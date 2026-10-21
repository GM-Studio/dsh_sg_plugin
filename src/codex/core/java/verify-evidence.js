import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { patchState } from '../state.js';

export const VERIFY_STAGES = [
  'backend-verify',
  'frontend-install',
  'frontend-build',
  'frontend-test',
  'frontend-lint',
  'frontend-format',
  'coverage',
  'runtime',
];
export const FULL_VERIFY_STAGES = [...VERIFY_STAGES, 'browser'];

export function createVerification(root, preset, { full = false } = {}) {
  const expectedStages = full ? FULL_VERIFY_STAGES : VERIFY_STAGES;
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const directory = path.join(root, '.specgate', 'verify-runs', runId);
  fs.mkdirSync(directory, { recursive: true });
  const report = {
    schemaVersion: 2,
    runId,
    preset: preset.id,
    label: preset.label,
    status: 'running',
    ok: false,
    startedAt: new Date().toISOString(),
    stages: [],
    expectedStages,
  };
  function save(patch = {}) {
    Object.assign(report, patch, { checkedAt: new Date().toISOString() });
    if (
      report.ok &&
      (report.stages.length !== expectedStages.length ||
        expectedStages.some(
          (name) =>
            report.stages.filter((stage) => stage.name === name && stage.status === 0).length !== 1,
        ))
    )
      throw new Error('Verification reconciliation incomplete: cannot mark passed');
    const passed = report.stages.filter((stage) => stage.status === 0).length;
    const failed = report.stages.filter((stage) => stage.status !== 0).length;
    report.reconciliation = {
      expected: expectedStages.length,
      executed: report.stages.length,
      passed,
      failed,
      notRun: expectedStages.length - report.stages.length,
    };
    report.checks = expectedStages.map((name) => {
      const stage = report.stages.find((item) => item.name === name);
      return {
        name,
        status: stage ? (stage.status === 0 ? 'passed' : 'failed') : 'not-run',
        ...(stage ? { log: stage.log, exitCode: stage.status } : {}),
      };
    });
    const text = JSON.stringify(report, null, 2) + '\n';
    for (const file of [
      path.join(directory, 'report.json'),
      path.join(root, '.specgate', 'verify-report.json'),
    ]) {
      fs.writeFileSync(file + '.tmp', text);
      fs.renameSync(file + '.tmp', file);
    }
    const initFile = path.join(root, '.specgate', 'init-report.json');
    if (fs.existsSync(initFile)) {
      const init = JSON.parse(fs.readFileSync(initFile, 'utf8'));
      init.phase =
        report.phase || (report.ok ? 'SMOKE_PASSED' : 'VERIFY_' + report.status.toUpperCase());
      init.initializationComplete = report.ok;
      init.verification = {
        kind: 'local-sg-verify',
        ok: report.ok,
        runId,
        checkedAt: report.checkedAt,
        report: '.specgate/verify-runs/' + runId + '/report.json',
        failedStage: report.failedStage || null,
      };
      init.execution = Object.fromEntries(report.checks.map((check) => [check.name, check.status]));
      fs.writeFileSync(initFile, JSON.stringify(init, null, 2) + '\n');
    }
    const stateFile = path.join(root, '.specgate', 'state.json');
    if (fs.existsSync(stateFile)) {
      const saved = patchState(root, (draft) => {
        const phase =
          report.phase || (report.ok ? 'SMOKE_PASSED' : 'VERIFY_' + report.status.toUpperCase());
        draft.initialization = {
          ...(draft.initialization || {}),
          phase,
          initializationComplete: report.ok,
          verification: {
            kind: 'local-sg-verify',
            ok: report.ok,
            runId,
            checkedAt: report.checkedAt,
            report: '.specgate/verify-runs/' + runId + '/report.json',
            failedStage: report.failedStage || null,
          },
        };
      });
      if (!saved.ok) throw new Error('Unable to persist verification state: ' + saved.message);
    }
    return report;
  }
  save();
  return { report, save, directory };
}

export function commandSpec(command, args) {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) return { command, args };
  const quote = (value) => {
    if (/["\r\n%&|<>^!]/.test(value)) throw new Error('Unsafe Windows command argument');
    return '"' + value + '"';
  };
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', '"' + [command, ...args].map(quote).join(' ') + '"'],
    windowsVerbatimArguments: true,
  };
}

export async function executeVerificationStage({
  name,
  command,
  args,
  cwd,
  env,
  timeoutMs,
  signal,
  directory,
  root,
}) {
  const startedAt = new Date().toISOString();
  const logFile = path.join(directory, name + '.log');
  const fd = fs.openSync(logFile, 'w');
  let status = 1,
    error = null,
    reason = null;
  let tail = '';
  try {
    if (signal?.aborted) throw new Error('Verification cancelled');
    const spec = commandSpec(command, args);
    await new Promise((resolve) => {
      const child = spawn(spec.command, spec.args, {
        cwd,
        env,
        windowsHide: true,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const capture = (chunk) => {
        fs.writeSync(fd, chunk);
        tail = (tail + chunk.toString()).slice(-12000);
      };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);
      const stop = (why) => {
        if (reason) return;
        reason = why;
        if (process.platform === 'win32' && child.pid) {
          const killed = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
            timeout: 2000,
          });
          if (killed.status !== 0) child.kill('SIGKILL');
        } else child.kill('SIGKILL');
      };
      const abort = () => stop('cancelled');
      const timer = setTimeout(() => stop('timeout'), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      child.once('error', (cause) => {
        error = cause.message;
      });
      child.once('close', (code, exitSignal) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        status = reason ? 1 : (code ?? 1);
        if (exitSignal && !reason) reason = exitSignal;
        resolve();
      });
    });
  } catch (cause) {
    error = cause.message;
  } finally {
    if (error || reason) fs.writeSync(fd, '\n' + (error || reason));
    fs.closeSync(fd);
  }
  return {
    name,
    command,
    args,
    cwd,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - Date.parse(startedAt),
    status,
    reason,
    error,
    log: path.relative(root, logFile).replace(/\\/g, '/'),
    tail: (tail + '\n' + (error || reason || '')).split(/\r?\n/).filter(Boolean).slice(-12),
  };
}
