import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';
import { buildPrompt, buildWorkerPrompt } from '../src/codex/control/supervisor.js';

function fixture() {
  let next = 0;
  const now = Date.parse('2026-10-24T10:00:00.000Z');
  const service = createControlService({
    store: createControlStore({
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m4-application-store-')),
      clock: () => now,
    }),
    clock: () => now,
    randomId: () => `m4-${++next}`,
  });
  return {
    service,
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m4-application-project-')),
  };
}

async function createWaitingItem(
  service,
  projectRoot,
  { sessionId = null, type = 'H1_APPROVAL' } = {},
) {
  const created = await service.createWorkItem({
    title: 'M4 exporter',
    request: 'Implement the approved export flow',
    projectRoot,
  });
  let expectedVersion = created.workItem.revision;
  if (sessionId) {
    const claimed = await service.claimNext({ ownerId: 'm4-supervisor', leaseMs: 60000 });
    assert.equal(claimed.ok, true, JSON.stringify(claimed));
    const heartbeat = await service.heartbeat({
      runId: claimed.run.runId,
      leaseToken: claimed.lease.token,
      expectedRunVersion: claimed.run.revision,
      updates: { sessionId },
    });
    assert.equal(heartbeat.ok, true, JSON.stringify(heartbeat));
    expectedVersion = heartbeat.workItem.revision;
  }
  const attention = await service.requestAttention({
    workItemId: created.workItem.workItemId,
    expectedVersion,
    type,
    reason: 'Confirm the M4 execution slice',
    question: 'Approve this WorkItem?',
    actions: ['approve', 'request_changes', 'cancel'],
    artifactHash: 'a'.repeat(64),
  });
  assert.equal(attention.ok, true, JSON.stringify(attention));
  return { created, attention };
}

function decisionInput(waiting, overrides = {}) {
  return {
    workItemId: waiting.created.workItem.workItemId,
    attentionId: waiting.attention.attention.requestId,
    attentionRevision: waiting.attention.attention.revision,
    expectedWorkItemVersion: waiting.attention.workItem.revision,
    artifactHash: 'a'.repeat(64),
    action: 'approve',
    idempotencyKey: 'm4-decision',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
    ...overrides,
  };
}

test('Decision application is pending, single-owner and completes exactly once', async () => {
  const { service, projectRoot } = fixture();
  const waiting = await createWaitingItem(service, projectRoot, {
    sessionId: 'original-session',
  });
  const decided = await service.decide(decisionInput(waiting));
  assert.equal(decided.ok, true, JSON.stringify(decided));
  assert.equal(decided.decision.status, 'CONSUMED');
  assert.equal(decided.workItem.resume.decisionId, decided.decision.decisionId);
  assert.equal(decided.workItem.resume.sessionId, 'original-session');

  const input = {
    decisionId: decided.decision.decisionId,
    workItemId: decided.workItem.workItemId,
    consumer: 'worker-a',
  };
  const pending = await service.beginDecisionApplication(input);
  assert.equal(pending.ok, true, JSON.stringify(pending));
  assert.equal(pending.decision.status, 'CONSUMED');
  assert.equal(pending.decision.applyStatus, 'PENDING_APPLY');
  assert.equal(pending.decision.applyBy, 'worker-a');
  assert.ok(pending.decision.applyStartedAt);

  const repeated = await service.beginDecisionApplication(input);
  assert.equal(repeated.ok, true, JSON.stringify(repeated));
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.decision.applyStartedAt, pending.decision.applyStartedAt);

  const conflict = await service.beginDecisionApplication({
    ...input,
    consumer: 'worker-b',
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'DECISION_APPLICATION_CONFLICT');

  const applied = await service.markDecisionApplied(input);
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.decision.status, 'APPLIED');
  assert.equal(applied.decision.applyStatus, 'APPLIED');
  assert.equal(applied.decision.appliedBy, 'worker-a');
  assert.ok(applied.decision.appliedAt);

  const replay = await service.markDecisionApplied(input);
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'DECISION_ALREADY_APPLIED');
});

test('a cancelled Decision applies without an original session and never resumes', async () => {
  const { service, projectRoot } = fixture();
  const waiting = await createWaitingItem(service, projectRoot);
  const decided = await service.decide(decisionInput(waiting, { action: 'cancel' }));
  assert.equal(decided.ok, true, JSON.stringify(decided));
  assert.equal(decided.workItem.executionState, 'CANCELLED');
  assert.equal(decided.workItem.resume, null);

  const input = {
    decisionId: decided.decision.decisionId,
    workItemId: decided.workItem.workItemId,
    consumer: 'worker-cancel',
  };
  const pending = await service.beginDecisionApplication(input);
  assert.equal(pending.ok, true, JSON.stringify(pending));
  const applied = await service.markDecisionApplied(input);
  assert.equal(applied.ok, true, JSON.stringify(applied));
  assert.equal(applied.decision.status, 'APPLIED');
  assert.equal(applied.workItem.executionState, 'CANCELLED');
  assert.equal(applied.workItem.resume, null);
});

test('a missing original session blocks application without losing resume context', async () => {
  const { service, projectRoot } = fixture();
  const waiting = await createWaitingItem(service, projectRoot);
  const decided = await service.decide(decisionInput(waiting));
  assert.equal(decided.ok, true, JSON.stringify(decided));
  assert.equal(decided.workItem.resume.sessionId, null);
  const resumeSnapshot = JSON.parse(JSON.stringify(decided.workItem.resume));
  const input = {
    decisionId: decided.decision.decisionId,
    workItemId: decided.workItem.workItemId,
    consumer: 'worker-missing-session',
  };

  const pending = await service.beginDecisionApplication(input);
  assert.equal(pending.ok, false);
  assert.equal(pending.code, 'RESUME_SESSION_REQUIRED');
  const unchanged = await service.inspect();
  assert.deepEqual(unchanged.state.workItems[decided.workItem.workItemId].resume, resumeSnapshot);
  assert.equal(unchanged.state.decisions[decided.decision.decisionId].applyStatus, undefined);

  const failed = await service.failDecisionApplication({
    ...input,
    error: 'original session no longer exists',
  });
  assert.equal(failed.ok, true, JSON.stringify(failed));
  assert.equal(failed.decision.status, 'REJECTED');
  assert.equal(failed.decision.applyStatus, 'REJECTED');
  assert.equal(failed.decision.applyError, 'original session no longer exists');
  assert.equal(failed.workItem.executionState, 'BLOCKED');
  assert.equal(failed.workItem.hostHealth, 'INTERRUPTED');
  assert.equal(failed.workItem.nextOwner, 'user');
  assert.match(failed.workItem.nextAction, /Decision application failed/);
  assert.notEqual(failed.workItem.executionState, 'COMPLETED');
  assert.deepEqual(failed.workItem.resume, resumeSnapshot);
});

test('a pending application failure is explicit and never becomes completion', async () => {
  const { service, projectRoot } = fixture();
  const waiting = await createWaitingItem(service, projectRoot, {
    sessionId: 'session-that-fails-to-apply',
  });
  const decided = await service.decide(decisionInput(waiting));
  assert.equal(decided.ok, true, JSON.stringify(decided));
  const input = {
    decisionId: decided.decision.decisionId,
    workItemId: decided.workItem.workItemId,
    consumer: 'worker-apply-failure',
  };
  const pending = await service.beginDecisionApplication(input);
  assert.equal(pending.ok, true, JSON.stringify(pending));

  const failed = await service.failDecisionApplication({
    ...input,
    error: 'session resume returned a non-zero exit code',
  });
  assert.equal(failed.ok, true, JSON.stringify(failed));
  assert.equal(failed.decision.status, 'REJECTED');
  assert.equal(failed.decision.applyStatus, 'REJECTED');
  assert.equal(failed.workItem.executionState, 'BLOCKED');
  assert.equal(failed.workItem.completedAt, null);
  assert.match(failed.workItem.nextAction, /session resume returned a non-zero exit code/);
});

test('request_changes payload is carried into the resume prompt', async () => {
  const { service, projectRoot } = fixture();
  const waiting = await createWaitingItem(service, projectRoot, {
    sessionId: 'session-with-changes',
  });
  const comment = 'Add an empty-export regression test before delivery.';
  const decided = await service.decide(
    decisionInput(waiting, {
      action: 'request_changes',
      payload: { comment },
    }),
  );
  assert.equal(decided.ok, true, JSON.stringify(decided));
  assert.equal(decided.workItem.resume.action, 'request_changes');
  assert.equal(decided.workItem.resume.payload.comment, comment);

  const prompt = buildWorkerPrompt(decided.workItem, 'resume');
  assert.match(prompt, /Decision: request_changes/);
  assert.match(prompt, /Add an empty-export regression test before delivery\./);
  assert.match(prompt, /Session to restore: session-with-changes/);
  assert.match(prompt, /do not create a replacement session/);
  assert.equal(buildPrompt, buildWorkerPrompt);
});

test('native H1 and H3 gate application may complete without a resume session', async () => {
  const { service, projectRoot } = fixture();
  for (const type of ['H1_APPROVAL', 'H3_APPROVAL']) {
    const waiting = await createWaitingItem(service, projectRoot, { type });
    const decided = await service.decide(
      decisionInput(waiting, { idempotencyKey: `native-${type}` }),
    );
    assert.equal(decided.ok, true, JSON.stringify(decided));

    const consumer = `native-${type.slice(0, 2).toLowerCase()}-gate`;
    const applied = await service.markDecisionApplied({
      decisionId: decided.decision.decisionId,
      workItemId: decided.workItem.workItemId,
      consumer,
    });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.decision.status, 'APPLIED');
    assert.equal(applied.decision.applyStatus, 'APPLIED');
    assert.equal(applied.decision.appliedBy, consumer);
  }
});
