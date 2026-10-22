import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';

function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-store-'));
}

function fixture() {
  const controlRoot = temp();
  const projectRoot = temp();
  const store = createControlStore({
    root: controlRoot,
    clock: () => Date.parse('2026-10-22T10:00:00.000Z'),
  });
  const service = createControlService({
    store,
    clock: () => Date.parse('2026-10-22T10:00:00.000Z'),
    randomId: (() => {
      let id = 0;
      return () => `id-${++id}`;
    })(),
  });
  return { controlRoot, projectRoot, store, service };
}

test('control store persists immutable state and rejects version conflicts', async () => {
  const { service, store, projectRoot } = fixture();
  const created = await service.createWorkItem({
    title: 'Exporter',
    request: 'Implement CSV export',
    projectRoot,
  });
  assert.equal(created.ok, true);
  assert.equal(created.workItem.executionState, 'QUEUED');

  const inspected = await store.inspect();
  assert.equal(inspected.ok, true);
  assert.equal(inspected.state.version, 1);
  assert.equal(Object.keys(inspected.state.workItems).length, 1);

  const conflict = await service.updateWorkItem({
    workItemId: created.workItem.workItemId,
    expectedVersion: 0,
    patch: { title: 'Changed' },
  });
  assert.equal(conflict.code, 'VERSION_CONFLICT');
});

test('event chain tampering fails closed without replacing evidence', async () => {
  const { service, store, projectRoot } = fixture();
  const created = await service.createWorkItem({
    title: 'Exporter',
    request: 'Implement CSV export',
    projectRoot,
  });
  assert.equal(created.ok, true);
  const file = path.join(store.root, 'events.jsonl');
  const body = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, body.replace('Implement CSV export', 'Tampered request'));
  const inspected = await store.inspect();
  assert.equal(inspected.code, 'AUDIT_CORRUPT');
});

test('a lagging snapshot is recoverable from the complete event chain', async () => {
  const { service, store, projectRoot } = fixture();
  await service.createWorkItem({
    title: 'One',
    request: 'First work',
    projectRoot,
  });
  const snapshotPath = path.join(store.root, 'state.json');
  const firstSnapshot = fs.readFileSync(snapshotPath, 'utf8');
  await service.createWorkItem({
    title: 'Two',
    request: 'Second work',
    projectRoot,
  });
  fs.writeFileSync(snapshotPath, firstSnapshot);
  const inspected = await store.inspect();
  assert.equal(inspected.ok, true);
  assert.equal(Object.keys(inspected.state.workItems).length, 2);
});

test('a concurrent snapshot advance cannot make a consistent read look corrupt', async () => {
  const { service, store, projectRoot } = fixture();
  await service.createWorkItem({
    title: 'One',
    request: 'First work',
    projectRoot,
  });
  const eventsPath = path.join(store.root, 'events.jsonl');
  const snapshotPath = path.join(store.root, 'state.json');
  const eventsBefore = fs.readFileSync(eventsPath, 'utf8');
  const snapshotBefore = fs.readFileSync(snapshotPath, 'utf8');
  await service.createWorkItem({
    title: 'Two',
    request: 'Second work',
    projectRoot,
  });
  const eventsAfter = fs.readFileSync(eventsPath, 'utf8');
  const snapshotAfter = fs.readFileSync(snapshotPath, 'utf8');
  fs.writeFileSync(eventsPath, eventsBefore);
  fs.writeFileSync(snapshotPath, snapshotBefore);

  const readFileSync = fs.readFileSync;
  mock.method(fs, 'readFileSync', function (target, ...args) {
    if (target === eventsPath) {
      fs.writeFileSync(eventsPath, eventsAfter);
      fs.writeFileSync(snapshotPath, snapshotAfter);
      return eventsBefore;
    }
    return readFileSync.call(this, target, ...args);
  });
  try {
    const inspected = await store.inspect();
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
  } finally {
    mock.restoreAll();
  }
});

test('Attention revisions are unique and stale revisions cannot remain open', async () => {
  const { service, projectRoot } = fixture();
  const created = await service.createWorkItem({
    title: 'Exporter',
    request: 'Implement CSV export',
    projectRoot,
  });
  assert.equal(created.ok, true);
  const first = await service.requestAttention({
    workItemId: created.workItem.workItemId,
    expectedVersion: created.workItem.revision,
    type: 'H1_APPROVAL',
    reason: 'Confirm scope',
    question: 'Approve?',
    actions: ['approve', 'request_changes'],
    artifactHash: 'a'.repeat(64),
  });
  assert.equal(first.ok, true);

  const second = await service.requestAttention({
    workItemId: created.workItem.workItemId,
    expectedVersion: first.workItem.revision,
    type: 'H1_APPROVAL',
    reason: 'Confirm revised scope',
    question: 'Approve revised scope?',
    actions: ['approve', 'request_changes'],
    artifactHash: 'b'.repeat(64),
  });
  assert.equal(second.ok, true);
  assert.equal(second.attention.revision, 2);
  assert.equal(second.attention.previousAttentionId, first.attention.requestId);

  const state = (await service.inspect()).state;
  assert.equal(state.attention[first.attention.requestId].status, 'SUPERSEDED');
  assert.equal(state.attention[second.attention.requestId].status, 'OPEN');
});

test('a decided Attention key can reopen with a monotonically new revision', async () => {
  const { service, projectRoot } = fixture();
  const created = await service.createWorkItem({
    title: 'Exporter',
    request: 'Implement CSV export',
    projectRoot,
  });
  const first = await service.requestAttention({
    workItemId: created.workItem.workItemId,
    expectedVersion: created.workItem.revision,
    type: 'FAILED',
    reason: 'First failure',
    question: 'Retry?',
    actions: ['retry', 'cancel'],
    artifactHash: 'a'.repeat(64),
  });
  const decided = await service.decide({
    workItemId: created.workItem.workItemId,
    attentionId: first.attention.requestId,
    attentionRevision: first.attention.revision,
    expectedWorkItemVersion: first.workItem.revision,
    artifactHash: 'a'.repeat(64),
    action: 'retry',
    idempotencyKey: 'retry-first',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
  });
  assert.equal(decided.ok, true);
  const second = await service.requestAttention({
    workItemId: created.workItem.workItemId,
    expectedVersion: decided.workItem.revision,
    type: 'FAILED',
    reason: 'Second failure',
    question: 'Retry again?',
    actions: ['retry', 'cancel'],
    artifactHash: 'b'.repeat(64),
  });
  assert.equal(second.ok, true);
  assert.equal(second.attention.revision, 2);
  assert.equal(second.attention.previousAttentionId, first.attention.requestId);
});

test('project lease prevents concurrent WorkItems in one project', async () => {
  const { service, projectRoot } = fixture();
  const first = await service.createWorkItem({
    title: 'One',
    request: 'First work',
    projectRoot,
  });
  const second = await service.createWorkItem({
    title: 'Two',
    request: 'Second work',
    projectRoot,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  const claimed = await service.claimNext({
    ownerId: 'supervisor-a',
    leaseMs: 60000,
  });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.workItem.workItemId, first.workItem.workItemId);
  const next = await service.claimNext({
    ownerId: 'supervisor-b',
    leaseMs: 60000,
  });
  assert.equal(next.ok, true);
  assert.equal(next.workItem, null);
  assert.equal(next.idle, true);
});
