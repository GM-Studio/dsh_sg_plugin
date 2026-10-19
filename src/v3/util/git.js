import { execFileSync } from 'node:child_process';

export function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: options.timeout || 30000,
  }).trim();
}

export function isGitRepo(root) {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

export function headCommit(root) {
  try {
    return git(root, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

export function currentBranch(root) {
  try {
    return git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    return null;
  }
}

export function isClean(root) {
  try {
    return git(root, ['status', '--porcelain']).length === 0;
  } catch {
    return false;
  }
}
