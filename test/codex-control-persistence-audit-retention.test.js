import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRepository } from '../src/codex/core/control/persistence/memory-repository.js';

const AT = '2026-10-23T02:00:00.000Z';
const NOW = Date.parse(AT);
const DAY = 24 * 60 * 60 * 1000;
const HASH = 'a'.repeat(64);

const workItem = (overrides = {}) => ({
  workItemId: 'work-1',
  projectId: 'project-1',
  title: 'Persist control state',
  executionState: 'WAITING_FOR_USER',
  revision: 3,
  artifactHash: HASH,
  updatedAt: AT,
  ...overrides,
});

const decision = (overrides = {}) => ({
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
});

const audit = (overrides = {}) => ({
  auditId: 'audit-1',
  projectId: 'project-1',
  actorType: 'system',
  actorId: 'test',
  action: 'CREATE',
  objectType: 'work_item',
  objectId: 'work-1',
  detail: {},
  createdAt: AT,
  ...overrides,
});

test('audit chain detects tampering and returns defensive copies', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  assert.equal(repository.appendAudit(audit()).ok, true);
  assert.equal(repository.appendAudit(audit({ auditId: 'audit-2', action: 'UPDATE' })).ok, true);
  const listed = repository.listAudit('project-1');
  listed.audits[0].detail.injected = true;
  assert.deepEqual(repository.listAudit('project-1').audits[0].detail, {});
  assert.equal(repository.verifyAuditChain().ok, true);
  assert.equal(repository.listAudit('project-2').audits.length, 0);
});

test('audit rejects unknown actions and actors', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  assert.equal(
    repository.appendAudit(audit({ action: 'SILENT_EDIT' })).code,
    'AUDIT_ENTRY_INVALID',
  );
  assert.equal(repository.appendAudit(audit({ actorType: 'unknown' })).code, 'AUDIT_ENTRY_INVALID');
});

test('project retention defaults are 7/30/365/365 and can be configured', () => {
  const repository = createMemoryRepository({ clock: () => NOW });
  assert.equal(repository.saveProject({ projectId: 'project-1', name: 'One' }).ok, true);
  assert.deepEqual(repository.getProject('project-1').project, {
    projectId: 'project-1',
    name: 'One',
    evidenceRetentionDays: 7,
    notificationRetentionDays: 30,
    decisionRetentionDays: 365,
    auditRetentionDays: 365,
  });
  assert.equal(
    repository.saveProject({ projectId: 'project-1', name: 'Changed' }).code,
    'PROJECT_ALREADY_EXISTS',
  );
  assert.equal(
    repository.updateProjectRetention({
      projectId: 'project-1',
      expectedVersion: 1,
      evidenceRetentionDays: 10,
      notificationRetentionDays: 20,
      decisionRetentionDays: 30,
      auditRetentionDays: 40,
    }).ok,
    true,
  );
  const updated = repository.getProject('project-1').project;
  assert.equal(updated.evidenceRetentionDays, 10);
  assert.equal(updated.notificationRetentionDays, 20);
  assert.equal(updated.decisionRetentionDays, 30);
  assert.equal(updated.auditRetentionDays, 40);
  assert.equal(repository.getProject('project-1').version, 2);
  assert.equal(
    repository.updateProjectRetention({
      projectId: 'project-1',
      expectedVersion: 1,
      evidenceRetentionDays: 11,
    }).code,
    'PROJECT_VERSION_CONFLICT',
  );
});

test('retention purge audits before deleting and never removes audit entries', () => {
  let now = NOW;
  const repository = createMemoryRepository({ clock: () => now });
  repository.saveProject({
    projectId: 'project-1',
    name: 'One',
    evidenceRetentionDays: 1,
    notificationRetentionDays: 1,
    decisionRetentionDays: 1,
    auditRetentionDays: 1,
  });
  repository.saveWorkItem(workItem());
  repository.appendEvidence({
    eventId: 'event-1',
    projectId: 'project-1',
    workItemId: 'work-1',
    eventType: 'check.completed',
    source: 'worker',
    payload: { result: 'pass' },
    occurredAt: AT,
    receivedAt: AT,
  });
  repository.enqueueNotification({
    deliveryId: 'delivery-1',
    projectId: 'project-1',
    workItemId: 'work-1',
    attentionId: 'attention-1',
    channel: 'feishu',
    recipient: 'owner@example.com',
    kind: 'attention',
    version: 1,
  });
  repository.recordDecision(decision());
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
  now += 2 * DAY;
  const result = repository.purgeExpired({
    projectId: 'project-1',
    at: new Date(now).toISOString(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AUDIT_RETENTION_REQUIRES_ARCHIVE');
  assert.equal(repository.listEvidence('project-1').events.length, 1);
  assert.equal(repository.listNotifications('project-1').deliveries.length, 1);
  assert.equal(repository.getDecision('decision-1').ok, true);
});

test('expired evidence and notifications can be purged with an append-only audit receipt', () => {
  let now = NOW;
  const repository = createMemoryRepository({ clock: () => now });
  repository.saveProject({
    projectId: 'project-1',
    name: 'One',
    evidenceRetentionDays: 1,
    notificationRetentionDays: 1,
    decisionRetentionDays: 30,
    auditRetentionDays: 30,
  });
  repository.saveWorkItem(workItem());
  repository.appendEvidence({
    eventId: 'event-1',
    projectId: 'project-1',
    workItemId: 'work-1',
    eventType: 'check.completed',
    source: 'worker',
    payload: { result: 'pass' },
    occurredAt: AT,
    receivedAt: AT,
  });
  repository.enqueueNotification({
    deliveryId: 'delivery-1',
    projectId: 'project-1',
    workItemId: 'work-1',
    attentionId: 'attention-1',
    channel: 'feishu',
    recipient: 'owner@example.com',
    kind: 'attention',
    version: 1,
  });
  now += 2 * DAY;
  const first = repository.purgeExpired({
    projectId: 'project-1',
    at: new Date(now).toISOString(),
  });
  assert.equal(first.ok, true);
  assert.deepEqual(first.removed, { evidence: 1, notifications: 1, decisions: 0, audits: 0 });
  assert.equal(repository.listEvidence('project-1').events.length, 0);
  assert.equal(repository.listNotifications('project-1').deliveries.length, 0);
  assert.equal(repository.getDecision('decision-1').code, 'DECISION_NOT_FOUND');
  assert.equal(repository.listAudit('project-1').audits.at(-1).action, 'RETENTION_PURGE');
  const second = repository.purgeExpired({
    projectId: 'project-1',
    at: new Date(now).toISOString(),
  });
  assert.equal(second.ok, true);
  assert.deepEqual(second.removed, { evidence: 0, notifications: 0, decisions: 0, audits: 0 });
  assert.equal(repository.verifyAuditChain().ok, true);
});

test('decision purge derives project through the WorkItem rather than trusting Decision input', () => {
  let now = NOW;
  const repository = createMemoryRepository({ clock: () => now });
  repository.saveProject({
    projectId: 'project-1',
    decisionRetentionDays: 1,
    auditRetentionDays: 30,
  });
  repository.saveProject({
    projectId: 'project-2',
    decisionRetentionDays: 30,
    auditRetentionDays: 30,
  });
  repository.saveWorkItem(workItem());
  repository.recordDecision(decision());
  now += 2 * DAY;
  assert.deepEqual(
    repository.purgeExpired({ projectId: 'project-2', at: new Date(now).toISOString() }).removed,
    { evidence: 0, notifications: 0, decisions: 0, audits: 0 },
  );
  assert.equal(repository.getDecision('decision-1').ok, true);
  assert.deepEqual(
    repository.purgeExpired({ projectId: 'project-1', at: new Date(now).toISOString() }).removed,
    { evidence: 0, notifications: 0, decisions: 1, audits: 0 },
  );
  assert.equal(repository.getDecision('decision-1').code, 'DECISION_NOT_FOUND');
});
