import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialControlState,
  projectWorkItemSummary,
  validateAttentionInput,
  validateDecisionInput,
  validateWorkItemInput,
} from '../src/codex/core/control/domain.js';

test('control state starts empty and schema-bounded', () => {
  const state = createInitialControlState();
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.version, 0);
  assert.deepEqual(state.projects, {});
  assert.deepEqual(state.workItems, {});
  assert.deepEqual(state.runs, {});
  assert.deepEqual(state.attention, {});
  assert.deepEqual(state.decisions, {});
  assert.deepEqual(state.notifications, {});
  assert.deepEqual(state.leases, {});
});

test('WorkItem input is bounded and cannot inject identity or arbitrary state', () => {
  const valid = validateWorkItemInput({
    title: 'Fix export encoding',
    request: 'Fix the customer export encoding regression.',
    projectRoot: 'C:\\work\\crm',
    budget: { wallClockMs: 60000 },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.budget.wallClockMs, 60000);

  assert.equal(
    validateWorkItemInput({
      title: 'x',
      request: 'do work',
      projectRoot: 'C:\\work\\crm',
      actor: { kind: 'user', id: 'forged' },
    }).code,
    'CONTROL_INPUT_INVALID',
  );
  assert.equal(
    validateWorkItemInput({
      title: 'x',
      request: 'token=super-secret-value',
      projectRoot: 'C:\\work\\crm',
    }).code,
    'CONTROL_SENSITIVE_INPUT',
  );
});

test('AttentionRequest requires a decision shape and stable revision context', () => {
  const input = {
    workItemId: 'work-1',
    type: 'H1_APPROVAL',
    reason: 'Requirements need confirmation',
    question: 'Approve the frozen scope?',
    actions: ['approve', 'request_changes', 'cancel'],
    summary: 'Scope and AC are ready.',
    risks: ['None known'],
    artifactHash: 'a'.repeat(64),
    expectedVersion: 3,
  };
  const checked = validateAttentionInput(input);
  assert.equal(checked.ok, true);
  assert.equal(checked.value.attentionKey.length, 64);
  assert.equal(
    validateAttentionInput({ ...input, artifactHash: 'not-a-hash' }).code,
    'ATTENTION_INVALID',
  );
  assert.equal(
    validateAttentionInput({ ...input, actions: ['approve', 'shell'] }).code,
    'ATTENTION_INVALID',
  );
});

test('Decision validation rejects arbitrary actions and untrusted auth fields', () => {
  const base = {
    workItemId: 'work-1',
    attentionId: 'attention-1',
    attentionRevision: 1,
    expectedWorkItemVersion: 3,
    action: 'approve',
    idempotencyKey: 'callback-1',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
    artifactHash: 'a'.repeat(64),
  };
  assert.equal(validateDecisionInput(base).ok, true);
  assert.equal(validateDecisionInput({ ...base, action: 'run_shell' }).code, 'DECISION_INVALID');
  assert.equal(validateDecisionInput({ ...base, actorId: '' }).code, 'DECISION_INVALID');
});

test('user-visible projection never reports OFFLINE as running', () => {
  const workItem = {
    title: 'Fix export',
    executionState: 'RUNNING',
    hostHealth: 'OFFLINE',
    currentAttentionId: null,
  };
  assert.deepEqual(projectWorkItemSummary(workItem), {
    status: 'OFFLINE',
    nextOwner: 'system',
    needsUser: false,
  });
});
