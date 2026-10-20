import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  startFixedInit,
  createFixedFiles,
  inspectFixedTargets,
  fixedWorkflowFiles,
} from '../../src/v4/minimal-init.js';
import { readEffectiveBaseline } from '../../src/v3/baseline.js';
import { startWorkspaceChange } from '../../src/v4/workspace-change.js';

const environment = {
  ok: true,
  tools: {
    java: { path: '/java', version: '1.8.0', major: 8 },
    javac: { path: '/javac', version: '1.8.0', major: 8 },
    maven: { path: '/mvn' },
    mvn: { path: '/mvn' },
    node: { path: '/node', version: '22.0.0' },
    npm: { path: '/npm' },
    browser: { path: '/chrome' },
  },
  missing: [],
};
const passed = { ok: true, browserCrud: 'passed', restartPersistence: 'passed', cleanup: 'passed' };
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-fixed-init-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return path.join(base, 'project');
}
function questions(callback = () => {}) {
  return {
    async ask({ questions }) {
      const q = questions[0];
      callback(q);
      const label =
        q.id === 'sg-v4-quality-approval'
          ? q.options.find((option) => option.label.startsWith('确认方案 ')).label
          : q.options[0].label;
      return { answers: [{ id: q.id, selected: [label] }] };
    },
  };
}
const options = (root) => ({
  root,
  agent: { id: 'test-session' },
  environmentProbe: async () => environment,
  verifier: async () => passed,
});

test('no host answer, yes and missing toolchain cause zero project writes', async (t) => {
  const root = fixture(t);
  const noHost = await startFixedInit({ ...options(root), yes: true });
  assert.equal(noHost.code, 'APPROVAL_REQUIRED');
  assert.equal(fs.existsSync(root), false);
  const missing = await startFixedInit({
    ...options(root),
    environmentProbe: async () => ({ ok: false, tools: {}, missing: ['Java 8'] }),
    userQuestions: questions(),
  });
  assert.equal(missing.code, 'ENV_BLOCKED');
  assert.equal(fs.existsSync(root), false);
  const declined = await startFixedInit({
    ...options(root),
    userQuestions: {
      async ask({ questions }) {
        return { answers: [{ id: questions[0].id, selected: ['暂不执行'] }] };
      },
    },
  });
  assert.equal(declined.complete, false);
  assert.equal(fs.existsSync(root), false);
});

test('draft approval is not execution approval; final preview contains req paths commands and risks', async (t) => {
  const root = fixture(t);
  let seen = 0;
  const result = await startFixedInit({
    ...options(root),
    userQuestions: questions((q) => {
      seen++;
      assert.equal(fs.existsSync(root), false);
      if (seen === 4) {
        assert.ok(q.question.includes('openspec/REQ.md'));
        assert.match(q.question, /不自动创建业务变更/);
      }
    }),
  });
  assert.equal(seen, 4);
  assert.equal(result.ok, true);
  assert.equal(result.complete, true);
  assert.equal(readEffectiveBaseline(root).ok, true);
  const evidence = JSON.parse(
    fs.readFileSync(path.join(root, '.specgate', 'init-report.json'), 'utf8'),
  );
  assert.equal(evidence.complete, true);
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
});

test('unrelated files survive, planned existing files and races stop without overwrite', async (t) => {
  const root = fixture(t);
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'notes.txt'), 'user');
  const result = await startFixedInit({ ...options(root), userQuestions: questions() });
  assert.equal(result.ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'user');
  const retry = await startFixedInit({ ...options(root), userQuestions: questions() });
  assert.equal(retry.ok, false);
  const other = fixture(t);
  let index = 0;
  const conflict = await startFixedInit({
    ...options(other),
    userQuestions: questions(() => {
      if (++index === 4) {
        fs.mkdirSync(other);
        fs.writeFileSync(path.join(other, 'README.md'), 'user');
      }
    }),
  });
  assert.equal(conflict.ok, false);
  assert.equal(fs.readFileSync(path.join(other, 'README.md'), 'utf8'), 'user');
  assert.equal(fs.existsSync(path.join(other, 'openspec')), false);
});

test('exclusive creation and parent/path protection', (t) => {
  const root = fixture(t);
  createFixedFiles(root, { 'keep.txt': 'original' });
  assert.throws(() => createFixedFiles(root, { 'keep.txt': 'replacement' }));
  assert.equal(fs.readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'original');
  assert.throws(() => createFixedFiles(root, { '../outside': 'bad' }));
  assert.equal(inspectFixedTargets(root, { 'keep.txt/child': 'bad' }).ok, false);
});

test('HTTP-only, failed cleanup and missing browser verification cannot activate baseline', async (t) => {
  for (const runtime of [
    { ok: true },
    { ...passed, browserCrud: 'not-verified' },
    { ...passed, cleanup: 'failed' },
  ]) {
    const root = fixture(t);
    const result = await startFixedInit({
      ...options(root),
      userQuestions: questions(),
      verifier: async () => runtime,
    });
    assert.equal(result.complete, false);
    assert.equal(readEffectiveBaseline(root).ok, false);
    assert.equal(fs.existsSync(path.join(root, 'openspec', 'REQ.md')), true);
  }
});

test('report save conflict prevents effective req publication', async (t) => {
  const root = fixture(t);
  const result = await startFixedInit({
    ...options(root),
    userQuestions: questions(),
    verifier: async () => {
      fs.writeFileSync(path.join(root, '.specgate', 'init-report.json'), 'user');
      return passed;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(readEffectiveBaseline(root).ok, false);
  assert.equal(fs.readFileSync(path.join(root, '.specgate', 'init-report.json'), 'utf8'), 'user');
});

test('initialized engineering req is directly usable by managed sg change', async (t) => {
  const root = fixture(t);
  const result = await startFixedInit({ ...options(root), userQuestions: questions() });
  assert.equal(result.ok, true);
  const change = startWorkspaceChange({
    root,
    name: 'rename-item',
    type: 'modify',
    requirements: {
      functional: ['修改名称显示'],
      nonFunctional: [],
      constraints: [],
      acceptance: ['显示正确'],
    },
  });
  assert.equal(change.ok, true, change.message);
  assert.equal(readEffectiveBaseline(root).ok, true);
  const second = startWorkspaceChange({ root, name: 'other', type: 'modify' });
  assert.equal(second.ok, false);
});

test('req template is stable and not falsely marked implemented', () => {
  const first = fixedWorkflowFiles();
  const second = fixedWorkflowFiles();
  assert.equal(first['openspec/REQ.md'], second['openspec/REQ.md']);
  assert.match(first['openspec/REQ.md'], /实现有效性以工程状态和验证证据为准/);
});
