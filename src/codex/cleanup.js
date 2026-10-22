import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CHANGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const failure = (code, message) => ({ ok: false, code, message });

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function git(root, args) {
  return spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${root}`,
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
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
        ),
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}

function registeredWorktrees(root) {
  const listed = git(root, ['worktree', 'list', '--porcelain']);
  if (listed.status !== 0) throw new Error(listed.stderr || 'Cannot inspect worktrees');
  return listed.stdout
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(Boolean)
    .map((record) =>
      Object.fromEntries(
        record
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            const separator = line.indexOf(' ');
            return separator < 0
              ? [line, true]
              : [line.slice(0, separator), line.slice(separator + 1)];
          }),
      ),
    )
    .filter((entry) => typeof entry.worktree === 'string');
}

export function cleanupArchivedWorkspaces({ projectRoot, changeId } = {}) {
  if (typeof changeId !== 'string' || !CHANGE_ID.test(changeId))
    return failure('INVALID_CHANGE_ID', 'A bounded changeId is required');
  let root;
  try {
    root = fs.realpathSync(projectRoot);
  } catch {
    return failure('PROJECT_ROOT_MISSING', 'Project root is unavailable');
  }
  if (inside(SOURCE_ROOT, root) || inside(root, SOURCE_ROOT))
    return failure(
      'SOURCE_REPOSITORY_FORBIDDEN',
      'The plugin source cannot be cleaned as a product',
    );
  const workspaceRoot = path.join(root, '.specgate/codex/worktrees');
  const changeRoot = path.join(workspaceRoot, changeId);
  const tempRoot = path.join(root, '.specgate/codex/changes', changeId, 'tmp');
  if (!inside(workspaceRoot, changeRoot) || !inside(root, tempRoot))
    return failure('UNSAFE_PATH', 'Cleanup target escaped the project');

  const removedWorktrees = [];
  const removedBranches = [];
  const errors = [];
  let worktrees = [];
  try {
    worktrees = registeredWorktrees(root);
  } catch (error) {
    return failure('WORKTREE_INSPECTION_FAILED', error.message);
  }
  for (const entry of worktrees) {
    const target = path.resolve(entry.worktree);
    if (!inside(changeRoot, target) || target === changeRoot) continue;
    const removed = git(root, ['worktree', 'remove', '--force', target]);
    if (removed.status === 0) removedWorktrees.push(target);
    else
      errors.push({ target, message: (removed.stderr || '').trim() || 'Worktree removal failed' });
  }
  git(root, ['worktree', 'prune']);

  const prefix = `sg/codex/${changeId}/`;
  const branches = git(root, ['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}`]);
  if (branches.status === 0) {
    for (const branch of branches.stdout.split(/\r?\n/).filter(Boolean)) {
      if (!branch.startsWith(prefix)) continue;
      const removed = git(root, ['branch', '-D', branch]);
      if (removed.status === 0) removedBranches.push(branch);
      else
        errors.push({ branch, message: (removed.stderr || '').trim() || 'Branch removal failed' });
    }
  } else {
    errors.push({ branch: prefix, message: (branches.stderr || '').trim() });
  }

  let removedTemporaryDirectory = false;
  try {
    if (fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      removedTemporaryDirectory = true;
    }
    if (fs.existsSync(changeRoot) && fs.readdirSync(changeRoot).length === 0)
      fs.rmdirSync(changeRoot);
  } catch (error) {
    errors.push({ target: tempRoot, message: error.message });
  }

  return {
    ok: errors.length === 0,
    changeId,
    removedWorktrees,
    removedBranches,
    removedTemporaryDirectory,
    errors,
    preserved: [
      `.specgate/codex/changes/${changeId}/evidence`,
      `.specgate/codex/changes/${changeId}/review`,
      `.specgate/codex/changes/${changeId}/quality`,
      `.specgate/codex/archive/${changeId}`,
      `.specgate/codex/deliveries`,
    ],
  };
}
