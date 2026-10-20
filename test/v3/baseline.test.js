import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject, createChange, patchConfigRequirements } from '../../src/v3/change.js';
import { load, patchState } from '../../src/v3/state.js';
import {
  establishInitialBaseline,
  readEffectiveBaseline,
  checkChangeBaseline,
  prepareBaselineUpdate,
  approveBaselineUpdate,
  syncBaselineUpdate,
  patchBaselineState,
} from '../../src/v3/baseline.js';
const content = '# 工程 req\n\n### REQ-001 CRUD\n持久化数据\n';
function fixture(t, v4 = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-baseline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initProject(root);
  fs.writeFileSync(path.join(root, 'openspec', 'REQ.md'), content);
  if (v4) {
    const state = load(root).state;
    state.workflowVersion = 4;
    fs.writeFileSync(path.join(root, '.specgate', 'state.json'), JSON.stringify(state));
  }
  assert.equal(establishInitialBaseline(root, { content }).ok, true);
  if (v4)
    patchBaselineState(root, (draft) => {
      draft.change = 'edit-crud';
      draft.changeBaseline = draft.projectReq;
      draft.phase = 'H3_PENDING';
    });
  else assert.equal(createChange(root, { name: 'edit-crud', requirements: ['REQ-001'] }).ok, true);
  if (!v4)
    patchState(root, (draft) => {
      draft.phase = 'H3_PENDING';
    });
  return root;
}
function approve(root, state = load(root).state) {
  const prepared = prepareBaselineUpdate(root, state, {
    content: content.replace('CRUD', '新版 CRUD'),
    sessionId: 'session-a',
    verification: '构建、测试、真实联通通过',
  });
  assert.equal(prepared.ok, true);
  assert.equal(approveBaselineUpdate(root, state, prepared, { sessionId: 'session-a' }).ok, true);
  return prepared;
}
test('managed change binds current baseline and false config cannot bypass drift', (t) => {
  const root = fixture(t);
  const state = load(root).state;
  assert.equal(state.changeBaseline.version, 'v1.0');
  assert.equal(checkChangeBaseline(root, state).ok, true);
  patchConfigRequirements(root, { enabled: false });
  fs.appendFileSync(path.join(root, 'openspec', 'REQ.md'), 'manual');
  assert.equal(checkChangeBaseline(root, state).code, 'REQ_BASELINE_DRIFT');
  assert.equal(createChange(root, { name: 'other' }).ok, false);
});
test('unconfirmed, declined or foreign-session targets cannot publish', (t) => {
  const root = fixture(t);
  assert.equal(syncBaselineUpdate(root, { sessionId: 'session-a' }).code, 'REQ_RECONFIRM_REQUIRED');
  approve(root);
  assert.equal(syncBaselineUpdate(root, { sessionId: 'other' }).code, 'REQ_RECONFIRM_REQUIRED');
  assert.equal(fs.readFileSync(path.join(root, 'openspec', 'REQ.md'), 'utf8'), content);
});
test('confirmed replacement increments version, traces source and completes without git', (t) => {
  const root = fixture(t);
  approve(root);
  const result = syncBaselineUpdate(root, { sessionId: 'session-a' });
  assert.equal(result.ok, true);
  assert.equal(result.baseline.version, 'v1.1');
  assert.equal(result.baseline.sourceChange, 'edit-crud');
  assert.equal(load(root).state.phase, 'DONE');
  assert.equal(readEffectiveBaseline(root).content.includes('新版 CRUD'), true);
  assert.equal(createChange(root, { name: 'next-change' }).ok, true);
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
});
test('sync failure keeps old req, blocks next change, and limits explicit retries', (t) => {
  const root = fixture(t);
  approve(root);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === path.join(root, 'openspec', 'REQ.md')) throw new Error('disk failure');
    return rename(from, to);
  };
  t.after(() => {
    fs.renameSync = rename;
  });
  assert.equal(syncBaselineUpdate(root, { sessionId: 'session-a' }).code, 'REQ_PENDING_SYNC');
  assert.equal(load(root).state.phase, 'BASELINE_PENDING_SYNC');
  assert.equal(fs.readFileSync(path.join(root, 'openspec', 'REQ.md'), 'utf8'), content);
  assert.equal(createChange(root, { name: 'next-change' }).code, 'REQ_PENDING_SYNC');
  assert.equal(syncBaselineUpdate(root, { sessionId: 'session-a' }).code, 'REQ_RETRY_INVALID');
  for (let i = 0; i < 2; i++)
    assert.equal(
      syncBaselineUpdate(root, { sessionId: 'session-a', retry: true }).code,
      'REQ_PENDING_SYNC',
    );
  assert.equal(
    syncBaselineUpdate(root, { sessionId: 'session-a', retry: true }).code,
    'REQ_RETRY_LIMIT',
  );
});
test('same-session sync-only retry succeeds after write failure, manual old req change blocks', (t) => {
  const root = fixture(t);
  approve(root);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === path.join(root, 'openspec', 'REQ.md')) throw new Error('disk failure');
    return rename(from, to);
  };
  try {
    assert.equal(syncBaselineUpdate(root, { sessionId: 'session-a' }).code, 'REQ_PENDING_SYNC');
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(syncBaselineUpdate(root, { sessionId: 'session-a', retry: true }).ok, true);
  const root2 = fixture(t);
  approve(root2);
  fs.appendFileSync(path.join(root2, 'openspec', 'REQ.md'), 'manual');
  assert.equal(syncBaselineUpdate(root2, { sessionId: 'session-a' }).code, 'REQ_BASELINE_DRIFT');
});
test('prepared object tampering and partial initialized states are rejected', (t) => {
  const root = fixture(t);
  const state = load(root).state;
  const prepared = prepareBaselineUpdate(root, state, {
    content: content + 'new',
    sessionId: 'a',
    verification: 'pass',
  });
  prepared.baseline.doc = 'other.md';
  assert.equal(
    approveBaselineUpdate(root, state, prepared, { sessionId: 'a' }).code,
    'REQ_APPROVAL_INVALID',
  );
  patchState(root, (draft) => {
    draft.projectReq.initialized = false;
  });
  assert.equal(createChange(root, { name: 'other' }).code, 'REQ_INIT_INCOMPLETE');
});
test('state-save failure restores old req and requires fresh confirmation', (t) => {
  const root = fixture(t);
  approve(root);
  const rename = fs.renameSync;
  let writes = 0;
  fs.renameSync = (from, to) => {
    if (to === path.join(root, '.specgate', 'state.json') && ++writes >= 2)
      throw new Error('state unavailable');
    return rename(from, to);
  };
  try {
    assert.equal(
      syncBaselineUpdate(root, { sessionId: 'session-a' }).code,
      'REQ_SYNC_STATE_UNCERTAIN',
    );
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(fs.readFileSync(path.join(root, 'openspec', 'REQ.md'), 'utf8'), content);
  assert.equal(load(root).state.phase, 'BASELINE_PENDING_SYNC');
  assert.equal(
    syncBaselineUpdate(root, { sessionId: 'session-a', retry: true }).code,
    'REQ_RECONFIRM_REQUIRED',
  );
});

test('v4 root baseline and side root binding use single current req', (t) => {
  const root = fixture(t, true);
  const raw = JSON.parse(fs.readFileSync(path.join(root, '.specgate', 'state.json'), 'utf8'));
  assert.equal(checkChangeBaseline(root, raw).ok, true);
  approve(root, raw);
  assert.equal(syncBaselineUpdate(root, { sessionId: 'session-a' }).ok, true);
  assert.equal(readEffectiveBaseline(root).baseline.version, 'v1.1');
});
