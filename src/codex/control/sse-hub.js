const DEFAULT_RECONNECT_HINT_MS = 15_000;
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_MAX_CLIENTS = 100;
const DEFAULT_MAX_EVENTS_PER_CLIENT = 100;
const DEFAULT_EVENT_LIMIT = 1_000;
const MAX_SUMMARY_LENGTH = 500;

const EVENT_KEYS = new Set(['id', 'eventId', 'type', 'projectId', 'version', 'summary']);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_EVENT_TYPE = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ROLES = new Set(['owner', 'approver', 'viewer', 'customer_acceptor']);
const SENSITIVE_TEXT = [
  /(?:password|passwd|secret|token|cookie|authorization|api[_-]?key|private[_-]?key|ssh[_-]?key|db[_-]?password)\s*[:=]/i,
  /\b(?:sg[tw]_|gh[pousr]_|sk-|xox[baprs]-|AKIA)[A-Za-z0-9_.:/+=-]{6,}\b/,
  /(?:^|[\s("'`])(?:[A-Za-z]:[\\/]|\\\\[^\\/\s]+[\\/][^\\/\s]+|\/(?:Users|home|root|var|etc|tmp|opt|srv|mnt|workspace|private)\/)/i,
  /file:\/\//i,
  /(?:BEGIN\s+(?:LOG|OUTPUT)|stdout\s*:|stderr\s*:|traceback\s*\(most recent call last\)|stack\s+trace|\bat\s+\S+\s*\([^)]*:\d+:\d+\))/i,
  /(?:chain[- ]of[- ]thought|internal\s+reasoning|reasoning\s*:|思维链|推理过程|私下思考)/i,
  /(?:(?:customer|client)[ _-]?name|客户名称|客户名)\s*[:=]/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:diff\s+--git|^@@\s|^---\s+[ab]\/|^\+\+\+\s+[ab]\/|raw[_-]?diff\s*:|full[_-]?diff\s*:)/im,
];

const nowMs = (clock) => {
  const value = clock();
  const parsed =
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError('clock must return a valid timestamp');
  return parsed;
};

const boundedInteger = (value, fallback, minimum, maximum) =>
  Number.isSafeInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;

const safeSet = (values) => {
  if (!(values instanceof Set) && !Array.isArray(values)) return new Set();
  return new Set(
    [...values].filter((entry) => typeof entry === 'string' && SAFE_ID.test(entry)).slice(0, 1000),
  );
};

function clientScope(options = {}) {
  const actor =
    options.actor && typeof options.actor === 'object' && !Array.isArray(options.actor)
      ? options.actor
      : {};
  const role = actor.role ?? options.role;
  if (role !== undefined && !SAFE_ROLES.has(role)) return new Set();
  const supplied = options.projectIds ?? options.allowedProjects ?? actor.allowedProjects;
  if (role !== undefined && role !== 'owner' && supplied === undefined) return new Set();
  return supplied === undefined ? null : safeSet(supplied);
}

function allowsProject(scope, projectId) {
  return scope === null || scope.has(projectId);
}

function resetSignal(reason, reconnectHintMs, version) {
  return Object.freeze({
    reset: true,
    reason,
    reconnectHintMs,
    version,
  });
}

/**
 * Accepts a deliberately narrow text field. It fails closed for values that
 * look like credentials, local paths, raw logs, CoT, customer identity, email
 * addresses or diffs rather than trying to partially sanitize them.
 */
export function sanitizeSseText(value, maximum = MAX_SUMMARY_LENGTH) {
  if (typeof value !== 'string') return { ok: false, code: 'SSE_EVENT_REJECTED' };
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 4000) {
    return { ok: false, code: 'SSE_EVENT_REJECTED' };
  }
  if (/[\r\n]/.test(value) || value.length > maximum) {
    return { ok: false, code: 'SSE_EVENT_REJECTED' };
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || SENSITIVE_TEXT.some((pattern) => pattern.test(normalized))) {
    return { ok: false, code: 'SSE_EVENT_REJECTED' };
  }
  return { ok: true, value: normalized };
}

function sanitizeEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'SSE_EVENT_REJECTED' };
  }
  const keys = Object.keys(input);
  if (keys.some((key) => !EVENT_KEYS.has(key))) {
    return { ok: false, code: 'SSE_EVENT_REJECTED' };
  }
  if (input.id !== undefined && input.eventId !== undefined && input.id !== input.eventId) {
    return { ok: false, code: 'SSE_EVENT_REJECTED' };
  }
  const suppliedId = input.id ?? input.eventId;
  if (suppliedId !== undefined && (typeof suppliedId !== 'string' || !SAFE_ID.test(suppliedId))) {
    return { ok: false, code: 'SSE_EVENT_REJECTED' };
  }
  if (typeof input.type !== 'string' || !SAFE_EVENT_TYPE.test(input.type)) {
    return { ok: false, code: 'SSE_EVENT_REJECTED' };
  }
  if (typeof input.projectId !== 'string' || !SAFE_ID.test(input.projectId)) {
    return { ok: false, code: 'SSE_EVENT_REJECTED' };
  }
  if (input.version !== undefined && (!Number.isSafeInteger(input.version) || input.version < 0)) {
    return { ok: false, code: 'SSE_EVENT_REJECTED' };
  }
  const summary = sanitizeSseText(input.summary);
  if (!summary.ok) return summary;
  return {
    ok: true,
    value: {
      suppliedId,
      type: input.type,
      projectId: input.projectId,
      suppliedVersion: input.version,
      summary: summary.value,
    },
  };
}

/**
 * In-process SSE fan-out with bounded queues and an explicit reset signal.
 * HTTP response wiring, authentication middleware and rate limiting remain the
 * caller's responsibility; this module never exposes a state snapshot.
 */
export function createSseHub({
  clock = Date.now,
  maxClients = DEFAULT_MAX_CLIENTS,
  maxEventsPerClient = DEFAULT_MAX_EVENTS_PER_CLIENT,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  eventLimit = DEFAULT_EVENT_LIMIT,
  reconnectHintMs = DEFAULT_RECONNECT_HINT_MS,
  autoHeartbeat = true,
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const clientLimit = boundedInteger(maxClients, DEFAULT_MAX_CLIENTS, 1, 1000);
  const clientEventLimit = boundedInteger(
    maxEventsPerClient,
    DEFAULT_MAX_EVENTS_PER_CLIENT,
    1,
    1000,
  );
  const retainedEventLimit = boundedInteger(eventLimit, DEFAULT_EVENT_LIMIT, 1, 100_000);
  const heartbeatInterval = boundedInteger(heartbeatMs, DEFAULT_HEARTBEAT_MS, 100, 300_000);
  const pollHint = boundedInteger(reconnectHintMs, DEFAULT_RECONNECT_HINT_MS, 100, 300_000);

  const clients = new Map();
  const retained = [];
  const eventIds = new Set();
  let version = 0;
  let sequence = 0;
  let clientSequence = 0;
  let closed = false;

  function sendReset(client, reason) {
    const signal = resetSignal(reason, pollHint, version);
    client.reset = signal;
    client.queue.length = 0;
    if (typeof client.send !== 'function') return;
    try {
      client.send(signal);
    } catch {
      // The reset state remains available through drain/poll after a failed writer.
    }
  }

  function drainClient(client) {
    if (client.reset) {
      const reset = client.reset;
      client.reset = null;
      return { frames: [], reset: true, ...reset };
    }
    const frames = [];
    while (client.queue.length > 0 && typeof client.send === 'function') {
      const frame = client.queue[0];
      let accepted = false;
      try {
        accepted = client.send(frame) !== false;
      } catch {
        accepted = false;
      }
      if (!accepted) {
        client.queue.length = 0;
        sendReset(client, 'CLIENT_BACKPRESSURE');
        const reset = client.reset;
        client.reset = null;
        return { frames, reset: true, ...reset };
      }
      client.queue.shift();
      frames.push(frame);
      client.lastSeen = nowMs(clock);
    }
    if (typeof client.send !== 'function') {
      frames.push(...client.queue);
      client.queue.length = 0;
      client.lastSeen = nowMs(clock);
    }
    return { frames, reset: false };
  }

  function enqueue(client, frame) {
    if (!allowsProject(client.scope, frame.projectId)) return { filtered: true };
    if (client.reset) return { dropped: true };
    if (client.queue.length >= clientEventLimit) {
      sendReset(client, 'CLIENT_BACKPRESSURE');
      return { dropped: true };
    }
    client.queue.push(frame);
    if (typeof client.send !== 'function') return { delivered: true };
    const drained = drainClient(client);
    return drained.reset ? { dropped: true } : { delivered: true };
  }

  function replay(client, lastEventId) {
    if (lastEventId === undefined || lastEventId === null || lastEventId === '') return [];
    const index = retained.findIndex((frame) => frame.id === lastEventId);
    if (index === -1) {
      sendReset(client, 'REPLAY_UNAVAILABLE');
      return [];
    }
    const frames = retained
      .slice(index + 1)
      .filter((frame) => allowsProject(client.scope, frame.projectId));
    if (frames.length > clientEventLimit) {
      sendReset(client, 'REPLAY_BACKLOG');
      return [];
    }
    client.queue.push(...frames);
    if (typeof client.send === 'function') drainClient(client);
    return frames;
  }

  function publish(input) {
    if (closed) return { ok: false, code: 'SSE_HUB_CLOSED' };
    const checked = sanitizeEvent(input);
    if (!checked.ok) return { ok: false, code: checked.code };
    const event = checked.value;
    const suppliedId = event.suppliedId ?? `evt-${++sequence}`;
    if (eventIds.has(suppliedId)) return { ok: false, code: 'SSE_EVENT_REJECTED' };
    const nextVersion = Math.max(
      version + 1,
      Number.isSafeInteger(event.suppliedVersion) ? event.suppliedVersion : 0,
    );
    const frame = Object.freeze({
      id: suppliedId,
      type: event.type,
      projectId: event.projectId,
      version: nextVersion,
      summary: event.summary,
    });
    version = nextVersion;
    retained.push(frame);
    eventIds.add(frame.id);
    if (retained.length > retainedEventLimit) {
      const removed = retained.shift();
      eventIds.delete(removed.id);
    }
    let delivered = 0;
    let dropped = 0;
    let filtered = 0;
    for (const client of clients.values()) {
      const result = enqueue(client, frame);
      if (result.delivered) delivered += 1;
      if (result.dropped) dropped += 1;
      if (result.filtered) filtered += 1;
    }
    return { ok: true, frame, delivered, dropped, filtered };
  }

  function subscribe(options = {}, extra = {}) {
    if (closed) return { ok: false, code: 'SSE_HUB_CLOSED', reset: true };
    if (clients.size >= clientLimit) {
      return {
        ok: false,
        code: 'SSE_CLIENT_LIMIT',
        ...resetSignal('CLIENT_LIMIT', pollHint, version),
      };
    }
    const normalized =
      typeof options === 'string'
        ? { ...(extra && typeof extra === 'object' ? extra : {}), id: options }
        : typeof options === 'function'
          ? { send: options }
          : options && typeof options === 'object'
            ? options
            : {};
    const requestedId = normalized.id ?? normalized.clientId;
    const id =
      typeof requestedId === 'string' && SAFE_ID.test(requestedId)
        ? requestedId
        : `client-${++clientSequence}`;
    if (clients.has(id)) return { ok: false, code: 'SSE_CLIENT_EXISTS' };
    const sender =
      normalized.send ?? normalized.onEvent ?? normalized.onMessage ?? normalized.write;
    const send = typeof sender === 'function' ? sender : null;
    const client = {
      id,
      send,
      scope: clientScope(normalized),
      queue: [],
      reset: null,
      lastSeen: nowMs(clock),
    };
    clients.set(id, client);
    const lastEventId =
      normalized.lastEventId ?? normalized.lastEventID ?? normalized['Last-Event-ID'];
    const replayFrames = replay(client, lastEventId);
    const reset = client.reset;
    const handle = {
      id,
      ok: true,
      replay: replayFrames,
      reset: Boolean(reset),
      reason: reset?.reason ?? null,
      reconnectHintMs: pollHint,
      version,
      drain: () => drain(id),
      unsubscribe: () => unsubscribe(id),
    };
    return handle;
  }

  function unsubscribe(id) {
    const key = typeof id === 'string' ? id : id?.id;
    if (typeof key !== 'string' || !clients.has(key)) {
      return { ok: false, code: 'SSE_CLIENT_NOT_FOUND' };
    }
    clients.delete(key);
    return { ok: true };
  }

  function drain(id) {
    const key = typeof id === 'string' ? id : id?.id;
    const client = clients.get(key);
    if (!client) return { ok: false, code: 'SSE_CLIENT_NOT_FOUND' };
    const result = drainClient(client);
    return {
      ok: true,
      frames: result.frames,
      reset: result.reset,
      ...(result.reset ? { reason: result.reason } : {}),
      reconnectHintMs: pollHint,
      version,
    };
  }

  function poll({ sinceVersion } = {}) {
    if (sinceVersion !== undefined && (!Number.isSafeInteger(sinceVersion) || sinceVersion < 0)) {
      return {
        ok: true,
        version,
        changed: true,
        reset: true,
        reason: 'CURSOR_INVALID',
        reconnectHintMs: pollHint,
      };
    }
    const changed = sinceVersion === undefined || sinceVersion < version;
    return {
      ok: true,
      version,
      changed,
      reset: sinceVersion !== undefined && sinceVersion > version,
      reconnectHintMs: pollHint,
    };
  }

  function heartbeat() {
    const now = nowMs(clock);
    let cleaned = 0;
    let sent = 0;
    for (const [id, client] of clients) {
      if (now - client.lastSeen > heartbeatInterval * 2) {
        clients.delete(id);
        cleaned += 1;
        continue;
      }
      if (typeof client.send !== 'function') continue;
      try {
        if (client.send(': heartbeat\n\n') === false) {
          sendReset(client, 'HEARTBEAT_BACKPRESSURE');
        } else {
          client.lastSeen = now;
          sent += 1;
        }
      } catch {
        sendReset(client, 'HEARTBEAT_BACKPRESSURE');
      }
    }
    return { ok: true, cleaned, heartbeats: sent, version, reconnectHintMs: pollHint };
  }

  let timer = null;
  if (autoHeartbeat !== false) {
    timer = setInterval(heartbeat, heartbeatInterval);
    timer.unref?.();
  }

  function close() {
    if (closed) return { ok: true };
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    clients.clear();
    return { ok: true };
  }

  return Object.freeze({
    publish,
    emit: publish,
    subscribe,
    unsubscribe,
    drain,
    pull: drain,
    poll,
    heartbeat,
    close,
    reconnectHintMs: pollHint,
    get version() {
      return version;
    },
    get clientCount() {
      return clients.size;
    },
  });
}
