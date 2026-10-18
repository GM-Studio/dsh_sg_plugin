import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { exists } from './util.js';

export class GitError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'GitError';
    this.code = options.code || 'GIT_ERROR';
    this.stderr = options.stderr || '';
  }
}

function cleanStderr(error) {
  const raw = error && error.stderr ? error.stderr.toString() : '';
  return raw.trim();
}

function runGit(cwd, args, options = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: options.timeout || 15000,
    }).trim();
  } catch (error) {
    const stderr = cleanStderr(error);
    throw new GitError(
      stderr || `git ${args.join(' ')} 失败`,
      { code: options.code || 'GIT_COMMAND_FAILED', stderr },
    );
  }
}

export function isGitRepo(root) {
  if (!exists(path.join(root, '.git'))) return false;
  try {
    return runGit(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

export function gitStatus(root) {
  if (!isGitRepo(root)) {
    return {
      isRepo: false,
      branch: null,
      dirty: 0,
      changes: [],
      lastCommit: null,
    };
  }

  let branch = null;
  try {
    branch = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  } catch {
    branch = '(no commits)';
  }

  let changes = [];
  try {
    const porcelain = runGit(root, ['status', '--porcelain']);
    changes = porcelain ? porcelain.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    changes = [];
  }

  let lastCommit = null;
  try {
    const line = runGit(root, ['log', '-1', '--pretty=%h%x09%s']);
    if (line) {
      const [hash, ...subject] = line.split('\t');
      lastCommit = { hash, subject: subject.join('\t') };
    }
  } catch {
    lastCommit = null;
  }

  return {
    isRepo: true,
    branch,
    dirty: changes.length,
    changes,
    lastCommit,
  };
}

export function gitInit(root) {
  if (isGitRepo(root)) return { created: false, root };
  runGit(root, ['init'], { code: 'GIT_INIT_FAILED' });
  return { created: true, root };
}

function ensureIdentity(root) {
  let name = '';
  let email = '';
  try {
    name = runGit(root, ['config', 'user.name']);
  } catch {
    name = '';
  }
  try {
    email = runGit(root, ['config', 'user.email']);
  } catch {
    email = '';
  }
  const envName = process.env.GIT_AUTHOR_NAME || process.env.GIT_COMMITTER_NAME;
  const envEmail = process.env.GIT_AUTHOR_EMAIL || process.env.GIT_COMMITTER_EMAIL;
  if ((name && email) || (envName && envEmail)) return;
  throw new GitError(
    'Git 用户身份未配置：请先执行 git config user.name "<name>" 与 git config user.email "<email>"',
    { code: 'GIT_IDENTITY_MISSING' },
  );
}

export function gitAddAndCommit(root, message, options = {}) {
  if (!isGitRepo(root)) {
    throw new GitError('当前项目不是 Git 仓库', { code: 'GIT_NOT_A_REPO' });
  }
  const trimmed = String(message || '').trim();
  if (!trimmed) {
    throw new GitError('commit message 不能为空', { code: 'GIT_MESSAGE_REQUIRED' });
  }

  const all = options.all !== false;
  const paths = Array.isArray(options.paths) ? options.paths.filter(Boolean) : [];

  if (all) {
    runGit(root, ['add', '-A'], { code: 'GIT_ADD_FAILED' });
  } else {
    if (paths.length === 0) {
      throw new GitError('paths 为空且 all=false', { code: 'GIT_PATHS_REQUIRED' });
    }
    runGit(root, ['add', '--', ...paths], { code: 'GIT_ADD_FAILED' });
  }

  const staged = runGit(root, ['diff', '--cached', '--name-only']);
  const files = staged ? staged.split(/\r?\n/).filter(Boolean) : [];
  if (files.length === 0) {
    return { committed: false, reason: 'no changes', files: [] };
  }

  ensureIdentity(root);
  runGit(root, ['commit', '-m', trimmed], { code: 'GIT_COMMIT_FAILED' });
  const hash = runGit(root, ['rev-parse', '--short', 'HEAD']);
  const subject = runGit(root, ['log', '-1', '--pretty=%s']);
  return { committed: true, hash, subject, files: files.length };
}

export function gitClean(root) {
  const status = gitStatus(root);
  if (!status.isRepo) {
    return { ok: false, code: 'GIT_NOT_A_REPO', message: '当前项目不是 Git 仓库', status };
  }
  if (status.dirty > 0) {
    return {
      ok: false,
      code: 'GIT_DIRTY',
      message: `工作区有 ${status.dirty} 个未提交改动；请先 commit`,
      status,
    };
  }
  return { ok: true, status };
}

export function formatGitStatus(status, language = 'zh') {
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  if (!status.isRepo) return en ? 'Git: not initialized' : 'Git：未初始化';
  const branch = status.branch || '(no branch)';
  const dirty = status.dirty > 0 ? `dirty ${status.dirty}` : 'clean';
  const last = status.lastCommit
    ? `${status.lastCommit.hash} ${status.lastCommit.subject}`
    : en
      ? 'no commits'
      : '无提交';
  return en
    ? `Git: ${branch} | ${dirty} | last commit: ${last}`
    : `Git：${branch} ｜ ${dirty} ｜ 最近提交：${last}`;
}
