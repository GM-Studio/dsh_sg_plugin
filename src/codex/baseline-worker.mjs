import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runAdoptionBaseline } from './baseline.js';
import { applyAdoption } from './project-adopt.js';
import { createArtifactStore } from './core/artifact-store.js';

function writeStatus(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  }
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function git(projectRoot, args) {
  return spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${projectRoot}`,
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
    projectId: baselineRun.baseline.projectId,
    commit: baselineRun.baseline.commit,
    baseline: baselineRun.baseline,
    commands: baselineRun.results.map(({ command, result }) => ({
      id: command.id,
      kind: command.kind,
      cwd: command.cwd,
      argv: command.argv,
      status: result.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
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
  const worktree = path.join(os.tmpdir(), 'specgate-baseline-worktrees', job.runId);
  fs.rmSync(worktree, { recursive: true, force: true });
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
  try {
    baselineRun = await runAdoptionBaseline({
      preview: { ...job.preview, root: worktree },
      createdAt: job.createdAt,
      onProgress(progress) {
        Object.assign(status, progress);
        writeStatus(job.statusPath, status);
      },
    });
  } finally {
    git(job.projectRoot, ['worktree', 'remove', '--force', worktree]);
    git(job.projectRoot, ['worktree', 'prune']);
  }
  if (!baselineRun.ok) {
    writeStatus(job.statusPath, {
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
    writeStatus(job.statusPath, {
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
  recordEvidence(job.projectRoot, baselineRun, job);
  const stateRoot = path.dirname(path.dirname(job.statusPath));
  const stateParent = path.dirname(stateRoot);
  fs.rmSync(stateRoot, { recursive: true, force: true });
  if (fs.existsSync(stateParent) && fs.readdirSync(stateParent).length === 0)
    fs.rmdirSync(stateParent);
}

main().catch((error) => {
  const jobPath = option('--job');
  if (!jobPath) return;
  try {
    const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
    writeStatus(job.statusPath, {
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
