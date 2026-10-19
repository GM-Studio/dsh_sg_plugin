import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorkspaceLayout, resolveSelection } from '../../src/v4/workspace.js';
import { buildWorkspace } from '../../src/v4/build.js';
import {
  finalizeWorkspaceChange,
  prepareWorkspaceChange,
  startWorkspaceChange,
  wireSubmodules,
} from '../../src/v4/workspace-change.js';
import { load } from '../../src/v3/state.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v4-ch-'));
}

function quality() {
  return async () => ({ ok: true, stages: [] });
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('v4 Phase 4b：接入 submodule 并创建 workspace change', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ preset: 'node-fullstack' });
  createWorkspaceLayout({ root, selection });
  const built = await buildWorkspace({ root, selection, qualityRunner: quality() });
  assert.equal(built.ok, true);

  const wired = wireSubmodules({ root, sides: selection.sides });
  assert.equal(wired.ok, true);
  assert.ok(fs.existsSync(path.join(root, '.gitmodules')));
  assert.match(fs.readFileSync(path.join(root, '.gitmodules'), 'utf8'), /path = api/);
  assert.match(git(root, ['log', '--oneline']), /接入 api\/web 子模块/);

  const change = startWorkspaceChange({ root, name: 'add-login', type: 'feature' });
  assert.equal(change.ok, true, change.message);
  assert.deepEqual(change.sides.sort(), ['api', 'web']);
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'changes', 'add-login.json')));
  for (const side of ['api', 'web']) {
    assert.ok(
      fs.existsSync(path.join(root, side, 'openspec', 'changes', 'add-login', 'proposal.md')),
      side,
    );
    assert.equal(load(path.join(root, side)).state.phase, 'H1_PENDING', side);
  }
  const rootState = JSON.parse(fs.readFileSync(path.join(root, '.specgate', 'state.json'), 'utf8'));
  assert.equal(rootState.change, 'add-login');
});

test('v4 Phase 4b：submodule 接入幂等', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ backend: 'node', frontend: 'none' });
  createWorkspaceLayout({ root, selection });
  await buildWorkspace({ root, selection, qualityRunner: quality() });
  assert.equal(wireSubmodules({ root, sides: selection.sides }).ok, true);
  const again = wireSubmodules({ root, sides: selection.sides });
  assert.equal(again.skipped, true);
});

function fakeQuestions(confirm = '确认') {
  return {
    async ask({ questions }) {
      const question = questions[0];
      if (question.id === 'sg-v4-change-confirm') return { answers: [{ selected: [confirm] }] };
      if (question.id === 'sg-init-req-functional')
        return { answers: [{ selected: [], custom: '登录' }] };
      if (question.id === 'sg-init-req-nonFunctional')
        return { answers: [{ selected: [], custom: 'P95 < 300ms' }] };
      if (question.id === 'sg-init-req-constraints')
        return { answers: [{ selected: [], custom: '兼容旧库' }] };
      if (question.id === 'sg-init-req-acceptance')
        return { answers: [{ selected: [], custom: '登录成功' }] };
      return { answers: [{ selected: [] }] };
    },
  };
}

test('v4 Phase 4c：需求确认取消时零写', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ backend: 'node', frontend: 'none' });
  createWorkspaceLayout({ root, selection });
  const prepared = await prepareWorkspaceChange({
    root,
    name: 'add-login',
    userQuestions: fakeQuestions('取消'),
    agent: null,
  });
  assert.equal(prepared.ok, false);
  assert.equal(prepared.code, 'CANCELLED');
  assert.equal(fs.existsSync(path.join(root, '.specgate', 'changes', 'add-login.json')), false);
  assert.equal(fs.existsSync(path.join(root, 'api', 'openspec', 'changes', 'add-login')), false);
});

test('v4 Phase 4c：确认后写入需求并创建 change', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ backend: 'node', frontend: 'none' });
  createWorkspaceLayout({ root, selection });
  const prepared = await prepareWorkspaceChange({
    root,
    name: 'add-login',
    userQuestions: fakeQuestions('确认'),
    agent: null,
  });
  assert.equal(prepared.ok, true);
  const result = startWorkspaceChange({
    root,
    name: 'add-login',
    requirements: prepared.requirements,
  });
  assert.equal(result.ok, true);
  const json = JSON.parse(
    fs.readFileSync(path.join(root, '.specgate', 'changes', 'add-login.json'), 'utf8'),
  );
  assert.equal(json.requirements.functional[0], '登录');
  assert.ok(
    fs.existsSync(path.join(root, 'api', 'openspec', 'changes', 'add-login', 'requirements.md')),
  );
});

test('v4 Phase 4d：两侧归档后更新根指针并打 tag', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ preset: 'node-fullstack' });
  createWorkspaceLayout({ root, selection });
  await buildWorkspace({ root, selection, qualityRunner: quality() });
  wireSubmodules({ root, sides: selection.sides });
  const prepared = await prepareWorkspaceChange({
    root,
    name: 'add-login',
    userQuestions: fakeQuestions('确认'),
  });
  startWorkspaceChange({ root, name: 'add-login', requirements: prepared.requirements });

  const pending = finalizeWorkspaceChange({ root, name: 'add-login' });
  assert.equal(pending.ok, false);
  assert.equal(pending.code, 'PENDING');

  for (const side of ['api', 'web']) {
    const from = path.join(root, side, 'openspec', 'changes', 'add-login');
    const to = path.join(root, side, 'openspec', 'changes', 'archive', '2026-10-20-add-login');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    git(path.join(root, side), ['add', '-A']);
    git(path.join(root, side), [
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@e',
      'commit',
      '-q',
      '-m',
      'archive add-login',
    ]);
  }
  const done = finalizeWorkspaceChange({ root, name: 'add-login' });
  assert.equal(done.ok, true, done.message);
  assert.equal(git(root, ['tag']).includes('add-login'), true);
  const state = JSON.parse(fs.readFileSync(path.join(root, '.specgate', 'state.json'), 'utf8'));
  assert.equal(state.phase, 'IDLE');
  assert.equal(state.change, null);
});
