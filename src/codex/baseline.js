import { spawn } from 'node:child_process';
import path from 'node:path';
import { hashValue } from './events.js';
import { validateProjectBaseline } from './project-model.js';
import { projectCommandSpec } from './core/project-command.js';

const failure = (code, message) => ({ ok: false, code, message });
const STATUSES = new Set(['passed', 'failed', 'skipped', 'not-run', 'timeout', 'cancelled']);
const MAX_OUTPUT = 64 * 1024;
const COMMAND_ORDER = new Map([
  ['install', 0],
  ['build', 1],
  ['test', 2],
  ['lint', 3],
  ['format', 4],
  ['runtime', 5],
]);
const activeRuns = new Map();

export function commandsFor(profile) {
  return Object.entries(profile.commands)
    .sort(([left], [right]) => COMMAND_ORDER.get(left) - COMMAND_ORDER.get(right))
    .flatMap(([kind, commands]) => commands.map((command) => ({ ...command, kind })));
}

export function projectEnvironmentFingerprint(profile) {
  return hashValue({
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    targetBranch: profile.targetBranch,
    commands: profile.commands,
  });
}

function fingerprint(preview) {
  return projectEnvironmentFingerprint(preview.profile);
}

export function commandFailureSignature(command, result) {
  const detail = stableFailureDetail(result);
  return `${command.id}:${result.status}:exit=${result.exitCode ?? 'none'}:${hashValue(detail).slice(0, 12)}`;
}

export function legacyCommandFailureSignature(command, result) {
  const detail = String(result.stderr || result.stdout || result.status).trim();
  return `${command.id}:${result.status}:exit=${result.exitCode ?? 'none'}:${hashValue(detail).slice(0, 12)}`;
}

export function stableFailureDetail(result) {
  return String(result.stderr || result.stdout || result.status)
    .replace(/\r\n/g, '\n')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, '<timestamp>')
    .replace(/\b(?:PID|pid)\s*[:=]?\s*\d+/g, 'PID=<pid>')
    .replace(/\b\d+\s+---\s+/g, '<pid> --- ')
    .replace(/[A-Za-z]:\\[^\r\n\t ]+/g, '<path>')
    .replace(/\/(?:mnt|home|tmp|Users|var)\/[^\r\n\t ]+/g, '<path>')
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|sec|seconds)\b/g, '<duration>')
    .trim();
}

function stopProcess(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

export function runBaselineCommand({ command, cwd, timeoutMs = 15 * 60 * 1000, signal } = {}) {
  return new Promise((resolve) => {
    if (
      !command ||
      typeof command.id !== 'string' ||
      !Array.isArray(command.argv) ||
      command.argv.length === 0 ||
      !command.argv.every((entry) => typeof entry === 'string')
    ) {
      resolve({
        commandId: command?.id || null,
        status: 'failed',
        exitCode: null,
        stdout: '',
        stderr: 'Baseline command is invalid',
        durationMs: 0,
      });
      return;
    }
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer;
    let cancellation;
    const finish = (status, exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancellation);
      resolve({
        commandId: command.id,
        status,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    };
    if (signal?.aborted) {
      finish('cancelled', null);
      return;
    }
    let child;
    try {
      const resolved = projectCommandSpec(command.argv[0], command.argv.slice(1));
      child = spawn(resolved.command, resolved.args, {
        cwd,
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: resolved.windowsVerbatimArguments,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      stderr = String(error.message || error).slice(-4096);
      finish('failed', null);
      return;
    }
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk.toString('utf8')).slice(-MAX_OUTPUT);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-MAX_OUTPUT);
    });
    cancellation = () => {
      stopProcess(child);
      finish('cancelled', null);
    };
    signal?.addEventListener('abort', cancellation, { once: true });
    timer = setTimeout(
      () => {
        stopProcess(child);
        finish('timeout', null);
      },
      Math.max(1000, Math.min(timeoutMs, 30 * 60 * 1000)),
    );
    child.once('error', (error) => {
      stderr = (stderr + '\n' + String(error.message || error)).slice(-MAX_OUTPUT);
      finish('failed', null);
    });
    child.once('close', (code) => {
      finish(code === 0 ? 'passed' : 'failed', Number.isInteger(code) ? code : null);
    });
  });
}

export async function runAdoptionBaseline({
  preview,
  runner = runBaselineCommand,
  signal,
  createdAt = new Date().toISOString(),
  onProgress = () => {},
} = {}) {
  if (!preview?.ok || !preview.profile || !preview.git?.commit)
    return failure('BASELINE_PREVIEW_INVALID', 'A valid adoption preview is required');
  const commands = commandsFor(preview.profile);
  onProgress({
    status: 'running',
    totalCommands: commands.length,
    completedCommands: 0,
    currentCommand: commands[0]?.id || null,
  });
  if (commands.length === 0) {
    const baseline = {
      schemaVersion: 2,
      baselineId: `baseline-${hashValue({
        projectId: preview.profile.projectId,
        commit: preview.git.commit,
        status: 'partial',
      }).slice(0, 16)}`,
      projectId: preview.profile.projectId,
      commit: preview.git.commit,
      status: 'partial',
      knownFailures: [],
      unverifiedAreas: [
        {
          id: 'baseline-commands-missing',
          description: 'No safe build, test, lint, format or runtime command was discovered.',
          risk: 'The current project behavior is not verified by an executable baseline.',
        },
      ],
      commands: [],
      evidence: [],
      environmentFingerprint: fingerprint(preview),
      createdAt,
    };
    const checked = validateProjectBaseline(baseline);
    return checked.ok ? { ok: true, baseline, results: [] } : checked;
  }
  const results = [];
  for (const [index, command] of commands.entries()) {
    if (signal?.aborted) return failure('BASELINE_CANCELLED', 'Baseline execution was cancelled');
    onProgress({
      status: 'running',
      totalCommands: commands.length,
      completedCommands: index,
      currentCommand: command.id,
    });
    let result;
    try {
      result = await runner({
        command,
        cwd: path.join(preview.root, command.cwd),
        timeoutMs: command.timeoutMs,
        signal,
      });
    } catch (error) {
      if (signal?.aborted || error?.code === 'ABORT_ERR')
        return failure('BASELINE_CANCELLED', 'Baseline execution was cancelled');
      return failure(
        error?.code || 'BASELINE_RUN_FAILED',
        error?.message || 'Baseline command failed',
      );
    }
    if (
      !result ||
      result.commandId !== command.id ||
      !STATUSES.has(result.status) ||
      (result.exitCode !== null && !Number.isSafeInteger(result.exitCode))
    )
      return failure('BASELINE_RESULT_INVALID', 'Baseline runner returned an invalid result');
    if (result.status === 'cancelled')
      return failure('BASELINE_CANCELLED', 'Baseline execution was cancelled');
    results.push({ command, result });
    onProgress({
      status: 'running',
      totalCommands: commands.length,
      completedCommands: index + 1,
      currentCommand: commands[index + 1]?.id || null,
    });
  }
  const evidence = results.map(
    ({ command }) =>
      `baseline-${hashValue({ commandId: command.id, commit: preview.git.commit }).slice(0, 16)}`,
  );
  const knownFailures = [];
  const unverifiedAreas = [];
  results.forEach(({ command, result }, index) => {
    if (result.status === 'failed' || result.status === 'timeout') {
      knownFailures.push({
        id: `known-${hashValue({
          commandId: command.id,
          signature: commandFailureSignature(command, result),
        }).slice(0, 16)}`,
        signature: commandFailureSignature(command, result),
        commandId: command.id,
        scope: command.kind,
        evidence: evidence[index],
      });
    } else if (result.status !== 'passed') {
      unverifiedAreas.push({
        id: `unverified-${hashValue({ commandId: command.id, status: result.status }).slice(0, 16)}`,
        description: `${command.id} ended with ${result.status}.`,
        risk: 'The baseline does not prove this command category.',
      });
    }
  });
  const status =
    knownFailures.length > 0 ? 'known-failures' : unverifiedAreas.length > 0 ? 'partial' : 'green';
  const baseline = {
    schemaVersion: 2,
    baselineId: `baseline-${hashValue({
      projectId: preview.profile.projectId,
      commit: preview.git.commit,
      results: results.map(({ command, result }) => [command.id, result.status, result.exitCode]),
    }).slice(0, 16)}`,
    projectId: preview.profile.projectId,
    commit: preview.git.commit,
    status,
    knownFailures,
    unverifiedAreas,
    commands: [...new Set(commands.map((command) => command.id))],
    evidence,
    environmentFingerprint: fingerprint(preview),
    createdAt,
  };
  const checked = validateProjectBaseline(baseline);
  return checked.ok ? { ok: true, baseline, results } : checked;
}

function visibleRun(run) {
  return {
    runId: run.runId,
    status: run.status,
    previewHash: run.previewHash,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt || null,
    totalCommands: run.totalCommands || 0,
    completedCommands: run.completedCommands || 0,
    currentCommand: run.currentCommand || null,
    ...(run.code ? { code: run.code } : {}),
    ...(run.message ? { message: run.message } : {}),
    ...(run.baselineStatus ? { baselineStatus: run.baselineStatus } : {}),
    ...(run.baselineId ? { baselineId: run.baselineId } : {}),
    ...(run.evidenceWarning ? { evidenceWarning: run.evidenceWarning } : {}),
  };
}

export function startAdoptionBaseline({
  preview,
  runner = runBaselineCommand,
  persist,
  record,
  createdAt = new Date().toISOString(),
} = {}) {
  if (!preview?.ok || !preview.profile || !preview.git?.commit)
    return failure('BASELINE_PREVIEW_INVALID', 'A valid adoption preview is required');
  const existing = activeRuns.get(preview.root);
  if (existing?.status === 'running') {
    if (existing.previewHash === preview.previewHash) return { ok: true, ...visibleRun(existing) };
    return failure(
      'BASELINE_ALREADY_RUNNING',
      'A baseline for another project preview is already running',
    );
  }
  const run = {
    runId: `baseline-run-${hashValue({
      projectId: preview.profile.projectId,
      previewHash: preview.previewHash,
      createdAt,
    }).slice(0, 16)}`,
    status: 'running',
    previewHash: preview.previewHash,
    root: preview.root,
    startedAt: createdAt,
    totalCommands: commandsFor(preview.profile).length,
    completedCommands: 0,
    currentCommand: null,
  };
  activeRuns.set(preview.root, run);
  void Promise.resolve()
    .then(() =>
      runAdoptionBaseline({
        preview,
        runner,
        createdAt,
        onProgress(progress) {
          Object.assign(run, progress);
        },
      }),
    )
    .then(async (result) => {
      if (!result?.ok) {
        Object.assign(run, {
          status: 'failed',
          code: result?.code || 'BASELINE_RUN_FAILED',
          message: result?.message || 'Baseline execution failed',
          finishedAt: new Date().toISOString(),
          currentCommand: null,
        });
        return;
      }
      if (typeof persist !== 'function') {
        Object.assign(run, {
          status: 'failed',
          code: 'BASELINE_PERSISTENCE_UNAVAILABLE',
          message: 'Baseline persistence is unavailable',
          finishedAt: new Date().toISOString(),
          currentCommand: null,
        });
        return;
      }
      let persisted;
      try {
        persisted = await persist(result.baseline);
      } catch {
        persisted = failure('BASELINE_PERSIST_FAILED', 'Baseline persistence failed');
      }
      if (!persisted?.ok) {
        Object.assign(run, {
          status: 'failed',
          code: persisted?.code || 'BASELINE_PERSIST_FAILED',
          message: persisted?.message || 'Baseline persistence failed',
          finishedAt: new Date().toISOString(),
          currentCommand: null,
          baselineStatus: result.baseline.status,
        });
        return;
      }
      let evidenceWarning = null;
      if (typeof record === 'function') {
        try {
          const recorded = await record(result, run);
          if (recorded?.ok === false)
            evidenceWarning = recorded.message || 'Baseline evidence could not be recorded';
        } catch {
          evidenceWarning = 'Baseline evidence could not be recorded';
        }
      }
      Object.assign(run, {
        status: 'completed',
        baselineStatus: result.baseline.status,
        baselineId: result.baseline.baselineId,
        finishedAt: new Date().toISOString(),
        currentCommand: null,
        ...(evidenceWarning ? { evidenceWarning } : {}),
      });
    })
    .catch(() => {
      Object.assign(run, {
        status: 'failed',
        code: 'BASELINE_RUN_FAILED',
        message: 'Baseline execution failed',
        finishedAt: new Date().toISOString(),
        currentCommand: null,
      });
    });
  return { ok: true, ...visibleRun(run) };
}

export function getAdoptionBaselineRun(root) {
  const run = activeRuns.get(root);
  return run ? visibleRun(run) : null;
}
