import { gitExecutable } from './core/git-runtime.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runAdoptionBaseline } from './baseline.js';
import { gitSafeDirectory } from './git-path.js';
import { applyAdoption } from './project-adopt.js';
import { createArtifactStore } from './core/artifact-store.js';
import { environmentExecutionContext } from './core/environment-execution.js';
import { managedEnvironment } from './core/environment.js';
import {
  claimBaselineWorker,
  observeBaselineProcess,
  writeLeaseJson,
} from './core/baseline-lease.js';
import { finishBaselineJob } from './baseline-job.js';

function writeStatus(target, value) {
  writeLeaseJson(target, value);
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function git(projectRoot, args) {
  return spawnSync(
    gitExecutable(),
    [
      '-c',
      `safe.directory=${gitSafeDirectory(projectRoot)}`,
      '-c',
      'core.filemode=false',
      '-c',
      'core.autocrlf=true',
      ...args,
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}

function recordEvidence(projectRoot, baselineRun, run) {
  const store = createArtifactStore({ projectRoot });
  return store.writeJson(`.specgate/codex/baseline-runs/${run.runId}/summary.json`, {
    schemaVersion: 1,
    runId: run.runId,
    previewHash: run.previewHash,
    projectId: run.preview.profile.projectId,
    commit: run.preview.git.commit,
    baseline: baselineRun.baseline || null,
    ...(baselineRun.ok
      ? {}
      : { failure: { code: baselineRun.code, message: baselineRun.message } }),
    commands: (baselineRun.results || []).map(({ command, result }) => ({
      id: command.id,
      kind: command.kind,
      cwd: command.cwd,
      argv: command.argv,
      executedArgv: result.argv || null,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      startedAt: result.startedAt || null,
      finishedAt: result.finishedAt || null,
      stdout: result.stdout,
      stderr: result.stderr,
    })),
  });
}

async function main() {
  const jobPath = option('--job');
  if (!jobPath)
    throw Object.assign(new Error('Baseline job path is required'), {
      code: 'BASELINE_JOB_INVALID',
    });
  const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
  claimBaselineWorker(job.lease);
  const status = {
    runId: job.runId,
    status: 'running',
    previewHash: job.preview.previewHash,
    startedAt: job.createdAt,
    totalCommands: Object.values(job.preview.profile.commands).flat().length,
    completedCommands: 0,
    currentCommand: null,
    pid: process.pid,
  };
  writeStatus(job.statusPath, status);
  const worktree = path.join(job.worktreeRoot, job.runId);
  if (fs.existsSync(worktree))
    throw Object.assign(new Error('Baseline worktree already exists; retained'), {
      code: 'BASELINE_WORKTREE_CONFLICT',
    });
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  const added = git(job.projectRoot, [
    'worktree',
    'add',
    '--detach',
    '--force',
    worktree,
    job.preview.git.commit,
  ]);
  if (added.status !== 0)
    throw Object.assign(new Error(added.stderr || 'Cannot create worktree'), {
      code: 'BASELINE_WORKTREE_FAILED',
    });
  let baselineRun;
  {
    const temporary = path.join(worktree, '.specgate', 'baseline-temporary');
    fs.mkdirSync(temporary, { recursive: true });
    const env = {
      ...managedEnvironment(),
      TEMP: temporary,
      TMP: temporary,
      TMPDIR: temporary,
      GOTMPDIR: temporary,
    };
    baselineRun = await runAdoptionBaseline({
      preview: { ...job.preview, root: worktree },
      executionContext: job.environmentReport
        ? environmentExecutionContext(job.environmentReport, {
            root: worktree,
            env,
          })
        : undefined,
      createdAt: job.createdAt,
      processObserver: (event) => observeBaselineProcess(job.lease, event),
      commandLease: job.lease,
      onProgress(progress) {
        Object.assign(status, progress);
        writeStatus(job.statusPath, status);
      },
    });
  }
  writeLeaseJson(path.join(path.dirname(job.statusPath), 'results.json'), baselineRun);
  if (!baselineRun.ok) {
    recordEvidence(job.projectRoot, baselineRun, job);
    finishBaselineJob(job, {
      ...status,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      currentCommand: null,
      code: baselineRun.code,
      message: baselineRun.message,
    });
    return;
  }
  const persisted = applyAdoption({
    projectRoot: job.projectRoot,
    previewHash: job.preview.previewHash,
    baseline: baselineRun.baseline,
  });
  if (!persisted.ok) {
    finishBaselineJob(job, {
      ...status,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      currentCommand: null,
      code: persisted.code,
      message: persisted.message,
      baselineStatus: baselineRun.baseline.status,
    });
    return;
  }
  const recorded = recordEvidence(job.projectRoot, baselineRun, job);
  if (!recorded.ok) {
    finishBaselineJob(job, {
      ...status,
      status: 'failed',
      code: 'BASELINE_EVIDENCE_FAILED',
      message: recorded.message || 'Baseline evidence could not be persisted',
      finishedAt: new Date().toISOString(),
      currentCommand: null,
    });
    return;
  }
  const removed = git(job.projectRoot, ['worktree', 'remove', '--force', worktree]);
  if (removed.status !== 0)
    throw Object.assign(new Error(removed.stderr || 'Cannot remove completed worktree'), {
      code: 'BASELINE_WORKTREE_CLEANUP_FAILED',
    });
  finishBaselineJob(job, { success: true });
}

main().catch((error) => {
  const jobPath = option('--job');
  if (!jobPath) return;
  try {
    const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
    finishBaselineJob(job, {
      runId: job.runId,
      status: 'failed',
      previewHash: job.preview.previewHash,
      startedAt: job.createdAt,
      finishedAt: new Date().toISOString(),
      code: error.code || 'BASELINE_WORKER_FAILED',
      message: error.message || 'Baseline worker failed',
      currentCommand: null,
    });
  } catch {
    // The worker cannot report through corrupt or missing job state.
  }
});
