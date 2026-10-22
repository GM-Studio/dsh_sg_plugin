#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CONTROL_MODE_ENV,
  controlExecutionEnvironment,
  localControlEnvironment,
  resolveControlEnvironment,
  resolveControlRoot,
} from '../src/codex/control/config.js';
import { createLocalControlRuntime } from '../src/codex/control/runtime.js';
import { readDaemonStatus } from '../src/codex/control/daemon.js';
import { generateTotpSecret } from '../src/codex/control/step-up.js';
import {
  DEFAULT_PROBE_TIMEOUT_MS,
  createSyncProbeRunner,
  describeDegradation,
  detectCapabilities,
} from '../src/codex/control/capabilities.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WORKER = path.join(SOURCE_ROOT, 'src/codex/control/daemon-worker.mjs');

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function forceStopProcessTree(pid, { spawnImpl, platform }) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  if (platform === 'win32') {
    const child = spawnImpl('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on?.('error', () => {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // The bounded wait below reports whether the process exited.
      }
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The bounded wait below reports whether the process exited.
    }
  }
}

async function requestGracefulStop({
  controlRoot,
  status,
  spawnImpl = spawn,
  platform = process.platform,
}) {
  const stopPath = path.join(controlRoot, 'stop.request');
  fs.writeFileSync(stopPath, JSON.stringify({ requestedAt: new Date().toISOString() }), {
    flag: 'w',
    mode: 0o600,
  });
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (!pidAlive(status.pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  forceStopProcessTree(status.pid, { spawnImpl, platform });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!pidAlive(status.pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function waitForStatus(controlRoot, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = readDaemonStatus({ controlRoot });
    if (status.ok && pidAlive(status.status.pid)) return status;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { ok: false, code: 'DAEMON_START_TIMEOUT', message: 'Control daemon did not start' };
}

export async function runControlCli({
  args = process.argv.slice(2),
  env = process.env,
  cwd = process.cwd(),
  spawnImpl = spawn,
  spawnSyncImpl = spawnSync,
  runtimeFactory = createLocalControlRuntime,
  platform = process.platform,
} = {}) {
  const command = args[0] || 'help';
  const requestedProjectRoot = option(args, '--project');
  const configuredProjectRoot = requestedProjectRoot || env.SPECGATE_PROJECT_ROOT || null;
  const projectRoot = path.resolve(configuredProjectRoot || cwd);
  const modeArg = option(args, '--mode');
  const controlRoot = resolveControlRoot({ env });
  // The mode-aware commands (start/stop/status/list/register/create/attention)
  // resolve their effective control home and port from the mode. Aggregate keeps
  // the shared home; isolated derives a per-project home/port. Invalid
  // mode/root/port fails closed instead of writing to the wrong home.
  const resolveMode = () => resolveControlEnvironment({ env, mode: modeArg, projectRoot });
  // The effective control home is already mode-resolved, so runtime reads pin the
  // aggregate mode and must not re-derive (and re-nest) an isolated home.
  const runtimeFor = (effectiveRoot) =>
    runtimeFactory({
      env: { ...env, SPECGATE_CONTROL_HOME: effectiveRoot, [CONTROL_MODE_ENV]: 'aggregate' },
    });
  if (command === 'help') {
    return {
      ok: true,
      usage: [
        'specgate-control start [--project <path>] [--mode aggregate|isolated]',
        'specgate-control stop [--project <path>] [--mode aggregate|isolated]',
        'specgate-control status [--project <path>] [--mode aggregate|isolated]',
        'specgate-control register --project <path> [--mode aggregate|isolated]',
        'specgate-control create --title <text> --request <text> [--project <path>]',
        'specgate-control list [--mode aggregate|isolated]',
        'specgate-control attention',
        'specgate-control mfa',
        'specgate-control doctor [--project <path>]',
        `Control mode defaults to aggregate; set --mode or ${CONTROL_MODE_ENV}=aggregate|isolated.`,
      ],
    };
  }
  if (command === 'start') {
    const resolved = resolveMode();
    if (!resolved.ok) return resolved;
    const effectiveControlRoot = resolved.controlRoot;
    const existing = readDaemonStatus({ controlRoot: effectiveControlRoot });
    if (existing.ok && pidAlive(existing.status.pid)) {
      if (
        configuredProjectRoot &&
        existing.status.projectRoot &&
        path.resolve(existing.status.projectRoot) !== path.resolve(configuredProjectRoot)
      )
        return {
          ok: false,
          code: 'PROJECT_BINDING_CONFLICT',
          message: 'The running daemon is bound to another project; stop it before rebinding',
          projectRoot: existing.status.projectRoot,
        };
      return {
        ok: true,
        alreadyRunning: true,
        mode: existing.status.mode || resolved.mode,
        ...existing.status,
      };
    }
    fs.mkdirSync(effectiveControlRoot, { recursive: true, mode: 0o700 });
    const logPath = path.join(effectiveControlRoot, 'daemon.log');
    const logFd = fs.openSync(logPath, 'a', 0o600);
    let child;
    try {
      child = spawnImpl(process.execPath, [WORKER], {
        cwd: projectRoot,
        env: {
          ...env,
          SPECGATE_PROJECT_ROOT: projectRoot,
          // The worker derives the isolated home itself from the base control
          // home + mode, so both sides compute the same root exactly once.
          SPECGATE_CONTROL_HOME: controlRoot,
          [CONTROL_MODE_ENV]: resolved.mode,
        },
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
      });
    } finally {
      fs.closeSync(logFd);
    }
    child.unref();
    const status = await waitForStatus(effectiveControlRoot);
    return status.ok
      ? {
          ok: true,
          mode: resolved.mode,
          controlRoot: effectiveControlRoot,
          ...status.status,
          logPath,
        }
      : status;
  }
  if (command === 'status') {
    const resolved = resolveMode();
    if (!resolved.ok) return resolved;
    const status = readDaemonStatus({ controlRoot: resolved.controlRoot });
    if (!status.ok) return status;
    let controlMode = status.status.mode || resolved.mode;
    let projects = Array.isArray(status.status.registeredProjects)
      ? status.status.registeredProjects
      : [];
    const runtime = runtimeFor(resolved.controlRoot);
    if (typeof runtime?.service?.projection?.listRegistry === 'function') {
      const registry = await runtime.service.projection.listRegistry();
      if (registry.ok) {
        projects = registry.projects;
        controlMode = registry.controlMode || controlMode;
      }
    }
    return {
      ok: true,
      running: pidAlive(status.status.pid),
      mode: controlMode,
      projects,
      ...status.status,
    };
  }
  if (command === 'stop') {
    const resolved = resolveMode();
    if (!resolved.ok) return resolved;
    const stopRoot = resolved.controlRoot;
    const status = readDaemonStatus({ controlRoot: stopRoot });
    if (!status.ok) return { ok: true, alreadyStopped: true };
    if (pidAlive(status.status.pid)) {
      const stopped = await requestGracefulStop({
        controlRoot: stopRoot,
        status: status.status,
        spawnImpl,
        platform,
      });
      if (!stopped)
        return { ok: false, code: 'DAEMON_STOP_FAILED', message: 'Daemon could not be stopped' };
    }
    fs.rmSync(path.join(stopRoot, 'daemon.json'), { force: true });
    fs.rmSync(path.join(stopRoot, 'stop.request'), { force: true });
    return { ok: true, stopped: true };
  }
  if (command === 'mfa') {
    const secret = env.SPECGATE_MFA_SECRET || generateTotpSecret();
    const label = encodeURIComponent('SpecGate:local-owner');
    return {
      ok: true,
      secret,
      otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=SpecGate&algorithm=SHA1&digits=6&period=30`,
      instruction:
        'Set SPECGATE_MFA_SECRET to this secret in the control daemon environment. Do not commit it.',
    };
  }
  if (command === 'doctor') {
    const config = localControlEnvironment(env);
    const codexEnv = controlExecutionEnvironment({
      env: config.codexHome ? { ...env, CODEX_HOME: config.codexHome } : env,
      projectRoot,
      controlRoot,
    });
    const codex = spawnSyncImpl(config.codexCommand, ['--version'], {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      env: codexEnv,
      maxBuffer: 1024 * 1024,
    });
    const codexAvailable = codex?.status === 0;
    // Bounded, non-interactive, read-only host capability probe. A `not-probed`
    // capability is reported honestly and never fails the command.
    const capabilityStates = await detectCapabilities({
      exec: createSyncProbeRunner({
        command: config.codexCommand,
        spawnSyncImpl,
        cwd: projectRoot,
        env: codexEnv,
        timeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
      }),
    });
    const degradation = describeDegradation(capabilityStates);
    return {
      ok: codexAvailable,
      platform,
      node: process.version,
      projectRoot,
      controlRoot,
      managementPublicUrl: config.managementPublicUrl,
      feishuConfigured: Boolean(config.feishuWebhookUrl),
      mfaConfigured: Boolean(config.mfaSecret),
      codex: {
        command: config.codexCommand,
        homeConfigured: Boolean(config.codexHome),
        sandbox: config.codexSandbox,
        available: codexAvailable,
        version: codexAvailable
          ? String(codex.stdout || '')
              .trim()
              .slice(0, 200)
          : null,
        ...(codexAvailable
          ? {}
          : {
              code: 'CODEX_UNAVAILABLE',
              message: 'The configured Codex command could not run --version',
            }),
      },
      capabilities: {
        states: capabilityStates,
        mode: degradation.mode,
        degradations: degradation.degradations,
        blocked: degradation.blocked,
        versionGateHint: degradation.versionGateHint,
      },
      isolation: {
        explicitProjectBinding: true,
        unrelatedMcpDisabled: true,
        controlSecretsExcluded: true,
      },
    };
  }
  if (command === 'register') {
    const resolved = resolveMode();
    if (!resolved.ok) return resolved;
    const runtime = runtimeFor(resolved.controlRoot);
    if (typeof runtime?.service?.registerProject !== 'function')
      return {
        ok: false,
        code: 'NOT_AVAILABLE',
        message: 'The control service cannot register projects',
      };
    const registered = await runtime.service.registerProject({ projectRoot, mode: resolved.mode });
    return { ...registered, mode: resolved.mode, controlRoot: resolved.controlRoot };
  }
  if (command === 'create') {
    const resolved = resolveMode();
    if (!resolved.ok) return resolved;
    const bound = readDaemonStatus({ controlRoot: resolved.controlRoot });
    const boundProjectRoot =
      !requestedProjectRoot && bound.ok && pidAlive(bound.status.pid) && bound.status.projectRoot
        ? path.resolve(bound.status.projectRoot)
        : projectRoot;
    const title = option(args, '--title');
    const request = option(args, '--request');
    if (!title || !request)
      return {
        ok: false,
        code: 'INVALID_ARGUMENT',
        message: '--title and --request are required',
      };
    const runtime = runtimeFor(resolved.controlRoot);
    return runtime.service.createWorkItem({
      title,
      request,
      projectRoot: boundProjectRoot,
      priority: option(args, '--priority', 'normal'),
    });
  }
  if (command === 'list') {
    const resolved = resolveMode();
    if (!resolved.ok) return resolved;
    const runtime = runtimeFor(resolved.controlRoot);
    const registry =
      typeof runtime?.service?.projection?.listRegistry === 'function'
        ? await runtime.service.projection.listRegistry()
        : { ok: true, projects: [] };
    if (!registry.ok) return registry;
    const workItems =
      typeof runtime?.service?.projection?.listWorkItems === 'function'
        ? await runtime.service.projection.listWorkItems()
        : { ok: true, workItems: [] };
    if (!workItems.ok) return workItems;
    return {
      ok: true,
      mode: resolved.mode,
      projects: registry.projects,
      workItems: workItems.workItems,
    };
  }
  if (command === 'attention') {
    const resolved = resolveMode();
    if (!resolved.ok) return resolved;
    const runtime = runtimeFor(resolved.controlRoot);
    return runtime.service.projection.listAttention();
  }
  return { ok: false, code: 'UNKNOWN_COMMAND', message: `Unknown command: ${command}` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runControlCli();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        code: error.code || 'CONTROL_CLI_FAILED',
        message: error.message || 'Control command failed',
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
