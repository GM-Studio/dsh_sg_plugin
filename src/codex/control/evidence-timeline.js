import { canonicalJson } from '../events.js';

export const EVIDENCE_EVENT_TYPES = Object.freeze([
  'run.started',
  'plan.created',
  'tool.called',
  'test.started',
  'test.failed',
  'test.passed',
  'verification.skipped',
  'gate.requested',
  'decision.recorded',
  'decision.applied',
  'run.resumed',
  'delivery.packaged',
  'notification.sent',
  'notification.failed',
]);

export const DECISION_STATUSES = Object.freeze([
  'RECORDED',
  'PENDING_APPLY',
  'APPLYING',
  'APPLIED',
  'STALE',
  'REJECTED',
]);

const DECISION_ACTIONS = new Set([
  'approve',
  'request_changes',
  'answer',
  'pause',
  'resume',
  'retry',
  'cancel',
  'accept_delivery',
]);
const EVENT_TYPES = new Set(EVIDENCE_EVENT_TYPES);
const DECISION_STATUS_SET = new Set(DECISION_STATUSES);
const HASH = /^[a-f0-9]{64}$/i;
const MAX_SUMMARY_LENGTH = 4000;
const MAX_PAYLOAD_STRING = 8192;
const MAX_PAYLOAD_ENTRIES = 100;
const MAX_PAYLOAD_DEPTH = 6;
const MAX_EXPORT_LIMIT = 5000;
const DEFAULT_MAX_EVENTS = 1000;

const PROHIBITED_KEY =
  /^(?:chain[_-]?of[_-]?thought|reasoning|reasoning[_-]?process|thoughts?|internal[_-]?monologue|raw[_-]?logs?|logs?|stdout|stderr|raw[_-]?output|output|diff|patch|full[_-]?patch|source[_-]?diff|source|full[_-]?source|file[_-]?content|content)$/i;
const SECRET_KEY =
  /^(?:authorization|cookie|password|passwd|secret|token|token[_-]?hash|access[_-]?token|refresh[_-]?token|api[_-]?key|credential|credentials|private[_-]?key)$/i;
const CUSTOMER_NAME_KEY =
  /^(?:(?:customer|client|account|tenant|organization|company)[_-]?(?:name|title)|customer[_-]?title)$/i;
const CUSTOMER_CONTAINER_KEY = /^(?:customer|client|account|tenant|organization|company)$/i;

const PROHIBITED_TEXT = [
  /chain[-_\s]*of[-_\s]*thought/i,
  /internal[-_\s]*monologue/i,
  /reasoning[-_\s]*(?:process|trace)/i,
  /(?:思维链|推理过程|内部思考)/,
  /token[-_\s]*(?:stream|by[-_\s]*token)/i,
  /(?:逐\s*token|流式\s*token)/i,
  /\b(\S+)(?:\s+\1){20,}\b/,
  /(?:^|\n)\s*(?:stdout|stderr|logs?)\s*:/i,
  /\b(?:thoughts?|reasoning)\s*[:=]/i,
  /raw[-_\s]*(?:log|logs|stdout|stderr|output)/i,
  /(?:begin|complete|full)[-_\s]*(?:stdout|stderr|log|logs)/i,
  /(?:原始|完整)\s*(?:日志|输出|标准输出|标准错误)/,
  /(?:full|complete|source)[-_\s]*(?:diff|patch)/i,
  /(?:完整|源码)\s*(?:补丁|差异)/,
  /(?:^|\n)(?:diff --git |--- a\/|\+\+\+ b\/|@@ -\d+,\d+ \+\d+,\d+ @@)/m,
];

const BEARER = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]{8,}=*/gi;
const CREDENTIAL_ASSIGNMENT =
  /\b(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|credential|private[_-]?key)\s*[=:]\s*[^\s,;]+/gi;
const COMMON_CREDENTIAL =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|sgw_[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g;
const CUSTOMER_NAME_TEXT =
  /\b(?:customer|client|account|tenant|organization|company)[_-]?(?:name|title)\s*[=:]\s*[^\r\n,;]+/gi;
const WINDOWS_PATH = /\b[A-Za-z]:[\\/][^\r\n\t"'<>|]*/g;
const UNC_PATH = /\\\\[^\s\\]+\\[^\s"'<>|]*/g;
const UNIX_LOCAL_PATH =
  /(?<!:)\/(?:Users|home|tmp|var|opt|private|root|mnt|Volumes|workspace|workspaces|project|projects|app)\/[^\s"'`<>]*/g;

export const failure = (code, message, extra = {}) => ({
  ok: false,
  code,
  message,
  ...extra,
});

export const clone = (value) => JSON.parse(JSON.stringify(value));

function eventFingerprint(event) {
  const { receivedAt: _receivedAt, ...body } = event;
  return canonicalJson(body);
}

export function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function boundedText(value, maximum = 256) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function iso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

function prohibitedContent(value, path = '$', seen = new Set()) {
  if (typeof value === 'string') {
    const marker = PROHIBITED_TEXT.find((pattern) => pattern.test(value));
    return marker ? path : null;
  }
  if (value === null || typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  const entries = Array.isArray(value) ? value.entries() : Object.entries(value);
  for (const [key, entry] of entries) {
    if (!Array.isArray(value) && PROHIBITED_KEY.test(String(key))) {
      return `${path}.${key}`;
    }
    const nested = prohibitedContent(
      entry,
      Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`,
      seen,
    );
    if (nested) return nested;
  }
  seen.delete(value);
  return null;
}

export function sanitizeEvidenceText(value, maximum = MAX_PAYLOAD_STRING) {
  if (typeof value !== 'string') {
    return failure('EVIDENCE_TEXT_INVALID', 'Evidence text must be a string');
  }
  if (prohibitedContent(value)) {
    return failure(
      'EVIDENCE_PROHIBITED_CONTENT',
      'Evidence contains chain-of-thought, raw logs, token streams, or source diffs',
    );
  }
  if (value.length > MAX_PAYLOAD_STRING) {
    return failure('EVIDENCE_SIZE_INVALID', 'Evidence text exceeds the safe bound');
  }
  let sanitized = value;
  for (const pattern of PROHIBITED_TEXT) {
    if (pattern.test(sanitized)) {
      return failure(
        'EVIDENCE_PROHIBITED_CONTENT',
        'Evidence contains prohibited raw or reasoning content',
      );
    }
  }
  sanitized = sanitized
    .replace(CUSTOMER_NAME_TEXT, '[REDACTED_CUSTOMER]')
    .replace(BEARER, '[REDACTED]')
    .replace(CREDENTIAL_ASSIGNMENT, '[REDACTED]')
    .replace(COMMON_CREDENTIAL, '[REDACTED]')
    .replace(WINDOWS_PATH, '[LOCAL_PATH]')
    .replace(UNC_PATH, '[LOCAL_PATH]')
    .replace(UNIX_LOCAL_PATH, '[LOCAL_PATH]');
  return { ok: true, value: sanitized.slice(0, maximum) };
}

export function sanitizeDiscreteValue(
  value,
  { depth = 0, path = 'payload', seen = new Set(), context = null } = {},
) {
  if (depth > MAX_PAYLOAD_DEPTH) {
    return failure('EVIDENCE_PAYLOAD_INVALID', 'Evidence payload is nested too deeply', { path });
  }
  if (value === null || typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { ok: true, value }
      : failure('EVIDENCE_PAYLOAD_INVALID', 'Evidence payload numbers must be finite', { path });
  }
  if (typeof value === 'string') {
    const sanitized = sanitizeEvidenceText(value);
    return sanitized.ok ? sanitized : { ...sanitized, path };
  }
  if (typeof value !== 'object') {
    return failure('EVIDENCE_PAYLOAD_INVALID', 'Evidence payload is not JSON-safe', { path });
  }
  if (seen.has(value)) {
    return failure('EVIDENCE_PAYLOAD_INVALID', 'Evidence payload contains a cycle', { path });
  }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (value.length > MAX_PAYLOAD_ENTRIES) {
      seen.delete(value);
      return failure('EVIDENCE_PAYLOAD_INVALID', 'Evidence payload array is too large', {
        path,
      });
    }
    result = [];
    for (const [index, entry] of value.entries()) {
      const sanitized = sanitizeDiscreteValue(entry, {
        depth: depth + 1,
        path: `${path}[${index}]`,
        seen,
        context,
      });
      if (!sanitized.ok) {
        seen.delete(value);
        return sanitized;
      }
      result.push(sanitized.value);
    }
  } else if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > MAX_PAYLOAD_ENTRIES) {
      seen.delete(value);
      return failure('EVIDENCE_PAYLOAD_INVALID', 'Evidence payload object is too large', {
        path,
      });
    }
    result = {};
    for (const [key, entry] of entries) {
      if (PROHIBITED_KEY.test(key)) {
        seen.delete(value);
        return failure(
          'EVIDENCE_PROHIBITED_CONTENT',
          'Evidence payload contains a prohibited field',
          { path: `${path}.${key}` },
        );
      }
      if (
        SECRET_KEY.test(key) ||
        CUSTOMER_NAME_KEY.test(key) ||
        (context === 'customer' && /^(?:name|title)$/i.test(key))
      ) {
        result[key] = '[REDACTED]';
        continue;
      }
      const sanitized = sanitizeDiscreteValue(entry, {
        depth: depth + 1,
        path: `${path}.${key}`,
        seen,
        context: CUSTOMER_CONTAINER_KEY.test(key) ? 'customer' : null,
      });
      if (!sanitized.ok) {
        seen.delete(value);
        return sanitized;
      }
      result[key] = sanitized.value;
    }
  } else {
    seen.delete(value);
    return failure('EVIDENCE_PAYLOAD_INVALID', 'Evidence payload has an unsupported object type', {
      path,
    });
  }
  seen.delete(value);
  return { ok: true, value: result };
}

function optionalIdentifier(value, name, maximum = 128) {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (!boundedText(value, maximum)) {
    return failure('EVIDENCE_INVALID', `${name} is invalid`, { field: name });
  }
  return { ok: true, value: value.trim() };
}

function normalizeDecision(input) {
  if (!['decision.recorded', 'decision.applied'].includes(input.type)) {
    return { ok: true, value: undefined, artifactVersion: undefined };
  }
  const source = isPlainObject(input.decision) ? input.decision : {};
  const decisionId = input.decisionId ?? source.decisionId;
  const version =
    input.artifactVersion ??
    input.decisionVersion ??
    source.version ??
    source.artifactVersion ??
    input.version;
  const action = input.decisionAction ?? source.action ?? input.action;
  const status = input.decisionStatus ?? source.status ?? input.status;
  if (
    decisionId === undefined &&
    version === undefined &&
    action === undefined &&
    status === undefined
  ) {
    return { ok: true, value: undefined, artifactVersion: undefined };
  }
  if (decisionId !== undefined && !boundedText(decisionId, 128)) {
    return failure('EVIDENCE_DECISION_INVALID', 'Decision id is invalid');
  }
  const normalizedVersion =
    typeof version === 'number'
      ? Number.isSafeInteger(version) && version >= 0
        ? version
        : null
      : boundedText(version, 128)
        ? version.trim()
        : null;
  if (version !== undefined && normalizedVersion === null) {
    return failure('EVIDENCE_DECISION_INVALID', 'Decision artifact version is invalid');
  }
  if (action !== undefined && !DECISION_ACTIONS.has(action)) {
    return failure('EVIDENCE_DECISION_INVALID', 'Decision action is invalid');
  }
  if (status !== undefined && !DECISION_STATUS_SET.has(status)) {
    return failure('EVIDENCE_DECISION_INVALID', 'Decision status is invalid');
  }
  return {
    ok: true,
    artifactVersion: normalizedVersion ?? undefined,
    value: {
      ...(decisionId === undefined ? {} : { decisionId: decisionId.trim() }),
      ...(normalizedVersion === null ? {} : { version: normalizedVersion }),
      ...(action === undefined ? {} : { action }),
      ...(status === undefined ? {} : { status }),
    },
  };
}

function normalizeEvent(input, { clock, storedAt } = {}) {
  if (!isPlainObject(input)) {
    return failure('EVIDENCE_INVALID', 'Timeline event must be a plain object');
  }
  const unsafe = prohibitedContent(input);
  if (unsafe) {
    return failure('EVIDENCE_PROHIBITED_CONTENT', 'Timeline event contains prohibited content', {
      field: unsafe,
    });
  }
  for (const [name, maximum] of [
    ['eventId', 128],
    ['projectId', 128],
    ['workItemId', 128],
    ['correlationId', 128],
  ]) {
    if (!boundedText(input[name], maximum)) {
      return failure('EVIDENCE_INVALID', `${name} is required`, { field: name });
    }
  }
  if (!EVENT_TYPES.has(input.type)) {
    return failure('EVIDENCE_INVALID', 'Timeline event type is not allowed', {
      field: 'type',
    });
  }
  const occurredAt = iso(input.occurredAt);
  if (!occurredAt) {
    return failure('EVIDENCE_INVALID', 'occurredAt must be an ISO timestamp', {
      field: 'occurredAt',
    });
  }
  if (!HASH.test(input.artifactHash || '')) {
    return failure('EVIDENCE_INVALID', 'artifactHash must be a SHA-256 hash', {
      field: 'artifactHash',
    });
  }
  const summary = sanitizeEvidenceText(input.summary, MAX_SUMMARY_LENGTH);
  if (!summary.ok) return summary;
  if (!summary.value.trim()) {
    return failure('EVIDENCE_INVALID', 'summary is required', { field: 'summary' });
  }
  const runId = optionalIdentifier(input.runId, 'runId');
  if (!runId.ok) return runId;
  const sessionId = optionalIdentifier(input.sessionId, 'sessionId');
  if (!sessionId.ok) return sessionId;
  const payload = sanitizeDiscreteValue(input.payload ?? {});
  if (!payload.ok) return payload;
  const decision = normalizeDecision(input);
  if (!decision.ok) return decision;

  const receivedAt =
    iso(storedAt) ??
    iso(input.receivedAt) ??
    new Date(typeof clock === 'function' ? clock() : Date.now()).toISOString();
  return {
    ok: true,
    event: {
      eventId: input.eventId.trim(),
      projectId: input.projectId.trim(),
      workItemId: input.workItemId.trim(),
      ...(runId.value ? { runId: runId.value } : {}),
      ...(sessionId.value ? { sessionId: sessionId.value } : {}),
      type: input.type,
      occurredAt,
      receivedAt,
      summary: summary.value,
      artifactHash: input.artifactHash.toLowerCase(),
      correlationId: input.correlationId.trim(),
      payload: payload.value,
      ...(decision.artifactVersion === undefined
        ? {}
        : { artifactVersion: decision.artifactVersion }),
      ...(decision.value === undefined ? {} : { decision: decision.value }),
    },
  };
}

function normalizeFilters(options = {}) {
  if (!isPlainObject(options)) {
    return failure('TIMELINE_FILTER_INVALID', 'Timeline filters must be an object');
  }
  if (!boundedText(options.projectId, 128)) {
    return failure('TIMELINE_FILTER_INVALID', 'projectId is required');
  }
  for (const [name, maximum] of [
    ['workItemId', 128],
    ['runId', 128],
  ]) {
    if (options[name] !== undefined && !boundedText(options[name], maximum)) {
      return failure('TIMELINE_FILTER_INVALID', `${name} filter is invalid`, {
        field: name,
      });
    }
  }
  const limit =
    options.limit === undefined
      ? 100
      : Number.isSafeInteger(options.limit) && options.limit >= 1
        ? options.limit
        : null;
  if (limit === null) {
    return failure('TIMELINE_FILTER_INVALID', 'limit must be a positive integer');
  }
  return {
    ok: true,
    projectId: options.projectId.trim(),
    workItemId: options.workItemId?.trim(),
    runId: options.runId?.trim(),
    after: options.after,
    limit,
  };
}

function cursorAfter(events, cursor) {
  if (cursor === undefined || cursor === null || cursor === '') return { ok: true, index: -1 };
  if (typeof cursor === 'number' && Number.isFinite(cursor)) {
    let index = -1;
    for (const [candidate, event] of events.entries()) {
      if (Date.parse(event.occurredAt) <= cursor) index = candidate;
    }
    return { ok: true, index };
  }
  if (typeof cursor !== 'string' || !boundedText(cursor, 256)) {
    return failure('TIMELINE_CURSOR_INVALID', 'after must be an event id or ISO timestamp');
  }
  const timestamp = iso(cursor);
  if (timestamp) {
    let index = -1;
    for (const [candidate, event] of events.entries()) {
      if (event.occurredAt <= timestamp) index = candidate;
    }
    return { ok: true, index };
  }
  const index = events.findIndex((event) => event.eventId === cursor);
  return index < 0
    ? failure('TIMELINE_CURSOR_NOT_FOUND', 'after event was not found')
    : { ok: true, index };
}

function sortEvents(events) {
  return [...events].sort(
    (left, right) =>
      left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId),
  );
}

function permissionFailure(projectId, role, allowedProjects) {
  if (role !== undefined && role !== 'owner' && allowedProjects === undefined) {
    return failure('TIMELINE_FORBIDDEN', 'Timeline export requires an explicit project scope');
  }
  if (allowedProjects !== undefined && !allowedProjects.includes(projectId)) {
    return failure('TIMELINE_FORBIDDEN', 'Project is outside the permitted export scope');
  }
  return null;
}

export function createEvidenceTimeline({
  repository = null,
  clock = Date.now,
  maxEvents = DEFAULT_MAX_EVENTS,
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_EXPORT_LIMIT) {
    throw new TypeError(`maxEvents must be an integer between 1 and ${MAX_EXPORT_LIMIT}`);
  }
  if (
    repository !== null &&
    (typeof repository?.appendEvidence !== 'function' ||
      typeof repository?.listEvidence !== 'function')
  ) {
    throw new TypeError('repository must implement appendEvidence and listEvidence');
  }

  const events = new Map();
  const fingerprints = new Map();

  async function record(input) {
    const normalized = normalizeEvent(input, { clock });
    if (!normalized.ok) return normalized;
    const fingerprint = eventFingerprint(normalized.event);
    if (repository) {
      const result = await repository.appendEvidence(normalized.event);
      if (!result?.ok) {
        if (['EVIDENCE_CONFLICT', 'EVIDENCE_DUPLICATE'].includes(result?.code)) {
          const existing = await sourceEvents(normalized.event.projectId);
          const match = existing.ok
            ? existing.events.find((candidate) => candidate.eventId === normalized.event.eventId)
            : null;
          if (match) {
            const matches = eventFingerprint(match) === fingerprint;
            return matches
              ? { ok: true, event: clone(match), duplicate: true }
              : failure('EVIDENCE_CONFLICT', 'Event id was reused with different content', {
                  eventId: normalized.event.eventId,
                });
          }
        }
        return failure(
          result?.code ?? 'EVIDENCE_PERSIST_FAILED',
          result?.message ?? 'Evidence could not be persisted',
        );
      }
      const stored = normalizeEvent(result.event, {
        clock,
        storedAt: result.event?.receivedAt,
      });
      return stored.ok
        ? {
            ok: true,
            event: clone(stored.event),
            duplicate: result.duplicate === true,
          }
        : stored;
    }
    const existing = events.get(normalized.event.eventId);
    if (existing) {
      if (fingerprints.get(normalized.event.eventId) !== fingerprint) {
        return failure('EVIDENCE_CONFLICT', 'Event id was reused with different content', {
          eventId: normalized.event.eventId,
        });
      }
      return { ok: true, event: clone(existing), duplicate: true };
    }
    if (events.size >= maxEvents) {
      return failure('EVIDENCE_LIMIT_REACHED', 'Timeline in-memory event limit was reached', {
        maxEvents,
      });
    }
    events.set(normalized.event.eventId, clone(normalized.event));
    fingerprints.set(normalized.event.eventId, fingerprint);
    return { ok: true, event: clone(normalized.event), duplicate: false };
  }

  async function sourceEvents(projectId) {
    if (!repository) {
      return {
        ok: true,
        events: [...events.values()].filter((event) => event.projectId === projectId),
      };
    }
    const result = await repository.listEvidence(projectId);
    if (!result?.ok) {
      return failure(
        result?.code ?? 'EVIDENCE_READ_FAILED',
        result?.message ?? 'Evidence could not be read',
      );
    }
    if (!Array.isArray(result.events)) {
      return failure('EVIDENCE_READ_FAILED', 'Evidence repository returned an invalid event list');
    }
    const normalized = [];
    for (const event of result.events) {
      const checked = normalizeEvent(event, {
        clock,
        storedAt: event?.receivedAt,
      });
      if (!checked.ok) return checked;
      if (checked.event.projectId !== projectId) {
        return failure('EVIDENCE_PROJECT_MISMATCH', 'Evidence repository returned another project');
      }
      normalized.push(checked.event);
    }
    return { ok: true, events: normalized };
  }

  async function list(options = {}) {
    const filters = normalizeFilters(options);
    if (!filters.ok) return filters;
    const source = await sourceEvents(filters.projectId);
    if (!source.ok) return source;
    const ordered = sortEvents(source.events);
    const cursor = cursorAfter(ordered, filters.after);
    if (!cursor.ok) return cursor;
    const remaining = ordered
      .slice(cursor.index + 1)
      .filter(
        (event) =>
          (!filters.workItemId || event.workItemId === filters.workItemId) &&
          (!filters.runId || event.runId === filters.runId),
      );
    const limited = remaining.slice(0, Math.min(filters.limit, maxEvents));
    return {
      ok: true,
      events: clone(limited),
      count: limited.length,
      nextCursor: limited.at(-1)?.eventId ?? null,
    };
  }

  async function exportTimeline(options = {}) {
    const format = options.format ?? 'jsonl';
    if (!['jsonl', 'json'].includes(format)) {
      return failure('TIMELINE_EXPORT_INVALID', 'format must be jsonl or json');
    }
    const filters = normalizeFilters({
      ...options,
      limit: Math.min(options.limit ?? maxEvents, maxEvents),
    });
    if (!filters.ok) return filters;
    const allowedProjects =
      options.allowedProjects === undefined
        ? undefined
        : Array.isArray(options.allowedProjects)
          ? options.allowedProjects
          : null;
    if (allowedProjects === null) {
      return failure('TIMELINE_FORBIDDEN', 'allowedProjects must be an array');
    }
    const denied = permissionFailure(filters.projectId, options.role, allowedProjects);
    if (denied) return denied;
    const listed = await list(filters);
    if (!listed.ok) return listed;
    const content =
      format === 'jsonl'
        ? listed.events.map((event) => canonicalJson(event)).join('\n') +
          (listed.events.length ? '\n' : '')
        : canonicalJson({ events: listed.events });
    return {
      ok: true,
      format,
      content,
      eventCount: listed.events.length,
      nextCursor: listed.nextCursor,
    };
  }

  return Object.freeze({ record, list, export: exportTimeline });
}
