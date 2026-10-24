import { randomUUID } from 'node:crypto';
import { COMMAND_KINDS, normalizeCommand } from '../core/control/worker/worker-contract.js';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const MAX_SYNC_WAIT_MS = 60000;
const MAX_EVENT_BATCH_COUNT = 100;
const MAX_EVENT_BATCH_BYTES = 256 * 1024;
const MAX_COMMAND_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 10;
const MAX_STRING_LENGTH = 64 * 1024;

/**
 * These are the only network destinations the worker can reach. Routes are
 * deliberately relative and are resolved against the validated base URL; the
 * worker never accepts a server-supplied polling, callback or reconnect URL.
 */
export const WORKER_ROUTES = Object.freeze({
  connect: 'api/worker/connect',
  sync: 'api/worker/sync',
  claim: 'api/worker/claim',
  heartbeat: 'api/worker/heartbeat',
  events: 'api/worker/events',
  ack: 'api/worker/commands/ack',
  release: 'api/worker/release',
});

export const WORKER_COMMAND_KINDS = COMMAND_KINDS;

const COMMAND_FIELDS = new Set([
  'commandId',
  'kind',
  'payload',
  'workerId',
  'sequence',
  'dedupeKey',
  'fingerprint',
  'issuedBy',
  'issuedAt',
  'ackedAt',
]);

const FORBIDDEN_EXECUTION_FIELDS = new Set([
  'args',
  'argv',
  'bash',
  'cmd',
  'command',
  'commandline',
  'exec',
  'execcommand',
  'executable',
  'executablepath',
  'execpath',
  'powershell',
  'rawshell',
  'script',
  'shell',
  'shellcommand',
  'spawn',
]);

const FORBIDDEN_REMOTE_DESTINATION_FIELD =
  /^(?:callback|endpoint|redirect|webhook)(?:url|uri)?$|(?:url|uri)$/i;
const SENSITIVE_RESULT_FIELD = /^(?:authorization|cookie|password|secret|token)$/i;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429]);
const AUTHENTICATION_CODES = new Set([
  'AUTHENTICATION_FAILED',
  'AUTH_REVOKED',
  'REVOKED',
  'UNAUTHORIZED',
  'WORKER_REVOKED',
]);
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

class WorkerValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkerValidationError';
    this.code = code;
  }
}

function failure(code, message, extra = {}) {
  return { ...extra, ok: false, code, message };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isLoopbackHostname(hostname) {
  return LOOPBACK_HOSTS.has(hostname) || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

function validateBaseUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4096) {
    throw new TypeError('baseUrl is required');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('baseUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new TypeError('baseUrl must use HTTPS, or HTTP only for loopback');
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new TypeError('baseUrl must use HTTPS for non-loopback hosts');
  }
  if (url.username || url.password) {
    throw new TypeError('baseUrl must not embed credentials');
  }
  if (url.search || url.hash) {
    throw new TypeError('baseUrl must not contain a query or fragment');
  }
  if (!url.pathname.endsWith('/')) url.pathname = `${url.pathname}/`;
  return url;
}

function validateToken(value) {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) {
    throw new TypeError('token must be a nonempty bearer token');
  }
  return value.trim();
}

function validateOption(value, fallback, name) {
  const selected = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return selected;
}

function validateCursor(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    if (value.length > 4096) {
      throw new WorkerValidationError('CURSOR_INVALID', 'cursor is too long');
    }
    return value;
  }
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (
      keys.length === 0 ||
      keys.some((key) => !['commands', 'decisions', 'command', 'decision'].includes(key))
    ) {
      throw new WorkerValidationError('CURSOR_INVALID', 'cursor object is invalid');
    }
    const output = {};
    for (const key of ['commands', 'command']) {
      if (value[key] === undefined) continue;
      if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
        throw new WorkerValidationError('CURSOR_INVALID', `cursor.${key} is invalid`);
      }
      output[key] = value[key];
    }
    for (const key of ['decisions', 'decision']) {
      if (value[key] === undefined) continue;
      if (typeof value[key] !== 'string' || value[key].length > 4096) {
        throw new WorkerValidationError('CURSOR_INVALID', `cursor.${key} is invalid`);
      }
      output[key] = value[key];
    }
    return output;
  }
  throw new WorkerValidationError('CURSOR_INVALID', 'cursor must be a string, integer or object');
}

function normalizedFieldName(value) {
  return String(value).toLowerCase().replaceAll(/[-_]/g, '');
}

function cloneJson(
  value,
  {
    path = '$',
    depth = 0,
    seen = new Set(),
    maxBytes = MAX_COMMAND_BYTES,
    rejectExecutionFields = false,
    rejectRemoteDestinations = false,
  } = {},
) {
  if (depth > MAX_JSON_DEPTH) {
    throw new WorkerValidationError('COMMAND_INVALID', `${path} is nested too deeply`);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new WorkerValidationError('COMMAND_INVALID', `${path} must contain finite numbers`);
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) {
      throw new WorkerValidationError('COMMAND_INVALID', `${path} is too long`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new WorkerValidationError('COMMAND_INVALID', `${path} is not JSON serializable`);
  }
  if (seen.has(value)) {
    throw new WorkerValidationError('COMMAND_INVALID', `${path} contains a cycle`);
  }
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    if (value.length > 10000) {
      throw new WorkerValidationError('COMMAND_INVALID', `${path} has too many entries`);
    }
    output = value.map((entry, index) =>
      cloneJson(entry, {
        path: `${path}[${index}]`,
        depth: depth + 1,
        seen,
        maxBytes,
        rejectExecutionFields,
        rejectRemoteDestinations,
      }),
    );
  } else {
    if (!isPlainObject(value)) {
      throw new WorkerValidationError('COMMAND_INVALID', `${path} must be a plain object`);
    }
    const entries = Object.entries(value);
    if (entries.length > 1000) {
      throw new WorkerValidationError('COMMAND_INVALID', `${path} has too many fields`);
    }
    output = {};
    for (const [key, entry] of entries) {
      const normalizedKey = normalizedFieldName(key);
      if (
        key === '__proto__' ||
        key === 'prototype' ||
        key === 'constructor' ||
        (rejectExecutionFields &&
          (FORBIDDEN_EXECUTION_FIELDS.has(normalizedKey) ||
            FORBIDDEN_REMOTE_DESTINATION_FIELD.test(key)))
      ) {
        const code = FORBIDDEN_EXECUTION_FIELDS.has(normalizedKey)
          ? 'COMMAND_SHELL_REJECTED'
          : 'COMMAND_REMOTE_DESTINATION_REJECTED';
        throw new WorkerValidationError(code, `${path}.${key} is not permitted`);
      }
      if (rejectRemoteDestinations && FORBIDDEN_REMOTE_DESTINATION_FIELD.test(key)) {
        throw new WorkerValidationError(
          'COMMAND_REMOTE_DESTINATION_REJECTED',
          `${path}.${key} is not permitted`,
        );
      }
      output[key] = cloneJson(entry, {
        path: `${path}.${key}`,
        depth: depth + 1,
        seen,
        maxBytes,
        rejectExecutionFields,
        rejectRemoteDestinations,
      });
    }
  }
  seen.delete(value);
  const serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized) > maxBytes) {
    throw new WorkerValidationError('COMMAND_INVALID', `${path} exceeds the size limit`);
  }
  return output;
}

function validateCommand(raw) {
  if (!isPlainObject(raw)) {
    throw new WorkerValidationError('COMMAND_INVALID', 'Command must be a plain object');
  }
  for (const key of Object.keys(raw)) {
    if (!COMMAND_FIELDS.has(key)) {
      const normalizedKey = normalizedFieldName(key);
      if (
        FORBIDDEN_EXECUTION_FIELDS.has(normalizedKey) ||
        FORBIDDEN_REMOTE_DESTINATION_FIELD.test(key)
      ) {
        const code = FORBIDDEN_EXECUTION_FIELDS.has(normalizedKey)
          ? 'COMMAND_SHELL_REJECTED'
          : 'COMMAND_REMOTE_DESTINATION_REJECTED';
        throw new WorkerValidationError(code, `Command field ${key} is not permitted`);
      }
      throw new WorkerValidationError('COMMAND_INVALID', `Unknown command field: ${key}`);
    }
  }
  const commandId = raw.commandId;
  if (typeof commandId !== 'string' || !COMMAND_ID.test(commandId)) {
    throw new WorkerValidationError('COMMAND_INVALID', 'commandId is required');
  }
  if (raw.sequence !== undefined && (!Number.isSafeInteger(raw.sequence) || raw.sequence < 1)) {
    throw new WorkerValidationError('COMMAND_INVALID', 'sequence is invalid');
  }
  if (raw.payload !== undefined && !isPlainObject(raw.payload)) {
    throw new WorkerValidationError('COMMAND_INVALID', 'payload must be a plain object');
  }
  const payload = cloneJson(raw.payload ?? {}, {
    rejectExecutionFields: true,
    rejectRemoteDestinations: true,
  });
  const checked = normalizeCommand({ kind: raw.kind, payload });
  if (!checked.ok) {
    throw new WorkerValidationError(checked.code, checked.message);
  }
  return Object.freeze({
    commandId,
    kind: raw.kind,
    payload: checked.value,
  });
}

function commandIdFrom(raw) {
  return typeof raw?.commandId === 'string' && COMMAND_ID.test(raw.commandId)
    ? raw.commandId
    : null;
}

function boundedJson(value, maxBytes = MAX_COMMAND_BYTES) {
  return cloneJson(value, { maxBytes });
}

function sanitizedError(error, token) {
  const candidate = String(error?.message || error || 'Command handler failed').slice(0, 2000);
  return token ? candidate.split(token).join('<redacted>') : candidate;
}

function sanitizeResult(value, token, depth = 0, seen = new Set()) {
  if (value === undefined) return null;
  if (depth > 6) return '<truncated>';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const sanitized = token ? value.split(token).join('<redacted>') : value;
    return sanitized.slice(0, 8000);
  }
  if (typeof value !== 'object') return String(value).slice(0, 8000);
  if (seen.has(value)) return '<cycle>';
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = value.slice(0, 200).map((entry) => sanitizeResult(entry, token, depth + 1, seen));
  } else if (isPlainObject(value)) {
    output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 200)) {
      if (SENSITIVE_RESULT_FIELD.test(key)) continue;
      output[key] = sanitizeResult(entry, token, depth + 1, seen);
    }
  } else {
    output = '<object>';
  }
  seen.delete(value);
  return output;
}

function resultEvent({ commandId, ok, result = null, code = null, message = null }) {
  return {
    eventId: `command:${commandId || randomUUID()}:${ok ? 'result' : 'failure'}`,
    type: 'command.result',
    commandId,
    ok,
    ...(ok ? { result } : { error: { code, message } }),
  };
}

function bodyCode(body) {
  return String(body?.code || body?.error?.code || '')
    .trim()
    .toUpperCase();
}

function isAuthenticationCode(code) {
  return AUTHENTICATION_CODES.has(code) || code.startsWith('AUTH_');
}

function abortError(message = 'Worker stopped') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

async function defaultSleep(delayMs, { signal } = {}) {
  if (signal?.aborted) throw abortError();
  await new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function responseBody(response) {
  try {
    if (typeof response?.text === 'function') {
      const text = await response.text();
      if (!text) return {};
      const parsed = JSON.parse(text);
      return isPlainObject(parsed) ? parsed : { value: parsed };
    }
    if (typeof response?.json === 'function') {
      const parsed = await response.json();
      return isPlainObject(parsed) ? parsed : { value: parsed };
    }
  } catch {
    return {};
  }
  return {};
}

export function createOutboundWorker({
  baseUrl,
  token,
  fetchImpl = fetch,
  commandHandler,
  eventHandler = null,
  clock = Date.now,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  abortControllerFactory = () => new AbortController(),
  sleepImpl = defaultSleep,
  random = Math.random,
} = {}) {
  const managementBase = validateBaseUrl(baseUrl);
  const bearerToken = validateToken(token);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof commandHandler !== 'function') {
    throw new TypeError('commandHandler must be a function');
  }
  if (eventHandler !== null && typeof eventHandler !== 'function') {
    throw new TypeError('eventHandler must be a function or null');
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof abortControllerFactory !== 'function') {
    throw new TypeError('abortControllerFactory must be a function');
  }
  if (typeof sleepImpl !== 'function') throw new TypeError('sleepImpl must be a function');
  if (typeof random !== 'function') throw new TypeError('random must be a function');
  const pollDelay = validateOption(pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 'pollIntervalMs');
  const backoffLimit = validateOption(maxBackoffMs, DEFAULT_MAX_BACKOFF_MS, 'maxBackoffMs');
  const requestTimeout = validateOption(
    requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    'requestTimeoutMs',
  );

  let cursor = null;
  let stopped = false;
  let running = false;
  let loopPromise = null;
  let loopController = null;
  let activeRun = null;
  let lastAuthenticationFailure = null;
  const activeControllers = new Set();
  const commandStates = new Map();

  function endpoint(route) {
    return new URL(route, managementBase).href;
  }

  function makeController() {
    const controller = abortControllerFactory();
    if (
      !controller ||
      typeof controller.abort !== 'function' ||
      !controller.signal ||
      typeof controller.signal.addEventListener !== 'function'
    ) {
      throw new TypeError('abortControllerFactory must return an AbortController');
    }
    return controller;
  }

  async function request(route, payload) {
    if (stopped) {
      return failure('WORKER_STOPPED', 'The worker has been stopped', { retryable: false });
    }
    let controller;
    try {
      controller = makeController();
    } catch (error) {
      return failure('WORKER_ABORT_CONTROLLER_INVALID', error.message, { retryable: false });
    }
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeout);
    timer.unref?.();
    activeControllers.add(controller);
    try {
      const response = await fetchImpl(endpoint(route), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${bearerToken}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(payload ?? {}),
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
      const status = Number(response?.status);
      const data = await responseBody(response);
      const code = bodyCode(data);
      if (status === 401 || status === 403 || isAuthenticationCode(code)) {
        return failure('WORKER_AUTHENTICATION_FAILED', 'Worker authentication was rejected', {
          authFailure: true,
          retryable: false,
          status,
          data,
        });
      }
      if (status >= 200 && status < 300) {
        return { ok: true, status, data };
      }
      if (status >= 500 || TRANSIENT_HTTP_STATUSES.has(status)) {
        return failure('WORKER_TRANSIENT_HTTP_ERROR', `Worker endpoint returned HTTP ${status}`, {
          retryable: true,
          status,
          data,
        });
      }
      return failure('WORKER_HTTP_ERROR', `Worker endpoint returned HTTP ${status}`, {
        retryable: false,
        status,
        data,
      });
    } catch (error) {
      if (stopped) {
        return failure('WORKER_STOPPED', 'The worker has been stopped', { retryable: false });
      }
      if (timedOut || error?.name === 'TimeoutError') {
        return failure('WORKER_REQUEST_TIMEOUT', 'Worker request timed out', {
          retryable: true,
        });
      }
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
        return failure('WORKER_REQUEST_ABORTED', 'Worker request was aborted', {
          retryable: true,
        });
      }
      return failure('WORKER_NETWORK_ERROR', 'Worker endpoint could not be reached', {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      activeControllers.delete(controller);
    }
  }

  async function connect() {
    return request(WORKER_ROUTES.connect, {});
  }

  async function sync({ cursor: requestedCursor, waitMs = pollDelay } = {}) {
    let selectedCursor;
    try {
      selectedCursor = requestedCursor === undefined ? cursor : validateCursor(requestedCursor);
      const selectedWait = Number.isSafeInteger(waitMs) ? waitMs : pollDelay;
      if (selectedWait < 0 || selectedWait > MAX_SYNC_WAIT_MS) {
        throw new WorkerValidationError(
          'SYNC_WAIT_INVALID',
          `waitMs must be between 0 and ${MAX_SYNC_WAIT_MS}`,
        );
      }
      const result = await request(WORKER_ROUTES.sync, {
        cursor: selectedCursor,
        waitMs: selectedWait,
      });
      if (!result.ok) return result;
      const commands = result.data.commands ?? [];
      const events = result.data.events ?? [];
      const pendingDecisions = result.data.pendingDecisions ?? [];
      if (!Array.isArray(commands) || !Array.isArray(events) || !Array.isArray(pendingDecisions)) {
        return failure(
          'WORKER_PROTOCOL_ERROR',
          'sync must return commands, events and pendingDecisions arrays',
          {
            retryable: false,
          },
        );
      }
      const nextCursor = Object.hasOwn(result.data, 'cursor')
        ? validateCursor(result.data.cursor)
        : selectedCursor;
      return { ...result, cursor: nextCursor, commands, events, pendingDecisions };
    } catch (error) {
      return failure(error.code || 'SYNC_INVALID', error.message, { retryable: false });
    }
  }

  async function claim() {
    return request(WORKER_ROUTES.claim, {});
  }

  async function heartbeat(payload = {}) {
    try {
      return await request(WORKER_ROUTES.heartbeat, boundedJson(payload, 64 * 1024));
    } catch (error) {
      return failure(error.code || 'HEARTBEAT_INVALID', error.message, { retryable: false });
    }
  }

  async function reportEvents(events) {
    if (!Array.isArray(events)) {
      return failure('EVENTS_INVALID', 'events must be an array', { retryable: false });
    }
    const normalized = [];
    try {
      for (const event of events) {
        const cloned = boundedJson(event, MAX_EVENT_BATCH_BYTES);
        if (typeof cloned.type !== 'string' || !cloned.type) {
          throw new WorkerValidationError('EVENTS_INVALID', 'Every event must have a type');
        }
        normalized.push({
          ...cloned,
          eventId:
            typeof cloned.eventId === 'string' && cloned.eventId
              ? cloned.eventId
              : `event:${randomUUID()}`,
        });
      }
    } catch (error) {
      return failure(error.code || 'EVENTS_INVALID', error.message, { retryable: false });
    }
    const chunks = [];
    let chunk = [];
    let chunkBytes = 2;
    for (const event of normalized) {
      const eventBytes = Buffer.byteLength(JSON.stringify(event)) + 1;
      if (eventBytes > MAX_EVENT_BATCH_BYTES) {
        return failure('EVENTS_INVALID', 'An event exceeds the upload size limit', {
          retryable: false,
        });
      }
      if (
        chunk.length > 0 &&
        (chunk.length >= MAX_EVENT_BATCH_COUNT || chunkBytes + eventBytes > MAX_EVENT_BATCH_BYTES)
      ) {
        chunks.push(chunk);
        chunk = [];
        chunkBytes = 2;
      }
      chunk.push(event);
      chunkBytes += eventBytes;
    }
    if (chunk.length > 0) chunks.push(chunk);
    const receipts = [];
    for (const batch of chunks) {
      const result = await request(WORKER_ROUTES.events, { events: batch });
      if (!result.ok) return result;
      receipts.push({ status: result.status, count: batch.length });
    }
    return { ok: true, receipts, count: normalized.length };
  }

  async function ackCommand(commandId) {
    if (typeof commandId !== 'string' || !commandId.trim() || commandId.length > 256) {
      return failure('COMMAND_ID_INVALID', 'commandId is required', { retryable: false });
    }
    return request(WORKER_ROUTES.ack, { commandId });
  }

  async function release(payload = {}) {
    try {
      return await request(WORKER_ROUTES.release, boundedJson(payload, 64 * 1024));
    } catch (error) {
      return failure(error.code || 'RELEASE_INVALID', error.message, { retryable: false });
    }
  }

  async function emitLifecycle(event) {
    if (!eventHandler) return;
    try {
      await eventHandler(event);
    } catch {
      // Local observers must not turn an authentication or connectivity fact into a retry loop.
    }
  }

  async function handleIncomingEvent(raw) {
    if (!eventHandler) return;
    let event;
    try {
      event = cloneJson(raw, { maxBytes: MAX_EVENT_BATCH_BYTES });
    } catch {
      throw new WorkerValidationError('WORKER_EVENT_INVALID', 'Server event is invalid');
    }
    await eventHandler(Object.freeze(event));
  }

  async function resumeCommandState(state) {
    if (state.phase === 'running') {
      return { ok: true, skipped: 1, processed: 0 };
    }
    if (state.phase === 'succeeded' && state.acked) {
      return { ok: true, skipped: 1, processed: 0 };
    }
    const reported = await reportEvents(state.events || []);
    if (!reported.ok) return reported;
    if (state.phase === 'succeeded' && !state.acked) {
      const acked = await ackCommand(state.commandId);
      if (!acked.ok) return acked;
      state.acked = true;
    }
    return { ok: true, skipped: 1, processed: 0 };
  }

  async function processCommand(raw) {
    const commandId = commandIdFrom(raw);
    if (commandId && commandStates.has(commandId)) {
      return resumeCommandState(commandStates.get(commandId));
    }
    let command;
    try {
      command = validateCommand(raw);
    } catch (error) {
      const rejected = resultEvent({
        commandId,
        ok: false,
        code: error.code || 'COMMAND_REJECTED',
        message: sanitizedError(error, bearerToken),
      });
      if (commandId) {
        commandStates.set(commandId, {
          commandId,
          phase: 'rejected',
          events: [rejected],
          acked: false,
        });
      }
      const reported = await reportEvents([rejected]);
      if (!reported.ok) return reported;
      return { ok: true, rejected: 1, processed: 0, skipped: 0 };
    }

    const state = {
      commandId: command.commandId,
      phase: 'running',
      events: [],
      acked: false,
    };
    commandStates.set(command.commandId, state);
    let result;
    try {
      result = await commandHandler(command);
    } catch (error) {
      state.phase = 'failed';
      state.events = [
        resultEvent({
          commandId: command.commandId,
          ok: false,
          code: error?.code || 'COMMAND_HANDLER_FAILED',
          message: sanitizedError(error, bearerToken),
        }),
      ];
      const reported = await reportEvents(state.events);
      if (!reported.ok) return reported;
      return { ok: true, failed: 1, processed: 1, skipped: 0 };
    }
    if (isPlainObject(result) && result.ok === false) {
      state.phase = 'failed';
      state.events = [
        resultEvent({
          commandId: command.commandId,
          ok: false,
          code: String(result.code || 'COMMAND_HANDLER_FAILED').slice(0, 128),
          message: sanitizedError(
            result.message || 'Command handler rejected the command',
            bearerToken,
          ),
        }),
      ];
      const reported = await reportEvents(state.events);
      if (!reported.ok) return reported;
      return { ok: true, failed: 1, processed: 1, skipped: 0 };
    }

    state.phase = 'succeeded';
    state.events = [
      resultEvent({
        commandId: command.commandId,
        ok: true,
        result: sanitizeResult(result, bearerToken),
      }),
    ];
    const reported = await reportEvents(state.events);
    if (!reported.ok) return reported;
    const acked = await ackCommand(command.commandId);
    if (!acked.ok) return acked;
    state.acked = true;
    return { ok: true, acknowledged: 1, processed: 1, skipped: 0 };
  }

  async function executeRunOnce() {
    if (stopped) {
      return failure('WORKER_STOPPED', 'The worker has been stopped', { retryable: false });
    }
    const connected = await connect();
    if (!connected.ok) return connected;
    if (cursor === null && Object.hasOwn(connected.data, 'cursor')) {
      try {
        cursor = validateCursor(connected.data.cursor);
      } catch (error) {
        return failure(error.code || 'WORKER_PROTOCOL_ERROR', error.message, {
          retryable: false,
        });
      }
    }
    const synced = await sync({ cursor, waitMs: 0 });
    if (!synced.ok) return synced;
    for (const event of synced.events) {
      try {
        await handleIncomingEvent(event);
      } catch (error) {
        return failure(error.code || 'WORKER_EVENT_HANDLER_FAILED', error.message, {
          retryable: false,
        });
      }
    }

    const summary = {
      processed: 0,
      acknowledged: 0,
      failed: 0,
      rejected: 0,
      skipped: 0,
    };
    for (const command of synced.commands) {
      const result = await processCommand(command);
      if (!result.ok) return result;
      for (const key of Object.keys(summary)) summary[key] += result[key] || 0;
    }
    cursor = synced.cursor;
    return {
      ok: true,
      cursor,
      pendingDecisions: synced.pendingDecisions,
      ...summary,
    };
  }

  function runOnce() {
    if (stopped) {
      return Promise.resolve(
        failure('WORKER_STOPPED', 'The worker has been stopped', { retryable: false }),
      );
    }
    if (activeRun) return activeRun;
    activeRun = executeRunOnce().finally(() => {
      activeRun = null;
    });
    return activeRun;
  }

  function backoffDelay(attempt) {
    const ceiling = Math.min(backoffLimit, pollDelay * 2 ** Math.min(attempt, 30));
    const jitter = 0.5 + Math.min(1, Math.max(0, Number(random()) || 0)) * 0.5;
    return Math.max(1, Math.round(ceiling * jitter));
  }

  async function runLoop(controller) {
    let attempt = 0;
    let outcome = { ok: true, stopped: false };
    while (!stopped) {
      const result = await runOnce();
      if (stopped) {
        outcome = { ok: true, stopped: true };
        break;
      }
      if (result.ok) {
        attempt = 0;
        try {
          await sleepImpl(pollDelay, { signal: controller.signal });
        } catch {
          if (!stopped) {
            await emitLifecycle({
              type: 'worker.transport_error',
              code: 'WORKER_POLL_WAIT_FAILED',
              message: 'Worker poll wait failed',
              at: new Date(clock()).toISOString(),
            });
          }
        }
        continue;
      }
      if (result.authFailure) {
        lastAuthenticationFailure = result;
        stopped = true;
        controller.abort();
        await emitLifecycle({
          type: 'worker.authentication_failure',
          code: 'WORKER_AUTHENTICATION_FAILED',
          message: result.message,
          status: result.status ?? null,
          at: new Date(clock()).toISOString(),
        });
        outcome = {
          ok: false,
          code: 'WORKER_AUTHENTICATION_FAILED',
          message: result.message,
          authFailure: true,
        };
        break;
      }
      if (result.retryable) {
        const delay = backoffDelay(attempt);
        attempt += 1;
        await emitLifecycle({
          type: 'worker.transport_error',
          code: result.code,
          message: result.message,
          attempt,
          retryInMs: delay,
          at: new Date(clock()).toISOString(),
        });
        try {
          await sleepImpl(delay, { signal: controller.signal });
        } catch {
          if (!stopped) {
            await emitLifecycle({
              type: 'worker.transport_error',
              code: 'WORKER_BACKOFF_FAILED',
              message: 'Worker backoff wait failed',
              at: new Date(clock()).toISOString(),
            });
          }
        }
        continue;
      }
      stopped = true;
      controller.abort();
      await emitLifecycle({
        type: 'worker.protocol_failure',
        code: result.code,
        message: result.message,
        at: new Date(clock()).toISOString(),
      });
      outcome = { ok: false, code: result.code, message: result.message };
      break;
    }
    return outcome;
  }

  function start() {
    if (stopped) {
      return failure('WORKER_STOPPED', 'The worker has been stopped', { retryable: false });
    }
    if (loopPromise) {
      return { ok: true, alreadyRunning: true, running: true, done: loopPromise };
    }
    let controller;
    try {
      controller = makeController();
    } catch (error) {
      return failure('WORKER_ABORT_CONTROLLER_INVALID', error.message, { retryable: false });
    }
    running = true;
    loopController = controller;
    loopPromise = runLoop(controller)
      .catch((error) =>
        failure('WORKER_LOOP_FAILED', sanitizedError(error, bearerToken), { retryable: false }),
      )
      .finally(() => {
        running = false;
        loopPromise = null;
        loopController = null;
      });
    return { ok: true, running: true, done: loopPromise };
  }

  async function stop() {
    if (!stopped) stopped = true;
    loopController?.abort();
    for (const controller of activeControllers) controller.abort();
    const pending = loopPromise || activeRun;
    if (pending) {
      try {
        await pending;
      } catch {
        // stop is an idempotent cleanup boundary; loop failures stay on their result.
      }
    }
    return { ok: true, stopped: true };
  }

  return Object.freeze({
    connect,
    sync,
    claim,
    heartbeat,
    reportEvents,
    ackCommand,
    release,
    runOnce,
    start,
    stop,
    routes: WORKER_ROUTES,
    commandKinds: WORKER_COMMAND_KINDS,
    status: () => ({
      running,
      stopped,
      cursor,
      authenticationFailure: lastAuthenticationFailure,
    }),
  });
}
