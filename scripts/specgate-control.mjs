#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  controlExecutionEnvironment,
  localControlEnvironment,
  resolveControlRoot,
} from '../src/codex/control/config.js';
import { createLocalControlRuntime } from '../src/codex/control/runtime.js';
import { readDaemonStatus } from '../src/codex/control/daemon.js';
import { generateTotpSecret } from '../src/codex/control/step-up.js';

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
  const controlRoot = resolveControlRoot({ env });
  if (command === 'help') {
    return {
      ok: true,
      usage: [
        'specgate-control start [--project <path>]',
        'specgate-control stop',
        'specgate-control status',
        'specgate-control create --title <text> --request <text> [--project <path>]',
        'specgate-control list',
        'specgate-control attention',
        'specgate-control mfa',
        'specgate-control doctor [--project <path>]',
      ],
    };
  }
  if (command === 'start') {
    const existing = readDaemonStatus({ controlRoot });
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
      return { ok: true, alreadyRunning: true, ...existing.status };
    }
    fs.mkdirSync(controlRoot, { recursive: true, mode: 0o700 });
    const logPath = path.join(controlRoot, 'daemon.log');
    const logFd = fs.openSync(logPath, 'a', 0o600);
    let child;
    try {
      child = spawnImpl(process.execPath, [WORKER], {
        cwd: projectRoot,
        env: {
          ...env,
          SPECGATE_PROJECT_ROOT: projectRoot,
          SPECGATE_CONTROL_HOME: controlRoot,
        },
        detached: true,
        stdio: ['ignore', logFd, logFd],
        windowsHide: true,
      });
    } finally {
      fs.closeSync(logFd);
    }
    child.unref();
    const status = await waitForStatus(controlRoot);
    return status.ok ? { ok: true, ...status.status, logPath } : status;
  }
  if (command === 'status') {
    const status = readDaemonStatus({ controlRoot });
    if (!status.ok) return status;
    return {
      ok: true,
      running: pidAlive(status.status.pid),
      ...status.status,
    };
  }
  if (command === 'stop') {
    const status = readDaemonStatus({ controlRoot });
    if (!status.ok) return { ok: true, alreadyStopped: true };
    if (pidAlive(status.status.pid)) {
      const stopped = await requestGracefulStop({
        controlRoot,
        status: status.status,
        spawnImpl,
        platform,
      });
      if (!stopped)
        return { ok: false, code: 'DAEMON_STOP_FAILED', message: 'Daemon could not be stopped' };
    }
    fs.rmSync(path.join(controlRoot, 'daemon.json'), { force: true });
    fs.rmSync(path.join(controlRoot, 'stop.request'), { force: true });
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
    const codex = spawnSyncImpl(config.codexCommand, ['--version'], {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      env: controlExecutionEnvironment({
        env: config.codexHome ? { ...env, CODEX_HOME: config.codexHome } : env,
        projectRoot,
        controlRoot,
      }),
      maxBuffer: 1024 * 1024,
    });
    const codexAvailable = codex?.status === 0;
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
      isolation: {
        explicitProjectBinding: true,
        unrelatedMcpDisabled: true,
        controlSecretsExcluded: true,
      },
    };
  }
  const runtime = runtimeFactory({ env });
  if (command === 'create') {
    const bound = readDaemonStatus({ controlRoot });
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
    return runtime.service.createWorkItem({
      title,
      request,
      projectRoot: boundProjectRoot,
      priority: option(args, '--priority', 'normal'),
    });
  }
  if (command === 'list') return runtime.service.projection.listWorkItems();
  if (command === 'attention') return runtime.service.projection.listAttention();
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
