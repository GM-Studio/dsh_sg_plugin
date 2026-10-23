import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from '../src/codex/core/control/persistence/memory-repository.js';

const AT = '2026-10-23T02:00:00.000Z';
const HASH = 'a'.repeat(64);
const NOW = Date.parse(AT);

function workItem(overrides = {}) {
  return {
    workItemId: 'work-1',
    projectId: 'project-1',
    title: 'Implement persistence',
    executionState: 'WAITING_FOR_USER',
    revision: 3,
    artifactHash: HASH,
    updatedAt: AT,
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    decisionId: 'decision-1',
    workItemId: 'work-1',
    attentionId: 'attention-1',
    scope: 'delivery',
    attentionRevision: 1,
    idempotencyKey: 'idem-1',
    actorId: 'owner',
    action: 'approve',
    source: 'web',
    authLevel: 'step-up',
    artifactHash: HASH,
    expectedWorkItemVersion: 3,
    status: 'PENDING_APPLY',
    payload: {},
    createdAt: AT,
    ...overrides,
  };
}

function notification(overrides = {}) {
  return {
    deliveryId: 'delivery-1',
    projectId: 'project-1',
    workItemId: 'work-1',
    attentionId: 'attention-1',
    channel: 'feishu',
    recipient: 'owner@example.com',
    kind: 'attention',
    version: 1,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    eventId: 'event-1',
    projectId: 'project-1',
    workItemId: 'work-1',
    eventType: 'check.completed',
    source: 'worker',
    payload: { result: 'pass' },
    occurredAt: AT,
    receivedAt: AT,
    ...overrides,
  };
}

test('Project responses keep configuration and optimistic version separate', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  const created = repository.saveProject({ projectId: 'project-1' });
  assert.deepEqual(created.project, {
    projectId: 'project-1',
    name: 'project-1',
    evidenceRetentionDays: 7,
    notificationRetentionDays: 30,
    decisionRetentionDays: 365,
    auditRetentionDays: 365,
  });
  assert.equal(created.version, 1);

  const updated = repository.updateProjectRetention({
    projectId: 'project-1',
    expectedVersion: 1,
    evidenceRetentionDays: 14,
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.project.version, undefined);
  assert.equal(updated.project.evidenceRetentionDays, 14);
  assert.equal(updated.version, 2);

  const fetched = repository.getProject('project-1');
  assert.deepEqual(fetched, updated);
  assert.equal(
    repository.updateProjectRetention({
      projectId: 'project-1',
      expectedVersion: 1,
      evidenceRetentionDays: 30,
    }).code,
    'PROJECT_VERSION_CONFLICT',
  );
});

test('WorkItem CAS rejects stale revisions, revision gaps and identity changes', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  assert.equal(repository.saveWorkItem(workItem()).ok, true);
  const next = workItem({ revision: 4, executionState: 'DECIDED_PENDING_APPLY' });
  assert.equal(
    repository.updateWorkItemCas({ workItemId: 'work-1', expectedRevision: 3, workItem: next }).ok,
    true,
  );
  assert.equal(
    repository.updateWorkItemCas({
      workItemId: 'work-1',
      expectedRevision: 3,
      workItem: workItem({ revision: 5 }),
    }).code,
    'WORK_ITEM_VERSION_CONFLICT',
  );
  assert.equal(
    repository.updateWorkItemCas({
      workItemId: 'work-1',
      expectedRevision: 4,
      workItem: workItem({ revision: 6 }),
    }).code,
    'WORK_ITEM_VERSION_CONFLICT',
  );
  assert.equal(
    repository.updateWorkItemCas({
      workItemId: 'work-1',
      expectedRevision: 4,
      workItem: workItem({ projectId: 'project-2', revision: 5 }),
    }).code,
    'WORK_ITEM_INVALID',
  );
});

test('WorkItem save cannot overwrite an existing aggregate', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  assert.equal(repository.saveWorkItem(workItem()).ok, true);
  const result = repository.saveWorkItem(workItem({ title: 'overwritten', revision: 9 }));
  assert.equal(result.code, 'WORK_ITEM_ALREADY_EXISTS');
  assert.equal(repository.getWorkItem('work-1').workItem.title, 'Implement persistence');
});

test('Decision replay is idempotent and conflicting replay fails closed', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  repository.saveWorkItem(workItem());
  const first = repository.recordDecision(decision());
  assert.equal(first.ok, true);
  const replay = repository.recordDecision(decision());
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.decision.decisionId, first.decision.decisionId);
  assert.equal(
    repository.recordDecision(decision({ payload: { changed: true } })).code,
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(
    repository.recordDecision(decision({ idempotencyKey: 'idem-2', action: 'unknown' })).code,
    'DECISION_INVALID',
  );
});

test('Decision is bound to its WorkItem and project', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  repository.saveWorkItem(workItem());
  repository.saveWorkItem(workItem({ workItemId: 'work-2', projectId: 'project-2' }));
  repository.recordDecision(decision());
  assert.equal(
    repository.applyDecision({
      decisionId: 'decision-1',
      workItemId: 'work-2',
      expectedRevision: 3,
      actorId: 'owner',
      at: AT,
    }).code,
    'DECISION_WORK_ITEM_MISMATCH',
  );
  assert.equal(repository.getWorkItem('work-2').workItem.executionState, 'WAITING_FOR_USER');
  assert.equal(
    repository.recordDecision(
      decision({
        decisionId: 'decision-2',
        idempotencyKey: 'idem-2',
        workItemId: 'missing-work',
      }),
    ).code,
    'WORK_ITEM_NOT_FOUND',
  );
});

test('Decision application rejects stale artifacts without partial mutation', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  repository.saveWorkItem(workItem({ executionState: 'DECIDED_PENDING_APPLY' }));
  repository.recordDecision(decision({ artifactHash: 'b'.repeat(64) }));
  const result = repository.applyDecision({
    decisionId: 'decision-1',
    workItemId: 'work-1',
    expectedRevision: 3,
    actorId: 'owner',
    at: AT,
  });
  assert.equal(result.code, 'DECISION_STALE');
  assert.equal(repository.getWorkItem('work-1').workItem.executionState, 'DECIDED_PENDING_APPLY');
  assert.equal(repository.getDecision('decision-1').decision.status, 'PENDING_APPLY');
});

test('Evidence dedupe distinguishes identical replay from conflicting identity reuse', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  const first = repository.appendEvidence(evidence());
  assert.equal(first.duplicate, false);
  const replay = repository.appendEvidence(evidence());
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);
  const conflict = repository.appendEvidence(evidence({ payload: { result: 'fail' } }));
  assert.equal(conflict.code, 'EVIDENCE_CONFLICT');
});

test('Notification persists only recipientHash and enforces project identity', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  repository.saveWorkItem(workItem());
  const first = repository.enqueueNotification(notification());
  assert.equal(first.ok, true);
  assert.equal(first.delivery.recipient, undefined);
  assert.match(first.delivery.recipientHash, /^[a-f0-9]{64}$/);
  const replay = repository.enqueueNotification(notification({ deliveryId: 'delivery-2' }));
  assert.equal(replay.duplicate, true);
  assert.equal(
    repository.enqueueNotification(notification({ workItemId: 'missing-work' })).code,
    'WORK_ITEM_NOT_FOUND',
  );
  assert.equal(
    repository.enqueueNotification(notification({ projectId: 'project-2' })).code,
    'NOTIFICATION_PROJECT_MISMATCH',
  );
  assert.equal(repository.listNotifications('project-1').deliveries.length, 1);
  assert.equal(repository.listNotifications('project-2').deliveries.length, 0);
});

test('Audit entries are validated, immutable to callers and chain-verifiable', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  const created = repository.appendAudit({
    auditId: 'audit-1',
    projectId: 'project-1',
    actorType: 'user',
    actorId: 'owner',
    action: 'DECIDE',
    objectType: 'decision',
    objectId: 'decision-1',
    detail: { action: 'approve' },
    createdAt: AT,
  });
  assert.equal(created.ok, true);
  created.audit.detail.action = 'tampered';
  assert.equal(repository.verifyAuditChain().ok, true);
  assert.equal(
    repository.appendAudit({
      auditId: 'audit-2',
      projectId: 'project-1',
      actorType: 'user',
      actorId: 'owner',
      action: 'NOT_ALLOWED',
      objectType: 'decision',
      objectId: 'decision-1',
      detail: {},
      createdAt: AT,
    }).code,
    'AUDIT_ENTRY_INVALID',
  );
  assert.equal(repository.listAudit('project-1').audits.length, 1);
  assert.equal(repository.listAudit('project-2').audits.length, 0);
});

test('project retention is configurable and evidence/notification/decision purge is audited', () => {
  let now = NOW;
  const repository = createMemoryRepository({ clock: () => now });
  repository.saveProject({
    projectId: 'project-1',
    name: 'Project One',
    evidenceRetentionDays: 1,
    notificationRetentionDays: 1,
    decisionRetentionDays: 1,
    auditRetentionDays: 30,
  });
  repository.saveWorkItem(workItem());
  repository.appendEvidence(evidence({ receivedAt: AT }));
  repository.enqueueNotification(notification());
  repository.recordDecision(decision());
  now = NOW + 2 * 24 * 60 * 60 * 1000;
  const result = repository.purgeExpired({
    projectId: 'project-1',
    at: new Date(now).toISOString(),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.removed, { evidence: 1, notifications: 1, decisions: 1, audits: 0 });
  assert.equal(repository.listEvidence('project-1').events.length, 0);
  assert.equal(repository.listNotifications('project-1').deliveries.length, 0);
  assert.equal(repository.getDecision('decision-1').code, 'DECISION_NOT_FOUND');
  const audit = repository.listAudit('project-1').audits;
  assert.equal(audit.at(-1).action, 'RETENTION_PURGE');
  assert.deepEqual(audit.at(-1).detail.removed, result.removed);
  assert.equal(repository.verifyAuditChain().ok, true);
});

test('audit expiry fails closed until archival is implemented', () => {
  let now = NOW;
  const repository = createMemoryRepository({ clock: () => now });
  repository.saveProject({
    projectId: 'project-1',
    auditRetentionDays: 1,
  });
  repository.appendAudit({
    auditId: 'audit-old',
    projectId: 'project-1',
    actorType: 'system',
    actorId: 'test',
    action: 'CREATE',
    objectType: 'project',
    objectId: 'project-1',
    detail: {},
    createdAt: AT,
  });
  now = NOW + 2 * 24 * 60 * 60 * 1000;
  const result = repository.purgeExpired({
    projectId: 'project-1',
    at: new Date(now).toISOString(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AUDIT_RETENTION_REQUIRES_ARCHIVE');
  assert.equal(repository.listAudit('project-1').audits.length, 1);
  assert.equal(repository.verifyAuditChain().ok, true);
});
