import { gitExecutable } from './core/git-runtime.js';
import { environmentExecutionContext } from './core/environment-execution.js';
import { managedEnvironment } from './core/environment.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashValue } from './events.js';
import { gitSafeDirectory } from './git-path.js';
import {
  acquireBaselineLease,
  inspectBaselineLease,
  claimBaselineWorker,
  releaseBaselineLease,
  readLeaseJson,
  writeLeaseJson,
} from './core/baseline-lease.js';

const WORKER = fileURLToPath(new URL('./baseline-worker.mjs', import.meta.url));
const RUN_ID = /^baseline-run-[a-f0-9]{16}$/;

const failure = (code, message) => ({ ok: false, code, message });

function gitEnvironment() {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
    ),
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function git(root, args) {
  return spawnSync(
    gitExecutable(),
    [
      '-c',
      `safe.directory=${gitSafeDirectory(root)}`,
      '-c',
      'core.filemode=false',
      '-c',
      'core.longpaths=true',
      '-c',
      'core.autocrlf=true',
      ...args,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: gitEnvironment(),
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    },
  );
}

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function jobRoot(root) {
  const common = git(root, ['rev-parse', '--git-common-dir']);
  if (common.status !== 0) throw new Error(common.stderr || 'Cannot locate Git metadata');
  const commonDir = fs.realpathSync(path.resolve(root, common.stdout.trim()));
  const stateRoot = path.join(commonDir, 'specgate', 'baseline-jobs');
  if (!inside(commonDir, stateRoot)) throw new Error('Baseline state escaped Git metadata');
  return stateRoot;
}

export function baselineWorktreeRoot(root) {
  const configured = process.env.SPECGATE_BASELINE_WORKTREE_ROOT;
  const target = configured || path.join(jobRoot(root), 'worktrees');
  if (
    !path.isAbsolute(target) ||
    path.resolve(target) === path.parse(target).root ||
    path.resolve(target) === path.resolve(root)
  )
    throw new Error('Baseline worktrees require a dedicated absolute directory');
  return path.resolve(target);
}

function recoverBaselineJob(root, stateRoot, owner) {
  const directory = path.join(stateRoot, owner.runId);
  if (!RUN_ID.test(owner.runId)) throw new Error('Invalid expired baseline run');
  const file = path.join(directory, 'job.json');
  if (!fs.existsSync(file)) return;
  const job = readLeaseJson(file);
  if (job.lease?.token !== owner.token || job.projectRoot !== owner.projectRoot)
    throw new Error('Expired baseline ownership does not match its job; retained');
  const target = path.resolve(job.worktreeRoot, owner.runId);
  if (!inside(path.resolve(job.worktreeRoot), target) || path.basename(target) !== owner.runId)
    throw new Error('Expired baseline worktree path is invalid');
  if (fs.existsSync(target)) {
    const removed = git(root, ['worktree', 'remove', '--force', target]);
    if (removed.status !== 0)
      throw new Error(removed.stderr || 'Expired worktree could not be removed; retained');
  }
  const statusPath = path.join(directory, 'status.json');
  const previous = fs.existsSync(statusPath) ? readLeaseJson(statusPath) : {};
  writeJson(statusPath, {
    ...previous,
    runId: owner.runId,
    status: 'failed',
    code: 'BASELINE_WORKER_EXITED',
    message: 'Owner and tracked child processes exited; worktree reclaimed, job evidence retained',
    finishedAt: new Date().toISOString(),
    currentCommand: null,
  });
}

function writeJson(target, value) {
  writeLeaseJson(target, value);
}

function visibleStatus(status) {
  return {
    runId: status.runId,
    status: status.status,
    previewHash: status.previewHash,
    startedAt: status.startedAt,
    finishedAt: status.finishedAt || null,
    totalCommands: status.totalCommands || 0,
    completedCommands: status.completedCommands || 0,
    currentCommand: status.currentCommand || null,
    ...(status.code ? { code: status.code } : {}),
    ...(status.message ? { message: status.message } : {}),
    ...(status.baselineStatus ? { baselineStatus: status.baselineStatus } : {}),
    ...(status.baselineId ? { baselineId: status.baselineId } : {}),
  };
}

export function reserveBaselineJob({
  projectRoot,
  preview,
  createdAt = new Date().toISOString(),
  environmentReport,
} = {}) {
  let root;
  try {
    root = fs.realpathSync(projectRoot);
  } catch {
    return failure('PROJECT_ROOT_MISSING', 'Project root is unavailable');
  }
  if (!preview?.ok || !preview.profile || preview.root !== root || !preview.git?.commit)
    return failure('BASELINE_PREVIEW_INVALID', 'A current adoption preview is required');
  let stateRoot, heldLease;
  try {
    stateRoot = jobRoot(root);
    if (
      !fs.existsSync(path.join(path.dirname(stateRoot), 'baseline-lease')) &&
      fs.existsSync(stateRoot)
    ) {
      const previous = fs.readdirSync(stateRoot).filter((entry) => RUN_ID.test(entry));
      if (previous.length > 128)
        return failure(
          'BASELINE_HISTORY_LIMIT',
          'Baseline history requires inspection; no state was deleted',
        );
      for (const id of previous) {
        const status = readLeaseJson(path.join(stateRoot, id, 'status.json'));
        if (status.status === 'running')
          return failure(
            'BASELINE_ALREADY_RUNNING',
            'A legacy or unconfirmed baseline is present; inspect its owner before recovery',
          );
      }
    }
    const runId = `baseline-run-${hashValue({
      projectId: preview.profile.projectId,
      previewHash: preview.previewHash,
      createdAt,
      nonce: randomUUID(),
    }).slice(0, 16)}`;
    if (!RUN_ID.test(runId)) return failure('BASELINE_JOB_INVALID', 'Baseline run ID is invalid');
    const directory = path.join(stateRoot, runId);
    const jobPath = path.join(directory, 'job.json');
    const statusPath = path.join(directory, 'status.json');
    const acquired = acquireBaselineLease(
      path.join(path.dirname(stateRoot), 'baseline-lease'),
      {
        runId,
        projectRoot: root,
        previewHash: preview.previewHash,
        startedAt: createdAt,
      },
      (owner) => recoverBaselineJob(root, stateRoot, owner),
    );
    if (!acquired.ok) {
      const same =
        acquired.owner?.ownerAlive &&
        acquired.owner?.projectRoot === root &&
        acquired.owner?.previewHash === preview.previewHash;
      let active = getBaselineJob(root);
      if (
        !active ||
        (!acquired.owner?.workerPid && ['ENOENT', 'BASELINE_STATUS_INVALID'].includes(active.code))
      )
        active = { ...acquired.owner, status: 'running' };
      return same
        ? { ok: true, reused: true, ...visibleStatus(active) }
        : failure(
            'BASELINE_ALREADY_RUNNING',
            'Another baseline owns this Git repository; its worktree and evidence were preserved',
          );
    }
    const lease = acquired.lease;
    heldLease = lease;
    const status = {
      runId,
      status: 'running',
      previewHash: preview.previewHash,
      startedAt: createdAt,
      totalCommands: Object.values(preview.profile.commands).flat().length,
      completedCommands: 0,
      currentCommand: null,
      pid: process.pid,
    };
    writeJson(jobPath, {
      schemaVersion: 1,
      runId,
      projectRoot: root,
      preview,
      environmentReport,
      worktreeRoot: baselineWorktreeRoot(root),
      statusPath,
      createdAt,
      lease,
    });
    writeJson(statusPath, status);
    writeJson(path.join(path.dirname(stateRoot), 'baseline-current.json'), {
      runId,
      projectRoot: root,
      token: lease.token,
    });
    return { ok: true, ...visibleStatus(status), jobPath, statusPath, lease };
  } catch (error) {
    if (heldLease) {
      try {
        const statusPath = path.join(stateRoot, heldLease.runId, 'status.json');
        if (fs.existsSync(statusPath))
          writeJson(statusPath, {
            ...readLeaseJson(statusPath),
            status: 'failed',
            code: 'BASELINE_JOB_START_FAILED',
            message: error.message,
          });
        releaseBaselineLease(heldLease);
      } catch {
        /* retain uncertain ownership */
      }
    }
    return failure(error.code || 'BASELINE_JOB_START_FAILED', error.message);
  }
}

export function updateBaselineJob(job, patch) {
  const previous = readLeaseJson(job.statusPath);
  writeJson(job.statusPath, { ...previous, ...patch });
}

function removeIfEmpty(directory) {
  try {
    if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  }
}

export function finishBaselineJob(job, { success = false, ...patch } = {}) {
  if (!success) {
    updateBaselineJob(job, {
      ...patch,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      currentCommand: null,
    });
    releaseBaselineLease(job.lease);
    return;
  }
  const owner = inspectBaselineLease(job.lease.directory);
  if (
    !owner ||
    owner.token !== job.lease.token ||
    (owner.workerPid || owner.pid) !== process.pid ||
    owner.childAlive
  )
    throw new Error('Baseline ownership or child completion is not confirmed');
  const stateRoot = path.dirname(path.dirname(job.statusPath));
  const parent = path.dirname(stateRoot);
  writeJson(path.join(parent, 'baseline-current.json'), {
    runId: job.runId,
    token: job.lease.token,
    status: 'completed',
  });
  fs.rmSync(path.dirname(job.statusPath), { recursive: true });
  removeIfEmpty(path.join(stateRoot, 'worktrees'));
  removeIfEmpty(stateRoot);
  if (!fs.existsSync(stateRoot))
    fs.rmSync(path.join(parent, 'baseline-current.json'), { force: true });
  releaseBaselineLease(job.lease);
  removeIfEmpty(parent);
}

export function startBaselineJob(options = {}) {
  const reserved = reserveBaselineJob(options);
  if (!reserved.ok || reserved.reused) return reserved;
  const { jobPath, statusPath, lease } = reserved;
  try {
    const job = readLeaseJson(jobPath);
    const child = spawn(process.execPath, [WORKER, '--job', jobPath], {
      cwd: job.projectRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: job.environmentReport
        ? environmentExecutionContext(job.environmentReport, {
            root: job.projectRoot,
            env: managedEnvironment(),
          }).env
        : process.env,
    });
    child.once('error', (error) => {
      writeJson(statusPath, {
        ...reserved,
        status: 'failed',
        code: 'BASELINE_WORKER_SPAWN_FAILED',
        message: error.message,
      });
      releaseBaselineLease(lease);
    });
    if (child.pid) claimBaselineWorker(lease, child.pid);
    child.unref();
    return { ok: true, ...visibleStatus(reserved) };
  } catch (error) {
    writeJson(statusPath, {
      ...reserved,
      status: 'failed',
      code: error.code || 'BASELINE_JOB_START_FAILED',
      message: error.message,
    });
    return failure(error.code || 'BASELINE_JOB_START_FAILED', error.message);
  }
}

export function getBaselineJob(projectRoot) {
  // The worker publishes completion before removing its transient job files.
  // Reread the whole snapshot if cleanup crossed a read; persistent missing
  // state under an active lease remains a failure, never an inferred success.
  let result;
  for (let attempt = 0; attempt < 3; attempt++) {
    result = readBaselineJob(projectRoot);
    if (result?.code !== 'ENOENT') return result;
    if (attempt < 2) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return result;
}

function readBaselineJob(projectRoot) {
  let root;
  let stateRoot;
  try {
    root = fs.realpathSync(projectRoot);
    stateRoot = jobRoot(root);
  } catch {
    return null;
  }
  let runId;
  try {
    const lease = inspectBaselineLease(path.join(path.dirname(stateRoot), 'baseline-lease'));
    const pointer = fs.existsSync(path.join(path.dirname(stateRoot), 'baseline-current.json'))
      ? readLeaseJson(path.join(path.dirname(stateRoot), 'baseline-current.json'))
      : null;
    if (pointer?.status === 'completed' && !lease) return null;
    if (pointer?.status === 'completed' && lease)
      return visibleStatus({ ...lease, status: 'running' });
    runId = lease?.runId || pointer?.runId;
    if (!RUN_ID.test(runId || '')) return null;
  } catch (error) {
    return {
      status: 'failed',
      code: error.code || 'BASELINE_LEASE_INVALID',
      message: 'Baseline ownership is unreadable; state retained',
    };
  }
  try {
    const statusPath = path.join(stateRoot, runId, 'status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    if (status?.runId !== runId || !['running', 'failed'].includes(status.status))
      return {
        status: 'failed',
        runId,
        code: 'BASELINE_STATUS_INVALID',
        message: 'Baseline status is incomplete; state retained',
      };
    if (status.status === 'running' && Number.isSafeInteger(status.pid)) {
      const lease = inspectBaselineLease(path.join(path.dirname(stateRoot), 'baseline-lease'));
      let alive = true;
      try {
        process.kill(lease?.workerPid || status.pid, 0);
      } catch (error) {
        alive = error.code === 'EPERM';
      }
      if (!alive) {
        Object.assign(status, {
          status: 'failed',
          code: 'BASELINE_WORKER_EXITED',
          message: 'The detached baseline worker exited without a terminal result',
          finishedAt: new Date().toISOString(),
          currentCommand: null,
        });
      }
    }
    return visibleStatus(status);
  } catch (error) {
    return {
      status: 'failed',
      runId,
      code: error.code || 'BASELINE_STATUS_INVALID',
      message: 'Baseline status is unreadable; state retained',
    };
  }
}
