import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../events.js';
import { applyDecisionToWorkItem, WORK_ITEM_STATES } from './state-machine.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const sha256 = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const nonEmpty = (value, max = 256) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const iso = (value) => (Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null);
const DAY = 24 * 60 * 60 * 1000;
const DECISION_ACTIONS = Object.freeze([
  'approve',
  'request_changes',
  'answer',
  'pause',
  'resume',
  'retry',
  'cancel',
  'accept_delivery',
]);
const AUDIT_ACTIONS = Object.freeze([
  'CREATE',
  'UPDATE',
  'DELETE',
  'DECIDE',
  'APPLY',
  'CANCEL',
  'EXPIRE',
  'NOTIFY',
  'REVOKE',
  'MIGRATE',
  'RETENTION_PURGE',
]);
const NOTIFICATION_CHANNELS = Object.freeze(['feishu', 'dingtalk', 'webhook']);
const NOTIFICATION_KINDS = Object.freeze(['attention', 'reminder', 'escalation', 'resolution']);

function retentionDays(value, fallback) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 3650 ? value : fallback;
}

function normalizeProject(project = {}) {
  return {
    projectId: project.projectId,
    name: project.name ?? project.projectId,
    evidenceRetentionDays: retentionDays(project.evidenceRetentionDays, 7),
    notificationRetentionDays: retentionDays(project.notificationRetentionDays, 30),
    decisionRetentionDays: retentionDays(project.decisionRetentionDays, 365),
    auditRetentionDays: retentionDays(project.auditRetentionDays, 365),
    version: project.version ?? 1,
  };
}

function validProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) return false;
  if (!nonEmpty(project.projectId, 128)) return false;
  if (project.name !== undefined && !nonEmpty(project.name, 256)) return false;
  if (
    project.version !== undefined &&
    (!Number.isSafeInteger(project.version) || project.version < 1)
  )
    return false;
  return [
    'evidenceRetentionDays',
    'notificationRetentionDays',
    'decisionRetentionDays',
    'auditRetentionDays',
  ].every((key) => project[key] === undefined || retentionDays(project[key], null) !== null);
}

function validateAuditEntry(entry) {
  return (
    entry &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    nonEmpty(entry.auditId, 128) &&
    (entry.projectId === null || entry.projectId === undefined || nonEmpty(entry.projectId, 128)) &&
    ['user', 'worker', 'system', 'channel'].includes(entry.actorType) &&
    nonEmpty(entry.actorId) &&
    AUDIT_ACTIONS.includes(entry.action) &&
    nonEmpty(entry.objectType, 64) &&
    nonEmpty(entry.objectId, 128) &&
    entry.detail &&
    typeof entry.detail === 'object' &&
    !Array.isArray(entry.detail) &&
    iso(entry.createdAt)
  );
}

function validateDecision(decision) {
  return (
    decision &&
    typeof decision === 'object' &&
    !Array.isArray(decision) &&
    nonEmpty(decision.decisionId, 128) &&
    nonEmpty(decision.workItemId, 128) &&
    nonEmpty(decision.idempotencyKey, 256) &&
    nonEmpty(decision.actorId) &&
    DECISION_ACTIONS.includes(decision.action) &&
    /^[a-f0-9]{64}$/.test(decision.artifactHash || '') &&
    Number.isSafeInteger(decision.expectedWorkItemVersion) &&
    decision.expectedWorkItemVersion >= 0 &&
    iso(decision.createdAt)
  );
}

function decisionFingerprint(decision) {
  return sha256({
    workItemId: decision.workItemId,
    attentionId: decision.attentionId ?? null,
    scope: decision.scope ?? null,
    attentionRevision: decision.attentionRevision ?? null,
    expectedWorkItemVersion: decision.expectedWorkItemVersion,
    artifactHash: decision.artifactHash.toLowerCase(),
    action: decision.action,
    actorId: decision.actorId,
    source: decision.source ?? null,
    authLevel: decision.authLevel ?? null,
    payload: decision.payload ?? {},
  });
}

export function createMemoryRepository({ clock = Date.now } = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const projects = new Map();
  const workItems = new Map();
  const decisions = new Map();
  const decisionsByIdempotency = new Map();
  const evidence = new Map();
  const notifications = new Map();
  const notificationsByDedupe = new Map();
  const audits = [];
  const auditIds = new Set();
  let auditHead = null;
  let auditSequence = 0;

  const now = () => new Date(clock()).toISOString();

  function ensureProject(projectId) {
    if (!projects.has(projectId)) {
      projects.set(projectId, normalizeProject({ projectId, name: projectId, version: 1 }));
    }
    return projects.get(projectId);
  }

  function appendAudit(entry) {
    if (!validateAuditEntry(entry)) return failure('AUDIT_ENTRY_INVALID', 'Audit entry is invalid');
    if (entry.projectId !== null && entry.projectId !== undefined) ensureProject(entry.projectId);
    if (auditIds.has(entry.auditId))
      return failure('AUDIT_DUPLICATE', 'Audit entry already exists', { auditId: entry.auditId });
    const record = {
      auditId: entry.auditId,
      sequence: ++auditSequence,
      projectId: entry.projectId ?? null,
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId,
      detail: clone(entry.detail),
      createdAt: iso(entry.createdAt),
      previousHash: auditHead,
    };
    record.entryHash = sha256(record);
    audits.push(record);
    auditIds.add(record.auditId);
    auditHead = record.entryHash;
    return { ok: true, audit: clone(record) };
  }

  function verifyAuditChain() {
    let previousHash = null;
    for (const [index, record] of audits.entries()) {
      if (record.sequence !== index + 1 || record.previousHash !== previousHash)
        return failure('AUDIT_CORRUPT', 'Audit chain sequence or predecessor is invalid', {
          sequence: index + 1,
        });
      const { entryHash, ...body } = record;
      if (sha256(body) !== entryHash)
        return failure('AUDIT_CORRUPT', 'Audit entry hash is invalid', { sequence: index + 1 });
      previousHash = entryHash;
    }
    return { ok: true, headHash: previousHash, count: audits.length };
  }

  function saveProject(project) {
    if (!validProject(project))
      return failure('PROJECT_INVALID', 'Project configuration is invalid');
    if (projects.has(project.projectId))
      return failure('PROJECT_ALREADY_EXISTS', 'Project already exists', {
        projectId: project.projectId,
      });
    const stored = normalizeProject({ ...project, version: 1 });
    projects.set(stored.projectId, stored);
    const { version, ...configuration } = clone(stored);
    return { ok: true, project: configuration, version };
  }

  function updateProjectRetention({
    projectId,
    expectedVersion,
    evidenceRetentionDays,
    notificationRetentionDays,
    decisionRetentionDays,
    auditRetentionDays,
  } = {}) {
    const current = projects.get(projectId);
    if (!current) return failure('PROJECT_NOT_FOUND', 'Project was not found');
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== current.version)
      return failure('PROJECT_VERSION_CONFLICT', 'Project version changed', {
        expectedVersion: expectedVersion ?? null,
        actualVersion: current.version,
      });
    const requested = {
      evidenceRetentionDays,
      notificationRetentionDays,
      decisionRetentionDays,
      auditRetentionDays,
    };
    if (
      Object.values(requested).some(
        (value) => value !== undefined && retentionDays(value, null) === null,
      )
    )
      return failure('PROJECT_INVALID', 'Retention policy is invalid');
    const next = {
      ...current,
      ...Object.fromEntries(Object.entries(requested).filter(([, value]) => value !== undefined)),
      version: current.version + 1,
    };
    projects.set(projectId, next);
    const { version, ...configuration } = clone(next);
    return { ok: true, project: configuration, version };
  }

  function saveWorkItem(workItem) {
    if (!workItem || typeof workItem !== 'object' || Array.isArray(workItem))
      return failure('WORK_ITEM_INVALID', 'WorkItem is invalid');
    if (!nonEmpty(workItem.workItemId, 128) || !nonEmpty(workItem.projectId, 128))
      return failure('WORK_ITEM_INVALID', 'WorkItem identity is invalid');
    if (!Number.isSafeInteger(workItem.revision) || workItem.revision < 1)
      return failure('WORK_ITEM_INVALID', 'WorkItem revision is invalid');
    if (!WORK_ITEM_STATES.includes(workItem.executionState))
      return failure('WORK_ITEM_INVALID', 'WorkItem state is invalid');
    if (workItems.has(workItem.workItemId))
      return failure('WORK_ITEM_ALREADY_EXISTS', 'WorkItem already exists', {
        workItemId: workItem.workItemId,
      });
    ensureProject(workItem.projectId);
    const stored = clone(workItem);
    workItems.set(stored.workItemId, stored);
    return { ok: true, workItem: clone(stored) };
  }

  function updateWorkItemCas({ workItemId, expectedRevision, workItem } = {}) {
    const current = workItems.get(workItemId);
    if (!current) return failure('WORK_ITEM_NOT_FOUND', 'WorkItem was not found');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision)
      return failure('WORK_ITEM_VERSION_CONFLICT', 'WorkItem revision changed', {
        expectedRevision: expectedRevision ?? null,
        actualRevision: current.revision,
      });
    if (
      !workItem ||
      typeof workItem !== 'object' ||
      Array.isArray(workItem) ||
      workItem.workItemId !== workItemId ||
      workItem.projectId !== current.projectId
    )
      return failure('WORK_ITEM_INVALID', 'WorkItem identity cannot change');
    if (workItem.revision !== current.revision + 1)
      return failure('WORK_ITEM_VERSION_CONFLICT', 'WorkItem update must advance one revision');
    if (!WORK_ITEM_STATES.includes(workItem.executionState))
      return failure('WORK_ITEM_INVALID', 'WorkItem state is invalid');
    const stored = clone(workItem);
    workItems.set(workItemId, stored);
    return { ok: true, workItem: clone(stored) };
  }

  function recordDecision(decision) {
    if (!validateDecision(decision)) return failure('DECISION_INVALID', 'Decision is invalid');
    const fingerprint = decisionFingerprint(decision);
    const existingId = decisionsByIdempotency.get(decision.idempotencyKey);
    if (existingId) {
      const existing = decisions.get(existingId);
      if (existing.fingerprint !== fingerprint)
        return failure(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key was reused with different content',
          {
            decisionId: existing.decision.decisionId,
          },
        );
      return { ok: true, decision: clone(existing.decision), replayed: true };
    }
    if (decisions.has(decision.decisionId))
      return failure('DECISION_DUPLICATE', 'Decision id already exists', {
        decisionId: decision.decisionId,
      });
    const workItem = workItems.get(decision.workItemId);
    if (!workItem) return failure('WORK_ITEM_NOT_FOUND', 'WorkItem was not found');
    if (decision.projectId !== undefined && decision.projectId !== workItem.projectId)
      return failure('DECISION_PROJECT_MISMATCH', 'Decision project does not match WorkItem', {
        expectedProjectId: workItem.projectId,
        actualProjectId: decision.projectId,
      });
    const stored = clone(decision);
    stored.createdAt = iso(stored.createdAt);
    stored.projectId = workItem.projectId;
    decisions.set(stored.decisionId, { decision: stored, fingerprint });
    decisionsByIdempotency.set(stored.idempotencyKey, stored.decisionId);
    return { ok: true, decision: clone(stored), replayed: false };
  }

  function getDecision(decisionId) {
    const found = decisions.get(decisionId);
    return found
      ? { ok: true, decision: clone(found.decision) }
      : failure('DECISION_NOT_FOUND', 'Decision was not found');
  }

  function applyDecision({ decisionId, workItemId, expectedRevision, actorId, at } = {}) {
    const found = decisions.get(decisionId);
    const current = workItems.get(workItemId);
    if (!found) return failure('DECISION_NOT_FOUND', 'Decision was not found');
    if (!current) return failure('WORK_ITEM_NOT_FOUND', 'WorkItem was not found');
    if (found.decision.workItemId !== workItemId)
      return failure('DECISION_WORK_ITEM_MISMATCH', 'Decision is bound to another WorkItem', {
        decisionWorkItemId: found.decision.workItemId,
        actualWorkItemId: workItemId,
      });
    if (current.revision !== expectedRevision)
      return failure('WORK_ITEM_VERSION_CONFLICT', 'WorkItem revision changed', {
        expectedRevision: expectedRevision ?? null,
        actualRevision: current.revision,
      });
    const applied = applyDecisionToWorkItem({
      workItem: current,
      decision: found.decision,
      actorId,
      at,
    });
    if (!applied.ok) return applied;
    const next = clone(applied.workItem);
    const decision = clone(applied.decision);
    workItems.set(workItemId, next);
    found.decision = decision;
    return { ok: true, workItem: clone(next), decision: clone(decision) };
  }

  function appendEvidence(event) {
    if (
      !event ||
      typeof event !== 'object' ||
      Array.isArray(event) ||
      !nonEmpty(event.eventId, 128) ||
      !nonEmpty(event.projectId, 128)
    )
      return failure('EVIDENCE_INVALID', 'Evidence identity is invalid');
    const fingerprint = sha256(event);
    const existing = evidence.get(event.eventId);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        return failure('EVIDENCE_CONFLICT', 'Evidence id was reused with different content', {
          eventId: event.eventId,
        });
      return { ok: true, event: clone(existing.event), duplicate: true };
    }
    ensureProject(event.projectId);
    const stored = clone(event);
    evidence.set(stored.eventId, { event: stored, fingerprint });
    return { ok: true, event: clone(stored), duplicate: false };
  }

  function enqueueNotification(delivery) {
    if (
      !delivery ||
      typeof delivery !== 'object' ||
      Array.isArray(delivery) ||
      !nonEmpty(delivery.deliveryId, 128) ||
      !nonEmpty(delivery.projectId, 128) ||
      !nonEmpty(delivery.workItemId, 128) ||
      !nonEmpty(delivery.attentionId, 128) ||
      !NOTIFICATION_CHANNELS.includes(delivery.channel) ||
      !nonEmpty(delivery.recipient, 512) ||
      !NOTIFICATION_KINDS.includes(delivery.kind) ||
      !Number.isSafeInteger(delivery.version) ||
      delivery.version < 0
    )
      return failure('NOTIFICATION_INVALID', 'Notification delivery is invalid');
    const workItem = workItems.get(delivery.workItemId);
    if (!workItem) return failure('WORK_ITEM_NOT_FOUND', 'WorkItem was not found');
    if (workItem.projectId !== delivery.projectId)
      return failure(
        'NOTIFICATION_PROJECT_MISMATCH',
        'Notification project does not match WorkItem',
        {
          expectedProjectId: workItem.projectId,
          actualProjectId: delivery.projectId,
        },
      );
    const recipientHash = sha256({ channel: delivery.channel, recipient: delivery.recipient });
    const dedupeKey = sha256({
      attentionId: delivery.attentionId,
      channel: delivery.channel,
      recipientHash,
      kind: delivery.kind,
      version: delivery.version,
    });
    if (notificationsByDedupe.has(dedupeKey))
      return {
        ok: true,
        delivery: clone(notifications.get(notificationsByDedupe.get(dedupeKey))),
        duplicate: true,
      };
    if (notifications.has(delivery.deliveryId))
      return failure('NOTIFICATION_DUPLICATE', 'Notification delivery id already exists', {
        deliveryId: delivery.deliveryId,
      });
    const timestamp = now();
    const stored = {
      deliveryId: delivery.deliveryId,
      projectId: delivery.projectId,
      workItemId: delivery.workItemId,
      attentionId: delivery.attentionId,
      channel: delivery.channel,
      recipientHash,
      kind: delivery.kind,
      version: delivery.version,
      dedupeKey,
      status: 'PENDING',
      attemptCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    notifications.set(stored.deliveryId, stored);
    notificationsByDedupe.set(dedupeKey, stored.deliveryId);
    return { ok: true, delivery: clone(stored), duplicate: false };
  }

  function purgeExpired({ projectId, at } = {}) {
    const project = projects.get(projectId);
    if (!project) return failure('PROJECT_NOT_FOUND', 'Project was not found');
    if (!iso(at)) return failure('RETENTION_TIME_INVALID', 'Retention cutoff time is invalid');
    const cutoff = Date.parse(at);
    const expired = (timestamp, days) => {
      const parsed = Date.parse(timestamp);
      return Number.isFinite(parsed) && parsed <= cutoff - days * DAY;
    };
    if (
      audits.some(
        (entry) =>
          entry.projectId === projectId && expired(entry.createdAt, project.auditRetentionDays),
      )
    )
      return failure(
        'AUDIT_RETENTION_REQUIRES_ARCHIVE',
        'Audit retention requires an archival workflow before deletion',
      );

    const evidenceToDelete = [...evidence.entries()].filter(
      ([, entry]) =>
        entry.event.projectId === projectId &&
        expired(entry.event.receivedAt, project.evidenceRetentionDays),
    );
    const notificationsToDelete = [...notifications.entries()].filter(
      ([, delivery]) =>
        delivery.projectId === projectId &&
        expired(delivery.updatedAt, project.notificationRetentionDays),
    );
    const decisionsToDelete = [...decisions.entries()].filter(([, found]) => {
      const workItem = workItems.get(found.decision.workItemId);
      return (
        workItem?.projectId === projectId &&
        expired(found.decision.createdAt, project.decisionRetentionDays)
      );
    });
    const removed = {
      evidence: evidenceToDelete.length,
      notifications: notificationsToDelete.length,
      decisions: decisionsToDelete.length,
      audits: 0,
    };
    if (removed.evidence || removed.notifications || removed.decisions) {
      const audit = appendAudit({
        auditId: `retention-${projectId}-${cutoff}-${auditSequence + 1}`,
        projectId,
        actorType: 'system',
        actorId: 'retention',
        action: 'RETENTION_PURGE',
        objectType: 'project',
        objectId: projectId,
        detail: { removed, at: iso(at) },
        createdAt: iso(at),
      });
      if (!audit.ok) return audit;
    }
    for (const [id] of evidenceToDelete) evidence.delete(id);
    for (const [id, delivery] of notificationsToDelete) {
      notifications.delete(id);
      notificationsByDedupe.delete(delivery.dedupeKey);
    }
    for (const [id, found] of decisionsToDelete) {
      decisions.delete(id);
      decisionsByIdempotency.delete(found.decision.idempotencyKey);
    }
    return { ok: true, removed };
  }

  function getProject(projectId) {
    const project = projects.get(projectId);
    if (!project) return failure('PROJECT_NOT_FOUND', 'Project was not found');
    const { version, ...configuration } = clone(project);
    return { ok: true, project: configuration, version };
  }

  return Object.freeze({
    clock,
    saveProject,
    updateProjectRetention,
    getProject,
    saveWorkItem,
    getWorkItem: (workItemId) =>
      workItems.has(workItemId)
        ? { ok: true, workItem: clone(workItems.get(workItemId)) }
        : failure('WORK_ITEM_NOT_FOUND', 'WorkItem was not found'),
    updateWorkItemCas,
    recordDecision,
    getDecision,
    applyDecision,
    appendEvidence,
    listEvidence: (projectId) => ({
      ok: true,
      events: [...evidence.values()]
        .filter((entry) => entry.event.projectId === projectId)
        .map((entry) => clone(entry.event)),
    }),
    enqueueNotification,
    listNotifications: (projectId) => ({
      ok: true,
      deliveries: [...notifications.values()]
        .filter((delivery) => delivery.projectId === projectId)
        .map(clone),
    }),
    appendAudit,
    verifyAuditChain,
    listAudit: (projectId) => ({
      ok: true,
      audits: audits.filter((entry) => entry.projectId === projectId).map(clone),
    }),
    purgeExpired,
  });
}
