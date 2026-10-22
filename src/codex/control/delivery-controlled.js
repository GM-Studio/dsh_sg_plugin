import { hashValue } from '../events.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COMMIT = /^[a-f0-9]{40,64}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const DATE = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 16000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const list = (value, maximum = 100) =>
  Array.isArray(value) && value.length <= maximum && value.every((entry) => text(entry, 4000));
const exactKeys = (value, keys) =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const failure = (code, message) => ({ ok: false, code, message });
const sensitive = (value) =>
  /(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/i.test(
    JSON.stringify(value),
  );

const RELEASE_STATES = new Set([
  'release-approved',
  'delivered',
  'customer-accepted',
  'pushed',
  'deployment-unknown',
  'deployment-verified',
]);
const REVIEW_MODES = new Set(['evidence', 'evidence-and-diff', 'full-code-review']);

function rollback(value) {
  return (
    exactKeys(value, ['code', 'data', 'forwardFix']) &&
    text(value.code, 8000) &&
    text(value.data, 8000) &&
    text(value.forwardFix, 8000)
  );
}

function pushState(value) {
  return (
    exactKeys(value, ['requested', 'remoteUrl', 'status']) &&
    typeof value.requested === 'boolean' &&
    (value.remoteUrl === null || text(value.remoteUrl, 4096)) &&
    text(value.status, 128)
  );
}

function reference(value, keys) {
  return exactKeys(value, keys) && keys.every((key) => HASH.test(value[key] || ''));
}

export function validateDeliveryRecordV3(value) {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'deliveryId',
      'projectId',
      'changeId',
      'parentDeliveryId',
      'baselineCommit',
      'deliveryCommit',
      'tag',
      'releaseState',
      'environmentFingerprint',
      'reviewMode',
      'approvedAt',
      'acceptance',
      'evidence',
      'knownIssues',
      'risks',
      'rollback',
      'push',
      'contract',
      'verification',
      'h3',
      'customerAcceptance',
      'packs',
    ]) ||
    value.schemaVersion !== 3 ||
    !ID.test(value.deliveryId || '') ||
    !ID.test(value.projectId || '') ||
    !ID.test(value.changeId || '') ||
    (value.parentDeliveryId !== null && !ID.test(value.parentDeliveryId || '')) ||
    !COMMIT.test(value.baselineCommit || '') ||
    !COMMIT.test(value.deliveryCommit || '') ||
    !text(value.tag, 255) ||
    !RELEASE_STATES.has(value.releaseState) ||
    !HASH.test(value.environmentFingerprint || '') ||
    !REVIEW_MODES.has(value.reviewMode) ||
    !DATE(value.approvedAt) ||
    !Array.isArray(value.acceptance) ||
    value.acceptance.length === 0 ||
    !value.acceptance.every((entry) => ID.test(entry)) ||
    !list(value.evidence, 1000) ||
    value.evidence.length === 0 ||
    !list(value.knownIssues, 200) ||
    !list(value.risks, 200) ||
    !rollback(value.rollback) ||
    !pushState(value.push) ||
    !exactKeys(value.contract, ['artifactId', 'hash']) ||
    !ID.test(value.contract.artifactId || '') ||
    !HASH.test(value.contract.hash || '') ||
    !exactKeys(value.verification, ['verificationId', 'assessmentHash', 'decision']) ||
    !ID.test(value.verification.verificationId || '') ||
    !HASH.test(value.verification.assessmentHash || '') ||
    !['requires-h3', 'verified-awaiting-acceptance'].includes(value.verification.decision) ||
    !exactKeys(value.h3, ['artifactHash', 'approvalHash', 'approvedAt']) ||
    !HASH.test(value.h3.artifactHash || '') ||
    !HASH.test(value.h3.approvalHash || '') ||
    !DATE(value.h3.approvedAt) ||
    !(
      value.customerAcceptance === null ||
      (exactKeys(value.customerAcceptance, ['status', 'actorId', 'source', 'at', 'evidence']) &&
        ['accepted', 'rejected'].includes(value.customerAcceptance.status) &&
        text(value.customerAcceptance.actorId, 256) &&
        text(value.customerAcceptance.source, 64) &&
        DATE(value.customerAcceptance.at) &&
        text(value.customerAcceptance.evidence, 1024))
    ) ||
    !(value.packs === null || reference(value.packs, ['internalHash', 'customerHash']))
  )
    return failure('DELIVERY_V3_INVALID', 'DeliveryRecord schema 3 is invalid');
  if (value.releaseState === 'customer-accepted') {
    if (value.customerAcceptance?.status !== 'accepted')
      return failure('CUSTOMER_ACCEPTANCE_REQUIRED', 'Customer acceptance evidence is required');
  }
  if (value.releaseState === 'pushed') {
    if (!value.push.requested || value.push.status !== 'passed')
      return failure('PUSH_STATE_INVALID', 'Pushed delivery requires a passed explicit push');
  }
  if (sensitive(value)) return failure('SENSITIVE_DELIVERY', 'DeliveryRecord contains credentials');
  return { ok: true };
}

export function createDeliveryRecordV3({
  deliveryId,
  projectId,
  changeId,
  parentDeliveryId = null,
  baselineCommit,
  deliveryCommit,
  environmentFingerprint,
  reviewMode,
  acceptance,
  evidence,
  knownIssues = [],
  risks = [],
  rollback,
  push = { requested: false, remoteUrl: null, status: 'not-requested' },
  contract,
  verification,
  h3,
  customerAcceptance = null,
  releaseState = 'release-approved',
  approvedAt = new Date().toISOString(),
  tag,
  packs = null,
} = {}) {
  const stableId =
    deliveryId ||
    `delivery-${hashValue({
      projectId,
      changeId,
      deliveryCommit,
      parentDeliveryId,
    }).slice(0, 16)}`;
  const record = {
    schemaVersion: 3,
    deliveryId: stableId,
    projectId,
    changeId,
    parentDeliveryId,
    baselineCommit,
    deliveryCommit,
    tag: tag || `specgate-delivery-${stableId}`,
    releaseState,
    environmentFingerprint,
    reviewMode,
    approvedAt,
    acceptance,
    evidence,
    knownIssues,
    risks,
    rollback,
    push,
    contract,
    verification,
    h3,
    customerAcceptance,
    packs,
  };
  const checked = validateDeliveryRecordV3(record);
  return checked.ok ? { ok: true, delivery: record } : checked;
}

export const DELIVERY_V3_STATES = Object.freeze([...RELEASE_STATES]);
