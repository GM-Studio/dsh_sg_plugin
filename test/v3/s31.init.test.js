import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectInitMode,
  scaffoldFiles,
  initNewProject,
} from '../../src/v3/init.js';
import { load } from '../../src/v3/state.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-init-'));
}

function fakeQuestions() {
  return {
    async ask({ questions }) {
      const question = questions[0];
      if (question.id === 'sg-init-h0') return { answers: [{ selected: ['确认'] }] };
      if (question.id === 'sg-init-stack') return { answers: [{ selected: ['node'] }] };
      return { answers: [{ selected: ['跳过'] }] };
    },
  };
}

test('detectInitMode 区分空目录与已有代码', () => {
  const empty = tempRoot();
  assert.equal(detectInitMode(empty), 'new');

  const existing = tempRoot();
  fs.writeFileSync(path.join(existing, 'package.json'), '{}', 'utf8');
  assert.equal(detectInitMode(existing), 'existing');
});

test('scaffoldFiles 生成 Node 与 Python 最小骨架', () => {
  const node = scaffoldFiles('node');
  assert.ok(node['index.js'].includes('/health'));
  assert.ok(node['sg-test.mjs'].includes('SG_REPORT'));
  assert.equal(node['.nvmrc'], '22\n');

  const python = scaffoldFiles('python');
  assert.ok(python['app.py'].includes('/health'));
  assert.ok(python['tests/test_health.py'].includes('test_health'));
  assert.equal(python['.python-version'], '3.12\n');
});

test('initNewProject 走 H0、脚手架、自动建 change 停 H1', async () => {
  const root = tempRoot();
  const result = await initNewProject({
    root,
    userQuestions: fakeQuestions(),
    agent: null,
    signal: new AbortController().signal,
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.phase, 'H1_PENDING');
  assert.equal(result.change, 'add-version');

  for (const file of [
    'index.js',
    'sg-test.mjs',
    'project-context.md',
    'AGENTS.md',
    'docs/glossary.md',
    'docs/adr/0001-initial.md',
    '.github/workflows/ci.yml',
    'openspec/changes/add-version/proposal.md',
    'openspec/changes/add-version/specs/ops/spec.md',
  ]) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }

  const state = load(root).state;
  assert.equal(state.phase, 'H1_PENDING');
  assert.equal(state.change, 'add-version');
  assert.ok(state.h0?.hash);
  assert.ok(state.h0?.approvedAt);
});

test('initNewProject 不覆盖已有文件', async () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'index.js'), '// mine\n', 'utf8');
  const result = await initNewProject({
    root,
    userQuestions: fakeQuestions(),
    agent: null,
    signal: new AbortController().signal,
  });
  assert.equal(result.ok, true, result.message);
  assert.match(result.scaffold.skipped.join(','), /index\.js/);
  assert.equal(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), '// mine\n');
});
