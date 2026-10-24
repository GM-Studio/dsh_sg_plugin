import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../events.js';

export const clone = (value) => JSON.parse(JSON.stringify(value));
export const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
export const sha256 = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const nonEmpty = (value, max = 256) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
export const iso = (value) =>
  Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const DAY = 24 * 60 * 60 * 1000;
export const DECISION_ACTIONS = Object.freeze([
  'approve',
  'request_changes',
  'answer',
  'pause',
  'resume',
  'retry',
  'cancel',
  'accept_delivery',
]);
export const AUDIT_ACTIONS = Object.freeze([
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
export const NOTIFICATION_CHANNELS = Object.freeze(['feishu', 'dingtalk', 'webhook']);
export const NOTIFICATION_KINDS = Object.freeze([
  'attention',
  'reminder',
  'escalation',
  'resolution',
]);

export function retentionDays(value, fallback) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 3650 ? value : fallback;
}

export function normalizeProject(project = {}) {
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

export function validProject(project) {
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

export function validateAuditEntry(entry) {
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

export function validateDecision(decision) {
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

export function decisionFingerprint(decision) {
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
