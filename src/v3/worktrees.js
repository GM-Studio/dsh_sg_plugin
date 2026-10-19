import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { ensureDir, exists } from './util/fsx.js';

export function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 60000,
  }).trim();
}

function safe(segment) {
  return (
    String(segment || 'x')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'x'
  );
}

export function integrationBranch(change) {
  return `sg/${safe(change)}/integration`;
}

export function taskBranch(change, taskId) {
  return `sg/${safe(change)}/${safe(taskId)}`;
}

export function worktreePath(root, change, name) {
  return path.join(path.resolve(root), '.specgate', 'worktrees', safe(change), safe(name));
}

export function branchExists(root, branch) {
  try {
    git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function createWorktree(root, dir, branch, baseCommit) {
  ensureDir(path.dirname(dir));
  if (exists(dir)) {
    if (branchExists(root, branch)) return { ok: true, path: dir, branch, reused: true };
    return {
      ok: false,
      code: 'WORKTREE_BROKEN',
      message: `worktree 目录存在但分支 ${branch} 不存在`,
    };
  }
  try {
    if (branchExists(root, branch)) {
      git(root, ['worktree', 'add', dir, branch]);
    } else {
      git(root, ['worktree', 'add', '-b', branch, dir, baseCommit || 'HEAD']);
    }
  } catch (error) {
    return {
      ok: false,
      code: 'WORKTREE_FAILED',
      message: String(error.stderr || error.message).trim(),
    };
  }
  return { ok: true, path: dir, branch, reused: false };
}

export function ensureIntegration(root, change, baseCommit) {
  return createWorktree(root, worktreePath(root, change, 'integration'), integrationBranch(change), baseCommit);
}

export function ensureTask(root, change, taskId, baseCommit) {
  return createWorktree(root, worktreePath(root, change, taskId), taskBranch(change, taskId), baseCommit);
}

export function removeWorktree(root, dir) {
  try {
    git(root, ['worktree', 'remove', '--force', dir]);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: String(error.stderr || error.message).trim() };
  }
}

export function headOf(root, ref) {
  try {
    return git(root, ['rev-parse', ref]);
  } catch {
    return null;
  }
}

export function mergeIntoIntegration({ integrationPath, branch, expectedCommit, message }) {  const head = headOf(integrationPath, branch);
  if (!head) {
    return { ok: false, code: 'BRANCH_MISSING', message: `分支不存在：${branch}` };
  }
  if (expectedCommit && head !== expectedCommit) {
    return {
      ok: false,
      code: 'HEAD_MISMATCH',
      message: `分支 HEAD ${head} 与预期 ${expectedCommit} 不一致`,
    };
  }
  try {
    git(integrationPath, ['merge', '--no-ff', '-m', message || `merge ${branch}`, head]);
  } catch (error) {
    try {
      git(integrationPath, ['merge', '--abort']);
    } catch {
      // nothing to abort
    }
    return { ok: false, code: 'MERGE_CONFLICT', message: String(error.stderr || error.message).trim() };
  }
  return { ok: true, commit: headOf(integrationPath, 'HEAD') };
}

function parseNameStatus(output) {
  const entries = [];
  for (const line of String(output || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0][0];
    if (status === 'R' || status === 'C') {
      entries.push({ status: 'R', from: parts[1], path: parts[2] });
    } else {
      entries.push({ status, path: parts[1] });
    }
  }
  return entries;
}

const DENY_COMMON = [
  /^openspec\/specs\//,
  /^\.specgate\//,
  /^openspec\/changes\/[^/]+\/acceptance\.md$/,
  /^openspec\/changes\/[^/]+\/reviews\//,
  /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/,
  /^(jest|vitest|playwright)\.config\./,
  /^\.mocharc\./,
  /^\.github\//,
];

function isDeniedCommon(filePath) {
  return DENY_COMMON.some((pattern) => pattern.test(filePath));
}

function testerAllowed(entry, change, touched) {
  const automation = `openspec/changes/${change}/tests/automation/`;
  if (entry.status === 'A' && entry.path.startsWith(automation)) return true;
  if ((touched?.modify || []).includes(entry.path) && entry.status === 'M') return true;
  if ((touched?.delete || []).includes(entry.path) && entry.status === 'D') return true;
  if ((touched?.bootstrap || []).includes(entry.path) && ['A', 'M'].includes(entry.status)) {
    return true;
  }
  return false;
}

export function diffCheck({ root, branch, baseCommit, role, change, touched, phase }) {
  let base;
  try {
    base = git(root, ['merge-base', baseCommit, branch]);
  } catch (error) {
    return { ok: false, code: 'MERGE_BASE_FAILED', message: String(error.stderr || error.message) };
  }

  let entries;
  try {
    const withRename = parseNameStatus(git(root, ['diff', '--name-status', `${base}..${branch}`]));
    const withoutRename = parseNameStatus(
      git(root, ['diff', '--name-status', '--no-renames', `${base}..${branch}`]),
    );
    const byPath = new Map();
    for (const entry of [...withoutRename, ...withRename]) {
      byPath.set(`${entry.status}:${entry.path}`, entry);
    }
    entries = [...byPath.values()];
  } catch (error) {
    return { ok: false, code: 'DIFF_FAILED', message: String(error.stderr || error.message) };
  }

  const violations = [];
  for (const entry of entries) {
    const filePath = entry.path;
    let allowed = false;

    if (role === 'planner') {
      allowed =
        filePath.startsWith(`openspec/changes/${change}/`) &&
        !filePath.endsWith('acceptance.md');
      if (filePath.startsWith('docs/')) allowed = true;
    } else if (role === 'implementer') {
      allowed = !isDeniedCommon(filePath);
      if (filePath.startsWith('openspec/changes/')) allowed = false;
      if (filePath.startsWith('tests/')) allowed = false;
      if (filePath === 'package.json') allowed = false;
    } else if (role === 'tester') {
      allowed = testerAllowed(entry, change, touched) && !isDeniedCommon(filePath);
    } else if (role === 'reviewer') {
      allowed = false;
    }

    if (!allowed) {
      violations.push({
        path: filePath,
        status: entry.status,
        reason: `角色 ${role} 不允许 ${entry.status} ${filePath}`,
      });
    }
  }

  return { ok: violations.length === 0, violations, entries };
}

export function commitChangePackage(root, change, message) {
  try {
    git(root, ['add', `openspec/changes/${change}`]);
    for (const extra of [
      '.gitignore',
      '.specgate/config.yaml',
      'openspec/specs/.gitkeep',
      'openspec/changes/.gitkeep',
    ]) {
      try {
        git(root, ['add', extra]);
      } catch {
        // optional file
      }
    }
    const staged = git(root, ['diff', '--cached', '--name-only']);
    if (!staged) return { ok: true, skipped: true, commit: headOf(root, 'HEAD') };
    git(root, ['commit', '-q', '-m', message]);
    return { ok: true, commit: headOf(root, 'HEAD') };
  } catch (error) {
    return { ok: false, message: String(error.stderr || error.message).trim() };
  }
}
