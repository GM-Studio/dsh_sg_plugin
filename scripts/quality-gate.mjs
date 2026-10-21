#!/usr/bin/env node
// Quality gate for the SpecGate plugin repository.
//
//   commit  staged files: lint -> format -> stage (fast, runs in pre-commit)
//   push    files in this push: lint -> tests -> format check (pre-push)
//   ci      files changed against a base: lint -> format check (GitHub Actions)
//   all     files changed against a base: lint -> format -> stage (manual fix)
//
// Exit code 1 blocks the git operation and prints a Chinese error report.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { isolatedTestEnvironment } from './quality-test-env.mjs';

const ZERO_SHA = /^0+$/;
const REVIEW_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);
const FORMAT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.json', '.yml', '.yaml']);
const STAGES = new Set(['commit', 'push', 'ci', 'all']);
// Keep in sync with .prettierignore; passing an ignored file explicitly makes
// both ESLint and Prettier exit with "no files matching".
const IGNORED_DIRECTORIES = ['node_modules/', 'dist/', 'coverage/', 'assets/', 'docs/'];
const IGNORED_FILES = new Set(['package-lock.json']);

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

function run(bin, args, options = {}) {
  return execFileSync(bin, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function git(args) {
  return run('git', args);
}

function gitSucceeds(args) {
  try {
    execFileSync('git', args, { cwd: repoRoot, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const options = {
    stage: 'commit',
    base: null,
    fix: false,
    tests: null,
    lint: true,
  };
  for (const arg of argv) {
    if (arg === '--fix') options.fix = true;
    else if (arg === '--check') options.fix = false;
    else if (arg === '--tests') options.tests = true;
    else if (arg === '--no-tests') options.tests = false;
    else if (arg === '--no-lint') options.lint = false;
    else if (arg.startsWith('--stage=')) options.stage = arg.slice('--stage='.length);
    else if (arg.startsWith('--base=')) options.base = arg.slice('--base='.length);
    else throw new Error(`未知参数：${arg}`);
  }
  if (!STAGES.has(options.stage)) {
    throw new Error(`未知阶段：${options.stage}（可选 commit/push/ci/all）`);
  }
  if (options.tests === null) options.tests = options.stage === 'push';
  return options;
}

function readStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function unique(list) {
  return [...new Set(list)];
}

function normalizeFile(file) {
  return file.replace(/\\/g, '/');
}

function extensionOf(file) {
  return path.extname(file).toLowerCase();
}

function isIgnoredPath(file) {
  return (
    IGNORED_DIRECTORIES.some((directory) => file.startsWith(directory)) ||
    IGNORED_FILES.has(file) ||
    file.endsWith('.tgz')
  );
}

function filterFiles(files) {
  return unique(
    files.map(normalizeFile).filter((file) => file && existsSync(path.join(repoRoot, file))),
  );
}

function mergeBaseOf(ref) {
  try {
    return git(['merge-base', 'HEAD', ref]);
  } catch {
    return null;
  }
}

function upstreamRef() {
  try {
    return git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).trim();
  } catch {
    return null;
  }
}

function resolveBase(candidate) {
  if (
    candidate &&
    !ZERO_SHA.test(candidate) &&
    gitSucceeds(['rev-parse', '--verify', `${candidate}^{commit}`])
  ) {
    return mergeBaseOf(candidate) || candidate;
  }
  const upstream = upstreamRef();
  for (const ref of [upstream, 'origin/main', 'origin/master', 'main', 'master'].filter(Boolean)) {
    if (gitSucceeds(['rev-parse', '--verify', `${ref}^{commit}`])) {
      const base = mergeBaseOf(ref);
      if (base) return base;
    }
  }
  return git(['rev-list', '--max-parents=0', 'HEAD']);
}

function changedFilesBetween(base, head = 'HEAD') {
  if (!base) return [];
  const output = git(['diff', '--name-only', '--diff-filter=ACMR', `${base}..${head}`]);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function stagedFiles() {
  const output = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function parsePushTargets(stdin) {
  return stdin
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    })
    .filter((target) => target.localSha && !ZERO_SHA.test(target.localSha));
}

function collectChangedFiles(options, stdin) {
  if (options.stage === 'commit') {
    return { files: stagedFiles(), description: '暂存区（本次 commit）' };
  }
  if (options.stage === 'push') {
    const targets = parsePushTargets(stdin);
    if (targets.length === 0) {
      const base = resolveBase(options.base);
      return {
        files: changedFilesBetween(base),
        description: `与 ${base.slice(0, 8)} 之间的变更`,
      };
    }
    const files = [];
    for (const target of targets) {
      const hasRemote =
        target.remoteSha &&
        !ZERO_SHA.test(target.remoteSha) &&
        gitSucceeds(['cat-file', '-e', `${target.remoteSha}^{commit}`]);
      const base = hasRemote ? target.remoteSha : resolveBase(options.base);
      files.push(...changedFilesBetween(base, target.localSha));
    }
    return { files, description: '本次 push 包含的变更' };
  }
  const base = resolveBase(options.base);
  return { files: changedFilesBetween(base), description: `与 ${base.slice(0, 8)} 之间的变更` };
}

function banner(lines) {
  const width = 64;
  const body = Array.isArray(lines) ? lines : [lines];
  console.error(`\n${'='.repeat(width)}`);
  for (const line of body) console.error(line);
  console.error(`${'='.repeat(width)}\n`);
}

function blocked(title, details) {
  banner([`[quality-gate] ${title}`]);
  if (details) console.error(details);
  console.error('\n本次操作已被阻止，没有推送到远程仓库。');
  process.exit(1);
}

function describeFiles(files) {
  const preview = files.slice(0, 30).map((file) => `  - ${file}`);
  if (files.length > preview.length)
    preview.push(`  ... 其余 ${files.length - preview.length} 个文件`);
  return preview.join('\n');
}

function lintFiles(files) {
  if (files.length === 0) return true;
  const eslintBin = path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (!existsSync(eslintBin)) {
    blocked('缺少 ESLint 依赖', '请先在仓库根目录执行：npm install');
  }
  console.log(`[quality-gate] 代码审查（ESLint）：${files.length} 个文件`);
  const result = spawnSync(process.execPath, [eslintBin, '--no-warn-ignored', ...files], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    blocked(
      '代码审查未通过，push 已被阻止',
      'ESLint 发现了必须修复的问题。修复后重新提交，再执行 push。',
    );
  }
  return true;
}

function runTests() {
  console.log('[quality-gate] 代码审查（单元测试）：npm test');
  const result = spawnSync('npm test', {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
    env: isolatedTestEnvironment(
      process.env,
      git(['rev-parse', '--local-env-vars']).split(/\r?\n/),
    ),
  });
  if (result.status !== 0) {
    blocked('代码审查未通过，push 已被阻止', '单元测试失败。修复测试后重新提交，再执行 push。');
  }
  return true;
}

function prettierBin() {
  const bin = path.join(repoRoot, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
  if (!existsSync(bin)) {
    blocked('缺少 Prettier 依赖', '请先在仓库根目录执行：npm install');
  }
  return bin;
}

function formatFiles(files, write) {
  if (files.length === 0) return { ok: true, changed: false };
  console.log(
    `[quality-gate] ${write ? '格式化' : '格式检查'}（Prettier）：${files.length} 个文件`,
  );
  const result = spawnSync(
    process.execPath,
    [prettierBin(), write ? '--write' : '--check', ...files],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  return { ok: result.status === 0, changed: write };
}

function stageFiles(files) {
  if (files.length === 0) return;
  execFileSync('git', ['add', '--', ...files], { cwd: repoRoot, stdio: 'inherit' });
}

function snapshotFiles(files) {
  const snapshot = new Map();
  for (const file of files) {
    try {
      snapshot.set(file, readFileSync(path.join(repoRoot, file), 'utf8'));
    } catch {
      snapshot.set(file, null);
    }
  }
  return snapshot;
}

function changedContentFiles(files, snapshot) {
  return files.filter((file) => {
    try {
      return readFileSync(path.join(repoRoot, file), 'utf8') !== snapshot.get(file);
    } catch {
      return false;
    }
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const stdin = options.stage === 'push' ? readStdin() : '';
  const { files: rawFiles, description } = collectChangedFiles(options, stdin);
  const files = filterFiles(rawFiles);
  const reviewFiles = files.filter(
    (file) => !isIgnoredPath(file) && REVIEW_EXTENSIONS.has(extensionOf(file)),
  );
  const formatTargets = files.filter(
    (file) => !isIgnoredPath(file) && FORMAT_EXTENSIONS.has(extensionOf(file)),
  );

  console.log(`[quality-gate] 阶段：${options.stage}；范围：${description}`);
  if (files.length === 0) {
    console.log('[quality-gate] 没有需要审查的文件，放行。');
    return;
  }
  console.log(`[quality-gate] 变更文件 ${files.length} 个：\n${describeFiles(files)}\n`);

  if (options.lint) lintFiles(reviewFiles);
  if (options.tests) runTests();

  if (options.fix) {
    const before = snapshotFiles(formatTargets);
    formatFiles(formatTargets, true);
    const formatted = changedContentFiles(formatTargets, before);
    stageFiles(formatted);
    if (options.stage === 'push' && formatted.length > 0) {
      banner([
        '[quality-gate] 代码已自动格式化，push 已被阻止',
        '格式化结果已暂存到 Git 索引。',
        '请执行 git commit 提交格式化结果，然后重新执行 git push。',
      ]);
      process.exit(1);
    }
    console.log('[quality-gate] 代码审查与格式化均通过。');
    return;
  }

  const formatResult = formatFiles(formatTargets, false);
  if (!formatResult.ok) {
    blocked(
      '格式检查未通过，push 已被阻止',
      '存在未格式化的文件。执行 `npm run gate:fix` 后提交，再重新 push。',
    );
  }
  console.log('[quality-gate] 代码审查与格式检查均通过，放行。');
}

try {
  main();
} catch (error) {
  banner([`[quality-gate] 执行失败：${error.message}`]);
  process.exit(1);
}
