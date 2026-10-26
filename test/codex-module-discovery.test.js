import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverModules, inferModuleRole } from '../src/codex/core/discovery/modules.js';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-modules-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, content = '') {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const pomService =
  '<project><modelVersion>4.0.0</modelVersion><packaging>jar</packaging>' +
  '<dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>\n';
const pomLibrary =
  '<project><modelVersion>4.0.0</modelVersion><packaging>jar</packaging></project>\n';
const pomAggregator =
  '<project><modelVersion>4.0.0</modelVersion><packaging>pom</packaging></project>\n';

test('directory names alone never create a module', (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend', 'readme.md'), '# backend\n');
  fs.writeFileSync(path.join(root, 'frontend', 'readme.md'), '# frontend\n');
  const result = discoverModules({ root, candidates: ['.', 'backend', 'frontend'] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.modules, [], '没有构建文件的目录不是模块');
  assert.equal(result.gaps.length, 1);
});

test('a single-module CLI is not turned into backend or frontend', (t) => {
  const root = workspace(t);
  write(root, 'package.json', JSON.stringify({ bin: { demo: './cli.js' }, main: './index.js' }));
  write(root, 'src/index.js', '');
  const result = discoverModules({ root, candidates: ['.'] });
  assert.equal(result.ok, true);
  assert.equal(result.modules.length, 1);
  assert.equal(result.modules[0].role, 'cli', 'bin 字段应判为 cli，而不是 backend/frontend');
  assert.equal(result.modules[0].id, 'root');
});

test('a Maven multi-module repository reports every submodule', (t) => {
  const root = workspace(t);
  write(root, 'pom.xml', pomAggregator);
  write(root, 'api/pom.xml', pomService);
  write(root, 'core/pom.xml', pomLibrary);
  write(root, 'api/src/main/java/App.java', 'package com.acme;\n');
  const result = discoverModules({ root, candidates: ['.', 'api', 'core'] });
  assert.equal(result.ok, true);
  const ids = result.modules.map((entry) => entry.id).sort();
  assert.deepEqual(ids, ['api', 'core', 'root']);
  const byId = Object.fromEntries(result.modules.map((entry) => [entry.id, entry]));
  assert.equal(byId.api.role, 'service', 'spring-boot-starter 依赖 → service');
  assert.equal(byId.core.role, 'library', '无 spring-boot 的 jar → library');
  assert.equal(byId.root.role, 'other', 'packaging=pom 的聚合模块不是 service');
  assert.deepEqual(byId.api.entryPoints, ['src/main/java']);
});

test('npm workspaces are reported per workspace, not merged', (t) => {
  const root = workspace(t);
  write(root, 'package.json', JSON.stringify({ workspaces: ['packages/*'] }));
  write(
    root,
    'packages/web/package.json',
    JSON.stringify({ dependencies: { react: '^18.0.0' }, main: 'index.js' }),
  );
  write(root, 'packages/lib/package.json', JSON.stringify({ main: 'dist/index.js' }));
  const result = discoverModules({ root, candidates: ['.', 'packages/web', 'packages/lib'] });
  assert.equal(result.ok, true);
  const byId = Object.fromEntries(result.modules.map((entry) => [entry.id, entry]));
  assert.equal(byId['packages/web'].role, 'ui');
  assert.equal(byId['packages/lib'].role, 'library');
  assert.equal(result.roles.ui, 1);
  assert.equal(result.roles.library, 1);
});

test('a single python project is classified from its build facts', (t) => {
  const root = workspace(t);
  write(
    root,
    'pyproject.toml',
    '[build-system]\nrequires = ["setuptools"]\n\n[project.scripts]\ndemo = "demo:main"\n',
  );
  const result = discoverModules({ root, candidates: ['.'] });
  assert.equal(result.ok, true);
  assert.equal(result.modules[0].role, 'cli');
  assert.equal(result.modules[0].buildSystem, 'python');
});

test('every module carries source evidence for its classification', (t) => {
  const root = workspace(t);
  write(root, 'pom.xml', pomService);
  const result = discoverModules({ root, candidates: ['.'] });
  assert.ok(result.modules[0].buildFiles.length > 0);
  for (const observation of result.observations)
    assert.ok(observation.sourceRefs.length > 0, '观察必须带来源');
});

test('a module without a conventional entry point is reported as a gap', (t) => {
  const root = workspace(t);
  write(root, 'package.json', JSON.stringify({ name: 'no-entry' }));
  const result = discoverModules({ root, candidates: ['.'] });
  assert.equal(result.ok, true);
  assert.equal(result.modules[0].entryPoints.length, 0);
  assert.ok(result.gaps.some((entry) => entry.includes('未发现约定入口')));
});

test('role inference never defaults to backend or frontend', () => {
  const cases = [
    [{ buildSystem: 'cargo' }, 'other'],
    [{ buildSystem: 'go' }, 'cli'],
    [{ buildSystem: 'maven', maven: { packaging: 'pom' } }, 'other'],
    [{ buildSystem: 'npm', npm: { hasUI: false, hasBin: false, hasMain: false } }, 'other'],
    [{ buildSystem: 'unknown-system' }, 'other'],
  ];
  for (const [input, expected] of cases)
    assert.equal(inferModuleRole(input), expected, JSON.stringify(input));
  for (const system of ['maven', 'gradle', 'npm', 'python', 'cargo', 'go'])
    assert.equal(['backend', 'frontend'].includes(inferModuleRole({ buildSystem: system })), false);
});

test('discovery is read-only and bounded', (t) => {
  const root = workspace(t);
  write(root, 'pom.xml', pomService);
  write(root, 'package.json', JSON.stringify({ main: 'index.js' }));
  const snapshot = () => {
    const out = [];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          out.push('d:' + path.relative(root, target));
          visit(target);
        } else out.push('f:' + path.relative(root, target) + ':' + fs.statSync(target).size);
      }
    };
    visit(root);
    return out.sort();
  };
  const before = snapshot();
  discoverModules({ root, candidates: ['.'] });
  assert.deepEqual(snapshot(), before);
});

test('an invalid root is refused instead of thrown', () => {
  for (const root of ['relative', null, 7]) {
    const result = discoverModules({ root, candidates: ['.'] });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MODULE_DISCOVERY_INVALID');
  }
});
