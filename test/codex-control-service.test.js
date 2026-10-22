import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';

function fixture() {
  const store = createControlStore({
    root: fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-service-')),
    clock: () => Date.parse('2026-10-22T10:00:00.000Z'),
  });
  let next = 0;
  const service = createControlService({
    store,
    clock: () => Date.parse('2026-10-22T10:00:00.000Z'),
    randomId: () => `id-${++next}`,
  });
  return {
    store,
    service,
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-project-')),
  };
}

async function waitingItem(service, projectRoot) {
  const created = await service.createWorkItem({
    title: 'Exporter',
    request: 'Implement CSV export',
    projectRoot,
  });
  const attention = await service.requestAttention({
    workItemId: created.workItem.workItemId,
    expectedVersion: created.workItem.revision,
    type: 'H1_APPROVAL',
    reason: 'Confirm scope',
    question: 'Approve?',
    actions: ['approve', 'request_changes', 'cancel'],
    artifactHash: 'a'.repeat(64),
  });
  return { created, attention };
}

test('Decision requires H1 step-up, exact revision and artifact binding', async () => {
  const { service, projectRoot } = fixture();
  const { created, attention } = await waitingItem(service, projectRoot);
  const base = {
    workItemId: created.workItem.workItemId,
    attentionId: attention.attention.requestId,
    attentionRevision: attention.attention.revision,
    expectedWorkItemVersion: attention.workItem.revision,
    artifactHash: 'a'.repeat(64),
    action: 'approve',
    idempotencyKey: 'decision-1',
    actorId: 'owner',
    source: 'web',
  };
  assert.equal((await service.decide({ ...base, authLevel: 'session' })).code, 'STEP_UP_REQUIRED');
  assert.equal(
    (await service.decide({ ...base, authLevel: 'step-up', artifactHash: 'b'.repeat(64) })).code,
    'ARTIFACT_MISMATCH',
  );

  const accepted = await service.decide({ ...base, authLevel: 'step-up' });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.workItem.executionState, 'QUEUED');
  assert.equal(accepted.attention.status, 'DECIDED');
  assert.equal(accepted.workItem.humanDecisionCount, 1);
  assert.equal(accepted.workItem.resume.action, 'approve');
});

test('duplicate Decision callback is idempotent and does not resume twice', async () => {
  const { service, projectRoot } = fixture();
  const { created, attention } = await waitingItem(service, projectRoot);
  const input = {
    workItemId: created.workItem.workItemId,
    attentionId: attention.attention.requestId,
    attentionRevision: attention.attention.revision,
    expectedWorkItemVersion: attention.workItem.revision,
    artifactHash: 'a'.repeat(64),
    action: 'approve',
    idempotencyKey: 'decision-1',
    actorId: 'owner',
    source: 'feishu',
    authLevel: 'step-up',
  };
  const first = await service.decide(input);
  const second = await service.decide(input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.decision.decisionId, first.decision.decisionId);
  assert.equal(second.workItem.humanDecisionCount, 1);
});

test('stale and cross-work Decisions fail closed', async () => {
  const { service, projectRoot } = fixture();
  const first = await waitingItem(service, projectRoot);
  const secondProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-project-'));
  const second = await waitingItem(service, secondProjectRoot);
  const mismatch = await service.decide({
    workItemId: second.created.workItem.workItemId,
    attentionId: first.attention.attention.requestId,
    attentionRevision: first.attention.attention.revision,
    expectedWorkItemVersion: first.attention.workItem.revision,
    artifactHash: 'a'.repeat(64),
    action: 'approve',
    idempotencyKey: 'cross',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
  });
  assert.equal(mismatch.code, 'ATTENTION_NOT_FOUND');

  const state = (await service.inspect()).state;
  const item = state.workItems[first.created.workItem.workItemId];
  const stale = await service.decide({
    workItemId: first.created.workItem.workItemId,
    attentionId: first.attention.attention.requestId,
    attentionRevision: first.attention.attention.revision,
    expectedWorkItemVersion: first.attention.workItem.revision,
    artifactHash: 'a'.repeat(64),
    action: 'request_changes',
    idempotencyKey: 'stale',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
  });
  assert.equal(stale.ok, true);
  const replay = await service.decide({
    workItemId: first.created.workItem.workItemId,
    attentionId: first.attention.attention.requestId,
    attentionRevision: first.attention.attention.revision,
    expectedWorkItemVersion: stale.workItem.revision,
    artifactHash: 'a'.repeat(64),
    action: 'approve',
    idempotencyKey: 'old',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
  });
  assert.equal(replay.ok, false);
  assert.equal(item.executionState, 'WAITING_FOR_USER');
});

test('heartbeat and offline reconciliation are explicit', async () => {
  const { service, projectRoot } = fixture();
  const created = await service.createWorkItem({
    title: 'Exporter',
    request: 'Implement CSV export',
    projectRoot,
  });
  const claimed = await service.claimNext({ ownerId: 'supervisor', leaseMs: 30000 });
  assert.equal(claimed.ok, true);
  const runId = claimed.run.runId;
  const heartbeat = await service.heartbeat({
    runId,
    leaseToken: claimed.lease.token,
    expectedRunVersion: 1,
  });
  assert.equal(heartbeat.ok, true);
  assert.equal(heartbeat.run.executionState, 'RUNNING');
  assert.equal(heartbeat.workItem.lastHeartbeatAt, '2026-10-22T10:00:00.000Z');

  const reconciled = await service.reconcile({
    now: Date.parse('2026-10-22T10:02:00.000Z'),
  });
  assert.equal(reconciled.ok, true);
  const state = (await service.inspect()).state;
  assert.equal(state.runs[runId].executionState, 'INTERRUPTED');
  assert.equal(state.workItems[created.workItem.workItemId].hostHealth, 'INTERRUPTED');
  assert.equal(state.workItems[created.workItem.workItemId].executionState, 'WAITING_FOR_USER');
  const attentionId = state.workItems[created.workItem.workItemId].currentAttentionId;
  assert.equal(state.attention[attentionId].type, 'OFFLINE');
});

test('management actions are idempotent for retried client requests', async () => {
  const { service, projectRoot } = fixture();
  const created = await service.createWorkItem({
    title: 'Exporter',
    request: 'Implement CSV export',
    projectRoot,
  });
  const input = {
    workItemId: created.workItem.workItemId,
    expectedVersion: created.workItem.revision,
    actorId: 'owner',
    source: 'web',
    idempotencyKey: `web-${created.workItem.workItemId}-pause-${created.workItem.revision}`,
  };
  const first = await service.pause(input);
  const second = await service.pause(input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.decision.decisionId, first.decision.decisionId);
  const state = await service.inspect();
  assert.equal(
    Object.values(state.state.decisions).filter(
      (entry) => entry.idempotencyKey === input.idempotencyKey,
    ).length,
    1,
  );
});

test('direct cancel closes the open AttentionRequest', async () => {
  const { service, projectRoot } = fixture();
  const { created, attention } = await waitingItem(service, projectRoot);
  const cancelled = await service.cancel({
    workItemId: created.workItem.workItemId,
    expectedVersion: attention.workItem.revision,
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
    idempotencyKey: 'direct-cancel',
  });

  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  assert.equal(cancelled.workItem.executionState, 'CANCELLED');
  assert.equal(cancelled.workItem.currentAttentionId, null);
  const stored = (await service.inspect()).state;
  assert.equal(stored.attention[attention.attention.requestId].status, 'DECIDED');
  assert.equal(stored.attention[attention.attention.requestId].decisionAction, 'cancel');
  assert.equal(
    stored.attention[attention.attention.requestId].decisionId,
    cancelled.decision.decisionId,
  );
});

test('direct request changes closes the open AttentionRequest and queues work', async () => {
  const { service, projectRoot } = fixture();
  const { created, attention } = await waitingItem(service, projectRoot);
  const changed = await service.requestChanges({
    workItemId: created.workItem.workItemId,
    expectedVersion: attention.workItem.revision,
    actorId: 'owner',
    source: 'web',
    payload: { comment: 'Add a regression test for the empty export case.' },
    idempotencyKey: 'direct-request-changes',
  });

  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.equal(changed.workItem.executionState, 'QUEUED');
  assert.equal(changed.workItem.currentAttentionId, null);
  assert.equal(changed.workItem.resume.action, 'request_changes');
  const stored = (await service.inspect()).state;
  assert.equal(stored.attention[attention.attention.requestId].status, 'DECIDED');
  assert.equal(stored.attention[attention.attention.requestId].decisionAction, 'request_changes');
});

test('a BUDGET resume Decision must increase the budget before work is queued', async () => {
  const { service, projectRoot } = fixture();
  const created = await service.createWorkItem({
    title: 'Budgeted',
    request: 'Finish a bounded task',
    projectRoot,
  });
  const attention = await service.requestAttention({
    workItemId: created.workItem.workItemId,
    expectedVersion: created.workItem.revision,
    type: 'BUDGET',
    reason: 'Execution reached MODEL_TOKEN_BUDGET.',
    question: 'Increase the budget and resume, or cancel?',
    actions: ['resume', 'cancel'],
    artifactHash: 'c'.repeat(64),
  });
  const base = {
    workItemId: created.workItem.workItemId,
    attentionId: attention.attention.requestId,
    attentionRevision: attention.attention.revision,
    expectedWorkItemVersion: attention.workItem.revision,
    artifactHash: 'c'.repeat(64),
    action: 'resume',
    idempotencyKey: 'budget-resume',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
  };

  const missing = await service.decide(base);
  assert.equal(missing.code, 'BUDGET_INCREASE_REQUIRED');
  const unchanged = await service.decide({
    ...base,
    idempotencyKey: 'budget-unchanged',
    payload: { budget: { maxModelTokens: created.workItem.budget.maxModelTokens } },
  });
  assert.equal(unchanged.code, 'BUDGET_INCREASE_INVALID');

  const increased = await service.decide({
    ...base,
    idempotencyKey: 'budget-increased',
    payload: { budget: { maxModelTokens: 1500000 } },
  });
  assert.equal(increased.ok, true, JSON.stringify(increased));
  assert.equal(increased.workItem.budget.maxModelTokens, 1500000);
  assert.equal(increased.workItem.executionState, 'QUEUED');
});

test('Decision preview validates the same revision and artifact binding without writing', async () => {
  const { service, projectRoot } = fixture();
  const { created, attention } = await waitingItem(service, projectRoot);
  const before = await service.inspect();
  const input = {
    workItemId: created.workItem.workItemId,
    attentionId: attention.attention.requestId,
    attentionRevision: attention.attention.revision,
    expectedWorkItemVersion: attention.workItem.revision,
    artifactHash: 'a'.repeat(64),
    action: 'approve',
    idempotencyKey: 'preview-approve-1',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
  };
  const preview = await service.decisions.preview(input);
  assert.equal(preview.ok, true);
  assert.equal(preview.attention.requestId, attention.attention.requestId);
  assert.equal(preview.workItem.revision, attention.workItem.revision);
  const after = await service.inspect();
  assert.equal(after.state.version, before.state.version);

  const changed = await service.decisions.preview({
    ...input,
    artifactHash: 'b'.repeat(64),
  });
  assert.equal(changed.code, 'ARTIFACT_MISMATCH');
});

test('expired AttentionRequest becomes explicit and can no longer be decided', async () => {
  const { service, projectRoot } = fixture();
  const created = await service.createWorkItem({
    title: 'Expiry',
    request: 'Expire safely',
    projectRoot,
  });
  const attention = await service.requestAttention({
    workItemId: created.workItem.workItemId,
    expectedVersion: created.workItem.revision,
    type: 'CLARIFICATION',
    reason: 'Need input',
    question: 'Continue?',
    actions: ['answer', 'cancel'],
    artifactHash: 'a'.repeat(64),
    expiresAt: '2026-10-22T10:01:00.000Z',
  });
  const expired = await service.expireAttention({
    attentionId: attention.attention.requestId,
    now: Date.parse('2026-10-22T10:02:00.000Z'),
  });
  assert.equal(expired.ok, true);
  assert.equal(expired.attention.status, 'EXPIRED');
  const current = await service.getWorkItem(created.workItem.workItemId);
  const rejected = await service.decide({
    workItemId: created.workItem.workItemId,
    attentionId: attention.attention.requestId,
    attentionRevision: attention.attention.revision,
    expectedWorkItemVersion: current.workItem.revision,
    artifactHash: 'a'.repeat(64),
    action: 'answer',
    idempotencyKey: 'expired-answer',
    actorId: 'owner',
    source: 'web',
    authLevel: 'session',
  });
  assert.equal(rejected.code, 'ATTENTION_NOT_OPEN');
});
