import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  init,
  load,
  save,
  patchState,
  emptyState,
  statePath,
  validateState,
  SCHEMA_VERSION,
} from '../../src/v3/state.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-state-'));
}

test('init 创建 v3 默认状态', () => {
  const root = tempRoot();
  const result = init(root);
  assert.equal(result.ok, true);
  assert.equal(result.reused, false);
  assert.equal(result.state.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.state.phase, 'IDLE');
  assert.equal(result.state.workflowVersion, 3);
  assert.equal(fs.existsSync(statePath(root)), true);
});

test('init 幂等，不覆盖已有状态', () => {
  const root = tempRoot();
  init(root);
  patchState(root, (state) => {
    state.change = 'add-login';
    state.phase = 'H1_PENDING';
  });
  const second = init(root);
  assert.equal(second.ok, true);
  assert.equal(second.reused, true);
  assert.equal(second.state.change, 'add-login');
});

test('load 在无状态时返回 STATE_MISSING', () => {
  const root = tempRoot();
  const result = load(root);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STATE_MISSING');
});

test('load 在 JSON 损坏时返回 STATE_INVALID', () => {
  const root = tempRoot();
  init(root);
  fs.writeFileSync(statePath(root), '{ not json', 'utf8');
  const result = load(root);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STATE_INVALID');
});

test('save 拒绝非法 phase', () => {
  const root = tempRoot();
  init(root);
  const state = emptyState({ phase: 'NOT_A_PHASE' });
  const result = save(root, state);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STATE_INVALID');
  assert.match(result.message, /phase/);
});

test('validateState 报告缺失字段', () => {
  const result = validateState({ schemaVersion: 3, phase: 'IDLE' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.ok(result.errors.some((item) => item.includes('workflowVersion')));
});

test('patchState 修改并落盘', () => {
  const root = tempRoot();
  init(root);
  const patched = patchState(root, (state) => {
    state.change = 'add-login';
    state.type = 'feature';
    state.phase = 'H1_PENDING';
    state.tasks['T-001'] = { id: 'T-001', status: 'pending' };
  });
  assert.equal(patched.ok, true);
  const loaded = load(root);
  assert.equal(loaded.state.change, 'add-login');
  assert.equal(loaded.state.type, 'feature');
  assert.equal(loaded.state.tasks['T-001'].status, 'pending');
  assert.ok(loaded.state.updatedAt);
});

test('atomicWrite 不留下临时文件', () => {
  const root = tempRoot();
  init(root);
  for (let index = 0; index < 5; index += 1) {
    save(root, emptyState({ change: `c-${index}` }));
  }
  const entries = fs.readdirSync(path.join(root, '.specgate'));
  assert.deepEqual(
    entries.filter((name) => name.includes('.tmp')),
    [],
  );
});

test('往返序列化保留嵌套结构', () => {
  const root = tempRoot();
  init(root);
  const state = emptyState({
    change: 'add-login',
    type: 'fix',
    phase: 'EXECUTING',
    touched: { modify: ['tests/automation/a.test.js'], delete: [], bootstrap: [] },
    approvals: {
      H1: { artifactHash: 'sha256:abc', issuedAt: 'x', expiresAt: 'y', consumedAt: 'z' },
      H2: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
      H3: { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null },
    },
  });
  assert.equal(save(root, state).ok, true);
  const loaded = load(root);
  assert.deepEqual(loaded.state.touched.modify, ['tests/automation/a.test.js']);
  assert.equal(loaded.state.approvals.H1.artifactHash, 'sha256:abc');
});
