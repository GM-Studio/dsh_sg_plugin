import { sanitizeSseText } from './sse-hub.js';

const DEFAULT_RECONNECT_HINT_MS = 15_000;
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_MAX_PAGE_SIZE = 100;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ROLES = new Set(['owner', 'approver', 'viewer', 'customer_acceptor']);
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
const HUMAN_ATTENTION_STATUSES = new Set(['OPEN', 'DELIVERED', 'REMINDED', 'ESCALATED', 'EXPIRED']);
const HUMAN_WORK_STATES = new Set(['WAITING_FOR_USER', 'BLOCKED', 'FAILED', 'PAUSED']);
const ATTENTION_TYPES = new Set([
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
export const INBOX_RISKS = Object.freeze({
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
});

export const INBOX_RISK_RANK = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
});

const ROLE_ACTIONS = Object.freeze({
  owner: [...DECISION_ACTIONS],
  approver: ['approve', 'request_changes', 'answer'],
  viewer: [],
  customer_acceptor: ['accept_delivery', 'request_changes'],
});
const RISK_ALIASES = new Map([
  ['critical', 'critical'],
  ['highest', 'critical'],
  ['high', 'high'],
  ['medium', 'medium'],
  ['normal', 'medium'],
  ['low', 'low'],
]);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const timeValue = (value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const isoTime = (value) => {
  const parsed = timeValue(value);
  return parsed === null ? null : new Date(parsed).toISOString();
};
const currentTime = (clock) => {
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

function collection(value, key) {
  if (Array.isArray(value)) return value.filter(isObject).map(clone);
  if (!isObject(value)) return [];
  return Array.isArray(value[key]) ? value[key].filter(isObject).map(clone) : [];
}

function sourceVersion(value, entries) {
  let version = 0;
  if (isObject(value)) {
    for (const candidate of [value.version, value.stateVersion]) {
      if (Number.isSafeInteger(candidate) && candidate >= 0) version = Math.max(version, candidate);
    }
  }
  for (const entry of entries) {
    for (const candidate of [entry.version, entry.revision]) {
      if (Number.isSafeInteger(candidate) && candidate >= 0) version = Math.max(version, candidate);
    }
  }
  return version;
}

async function readCollection(projection, methodName, key) {
  const method = projection?.[methodName];
  if (typeof method !== 'function') return { entries: [], version: 0 };
  try {
    const value = await method.call(projection);
    const entries = collection(value, key);
    return { entries, version: sourceVersion(value, entries), ok: value?.ok !== false };
  } catch {
    return { entries: [], version: 0, ok: false };
  }
}

async function readNotifications(projection, fallback) {
  const projected = await readCollection(projection, 'listNotifications', 'notifications');
  if (projected.entries.length > 0 || projected.ok) return projected;
  if (fallback === undefined || fallback === null) return projected;
  try {
    const value = typeof fallback === 'function' ? await fallback() : fallback;
    const entries = collection(value, 'notifications');
    return { entries, version: sourceVersion(value, entries), ok: true };
  } catch {
    return { entries: [], version: 0, ok: false };
  }
}

function normalUpper(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function failedNotificationIndex(notifications) {
  const attentionIds = new Set();
  const workItemIds = new Set();
  for (const notification of notifications) {
    if (normalUpper(notification.status) !== 'FAILED') continue;
    if (typeof notification.attentionId === 'string' && SAFE_ID.test(notification.attentionId)) {
      attentionIds.add(notification.attentionId);
    }
    if (typeof notification.workItemId === 'string' && SAFE_ID.test(notification.workItemId)) {
      workItemIds.add(notification.workItemId);
    }
  }
  return { attentionIds, workItemIds };
}

function riskFor({ attention, workItem, expired, notificationFailure }) {
  const type = normalUpper(attention?.type);
  const executionState = normalUpper(workItem?.executionState);
  let rank = INBOX_RISK_RANK.low;
  if (['H1_APPROVAL', 'H3_APPROVAL', 'CUSTOMER_ACCEPTANCE'].includes(type)) {
    rank = INBOX_RISK_RANK.critical;
  } else if (
    ['BLOCKED', 'FAILED'].includes(type) ||
    ['BLOCKED', 'FAILED'].includes(executionState)
  ) {
    rank = INBOX_RISK_RANK.high;
  } else if (['BUDGET', 'OFFLINE'].includes(type) || notificationFailure || expired) {
    rank = INBOX_RISK_RANK.medium;
  }
  return Object.keys(INBOX_RISK_RANK).find((risk) => INBOX_RISK_RANK[risk] === rank);
}

function trimActions(actions, access) {
  if (!access.actions) return [];
  const seen = new Set();
  const output = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    if (
      typeof action !== 'string' ||
      !DECISION_ACTIONS.has(action) ||
      !access.actions.has(action) ||
      seen.has(action)
    ) {
      continue;
    }
    seen.add(action);
    output.push(action);
  }
  return output;
}

function defaultWorkActions(state) {
  if (state === 'PAUSED') return ['resume', 'cancel'];
  if (state === 'WAITING_FOR_USER') return ['answer', 'request_changes', 'cancel'];
  if (['BLOCKED', 'FAILED'].includes(state)) return ['retry', 'request_changes', 'cancel'];
  return [];
}

function titleAndSummary({ attention, workItem }) {
  const fallbackTitle = attention ? 'Human decision required' : 'WorkItem needs attention';
  const fallbackSummary = attention
    ? 'An Attention request requires review in the management console.'
    : 'A WorkItem requires human action.';
  const title = sanitizeSseText(attention?.title ?? workItem?.title, 200);
  const summary = sanitizeSseText(attention?.summary ?? workItem?.title, 500);
  return {
    title: title.ok ? title.value : fallbackTitle,
    summary: summary.ok ? summary.value : fallbackSummary,
  };
}

function roleAccess(options = {}) {
  const actor = isObject(options.actor)
    ? options.actor
    : isObject(options.viewer)
      ? options.viewer
      : {};
  const role = actor.role ?? options.role ?? 'owner';
  if (!SAFE_ROLES.has(role)) return { denied: true, projects: new Set(), actions: new Set() };
  const suppliedProjects = options.allowedProjects ?? actor.allowedProjects;
  const suppliedTools = options.tools ?? actor.tools;
  const roleProjects =
    role === 'owner' && suppliedProjects === undefined ? null : safeSet(suppliedProjects);
  const requestedProjects = options.projectIds === undefined ? null : safeSet(options.projectIds);
  let projects = roleProjects;
  if (requestedProjects !== null) {
    if (projects === null) projects = requestedProjects;
    else projects = new Set([...projects].filter((projectId) => requestedProjects.has(projectId)));
  }
  let actions = new Set(ROLE_ACTIONS[role]);
  if (suppliedTools !== undefined) {
    const tools = safeSet(suppliedTools);
    actions = new Set([...actions].filter((action) => tools.has(action)));
  }
  return { denied: false, projects, actions };
}

function visibleProject(access, projectId) {
  return !access.denied && (access.projects === null || access.projects.has(projectId));
}

function buildItems({ attentionEntries, workItems, notifications, now, access }) {
  const failed = failedNotificationIndex(notifications);
  const workItemsById = new Map(
    workItems
      .filter(
        (item) =>
          typeof item.workItemId === 'string' &&
          SAFE_ID.test(item.workItemId) &&
          typeof item.projectId === 'string' &&
          SAFE_ID.test(item.projectId),
      )
      .map((item) => [item.workItemId, item]),
  );
  const items = [];
  const claimedWorkItems = new Set();
  const attentionIds = new Set();
  const emittedWorkItems = new Set();

  for (const attention of attentionEntries) {
    const attentionId = attention.requestId;
    const workItemId = attention.workItemId;
    if (
      typeof attentionId !== 'string' ||
      !SAFE_ID.test(attentionId) ||
      attentionIds.has(attentionId) ||
      typeof workItemId !== 'string' ||
      !SAFE_ID.test(workItemId) ||
      !HUMAN_ATTENTION_STATUSES.has(normalUpper(attention.status))
    ) {
      continue;
    }
    const workItem = workItemsById.get(workItemId);
    if (workItem && attention.projectId && attention.projectId !== workItem.projectId) {
      continue;
    }
    const projectId = workItem?.projectId ?? attention.projectId;
    if (
      typeof projectId !== 'string' ||
      !SAFE_ID.test(projectId) ||
      !visibleProject(access, projectId)
    ) {
      continue;
    }
    attentionIds.add(attentionId);
    claimedWorkItems.add(workItemId);
    const notificationFailure =
      failed.attentionIds.has(attentionId) || failed.workItemIds.has(workItemId);
    const status = normalUpper(attention.status);
    const expiresAtMs = timeValue(attention.expiresAt);
    const expired = status === 'EXPIRED' || (expiresAtMs !== null && expiresAtMs <= now);
    const type = ATTENTION_TYPES.has(normalUpper(attention.type))
      ? normalUpper(attention.type)
      : 'CLARIFICATION';
    const blocked =
      ['BLOCKED', 'FAILED'].includes(type) ||
      ['BLOCKED', 'FAILED'].includes(normalUpper(workItem?.executionState));
    const blockedSince = blocked
      ? (isoTime(attention.blockedAt) ??
        isoTime(workItem?.blockedAt) ??
        isoTime(workItem?.updatedAt) ??
        isoTime(attention.createdAt))
      : null;
    const waitingSince =
      isoTime(attention.createdAt) ?? isoTime(workItem?.createdAt) ?? isoTime(attention.updatedAt);
    const waitingAt = timeValue(waitingSince);
    const text = titleAndSummary({ attention, workItem });
    const risk = riskFor({ attention, workItem, expired, notificationFailure });
    items.push({
      id: `attention:${attentionId}`,
      kind: 'attention',
      type,
      status,
      projectId,
      attentionId,
      workItemId,
      attentionRevision: Number.isSafeInteger(attention.revision) ? attention.revision : null,
      workItemVersion: Number.isSafeInteger(attention.workItemVersion)
        ? attention.workItemVersion
        : null,
      artifactHash:
        typeof attention.artifactHash === 'string' && /^[a-f0-9]{64}$/i.test(attention.artifactHash)
          ? attention.artifactHash
          : null,
      title: text.title,
      summary: text.summary,
      actions: trimActions(attention.actions, access),
      risk,
      riskRank: INBOX_RISK_RANK[risk],
      waitingSince,
      waitingMs: waitingAt === null ? 0 : Math.max(0, now - waitingAt),
      expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
      expiresInMs: expiresAtMs === null ? null : expiresAtMs - now,
      expired,
      notificationFailure,
      blockedSince,
      createdAt: isoTime(attention.createdAt),
      updatedAt: isoTime(attention.updatedAt),
    });
  }

  for (const workItem of workItems) {
    const workItemId = workItem.workItemId;
    const projectId = workItem.projectId;
    const state = normalUpper(workItem.executionState);
    if (
      typeof workItemId !== 'string' ||
      !SAFE_ID.test(workItemId) ||
      claimedWorkItems.has(workItemId) ||
      emittedWorkItems.has(workItemId) ||
      typeof projectId !== 'string' ||
      !SAFE_ID.test(projectId) ||
      !visibleProject(access, projectId) ||
      !HUMAN_WORK_STATES.has(state)
    ) {
      continue;
    }
    const blocked = ['BLOCKED', 'FAILED'].includes(state);
    const notificationFailure = failed.workItemIds.has(workItemId);
    const blockedSince = blocked
      ? (isoTime(workItem.blockedAt) ?? isoTime(workItem.updatedAt) ?? isoTime(workItem.createdAt))
      : null;
    const waitingSince = isoTime(workItem.createdAt) ?? isoTime(workItem.updatedAt);
    const waitingAt = timeValue(waitingSince);
    const text = titleAndSummary({ workItem });
    const risk = riskFor({
      workItem,
      expired: false,
      notificationFailure,
    });
    emittedWorkItems.add(workItemId);
    items.push({
      id: `work_item:${workItemId}`,
      kind: 'work_item',
      type: state,
      status: state,
      projectId,
      attentionId: null,
      workItemId,
      title: text.title,
      summary: text.summary,
      actions: trimActions(defaultWorkActions(state), access),
      risk,
      riskRank: INBOX_RISK_RANK[risk],
      waitingSince,
      waitingMs: waitingAt === null ? 0 : Math.max(0, now - waitingAt),
      expiresAt: null,
      expiresInMs: null,
      expired: false,
      notificationFailure,
      blockedSince,
      createdAt: isoTime(workItem.createdAt),
      updatedAt: isoTime(workItem.updatedAt),
    });
  }

  return items;
}

function urgencyRank(item) {
  if (item.expired) return 0;
  if (item.expiresInMs !== null && item.expiresInMs <= 24 * 60 * 60 * 1000) return 1;
  if (item.blockedSince) return 2;
  return 3;
}

function compareInboxItems(left, right) {
  const risk = left.riskRank - right.riskRank;
  if (risk !== 0) return risk;
  const urgency = urgencyRank(left) - urgencyRank(right);
  if (urgency !== 0) return urgency;
  const leftExpires = timeValue(left.expiresAt);
  const rightExpires = timeValue(right.expiresAt);
  if (leftExpires !== null || rightExpires !== null) {
    const expiry =
      (leftExpires ?? Number.MAX_SAFE_INTEGER) - (rightExpires ?? Number.MAX_SAFE_INTEGER);
    if (expiry !== 0) return expiry;
  }
  const leftBlocked = timeValue(left.blockedSince);
  const rightBlocked = timeValue(right.blockedSince);
  if (leftBlocked !== null || rightBlocked !== null) {
    const blocked =
      (leftBlocked ?? Number.MAX_SAFE_INTEGER) - (rightBlocked ?? Number.MAX_SAFE_INTEGER);
    if (blocked !== 0) return blocked;
  }
  const leftCreated = timeValue(left.createdAt) ?? Number.MAX_SAFE_INTEGER;
  const rightCreated = timeValue(right.createdAt) ?? Number.MAX_SAFE_INTEGER;
  return leftCreated - rightCreated || left.id.localeCompare(right.id);
}

function filterSet(value, normalizer) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const normalized = normalizer(value);
    return new Set(normalized ? [normalized] : []);
  }
  if (!Array.isArray(value) && !(value instanceof Set)) return new Set();
  return new Set([...value].map(normalizer).filter(Boolean));
}

function cursorFor(offset, version) {
  return Buffer.from(JSON.stringify({ o: offset, v: version }), 'utf8').toString('base64url');
}

function offsetFor(cursor, version) {
  if (cursor === undefined || cursor === null || cursor === '') return { ok: true, offset: 0 };
  if (typeof cursor !== 'string' || cursor.length > 512) {
    return { ok: false, code: 'INBOX_CURSOR_INVALID' };
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !isObject(decoded) ||
      !Number.isSafeInteger(decoded.o) ||
      decoded.o < 0 ||
      !Number.isSafeInteger(decoded.v) ||
      decoded.v < 0
    ) {
      return { ok: false, code: 'INBOX_CURSOR_INVALID' };
    }
    return decoded.v === version
      ? { ok: true, offset: decoded.o, reset: false }
      : { ok: true, offset: 0, reset: true };
  } catch {
    return { ok: false, code: 'INBOX_CURSOR_INVALID' };
  }
}

/**
 * Read-only multi-project exception inbox. The projection remains the source
 * of truth; this module only narrows and presents already-structured metadata.
 */
export function createExceptionInbox({
  projection = {},
  notifications = () => [],
  clock = Date.now,
  reconnectHintMs = DEFAULT_RECONNECT_HINT_MS,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPageSize = DEFAULT_MAX_PAGE_SIZE,
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const pollHint = boundedInteger(reconnectHintMs, DEFAULT_RECONNECT_HINT_MS, 100, 300_000);
  const pageLimit = boundedInteger(maxPageSize, DEFAULT_MAX_PAGE_SIZE, 1, 1000);
  const defaultLimit = boundedInteger(pageSize, DEFAULT_PAGE_SIZE, 1, pageLimit);
  let version = 0;
  let previousSignature = null;

  function observe(items, observedVersion) {
    const stable = items.map(({ waitingMs, expiresInMs, expired, riskRank, ...entry }) => entry);
    const signature = JSON.stringify(stable);
    const changed =
      previousSignature === null || signature !== previousSignature || observedVersion > version;
    if (previousSignature === null) version = Math.max(1, observedVersion);
    else if (signature !== previousSignature) version = Math.max(version + 1, observedVersion);
    else if (observedVersion > version) version = observedVersion;
    previousSignature = signature;
    return changed;
  }

  async function materialize() {
    const [attentionFeed, workFeed, notificationFeed] = await Promise.all([
      readCollection(projection, 'listAttention', 'attention'),
      readCollection(projection, 'listWorkItems', 'workItems'),
      readNotifications(projection, notifications),
    ]);
    const now = currentTime(clock);
    const access = roleAccess({});
    const items = buildItems({
      attentionEntries: attentionFeed.entries,
      workItems: workFeed.entries,
      notifications: notificationFeed.entries,
      now,
      access,
    }).sort(compareInboxItems);
    const observedVersion = Math.max(
      attentionFeed.version,
      workFeed.version,
      notificationFeed.version,
    );
    return { items, changed: observe(items, observedVersion) };
  }

  function narrow(items, options) {
    const access = roleAccess(options);
    if (access.denied) return [];
    const risks = filterSet(options.risk, (value) => RISK_ALIASES.get(String(value).toLowerCase()));
    const statuses = filterSet(options.status, (value) =>
      typeof value === 'string' ? value.trim().toUpperCase() : '',
    );
    return items
      .filter((item) => visibleProject(access, item.projectId))
      .filter((item) => risks === null || risks.has(item.risk))
      .filter((item) => statuses === null || statuses.has(item.status))
      .map((item) => ({ ...item, actions: trimActions(item.actions, access) }));
  }

  async function list(options = {}) {
    const query = isObject(options) ? options : {};
    const feed = await materialize();
    const filtered = narrow(feed.items, query);
    const sinceVersion = query.sinceVersion === undefined ? undefined : Number(query.sinceVersion);
    if (sinceVersion !== undefined && (!Number.isSafeInteger(sinceVersion) || sinceVersion < 0)) {
      return {
        ok: false,
        code: 'INBOX_CURSOR_INVALID',
        message: 'sinceVersion must be a non-negative integer',
      };
    }
    const cursor = offsetFor(query.cursor, version);
    if (!cursor.ok) return cursor;
    const limit = boundedInteger(Number(query.limit), defaultLimit, 1, pageLimit);
    const unchanged = sinceVersion !== undefined && sinceVersion === version && !feed.changed;
    const reset = Boolean(cursor.reset) || (sinceVersion !== undefined && sinceVersion > version);
    const visible = unchanged && !reset ? [] : filtered.slice(cursor.offset, cursor.offset + limit);
    const offset = cursor.offset + visible.length;
    return {
      ok: true,
      items: visible,
      version,
      changed: sinceVersion === undefined ? true : version > sinceVersion || reset,
      sinceVersion: sinceVersion ?? null,
      reset,
      total: filtered.length,
      nextCursor:
        visible.length > 0 && offset < filtered.length ? cursorFor(offset, version) : null,
      reconnectHintMs: pollHint,
    };
  }

  async function get(itemId, options = {}) {
    if (typeof itemId !== 'string' || itemId.length > 300) {
      return { ok: false, code: 'INBOX_ITEM_NOT_FOUND', message: 'Inbox item was not found' };
    }
    const query = isObject(options) ? options : {};
    const feed = await materialize();
    const item = narrow(feed.items, query).find((entry) => entry.id === itemId);
    return item
      ? { ok: true, item, version, reconnectHintMs: pollHint }
      : { ok: false, code: 'INBOX_ITEM_NOT_FOUND', message: 'Inbox item was not found' };
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
    return {
      ok: true,
      version,
      changed: sinceVersion === undefined || sinceVersion < version,
      reset: sinceVersion !== undefined && sinceVersion > version,
      reconnectHintMs: pollHint,
    };
  }

  return Object.freeze({
    list,
    query: list,
    get,
    poll,
    reconnectHintMs: pollHint,
    get version() {
      return version;
    },
  });
}
