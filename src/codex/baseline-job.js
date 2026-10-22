import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashValue } from './events.js';
import { gitSafeDirectory } from './git-path.js';

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
    'git',
    [
      '-c',
      `safe.directory=${gitSafeDirectory(root)}`,
      '-c',
      'core.filemode=false',
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

function cleanupStaleWorktrees(root) {
  const listed = git(root, ['worktree', 'list', '--porcelain']);
  if (listed.status !== 0) return;
  const worktreeParent = path.join(os.tmpdir(), 'specgate-baseline-worktrees');
  for (const record of listed.stdout.trim().split(/\r?\n\r?\n/)) {
    const line = record.split(/\r?\n/).find((entry) => entry.startsWith('worktree '));
    if (!line) continue;
    const target = path.resolve(line.slice('worktree '.length));
    if (inside(worktreeParent, target) && target !== worktreeParent)
      git(root, ['worktree', 'remove', '--force', target]);
  }
  git(root, ['worktree', 'prune']);
}

function writeJson(target, value) {
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

export function startBaselineJob({
  projectRoot,
  preview,
  createdAt = new Date().toISOString(),
} = {}) {
  let root;
  try {
    root = fs.realpathSync(projectRoot);
  } catch {
    return failure('PROJECT_ROOT_MISSING', 'Project root is unavailable');
  }
  if (!preview?.ok || !preview.profile || preview.root !== root || !preview.git?.commit)
    return failure('BASELINE_PREVIEW_INVALID', 'A current adoption preview is required');
  let stateRoot;
  try {
    stateRoot = jobRoot(root);
    cleanupStaleWorktrees(root);
    fs.rmSync(stateRoot, { recursive: true, force: true });
    const runId = `baseline-run-${hashValue({
      projectId: preview.profile.projectId,
      previewHash: preview.previewHash,
      createdAt,
    }).slice(0, 16)}`;
    if (!RUN_ID.test(runId)) return failure('BASELINE_JOB_INVALID', 'Baseline run ID is invalid');
    const directory = path.join(stateRoot, runId);
    const jobPath = path.join(directory, 'job.json');
    const statusPath = path.join(directory, 'status.json');
    const status = {
      runId,
      status: 'running',
      previewHash: preview.previewHash,
      startedAt: createdAt,
      totalCommands: Object.values(preview.profile.commands).flat().length,
      completedCommands: 0,
      currentCommand: null,
      pid: null,
    };
    writeJson(jobPath, {
      schemaVersion: 1,
      runId,
      projectRoot: root,
      preview,
      statusPath,
      createdAt,
    });
    writeJson(statusPath, status);
    const child = spawn(process.execPath, [WORKER, '--job', jobPath], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    });
    status.pid = child.pid || null;
    writeJson(statusPath, status);
    child.unref();
    return { ok: true, ...visibleStatus(status) };
  } catch (error) {
    return failure(error.code || 'BASELINE_JOB_START_FAILED', error.message);
  }
}

export function getBaselineJob(projectRoot) {
  let root;
  let stateRoot;
  try {
    root = fs.realpathSync(projectRoot);
    stateRoot = jobRoot(root);
  } catch {
    return null;
  }
  if (!fs.existsSync(stateRoot)) return null;
  let directories;
  try {
    directories = fs
      .readdirSync(stateRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name));
  } catch {
    return null;
  }
  if (directories.length !== 1) return null;
  try {
    const statusPath = path.join(stateRoot, directories[0].name, 'status.json');
    const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    if (status?.runId !== directories[0].name || !['running', 'failed'].includes(status.status))
      return null;
    if (status.status === 'running' && Number.isSafeInteger(status.pid)) {
      let alive = true;
      try {
        process.kill(status.pid, 0);
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
        writeJson(statusPath, status);
      }
    }
    return visibleStatus(status);
  } catch {
    return null;
  }
}
