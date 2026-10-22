import { hashValue } from '../../events.js';

export const BUSINESS_MILESTONES = Object.freeze([
  'PROJECT_READY',
  'CONTRACT_CONFIRMED',
  'EVIDENCE_READY',
  'RELEASE_APPROVED',
  'DELIVERY_ACCEPTED',
]);

export const EXECUTION_STATES = Object.freeze([
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_USER',
  'PAUSED',
  'BLOCKED',
  'FAILED',
  'COMPLETED',
  'CANCELLED',
]);

export const HOST_ONLINE = 'ONLINE';
export const HOST_OFFLINE = 'OFFLINE';
export const HOST_INTERRUPTED = 'INTERRUPTED';
export const HOST_SUSPECT = 'SUSPECT';

export const HOST_HEALTH = Object.freeze([
  HOST_ONLINE,
  HOST_OFFLINE,
  HOST_INTERRUPTED,
  HOST_SUSPECT,
]);

export const ATTENTION_STATUSES = Object.freeze([
  'OPEN',
  'DELIVERED',
  'REMINDED',
  'DECIDED',
  'EXPIRED',
  'SUPERSEDED',
]);

export const ATTENTION_TYPES = Object.freeze([
  'H1_APPROVAL',
  'H3_APPROVAL',
  'CLARIFICATION',
  'BLOCKED',
  'FAILED',
  'OFFLINE',
  'BUDGET',
  'CUSTOMER_ACCEPTANCE',
  'COMPLETION',
]);

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

export const HIGH_RISK_ATTENTION_TYPES = Object.freeze([
  'H1_APPROVAL',
  'H3_APPROVAL',
  'CUSTOMER_ACCEPTANCE',
]);

export const DEFAULT_BUDGET = Object.freeze({
  wallClockMs: 2 * 60 * 60 * 1000,
  maxModelTokens: 500000,
  maxToolCalls: 2000,
  maxRepairRounds: 2,
  maxNotificationAttempts: 8,
  maxEvidenceBytes: 50 * 1024 * 1024,
});

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/i;
const SAFE_INPUT_KEYS = new Set(['title', 'request', 'projectRoot', 'budget', 'priority']);
const SAFE_ATTENTION_KEYS = new Set([
  'workItemId',
  'scope',
  'expectedVersion',
  'type',
  'reason',
  'question',
  'actions',
  'summary',
  'risks',
  'evidence',
  'artifactHash',
  'expiresAt',
]);
const SAFE_DECISION_KEYS = new Set([
  'workItemId',
  'attentionId',
  'attentionRevision',
  'expectedWorkItemVersion',
  'artifactHash',
  'action',
  'idempotencyKey',
  'actorId',
  'source',
  'authLevel',
  'payload',
  'expiresAt',
]);
const ACTOR_SOURCES = new Set(['web', 'feishu', 'cli', 'system', 'api']);
const AUTH_LEVELS = new Set(['session', 'step-up', 'system']);

const failure = (code, message) => ({ ok: false, code, message });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 16000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const list = (value, maximumItems = 100, maximum = 4000) =>
  Array.isArray(value) &&
  value.length <= maximumItems &&
  value.every((entry) => text(entry, maximum));
const clone = (value) => JSON.parse(JSON.stringify(value));
const sensitive = (value) =>
  /(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/i.test(
    JSON.stringify(value),
  );

export function createInitialControlState() {
  return {
    schemaVersion: 1,
    version: 0,
    projects: {},
    workItems: {},
    runs: {},
    attention: {},
    decisions: {},
    notifications: {},
    leases: {},
    workSequence: 0,
  };
}

function budget(value) {
  if (value === undefined) return { ok: true, value: { ...DEFAULT_BUDGET } };
  if (!object(value)) return failure('CONTROL_INPUT_INVALID', 'Budget must be an object');
  const allowed = new Set([
    'wallClockMs',
    'maxModelTokens',
    'maxToolCalls',
    'maxRepairRounds',
    'maxNotificationAttempts',
    'maxEvidenceBytes',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    return failure('CONTROL_INPUT_INVALID', 'Budget contains unsupported fields');
  const normalized = { ...DEFAULT_BUDGET, ...value };
  for (const [key, entry] of Object.entries(normalized)) {
    if (!Number.isSafeInteger(entry) || entry <= 0 || entry > 2_000_000_000)
      return failure('CONTROL_INPUT_INVALID', `Budget ${key} must be a bounded positive integer`);
  }
  return { ok: true, value: normalized };
}

export function validateWorkItemInput(value) {
  if (!object(value) || Object.keys(value).some((key) => !SAFE_INPUT_KEYS.has(key)))
    return failure('CONTROL_INPUT_INVALID', 'WorkItem input contains unsupported fields');
  if (!text(value.title, 256) || !text(value.request) || typeof value.projectRoot !== 'string')
    return failure('CONTROL_INPUT_INVALID', 'Title, request and projectRoot are required');
  if (!value.projectRoot || value.projectRoot.length > 32768)
    return failure('CONTROL_INPUT_INVALID', 'projectRoot is invalid');
  if (
    value.priority !== undefined &&
    value.priority !== 'low' &&
    value.priority !== 'normal' &&
    value.priority !== 'high'
  )
    return failure('CONTROL_INPUT_INVALID', 'priority is invalid');
  const checkedBudget = budget(value.budget);
  if (!checkedBudget.ok) return checkedBudget;
  if (sensitive(value)) return failure('CONTROL_SENSITIVE_INPUT', 'WorkItem contains credentials');
  return {
    ok: true,
    value: {
      title: value.title,
      request: value.request,
      projectRoot: value.projectRoot,
      priority: value.priority || 'normal',
      budget: checkedBudget.value,
    },
  };
}

export function validateAttentionInput(value) {
  if (!object(value) || Object.keys(value).some((key) => !SAFE_ATTENTION_KEYS.has(key)))
    return failure('ATTENTION_INVALID', 'AttentionRequest contains unsupported fields');
  if (
    !ID.test(value.workItemId || '') ||
    (value.scope !== undefined && !text(value.scope, 256)) ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 0 ||
    !ATTENTION_TYPES.includes(value.type) ||
    !text(value.reason, 4000) ||
    !text(value.question, 4000) ||
    !Array.isArray(value.actions) ||
    value.actions.length < 1 ||
    value.actions.length > 8 ||
    !value.actions.every((entry) => DECISION_ACTIONS.includes(entry)) ||
    !HASH.test(value.artifactHash || '') ||
    (value.summary !== undefined && !text(value.summary, 16000)) ||
    (value.risks !== undefined && !list(value.risks, 100, 4000)) ||
    (value.evidence !== undefined && !list(value.evidence, 200, 1024)) ||
    (value.expiresAt !== undefined && !Number.isFinite(Date.parse(value.expiresAt)))
  )
    return failure('ATTENTION_INVALID', 'AttentionRequest fields are invalid');
  if (new Set(value.actions).size !== value.actions.length)
    return failure('ATTENTION_INVALID', 'Attention actions must be unique');
  if (sensitive(value))
    return failure('ATTENTION_INVALID', 'AttentionRequest contains credentials');
  const attentionKey = hashValue({
    workItemId: value.workItemId,
    type: value.type,
    scope: value.scope || null,
  });
  return {
    ok: true,
    value: {
      ...value,
      artifactHash: value.artifactHash.toLowerCase(),
      attentionKey,
      summary: value.summary || value.question,
      risks: value.risks || [],
      evidence: value.evidence || [],
    },
  };
}

export function validateDecisionInput(value) {
  if (!object(value) || Object.keys(value).some((key) => !SAFE_DECISION_KEYS.has(key)))
    return failure('DECISION_INVALID', 'Decision contains unsupported fields');
  if (
    !ID.test(value.workItemId || '') ||
    !ID.test(value.attentionId || '') ||
    !Number.isSafeInteger(value.attentionRevision) ||
    value.attentionRevision < 1 ||
    !Number.isSafeInteger(value.expectedWorkItemVersion) ||
    value.expectedWorkItemVersion < 0 ||
    !HASH.test(value.artifactHash || '') ||
    !DECISION_ACTIONS.includes(value.action) ||
    !text(value.idempotencyKey, 256) ||
    !text(value.actorId, 256) ||
    !ACTOR_SOURCES.has(value.source) ||
    !AUTH_LEVELS.has(value.authLevel) ||
    (value.payload !== undefined && !object(value.payload)) ||
    (value.expiresAt !== undefined && !Number.isFinite(Date.parse(value.expiresAt)))
  )
    return failure('DECISION_INVALID', 'Decision fields are invalid');
  if (sensitive(value)) return failure('DECISION_INVALID', 'Decision contains credentials');
  return { ok: true, value: { ...value, artifactHash: value.artifactHash.toLowerCase() } };
}

export function attentionNeedsStepUp(type, action) {
  return HIGH_RISK_ATTENTION_TYPES.includes(type) || ['cancel', 'accept_delivery'].includes(action);
}

export function projectWorkItemSummary(workItem) {
  if (!object(workItem)) return { status: 'UNKNOWN', nextOwner: 'system', needsUser: false };
  if ([HOST_OFFLINE, HOST_INTERRUPTED, HOST_SUSPECT].includes(workItem.hostHealth))
    return { status: workItem.hostHealth, nextOwner: 'system', needsUser: false };
  if (workItem.executionState === 'WAITING_FOR_USER')
    return { status: 'WAITING_FOR_USER', nextOwner: 'user', needsUser: true };
  if (workItem.executionState === 'FAILED')
    return { status: 'FAILED', nextOwner: 'user', needsUser: true };
  if (workItem.executionState === 'BLOCKED')
    return { status: 'BLOCKED', nextOwner: 'user', needsUser: true };
  if (workItem.executionState === 'PAUSED')
    return { status: 'PAUSED', nextOwner: 'user', needsUser: false };
  if (workItem.executionState === 'COMPLETED')
    return { status: 'COMPLETED', nextOwner: 'none', needsUser: false };
  if (workItem.executionState === 'CANCELLED')
    return { status: 'CANCELLED', nextOwner: 'none', needsUser: false };
  if (workItem.executionState === 'RUNNING')
    return { status: 'RUNNING', nextOwner: 'ai', needsUser: false };
  return { status: 'QUEUED', nextOwner: 'system', needsUser: false };
}

export function canonicalControlState(value) {
  return clone(value);
}
