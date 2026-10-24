import { createHash } from 'node:crypto';
import { createFeishuNotifier, validateManagementUrl } from './feishu.js';

const failure = (code, message) => ({ ok: false, code, message });

export const CHANNEL_NAMES = Object.freeze(['feishu', 'dingtalk', 'webhook']);
export const MAX_CHANNEL_TIMEOUT_MS = 60_000;

const ROOT_KEYS = new Set([
  'workItem',
  'attention',
  'notification',
  'managementUrl',
  'dedupeKey',
  'notificationId',
  'deliveryId',
  'kind',
  'channel',
  'version',
]);
const WORK_ITEM_KEYS = new Set([
  'projectId',
  'workItemId',
  'workItemVersion',
  'projectName',
  'title',
  'status',
  'summary',
  'riskLevel',
  'artifactHash',
  'nextAction',
  'updatedAt',
]);
const ATTENTION_KEYS = new Set([
  'requestId',
  'attentionId',
  'attentionKey',
  'revision',
  'type',
  'status',
  'reason',
  'question',
  'actions',
  'summary',
  'risks',
  'evidence',
  'artifactHash',
  'workItemVersion',
  'expiresAt',
  'createdAt',
  'updatedAt',
  'decisionId',
  'decisionAction',
  'decidedAt',
  'expiredAt',
  'supersededBy',
]);
const NOTIFICATION_KEYS = new Set([
  'kind',
  'status',
  'stage',
  'outcome',
  'action',
  'summary',
  'nextAction',
  'attentionId',
  'workItemId',
  'decisionId',
  'artifactHash',
  'reminderNumber',
  'decidedAt',
  'expiredAt',
  'failedAt',
  'recoveredAt',
  'completedAt',
  'updatedAt',
]);
const EVIDENCE_KEYS = new Set(['kind', 'summary', 'artifactHash']);

const FORBIDDEN_FIELDS = new Set([
  'projectroot',
  'rootpath',
  'localpath',
  'absolutepath',
  'filepath',
  'workingdirectory',
  'cwd',
  'callback',
  'callbackurl',
  'webhook',
  'webhookurl',
  'token',
  'password',
  'passwd',
  'secret',
  'apikey',
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'rawlog',
  'rawlogs',
  'stdout',
  'stderr',
  'stack',
  'stacktrace',
  'diff',
  'patch',
  'sourcediff',
  'sourcecode',
  'chainofthought',
  'thought',
  'reasoning',
  'customer',
  'customername',
  'client',
  'clientname',
  'tenant',
  'tenantname',
  'companyname',
  'accountname',
  'email',
  'phone',
]);

const normalizedKey = (value) =>
  String(value)
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();

function forbiddenField(key) {
  return FORBIDDEN_FIELDS.has(normalizedKey(key));
}

function assertNoInjectedFields(value, scope = 'root') {
  if (value === null || typeof value !== 'object') return { ok: true };
  if (Array.isArray(value)) {
    for (const entry of value) {
      const checked = assertNoInjectedFields(entry, scope);
      if (!checked.ok) return checked;
    }
    return { ok: true };
  }
  for (const [key, entry] of Object.entries(value)) {
    const allowedServicePath = scope === 'workItem' && normalizedKey(key) === 'projectroot';
    if (!allowedServicePath && forbiddenField(key))
      return failure('NOTIFICATION_FORBIDDEN_FIELD', `Notification field is not allowed: ${key}`);
    const nextScope =
      scope === 'root' && ['workItem', 'attention', 'notification'].includes(key) ? key : scope;
    const checked = assertNoInjectedFields(entry, nextScope);
    if (!checked.ok) return checked;
  }
  return { ok: true };
}

export function validateChannelName(name) {
  return CHANNEL_NAMES.includes(name)
    ? { ok: true, name }
    : failure('CHANNEL_NAME_INVALID', 'Channel name must be feishu, dingtalk or webhook');
}

export function validateWebhookUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4096)
    return failure('CHANNEL_WEBHOOK_INVALID', 'A webhook URL is required');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname)
      return failure('CHANNEL_WEBHOOK_INVALID', 'A webhook URL must use HTTPS');
    if (url.username || url.password)
      return failure('CHANNEL_WEBHOOK_INVALID', 'A webhook URL must not embed credentials');
    return { ok: true, url: url.href };
  } catch {
    return failure('CHANNEL_WEBHOOK_INVALID', 'The webhook URL is invalid');
  }
}

function containsRawLogOrSource(value) {
  return (
    /(?:^|\n)diff --git\s/m.test(value) ||
    /(?:^|\n)@@(?:\s|$)/m.test(value) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value) ||
    /```/.test(value) ||
    /\b(?:raw\s*log|stack\s*trace|stdout|stderr)\s*:/i.test(value)
  );
}

export function redactNotificationText(value) {
  const cleaned = [...String(value ?? '')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join('');
  return cleaned
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi,
      '<redacted-key>',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}/gi, 'Bearer <redacted>')
    .replace(
      /\b(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[=:]\s*["']?[^\s,;"']{4,}/gi,
      '<redacted-credential>',
    )
    .replace(/https?:\/\/[^\s"'`，。；、<>]+/gi, '<url>')
    .replace(/\\\\[^\s"'`，。；、)]+/g, '<local-path>')
    .replace(/[A-Za-z]:[\\/][^\s"'`，。；、)]+/g, '<local-path>')
    .replace(/(^|[\s("'=:：，,])\/(?!\/)[^\s"'`，。；、)]+/g, '$1<local-path>')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi, '<redacted-email>')
    .slice(0, 4000);
}

function sanitizePrimitive(value, key, state) {
  state.nodes += 1;
  if (state.nodes > 1000)
    return failure('NOTIFICATION_TOO_LARGE', 'Notification payload is too large');
  if (value === null || typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number')
    return Number.isFinite(value)
      ? { ok: true, value }
      : failure('NOTIFICATION_INVALID', 'Notification contains a non-finite number');
  if (typeof value !== 'string')
    return failure('NOTIFICATION_INVALID', 'Notification contains an unsupported value');
  if (containsRawLogOrSource(value))
    return failure(
      'NOTIFICATION_FORBIDDEN_CONTENT',
      'Notification must not contain raw logs, source code or diffs',
    );
  if (key === 'managementUrl') {
    const checked = validateManagementUrl(value);
    return checked.ok ? { ok: true, value: checked.url } : checked;
  }
  return { ok: true, value: redactNotificationText(value) };
}

function sanitizeObject(value, schema, state, depth) {
  if (depth > 6)
    return failure('NOTIFICATION_TOO_DEEP', 'Notification payload is too deeply nested');
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (forbiddenField(key))
      return failure('NOTIFICATION_FORBIDDEN_FIELD', `Notification field is not allowed: ${key}`);
    if (!schema.has(key)) continue;
    const checked = sanitizeValue(entry, key, state, depth + 1);
    if (!checked.ok) return checked;
    output[key] = checked.value;
  }
  return { ok: true, value: output };
}

function sanitizeValue(value, key, state, depth) {
  if (Array.isArray(value)) {
    state.nodes += 1;
    if (state.nodes > 1000 || value.length > 32)
      return failure('NOTIFICATION_TOO_LARGE', 'Notification array is too large');
    const entries = [];
    for (const entry of value) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const checked = sanitizeObject(
          entry,
          key === 'evidence' ? EVIDENCE_KEYS : new Set(),
          state,
          depth,
        );
        if (!checked.ok) return checked;
        entries.push(checked.value);
      } else {
        const checked = sanitizePrimitive(entry, key, state);
        if (!checked.ok) return checked;
        entries.push(checked.value);
      }
    }
    return { ok: true, value: entries };
  }
  if (value && typeof value === 'object') {
    const schema =
      {
        workItem: WORK_ITEM_KEYS,
        attention: ATTENTION_KEYS,
        notification: NOTIFICATION_KEYS,
      }[key] || new Set();
    return sanitizeObject(value, schema, state, depth);
  }
  return sanitizePrimitive(value, key, state);
}

export function sanitizeNotificationPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return failure('NOTIFICATION_INVALID', 'Notification payload is invalid');
  const shape = assertNoInjectedFields(value);
  if (!shape.ok) return shape;
  return sanitizeObject(value, ROOT_KEYS, { nodes: 0 }, 0);
}

const pick = (value, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => value && Object.hasOwn(value, key) && value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );

export function prepareNotificationMessage(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return failure('NOTIFICATION_INVALID', 'Notification input is invalid');
  const shape = assertNoInjectedFields(input);
  if (!shape.ok) return shape;
  const projected = {
    ...(input.workItem ? { workItem: pick(input.workItem, [...WORK_ITEM_KEYS]) } : {}),
    ...(input.attention ? { attention: pick(input.attention, [...ATTENTION_KEYS]) } : {}),
    ...(input.notification
      ? { notification: pick(input.notification, [...NOTIFICATION_KEYS]) }
      : {}),
    ...(input.managementUrl ? { managementUrl: input.managementUrl } : {}),
    ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    ...(input.notificationId ? { notificationId: input.notificationId } : {}),
    ...(input.deliveryId ? { deliveryId: input.deliveryId } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.channel ? { channel: input.channel } : {}),
    ...(Number.isSafeInteger(input.version) ? { version: input.version } : {}),
  };
  return sanitizeNotificationPayload(projected);
}

function stableCode(value) {
  return typeof value === 'string' && /^[A-Z0-9_]{1,80}$/.test(value)
    ? value
    : 'CHANNEL_DELIVERY_FAILED';
}

export function normalizeChannelResult(name, result) {
  const checkedName = validateChannelName(name);
  if (!checkedName.ok) return checkedName;
  if (result?.ok) {
    const receipt = result.receipt && typeof result.receipt === 'object' ? result.receipt : {};
    return {
      ok: true,
      receipt: {
        provider: name,
        status: Number.isSafeInteger(receipt.status) ? receipt.status : null,
        code: Number.isSafeInteger(receipt.code) ? receipt.code : 0,
        messageId: typeof receipt.messageId === 'string' ? receipt.messageId.slice(0, 256) : null,
        startedAt:
          typeof receipt.startedAt === 'string' && Number.isFinite(Date.parse(receipt.startedAt))
            ? new Date(receipt.startedAt).toISOString()
            : null,
        finishedAt:
          typeof receipt.finishedAt === 'string' && Number.isFinite(Date.parse(receipt.finishedAt))
            ? new Date(receipt.finishedAt).toISOString()
            : null,
      },
    };
  }
  return failure(
    stableCode(result?.code),
    redactNotificationText(result?.message || 'Channel delivery failed'),
  );
}

function deliveryKey(message) {
  const explicit = typeof message.dedupeKey === 'string' ? message.dedupeKey : '';
  const attention = message.attention || {};
  const fallback = [
    attention.attentionKey || attention.requestId || '',
    attention.revision ?? '',
    message.kind || message.notification?.kind || 'attention',
    message.notification?.reminderNumber ?? '',
  ].join(':');
  const raw = explicit || fallback;
  return raw.replace(/:+$/, '') ? createHash('sha256').update(raw).digest('hex') : null;
}

function renderGenericWebhook(message) {
  return {
    ok: true,
    body: {
      kind: message.kind || message.notification?.kind || 'attention',
      title: message.workItem?.title || message.workItem?.workItemId || 'SpecGate',
      summary:
        message.attention?.summary ||
        message.attention?.question ||
        message.notification?.summary ||
        'Open the authenticated management console for details.',
      url: message.managementUrl,
    },
  };
}

async function readBoundedJson(response) {
  if (typeof response.text === 'function') {
    const raw = await response.text();
    if (raw.length > 65536)
      return failure('CHANNEL_RESPONSE_TOO_LARGE', 'Channel response is too large');
    if (!raw) return { ok: true, body: {} };
    try {
      return { ok: true, body: JSON.parse(raw) };
    } catch {
      return { ok: true, body: {} };
    }
  }
  if (typeof response.json === 'function') {
    try {
      return { ok: true, body: await response.json() };
    } catch {
      return { ok: true, body: {} };
    }
  }
  return { ok: true, body: {} };
}

function providerCode(body) {
  const raw = body?.errcode ?? body?.code ?? body?.StatusCode ?? body?.status_code;
  if (raw === undefined || raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : raw;
}

function classifyFetchError(name, error) {
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR')
    return failure(`${name.toUpperCase()}_TIMEOUT`, 'Channel notification timed out');
  return failure(
    `${name.toUpperCase()}_NETWORK_ERROR`,
    'Channel notification could not be delivered',
  );
}

function assertNoInboundOptions(options) {
  for (const key of ['callbackUrl', 'callback', 'onMessage', 'listen', 'receive', 'handle']) {
    if (Object.hasOwn(options, key))
      throw new TypeError('Inbound callbacks are not supported by outbound channel adapters');
  }
}

export function createChannelAdapter(options = {}) {
  const {
    name,
    webhookUrl,
    notifier,
    render,
    fetchImpl = fetch,
    timeoutMs = 10_000,
    clock = Date.now,
    dedupeLimit = 1024,
  } = options;
  const checkedName = validateChannelName(name);
  if (!checkedName.ok) throw new TypeError(checkedName.message);
  assertNoInboundOptions(options);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_CHANNEL_TIMEOUT_MS)
    throw new TypeError(`timeoutMs must be between 1 and ${MAX_CHANNEL_TIMEOUT_MS}`);
  if (!Number.isSafeInteger(dedupeLimit) || dedupeLimit < 1 || dedupeLimit > 10_000)
    throw new TypeError('dedupeLimit must be a bounded positive integer');
  if (!Number.isFinite(clock())) throw new TypeError('clock must return a timestamp');
  const sender =
    notifier && typeof notifier.send === 'function' ? (message) => notifier.send(message) : null;
  if (!sender) {
    if (render !== undefined && typeof render !== 'function')
      throw new TypeError('render must be a function');
    const checkedWebhook = validateWebhookUrl(webhookUrl);
    if (!checkedWebhook.ok) throw new TypeError(checkedWebhook.message);
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  }

  const completed = new Map();
  const inFlight = new Map();

  async function webhookSend(message) {
    const rendered = (render || renderGenericWebhook)(message);
    if (!rendered?.ok)
      return failure(
        stableCode(rendered?.code || `${name.toUpperCase()}_RENDER_FAILED`),
        rendered?.message || 'Channel message could not be rendered',
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = new Date(clock()).toISOString();
    try {
      const response = await fetchImpl(validateWebhookUrl(webhookUrl).url, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(rendered.body),
        signal: controller.signal,
      });
      const parsed = await readBoundedJson(response);
      if (!parsed.ok) return parsed;
      const body = parsed.body;
      if (!response.ok)
        return failure(
          `${name.toUpperCase()}_HTTP_ERROR`,
          `${name} returned HTTP ${response.status}`,
        );
      const code = providerCode(body);
      if (typeof code === 'number' && code !== 0)
        return failure(
          `${name.toUpperCase()}_API_ERROR`,
          `${name} rejected the notification (code ${code})`,
        );
      return {
        ok: true,
        receipt: {
          provider: name,
          status: response.status,
          code: typeof code === 'number' ? code : 0,
          messageId:
            body?.data?.message_id ||
            body?.message_id ||
            body?.processQueryKey ||
            body?.task_id ||
            null,
          startedAt,
          finishedAt: new Date(clock()).toISOString(),
        },
      };
    } catch (error) {
      return classifyFetchError(name, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async function dispatch(message) {
    try {
      const raw = sender ? await sender(message) : await webhookSend(message);
      return normalizeChannelResult(name, raw);
    } catch {
      return failure(`${name.toUpperCase()}_DELIVERY_FAILED`, 'Channel notification failed');
    }
  }

  async function send(input) {
    const prepared = prepareNotificationMessage(input);
    if (!prepared.ok) return prepared;
    const key = deliveryKey(prepared.value);
    if (key && completed.has(key)) return structuredClone(completed.get(key));
    if (key && inFlight.has(key)) return inFlight.get(key);
    const operation = dispatch(prepared.value).then((result) => {
      if (key && result.ok) {
        completed.set(key, structuredClone(result));
        while (completed.size > dedupeLimit) completed.delete(completed.keys().next().value);
      }
      if (key) inFlight.delete(key);
      return result;
    });
    if (key) inFlight.set(key, operation);
    return operation;
  }

  return Object.freeze({ name, send });
}

export function createWebhookAdapter(options = {}) {
  return createChannelAdapter(options);
}

export function createFeishuAdapter(options = {}) {
  assertNoInboundOptions(options);
  return createChannelAdapter({
    ...options,
    name: 'feishu',
    notifier: createFeishuNotifier(options),
  });
}
