import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectStack, MAX_TOP_LEVEL_DIRECTORIES } from '../src/codex/core/discovery/stack.js';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-stack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, content = '') {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const pom = '<project><modelVersion>4.0.0</modelVersion></project>\n';

test('a backend-only Maven repository is detected instead of rejected', (t) => {
  const root = workspace(t);
  write(root, 'pom.xml', pom);
  const result = detectStack({ root });
  assert.equal(result.ok, true);
  assert.deepEqual(result.buildSystems, ['maven']);
  assert.deepEqual(result.languages, ['java']);
  assert.equal(result.modules.length, 1);
  assert.equal(result.modules[0].id, 'root');
  // 关键：没有前端也必须是成功结果，且不虚构前端模块。
  assert.equal(
    result.modules.some((entry) => entry.id === 'frontend'),
    false,
  );
});

test('a frontend-only repository is detected instead of rejected', (t) => {
  const root = workspace(t);
  write(
    root,
    'package.json',
    JSON.stringify({ scripts: { build: 'vite build' }, dependencies: { vue: '^3.4.0' } }),
  );
  const result = detectStack({ root });
  assert.equal(result.ok, true);
  assert.deepEqual(result.buildSystems, ['npm']);
  assert.equal(result.modules.length, 1);
  assert.equal(
    result.modules.some((entry) => entry.id === 'backend'),
    false,
  );
  assert.ok(result.observations.some((entry) => entry.text.includes('vue')));
});

test('a pure python repository is detected without java or npm', (t) => {
  const root = workspace(t);
  write(root, 'pyproject.toml', '[project]\nname = "demo"\n');
  write(root, 'uv.lock', '');
  const result = detectStack({ root });
  assert.equal(result.ok, true);
  assert.deepEqual(result.buildSystems, ['python']);
  assert.deepEqual(result.languages, ['python']);
  assert.equal(result.modules[0].packageManager, 'uv');
});

test('an empty directory yields a result with explicit gaps rather than a refusal', (t) => {
  const root = workspace(t);
  const result = detectStack({ root });
  assert.equal(result.ok, true, '未知技术栈不得让分析阶段整体失败');
  assert.deepEqual(result.modules, []);
  assert.deepEqual(result.capabilities, []);
  assert.equal(result.stack, null);
  assert.equal(result.gaps.length, 1);
  assert.match(result.gaps[0], /未发现任何已知构建文件/);
});

test('a monorepo reports every module that actually has a build file', (t) => {
  const root = workspace(t);
  write(root, 'pom.xml', pom);
  write(root, 'backend/pom.xml', pom);
  write(
    root,
    'frontend/package.json',
    JSON.stringify({ scripts: { build: 'vite build', test: 'vitest run' } }),
  );
  const result = detectStack({ root });
  assert.equal(result.ok, true);
  const ids = result.modules.map((entry) => entry.id).sort();
  assert.deepEqual(ids, ['backend', 'frontend', 'root']);
  assert.ok(result.buildSystems.includes('maven'));
  assert.ok(result.buildSystems.includes('npm'));
  // 多技术栈时 stack 是描述性标签，不强行压成单一值。
  assert.equal(typeof result.stack, 'string');
});

test('module roles are never invented from directory names alone', (t) => {
  const root = workspace(t);
  // 目录名像前后端，但没有任何构建文件。
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'notes.txt'), 'nothing here\n');
  fs.writeFileSync(path.join(root, 'frontend', 'notes.txt'), 'nothing here\n');
  const result = detectStack({ root });
  assert.equal(result.ok, true);
  assert.deepEqual(result.modules, [], '不能仅凭目录名判定模块');
  assert.equal(result.gaps.length, 1);
});

test('lockfiles determine the package manager and are reported with their module', (t) => {
  const root = workspace(t);
  write(root, 'package.json', JSON.stringify({ scripts: {} }));
  write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  const result = detectStack({ root });
  assert.equal(result.modules[0].packageManager, 'pnpm');
  assert.deepEqual(
    result.lockfiles.map((entry) => entry.packageManager),
    ['pnpm'],
  );
  assert.equal(result.lockfiles[0].relative, '.');
});

test('npm scripts become capabilities and argv-only commands', (t) => {
  const root = workspace(t);
  write(
    root,
    'package.json',
    JSON.stringify({
      scripts: {
        build: 'vite build',
        test: 'vitest run',
        lint: 'eslint .',
        format: 'prettier -w .',
        dev: 'vite',
      },
    }),
  );
  const result = detectStack({ root });
  const kinds = result.capabilities.map((entry) => entry.kind).sort();
  assert.deepEqual(kinds, ['build', 'format', 'lint', 'runtime', 'test']);
  for (const command of result.commands.build) assert.ok(Array.isArray(command.argv));
  assert.ok(result.commands.build.some((entry) => entry.argv.join(' ') === 'npm run build'));
  assert.ok(result.commands.runtime.some((entry) => entry.argv.join(' ') === 'npm run dev'));
});

test('detection is read-only: no file is created or modified', (t) => {
  const root = workspace(t);
  write(root, 'pom.xml', pom);
  write(root, 'package.json', JSON.stringify({ scripts: { build: 'vite build' } }));
  const snapshot = () => {
    const entries = [];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          entries.push('d:' + path.relative(root, target));
          visit(target);
        } else entries.push('f:' + path.relative(root, target) + ':' + fs.statSync(target).size);
      }
    };
    visit(root);
    return entries.sort();
  };
  const before = snapshot();
  detectStack({ root });
  detectStack({ root });
  assert.deepEqual(snapshot(), before, '探测不得写入任何文件');
});

test('an invalid root is refused with a bounded error, not thrown', () => {
  for (const root of ['relative/path', null, 42, undefined]) {
    const result = detectStack({ root });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'STACK_DETECT_INVALID');
  }
  const missing = detectStack({ root: path.join(os.tmpdir(), 'sg-does-not-exist-' + Date.now()) });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'STACK_DETECT_INVALID');
});

test('directory scanning is bounded rather than unbounded', (t) => {
  const root = workspace(t);
  const total = MAX_TOP_LEVEL_DIRECTORIES + 10;
  for (let index = 0; index < total; index += 1) {
    write(root, 'mod-' + String(index).padStart(2, '0') + '/pom.xml', pom);
  }
  const result = detectStack({ root });
  assert.equal(result.ok, true);
  // 上限内的顶层目录被扫到；扫描范围显式可读，不是整盘遍历。
  assert.ok(
    result.scanned.length <= MAX_TOP_LEVEL_DIRECTORIES,
    JSON.stringify(result.scanned.length),
  );
  assert.ok(result.modules.length >= 1);
});

test('detection output plugs into the v3 profile shape without a java-vue assumption', async (t) => {
  const { validateProjectProfileV3 } = await import('../src/codex/core/profile-migration.js');
  const root = workspace(t);
  write(root, 'pyproject.toml', '[project]\nname = "demo"\n');
  const detected = detectStack({ root });
  const profile = {
    schemaVersion: 3,
    projectId: 'demo',
    mode: 'adopted',
    stack: detected.stack,
    root,
    targetBranch: 'main',
    remoteUrl: null,
    commands: { install: [], build: [], test: [], lint: [], format: [], runtime: [] },
    protectedPaths: [],
    capabilities: detected.capabilities.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      module: entry.module,
      toolchain: entry.toolchain || '',
    })),
    modules: detected.modules.map((entry) => ({
      id: entry.id,
      role: 'other',
      root: entry.root,
      buildSystem: entry.buildSystems[0] || '',
      packageManager: entry.packageManager || '',
    })),
    observations: detected.observations.map((entry) => ({
      id: entry.id,
      text: entry.text,
      sourceRefs: entry.sourceRefs,
    })),
    gaps: detected.gaps,
    createdAt: '2026-10-26T00:00:00.000Z',
    updatedAt: '2026-10-26T00:00:00.000Z',
  };
  const checked = validateProjectProfileV3(profile);
  assert.equal(checked.ok, true, JSON.stringify(checked));
});
