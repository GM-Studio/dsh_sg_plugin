import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTENTION_STATES,
  DECISION_STATES,
  WORK_ITEM_STATES,
  applyDecisionToWorkItem,
  transitionAttention,
  transitionDecision,
  transitionWorkItem,
} from '../src/codex/core/control/persistence/state-machine.js';

const at = '2026-10-23T02:00:00.000Z';
const evidence = { actorId: 'owner', source: 'web', at, reason: 'test transition', version: 1 };

test('frozen persistence state enums match the approved product states', () => {
  assert.deepEqual(WORK_ITEM_STATES, [
    'QUEUED',
    'RUNNING',
    'WAITING_FOR_USER',
    'PAUSED',
    'BLOCKED',
    'FAILED',
    'DECIDED_PENDING_APPLY',
    'RESUMING',
    'DELIVERING',
    'COMPLETED',
    'CANCELLED',
  ]);
  assert.deepEqual(ATTENTION_STATES, [
    'OPEN',
    'DELIVERED',
    'REMINDED',
    'ESCALATED',
    'DECIDED',
    'RESOLVED',
    'EXPIRED',
    'SUPERSEDED',
    'CANCELLED',
  ]);
  assert.deepEqual(DECISION_STATES, [
    'RECORDED',
    'PENDING_APPLY',
    'APPLYING',
    'APPLIED',
    'STALE',
    'REJECTED',
  ]);
  for (const states of [WORK_ITEM_STATES, ATTENTION_STATES, DECISION_STATES]) {
    assert.equal(Object.isFrozen(states), true);
  }
});

test('WorkItem transitions require evidence and cancellation is terminal', () => {
  const waiting = transitionWorkItem({
    ...evidence,
    from: 'RUNNING',
    to: 'WAITING_FOR_USER',
  });
  assert.equal(waiting.ok, true);
  assert.deepEqual(waiting.transition, {
    from: 'RUNNING',
    to: 'WAITING_FOR_USER',
    actorId: 'owner',
    source: 'web',
    at,
    reason: 'test transition',
    version: 1,
    related: null,
  });
  assert.equal(
    transitionWorkItem({ ...evidence, from: 'CANCELLED', to: 'RUNNING' }).code,
    'INVALID_TRANSITION',
  );
  assert.equal(
    transitionWorkItem({ ...evidence, from: 'RUNNING', to: 'UNKNOWN' }).code,
    'INVALID_TRANSITION',
  );
  assert.equal(
    transitionWorkItem({ ...evidence, from: 'RUNNING', to: 'COMPLETED', actorId: '' }).code,
    'TRANSITION_EVIDENCE_INVALID',
  );
  assert.equal(
    transitionWorkItem({ ...evidence, from: 'RUNNING', to: 'COMPLETED', at: 'not-a-time' }).code,
    'TRANSITION_EVIDENCE_INVALID',
  );
});

test('Attention lifecycle is independent from delivery channels and supports escalation', () => {
  const path = ['OPEN', 'DELIVERED', 'REMINDED', 'ESCALATED', 'DECIDED'];
  for (let index = 0; index < path.length - 1; index += 1) {
    assert.equal(
      transitionAttention({ ...evidence, from: path[index], to: path[index + 1] }).ok,
      true,
    );
  }
  for (const terminal of ['DECIDED', 'RESOLVED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED']) {
    assert.equal(
      transitionAttention({ ...evidence, from: terminal, to: 'OPEN' }).code,
      'INVALID_TRANSITION',
    );
  }
  assert.equal(transitionAttention({ ...evidence, from: 'OPEN', to: 'RESOLVED' }).ok, true);
  assert.equal(transitionAttention({ ...evidence, from: 'ESCALATED', to: 'CANCELLED' }).ok, true);
});

test('Decision distinguishes recorded, pending, applying and applied', () => {
  for (const [from, to] of [
    ['RECORDED', 'PENDING_APPLY'],
    ['PENDING_APPLY', 'APPLYING'],
    ['APPLYING', 'APPLIED'],
    ['RECORDED', 'REJECTED'],
    ['PENDING_APPLY', 'STALE'],
  ]) {
    assert.equal(transitionDecision({ ...evidence, from, to }).ok, true);
  }
  assert.equal(
    transitionDecision({ ...evidence, from: 'APPLIED', to: 'PENDING_APPLY' }).code,
    'INVALID_TRANSITION',
  );
  assert.equal(
    transitionDecision({ ...evidence, from: 'REJECTED', to: 'APPLIED' }).code,
    'INVALID_TRANSITION',
  );
});

const pendingWorkItem = {
  workItemId: 'work-1',
  executionState: 'DECIDED_PENDING_APPLY',
  revision: 4,
  artifactHash: 'a'.repeat(64),
};
const pendingDecision = {
  decisionId: 'decision-1',
  status: 'PENDING_APPLY',
  action: 'approve',
  source: 'web',
  expectedWorkItemVersion: 4,
  artifactHash: 'a'.repeat(64),
};

test('decision application updates WorkItem and Decision only after validation', () => {
  const applied = applyDecisionToWorkItem({
    workItem: pendingWorkItem,
    decision: pendingDecision,
    actorId: 'owner',
    at,
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.workItem.executionState, 'RESUMING');
  assert.equal(applied.workItem.revision, 5);
  assert.equal(applied.decision.status, 'APPLIED');
  assert.equal(applied.decision.appliedAt, at);
  assert.equal(applied.transition.from, 'DECIDED_PENDING_APPLY');
  assert.equal(applied.transition.to, 'RESUMING');
  assert.equal(pendingWorkItem.executionState, 'DECIDED_PENDING_APPLY');
  assert.equal(pendingDecision.status, 'PENDING_APPLY');
});

test('old WorkItem revisions and old artifacts fail closed without mutation', () => {
  for (const decision of [
    { ...pendingDecision, expectedWorkItemVersion: 3 },
    { ...pendingDecision, artifactHash: 'b'.repeat(64) },
  ]) {
    const result = applyDecisionToWorkItem({
      workItem: pendingWorkItem,
      decision,
      actorId: 'owner',
      at,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'DECISION_STALE');
  }
  const cancelled = applyDecisionToWorkItem({
    workItem: { ...pendingWorkItem, executionState: 'CANCELLED' },
    decision: pendingDecision,
    actorId: 'owner',
    at,
  });
  assert.equal(cancelled.code, 'INVALID_TRANSITION');
});

test('Decision application accepts only pending states and maps terminal actions', () => {
  for (const status of ['RECORDED', 'APPLIED', 'STALE', 'REJECTED']) {
    assert.equal(
      applyDecisionToWorkItem({
        workItem: pendingWorkItem,
        decision: { ...pendingDecision, status },
        actorId: 'owner',
        at,
      }).code,
      'DECISION_NOT_APPLICABLE',
    );
  }
  const cancelledDecision = applyDecisionToWorkItem({
    workItem: pendingWorkItem,
    decision: { ...pendingDecision, action: 'cancel' },
    actorId: 'owner',
    at,
  });
  assert.equal(cancelledDecision.ok, true);
  assert.equal(cancelledDecision.workItem.executionState, 'CANCELLED');
  const accepted = applyDecisionToWorkItem({
    workItem: { ...pendingWorkItem, executionState: 'DELIVERING', revision: 4 },
    decision: { ...pendingDecision, action: 'accept_delivery' },
    actorId: 'owner',
    at,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.workItem.executionState, 'COMPLETED');
});
