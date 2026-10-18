import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ensureDir, exists, writeFile } from './util.js';

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: options.timeout || 30000,
  }).trim();
}

export function isGitRepo(root) {
  if (!exists(path.join(root, '.git'))) return false;
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

export function gitDirty(root) {
  try {
    return git(root, ['status', '--porcelain']).length > 0;
  } catch {
    return true;
  }
}

export function currentBranch(root) {
  try {
    return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || null;
  } catch {
    return null;
  }
}

export function branchExists(root, branch) {
  try {
    git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export function isAncestor(root, ref) {
  try {
    git(root, ['merge-base', '--is-ancestor', ref, 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

function safeSegment(value) {
  return String(value || 'task')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'task';
}

export function worktreePaths(root, change, taskId) {
  const base = path.join(path.resolve(root), '.specgate', 'worktrees', safeSegment(change));
  const task = safeSegment(taskId);
  const branchTask = ['test', 'format', 'review'].includes(task) ? task : `${task}-dev`;
  return {
    path: path.join(base, task),
    branch: `specgate/${safeSegment(change)}/${branchTask}`,
  };
}

export function createWorktree(root, change, task) {
  const { path: worktreePath, branch } = worktreePaths(root, change, task.id);
  ensureDir(path.dirname(worktreePath));
  const worktreesRoot = path.join(path.resolve(root), '.specgate', 'worktrees');
  ensureDir(worktreesRoot);
  const ignore = path.join(worktreesRoot, '.gitignore');
  if (!exists(ignore)) writeFile(ignore, '*\n');

  if (exists(worktreePath)) {
    if (branchExists(root, branch)) {
      return { ok: true, path: worktreePath, branch, reused: true };
    }
    throw new Error(`worktree 目录已存在但分支不存在：${worktreePath}`);
  }

  const args = branchExists(root, branch)
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath, 'HEAD'];
  try {
    git(root, args, { timeout: 60000 });
    return { ok: true, path: worktreePath, branch, reused: false };
  } catch (error) {
    throw new Error(`创建 worktree 失败：${error.stderr || error.message}`);
  }
}

export function removeWorktree(root, worktreePath) {
  try {
    git(root, ['worktree', 'remove', '--force', worktreePath], { timeout: 60000 });
    return true;
  } catch {
    return false;
  }
}

export function mergeBranch(root, branch) {
  try {
    git(root, ['merge', '--no-ff', '--no-edit', branch], { timeout: 120000 });
    return { ok: true, branch };
  } catch (error) {
    let conflicts = [];
    try {
      conflicts = git(root, ['diff', '--name-only', '--diff-filter=U'])
        .split(/\r?\n/)
        .filter(Boolean);
    } catch {
      conflicts = [];
    }
    try {
      git(root, ['merge', '--abort']);
    } catch {
      // A failed merge may already be clean.
    }
    return {
      ok: false,
      branch,
      conflicts,
      message: String(error.stderr || error.message || '').trim(),
    };
  }
}

export function headHash(root) {
  try {
    return git(root, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

export function headSubject(root) {
  try {
    return git(root, ['log', '-1', '--pretty=%s']);
  } catch {
    return null;
  }
}

export function diffNames(root, baseCommit, options = {}) {
  if (!baseCommit) return [];
  try {
    const args = ['diff', '--name-only', `${baseCommit}..HEAD`];
    if (options.cached) args.splice(1, 0, '--cached');
    return git(root, args)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
