import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { detectProject } from '../src/codex/project-detect.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-project-detect-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fullstack(t) {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend', 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backend', 'pom.xml'),
    '<project><modelVersion>4.0.0</modelVersion></project>\n',
  );
  fs.mkdirSync(path.join(root, 'backend', 'src', 'main', 'java', 'com', 'acme', 'orders'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(
      root,
      'backend',
      'src',
      'main',
      'java',
      'com',
      'acme',
      'orders',
      'TaskApplication.java',
    ),
    'package com.acme.orders;\npublic class TaskApplication {}\n',
  );
  fs.writeFileSync(
    path.join(root, 'frontend', 'package.json'),
    JSON.stringify({
      scripts: {
        build: 'vite build',
        test: 'vitest run',
        lint: 'eslint src',
        format: 'prettier --check .',
      },
    }),
  );
  fs.writeFileSync(path.join(root, 'frontend', 'package-lock.json'), '{}\n');
  fs.writeFileSync(path.join(root, '.env'), 'APP_ADMIN_PASSWORD=not-recorded\n');
  git(root, ['init', '-q']);
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@local',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'baseline',
  ]);
  return root;
}

test('detects a Java/Vue monorepo and derives argv-only commands without writes', (t) => {
  const root = fullstack(t);
  const before = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  const result = detectProject({ root });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stack, 'java-vue');
  assert.equal(result.mode, 'adopted');
  assert.equal(result.git.repository, true);
  assert.equal(result.git.clean, true);
  assert.equal(result.git.branch, 'master');
  assert.ok(result.commands.install.some((entry) => entry.argv.join(' ') === 'npm ci'));
  assert.ok(result.commands.build.some((entry) => entry.argv.includes('mvn')));
  assert.ok(result.commands.build.some((entry) => entry.argv.join(' ') === 'npm run build'));
  assert.ok(result.commands.test.some((entry) => entry.argv.join(' ') === 'npm run test'));
  assert.equal(
    result.commands.test.every((entry) => Array.isArray(entry.argv)),
    true,
  );
  assert.ok(result.protectedPaths.includes('.env'));
  assert.equal(result.conventions.backendPackage, 'com.acme.orders');
  assert.equal(result.conventions.frontendDefaultLocale, 'zh-CN');
  assert.equal(result.conventions.frontendFramework, 'vue');
  assert.equal(git(root, ['status', '--porcelain=v1', '--untracked-files=all']), before);
});

test('detects the frontend framework from package dependencies', (t) => {
  const root = fullstack(t);
  fs.writeFileSync(
    path.join(root, 'frontend', 'package.json'),
    JSON.stringify({
      scripts: { build: 'vite build', test: 'vitest run' },
      dependencies: { react: '^18.3.1' },
    }),
  );
  const result = detectProject({ root });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.conventions.frontendFramework, 'react');
});

test('reports dirty files and package-manager choice without committing or staging', (t) => {
  const root = fullstack(t);
  fs.writeFileSync(path.join(root, 'frontend', 'package.json'), '{invalid-json');
  fs.writeFileSync(path.join(root, 'frontend', 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  fs.writeFileSync(path.join(root, 'untracked feature.txt'), 'draft');
  const before = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  const result = detectProject({ root });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.git.clean, false);
  assert.ok(result.git.dirtyFiles.some((entry) => entry.path === 'frontend/package.json'));
  assert.ok(result.git.dirtyFiles.some((entry) => entry.path === 'untracked feature.txt'));
  assert.equal(result.packageManager, 'pnpm');
  assert.equal(git(root, ['status', '--porcelain=v1', '--untracked-files=all']), before);
});

test('a repository without Maven or a frontend is analysed instead of rejected', (t) => {
  // AC-01：旧行为是 PROJECT_STACK_UNSUPPORTED 整体拒绝；
  // 新行为是返回可确认的观察与缺口，且不虚构前后端模块（AC-02、AC-03）。
  const root = temp(t);
  fs.writeFileSync(path.join(root, 'index.js'), 'console.log("node");\n');
  git(root, ['init', '-q']);
  const result = detectProject({ root });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.code, undefined, 'PROJECT_STACK_UNSUPPORTED 不得再因技术栈出现');
  assert.deepEqual(result.modules, { backend: null, frontends: [] }, '不得补造模块');
  assert.equal(result.stack, null, '无构建事实时 stack 为 null 而不是 java-vue');
  assert.deepEqual(result.capabilities, []);
  // 缺口来自两处检测：技术栈探测与模块识别各给一条，均需显式可见。
  assert.ok(result.gaps.length >= 1, '必须显式列出缺口');
  assert.ok(result.gaps.some((entry) => /未发现任何已知构建文件/.test(entry)));
  assert.ok(result.gaps.some((entry) => /未识别到任何模块/.test(entry)));
  assert.deepEqual(result.moduleList, [], '不得凭目录名或空目录补造模块');
  assert.deepEqual(fs.readdirSync(root).sort(), ['.git', 'index.js'], '检测不得写入');
  assert.equal(detectProject({ root: process.cwd() }).code, 'PROJECT_SOURCE_FORBIDDEN');
});

test('symlinked project entries are rejected before command discovery', (t) => {
  const root = fullstack(t);
  const outside = temp(t);
  fs.symlinkSync(
    outside,
    path.join(root, 'frontend', 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const result = detectProject({ root });
  assert.equal(result.code, 'UNSAFE_PROJECT_PATH');
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('discovers hyphenated front-end roots and multiple frontend applications', (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend', 'front-office'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend', 'back-office'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'pom.xml'), '<project/>\n');
  for (const name of ['front-office', 'back-office']) {
    fs.writeFileSync(
      path.join(root, 'frontend', name, 'package.json'),
      JSON.stringify({ scripts: { build: 'vite build', test: 'vitest run' } }),
    );
    fs.writeFileSync(path.join(root, 'frontend', name, 'package-lock.json'), '{}\n');
    fs.writeFileSync(
      path.join(root, 'frontend', name, 'App.vue'),
      '<template><div /></template>\n',
    );
  }
  git(root, ['init', '-q']);
  git(root, ['add', '.']);
  git(root, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@local',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'baseline',
  ]);
  const multi = detectProject({ root });
  assert.equal(multi.ok, true, JSON.stringify(multi));
  assert.deepEqual(multi.modules.frontends.sort(), [
    'frontend/back-office',
    'frontend/front-office',
  ]);
  assert.equal(
    multi.commands.build.filter((entry) => entry.argv.join(' ') === 'npm run build').length,
    2,
  );
  assert.equal(
    multi.commands.install.filter((entry) => entry.argv.join(' ') === 'npm ci').length,
    2,
  );

  const second = temp(t);
  fs.mkdirSync(path.join(second, 'front-end'), { recursive: true });
  fs.writeFileSync(path.join(second, 'pom.xml'), '<project/>\n');
  fs.writeFileSync(
    path.join(second, 'front-end', 'package.json'),
    JSON.stringify({ scripts: { build: 'vite build' } }),
  );
  fs.writeFileSync(path.join(second, 'front-end', 'App.vue'), '<template><div /></template>\n');
  git(second, ['init', '-q']);
  git(second, ['add', '.']);
  git(second, [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@local',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    'baseline',
  ]);
  const hyphen = detectProject({ root: second });
  assert.equal(hyphen.ok, true, JSON.stringify(hyphen));
  assert.deepEqual(hyphen.modules.frontends, ['front-end']);
  assert.equal(hyphen.commands.install[0].argv.join(' '), 'npm install --no-package-lock');
});

test('discovers package-manager-specific install commands before build', (t) => {
  const yarnRoot = temp(t);
  fs.mkdirSync(path.join(yarnRoot, 'backend'));
  fs.mkdirSync(path.join(yarnRoot, 'frontend'));
  fs.writeFileSync(path.join(yarnRoot, 'backend', 'pom.xml'), '<project/>\n');
  fs.writeFileSync(
    path.join(yarnRoot, 'frontend', 'package.json'),
    JSON.stringify({ scripts: { build: 'vite build' } }),
  );
  fs.writeFileSync(path.join(yarnRoot, 'frontend', 'yarn.lock'), '# yarn lockfile v1\n');
  assert.equal(
    detectProject({ root: yarnRoot }).commands.install[0].argv.join(' '),
    'yarn install --frozen-lockfile',
  );

  const pnpmRoot = temp(t);
  fs.mkdirSync(path.join(pnpmRoot, 'backend'));
  fs.mkdirSync(path.join(pnpmRoot, 'frontend'));
  fs.writeFileSync(path.join(pnpmRoot, 'backend', 'pom.xml'), '<project/>\n');
  fs.writeFileSync(
    path.join(pnpmRoot, 'frontend', 'package.json'),
    JSON.stringify({ scripts: { build: 'vite build' } }),
  );
  fs.writeFileSync(path.join(pnpmRoot, 'frontend', 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  assert.equal(
    detectProject({ root: pnpmRoot }).commands.install[0].argv.join(' '),
    'pnpm install --frozen-lockfile',
  );
});
