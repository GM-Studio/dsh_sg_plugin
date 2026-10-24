import { createHash } from 'node:crypto';
import { hashValue } from '../../../events.js';

export const WORKER_STATUSES = Object.freeze(['ACTIVE', 'OFFLINE', 'ONLINE', 'REVOKED']);
export const AUTHENTICATED_WORKER_STATUSES = Object.freeze(['ACTIVE', 'ONLINE']);
export const COMMAND_KINDS = Object.freeze([
  'CLAIM',
  'RUN_TYPED_OPERATION',
  'UPLOAD_EVIDENCE',
  'APPLY_DECISION',
  'RELEASE_LEASE',
  'STOP',
]);

const WORKER_ID = /^worker-[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT_TYPE = /^[A-Za-z][A-Za-z0-9]*(?:[._:-][A-Za-z0-9]+){0,7}$/;
const OPERATION_TYPE = /^[a-z][a-z0-9]*(?:[._-][a-z][a-z0-9]*){1,7}$/;
const HASH = /^[a-f0-9]{64}$/;
const CAPABILITY_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAPABILITY_REGION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SENSITIVE_KEY =
  /^(?:password|passwd|secret|token|tokenHash|authorization|cookie|csrf|proof|nonce|credential|private[_-]?key|api[_-]?key|webhook(?:Url)?|callback(?:Url)?)$/i;
const LOCAL_PATH =
  /(?:^|[\s"'(=])(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+[\\/]|\/(?:Users|home|tmp|var|opt|etc|root|mnt)\/)/i;
const CREDENTIAL_TEXT =
  /(?:\bBearer\s+[A-Za-z0-9._~+/-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|passwd|secret|token|authorization|api[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,})/i;
const CALLBACK_FIELD = /^(?:callback|callbackUrl|webhook|webhookUrl|inboundUrl|endpointUrl)$/i;
const INVALID_COMMAND_FIELDS = new Set(['command', 'shell', 'argv', 'executable', 'script', 'cwd']);
const SCHEDULING_CAPABILITY_FIELDS = new Set([
  'projectIds',
  'projects',
  'toolchains',
  'skills',
  'labels',
  'maxConcurrency',
  'region',
  'priority',
  'lastAssignedAt',
  'skillStatuses',
]);
const AVAILABLE_SKILL_STATES = new Set(['ACTIVE', 'AVAILABLE', 'ONLINE']);
const UNAVAILABLE_SKILL_STATES = new Set(['DISCONNECTED', 'OFFLINE', 'REVOKED']);

const COMMAND_PAYLOAD_FIELDS = Object.freeze({
  CLAIM: new Set(),
  RUN_TYPED_OPERATION: new Set(['workItemId', 'runId', 'operation']),
  UPLOAD_EVIDENCE: new Set(['workItemId', 'runId', 'eventIds', 'artifactHash']),
  APPLY_DECISION: new Set(['workItemId', 'runId', 'decisionId', 'artifactHash', 'expectedVersion']),
  RELEASE_LEASE: new Set(['workItemId', 'runId']),
  STOP: new Set(['runId', 'reason']),
});

const EVENT_FIELDS = new Set([
  'eventId',
  'dedupeKey',
  'type',
  'projectId',
  'workItemId',
  'runId',
  'occurredAt',
  'payload',
]);

export const failure = (code, message, extra = {}) => ({
  ok: false,
  code,
  message,
  ...extra,
});

export const cloneWorkerValue = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

export const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export const boundedText = (value, maximum = 256) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;

export const validIso = (value) =>
  Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function hashWorkerToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function commandFingerprint({ kind, payload }) {
  return hashValue({ kind, payload });
}

export function eventFingerprint(event) {
  return hashValue({
    eventId: event.eventId,
    dedupeKey: event.dedupeKey,
    type: event.type,
    projectId: event.projectId,
    workItemId: event.workItemId ?? null,
    runId: event.runId ?? null,
    occurredAt: event.occurredAt,
    payload: event.payload ?? {},
  });
}

function boundedJson(value, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > 500 || depth > 6) return false;
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return true;
  if (typeof value === 'string') return value.length <= 4000;
  if (Array.isArray(value))
    return value.length <= 100 && value.every((entry) => boundedJson(entry, depth + 1, budget));
  if (!isPlainObject(value)) return false;
  return (
    Object.keys(value).length <= 64 &&
    Object.entries(value).every(
      ([key, entry]) =>
        /^[A-Za-z0-9_.:-]{1,128}$/.test(key) && boundedJson(entry, depth + 1, budget),
    )
  );
}

export function hasDangerousCommandFields(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value))
    return value.some((entry) => hasDangerousCommandFields(entry, depth + 1));
  return Object.entries(value).some(
    ([key, entry]) =>
      INVALID_COMMAND_FIELDS.has(key.toLowerCase()) || hasDangerousCommandFields(entry, depth + 1),
  );
}

function forbiddenCloudPath(value, path = '') {
  if (value === null || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : path || 'value';
  if (typeof value === 'string') {
    if (LOCAL_PATH.test(value)) return path || 'value';
    if (CREDENTIAL_TEXT.test(value)) return path || 'value';
    return null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = forbiddenCloudPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isPlainObject(value)) return path || 'value';
  for (const [key, entry] of Object.entries(value)) {
    const child = path ? `${path}.${key}` : key;
    if (SENSITIVE_KEY.test(key) || CALLBACK_FIELD.test(key)) return child;
    const found = forbiddenCloudPath(entry, child);
    if (found) return found;
  }
  return null;
}

export function containsForbiddenCloudContent(value) {
  return forbiddenCloudPath(value);
}

export function sanitizeWorkerAuditDetail(value, depth = 0) {
  if (depth > 5) return '[TRUNCATED]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (LOCAL_PATH.test(value)) return '[LOCAL_PATH]';
    if (CREDENTIAL_TEXT.test(value)) return '[REDACTED]';
    return value.slice(0, 1000);
  }
  if (Array.isArray(value))
    return value.slice(0, 50).map((entry) => sanitizeWorkerAuditDetail(entry, depth + 1));
  if (!isPlainObject(value)) return '[INVALID]';
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 50)) {
    result[key] =
      SENSITIVE_KEY.test(key) || INVALID_COMMAND_FIELDS.has(key.toLowerCase())
        ? '[REDACTED]'
        : sanitizeWorkerAuditDetail(entry, depth + 1);
  }
  return result;
}

export function normalizeCapabilities(value) {
  if (value === undefined) return { ok: true, value: [] };
  if (Array.isArray(value)) {
    if (
      value.length > 64 ||
      value.some((entry) => !boundedText(entry, 128)) ||
      new Set(value).size !== value.length
    )
      return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
    return { ok: true, value: value.map((entry) => entry.trim()) };
  }
  if (!isPlainObject(value) || !boundedJson(value))
    return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
  if (hasDangerousCommandFields(value) || containsForbiddenCloudContent(value))
    return failure(
      'WORKER_CAPABILITIES_INVALID',
      'Capabilities must not contain shell, callback, secret or local path data',
    );
  const entries = Object.entries(value);
  if (entries.length > 64 || entries.some(([key]) => !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(key)))
    return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
  for (const [key, entry] of entries) {
    if (!SCHEDULING_CAPABILITY_FIELDS.has(key)) {
      if (!['string', 'number', 'boolean'].includes(typeof entry))
        return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
      continue;
    }
    if (key === 'projectIds' || key === 'projects' || key === 'toolchains' || key === 'labels') {
      if (
        !Array.isArray(entry) ||
        entry.length > 64 ||
        entry.some((item) => typeof item !== 'string' || !CAPABILITY_TOKEN.test(item.trim())) ||
        new Set(entry.map((item) => item.trim())).size !== entry.length
      )
        return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
      continue;
    }
    if (key === 'skills') {
      if (Array.isArray(entry)) {
        if (
          entry.length > 64 ||
          entry.some((item) => typeof item !== 'string' || !CAPABILITY_TOKEN.test(item.trim())) ||
          new Set(entry.map((item) => item.trim())).size !== entry.length
        )
          return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
      } else if (
        !isPlainObject(entry) ||
        Object.keys(entry).length > 64 ||
        Object.entries(entry).some(
          ([skill, status]) =>
            !CAPABILITY_TOKEN.test(skill) ||
            typeof status !== 'string' ||
            (!AVAILABLE_SKILL_STATES.has(status.toUpperCase()) &&
              !UNAVAILABLE_SKILL_STATES.has(status.toUpperCase())),
        )
      ) {
        return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
      }
      continue;
    }
    if (key === 'skillStatuses') {
      if (
        !isPlainObject(entry) ||
        Object.keys(entry).length > 64 ||
        Object.entries(entry).some(
          ([skill, status]) =>
            !CAPABILITY_TOKEN.test(skill) ||
            typeof status !== 'string' ||
            (!AVAILABLE_SKILL_STATES.has(status.toUpperCase()) &&
              !UNAVAILABLE_SKILL_STATES.has(status.toUpperCase())),
        )
      )
        return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
      continue;
    }
    if (key === 'maxConcurrency') {
      if (!Number.isSafeInteger(entry) || entry < 1 || entry > 100)
        return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
      continue;
    }
    if (key === 'priority') {
      if (!Number.isSafeInteger(entry) || entry < 0 || entry > 1000)
        return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
      continue;
    }
    if (key === 'region') {
      if (typeof entry !== 'string' || !CAPABILITY_REGION.test(entry.trim()))
        return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
      continue;
    }
    if (key === 'lastAssignedAt' && validIso(entry) === null)
      return failure('WORKER_CAPABILITIES_INVALID', 'Capabilities are invalid');
  }
  return { ok: true, value: cloneWorkerValue(value) };
}

export function normalizeProjectIds(value) {
  if (!Array.isArray(value) || value.length > 100)
    return failure('WORKER_PROJECTS_INVALID', 'Project whitelist is invalid');
  if (
    value.some((projectId) => !boundedText(projectId, 128)) ||
    new Set(value).size !== value.length
  )
    return failure('WORKER_PROJECTS_INVALID', 'Project whitelist is invalid');
  return { ok: true, value: value.map((projectId) => projectId.trim()) };
}

export function normalizeWorkerRegistration(input) {
  if (!isPlainObject(input))
    return failure('WORKER_INPUT_INVALID', 'Worker registration must be an object');
  const allowed = new Set(['displayName', 'projectIds', 'capabilities', 'actorId']);
  if (Object.keys(input).some((key) => !allowed.has(key)))
    return failure('WORKER_INPUT_INVALID', 'Worker registration contains unsupported fields');
  if (!boundedText(input.displayName, 256) || !boundedText(input.actorId, 256))
    return failure('WORKER_INPUT_INVALID', 'Display name and actor are required');
  if (containsForbiddenCloudContent({ displayName: input.displayName }))
    return failure('WORKER_INPUT_INVALID', 'Worker registration contains local or secret data');
  const capabilities = normalizeCapabilities(input.capabilities);
  if (!capabilities.ok) return capabilities;
  const projects = normalizeProjectIds(input.projectIds);
  if (!projects.ok) return projects;
  return {
    ok: true,
    value: {
      displayName: input.displayName.trim(),
      projectIds: projects.value,
      capabilities: capabilities.value,
      actorId: input.actorId.trim(),
    },
  };
}

export function normalizeCommand({ kind, payload = {} } = {}) {
  if (!COMMAND_KINDS.includes(kind))
    return failure('WORKER_COMMAND_KIND_INVALID', 'Command kind is not allowed');
  if (!isPlainObject(payload))
    return failure('WORKER_COMMAND_PAYLOAD_INVALID', 'Command payload must be an object');
  if (hasDangerousCommandFields(payload))
    return failure(
      'WORKER_COMMAND_SHELL_REJECTED',
      'Shell commands, executables and working directories are not allowed',
    );
  const allowed = COMMAND_PAYLOAD_FIELDS[kind];
  if (Object.keys(payload).some((key) => !allowed.has(key)))
    return failure('WORKER_COMMAND_PAYLOAD_INVALID', 'Command payload contains unsupported fields');
  if (!boundedJson(payload))
    return failure('WORKER_COMMAND_PAYLOAD_INVALID', 'Command payload exceeds its bounds');
  if (containsForbiddenCloudContent(payload))
    return failure(
      'WORKER_COMMAND_PAYLOAD_INVALID',
      'Command payload contains credentials, callbacks or local paths',
    );
  if (kind === 'RUN_TYPED_OPERATION' && payload.operation !== undefined) {
    if (!isPlainObject(payload.operation))
      return failure('WORKER_COMMAND_PAYLOAD_INVALID', 'Typed operation must be an object');
    if (
      Object.keys(payload.operation).some((key) => !['type', 'input'].includes(key)) ||
      !OPERATION_TYPE.test(payload.operation.type || '') ||
      /(?:^|[._-])(?:shell|bash|powershell|cmd|sh)(?:$|[._-])/i.test(payload.operation.type || '')
    )
      return failure('WORKER_COMMAND_PAYLOAD_INVALID', 'Typed operation is invalid');
    if (payload.operation.input !== undefined && !boundedJson(payload.operation.input))
      return failure('WORKER_COMMAND_PAYLOAD_INVALID', 'Typed operation input is invalid');
    if (
      payload.operation.input !== undefined &&
      containsForbiddenCloudContent(payload.operation.input)
    )
      return failure(
        'WORKER_COMMAND_PAYLOAD_INVALID',
        'Typed operation input contains credentials or local paths',
      );
  }
  return { ok: true, value: cloneWorkerValue(payload) };
}

export function normalizeWorkerEvent(input, { receivedAt } = {}) {
  if (!isPlainObject(input))
    return failure('WORKER_EVENT_INVALID', 'Worker event must be an object');
  const forbidden = containsForbiddenCloudContent(input);
  if (forbidden)
    return failure('WORKER_EVENT_SENSITIVE', 'Worker event contains credentials or local paths', {
      field: forbidden,
    });
  if (Object.keys(input).some((key) => !EVENT_FIELDS.has(key)))
    return failure('WORKER_EVENT_INVALID', 'Worker event contains unsupported fields');
  if (
    !EVENT_ID.test(input.eventId || '') ||
    !boundedText(input.dedupeKey, 256) ||
    !EVENT_TYPE.test(input.type || '') ||
    !boundedText(input.projectId, 128) ||
    (input.workItemId !== undefined && !boundedText(input.workItemId, 128)) ||
    (input.runId !== undefined && !boundedText(input.runId, 128)) ||
    (input.payload !== undefined && !isPlainObject(input.payload)) ||
    (input.payload !== undefined && !boundedJson(input.payload))
  )
    return failure('WORKER_EVENT_INVALID', 'Worker event fields are invalid');
  const occurredAt = input.occurredAt === undefined ? receivedAt : validIso(input.occurredAt);
  if (!occurredAt) return failure('WORKER_EVENT_INVALID', 'Worker event time is invalid');
  return {
    ok: true,
    value: {
      eventId: input.eventId,
      dedupeKey: input.dedupeKey,
      type: input.type,
      projectId: input.projectId,
      workItemId: input.workItemId ?? null,
      runId: input.runId ?? null,
      occurredAt,
      receivedAt,
      payload: cloneWorkerValue(input.payload ?? {}),
    },
  };
}

export function validWorkerRecord(worker) {
  return (
    isPlainObject(worker) &&
    WORKER_ID.test(worker.workerId || '') &&
    boundedText(worker.displayName, 256) &&
    HASH.test(worker.tokenHash || '') &&
    WORKER_STATUSES.includes(worker.status) &&
    Array.isArray(worker.projectIds) &&
    worker.projectIds.length <= 100 &&
    worker.projectIds.every((projectId) => boundedText(projectId, 128)) &&
    Number.isSafeInteger(worker.version) &&
    worker.version >= 1
  );
}

export function validWorkerEventRecord(event) {
  return (
    isPlainObject(event) &&
    EVENT_ID.test(event.eventId || '') &&
    boundedText(event.dedupeKey, 256) &&
    EVENT_TYPE.test(event.type || '') &&
    boundedText(event.projectId, 128) &&
    boundedText(event.workerId, 128) &&
    HASH.test(event.fingerprint || '') &&
    validIso(event.receivedAt) !== null
  );
}
