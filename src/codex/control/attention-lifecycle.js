import { validateManagementUrl } from '../channels/feishu.js';

const failure = (code, message) => ({ ok: false, code, message });
const ACTIVE_ATTENTION_STATES = new Set(['OPEN', 'DELIVERED', 'REMINDED']);
const EXPIRABLE_ATTENTION_STATES = new Set(['OPEN', 'DELIVERED', 'REMINDED', 'ESCALATED']);

function validAttention(attention) {
  return (
    attention &&
    typeof attention === 'object' &&
    !Array.isArray(attention) &&
    typeof attention.requestId === 'string' &&
    attention.requestId.length > 0 &&
    attention.requestId.length <= 128 &&
    Number.isSafeInteger(attention.revision) &&
    attention.revision >= 0
  );
}

async function managementLink({ attention, suppliedUrl, managementBaseUrl, credentialFactory }) {
  if (suppliedUrl) {
    const checked = validateManagementUrl(suppliedUrl);
    return checked.ok ? { ok: true, url: checked.url } : checked;
  }
  if (!managementBaseUrl)
    return failure('MANAGEMENT_URL_REQUIRED', 'A management URL is required for notifications');
  const checked = validateManagementUrl(managementBaseUrl);
  if (!checked.ok) return checked;
  let credential = null;
  if (typeof credentialFactory === 'function') {
    try {
      const generated = await credentialFactory(attention);
      if (
        generated &&
        ['nonce', 'token'].includes(generated.parameter) &&
        typeof generated.value === 'string' &&
        generated.value.length > 0 &&
        generated.value.length <= 1024
      )
        credential = generated;
    } catch {
      return failure(
        'MANAGEMENT_CREDENTIAL_FAILED',
        'A short-lived management entry could not be created',
      );
    }
  }
  const base = checked.url.endsWith('/') ? checked.url : `${checked.url}/`;
  return {
    ok: true,
    url: `${base}#attention=${encodeURIComponent(attention.requestId)}${
      credential ? `&${credential.parameter}=${encodeURIComponent(credential.value)}` : ''
    }`,
  };
}

export function createAttentionLifecycleNotifier({
  fanout,
  managementBaseUrl,
  credentialFactory = null,
} = {}) {
  if (!fanout || typeof fanout.enqueue !== 'function')
    throw new TypeError('A notification fanout is required');
  if (managementBaseUrl !== undefined) {
    const checked = validateManagementUrl(managementBaseUrl);
    if (!checked.ok) throw new TypeError(checked.message);
  }

  async function payload(input = {}) {
    if (!validAttention(input.attention))
      return failure('NOTIFICATION_INVALID', 'A valid Attention state is required');
    const linked = await managementLink({
      attention: input.attention,
      suppliedUrl: input.managementUrl,
      managementBaseUrl,
      credentialFactory,
    });
    if (!linked.ok) return linked;
    return {
      ok: true,
      value: {
        workItem: {
          ...(input.workItem || {}),
          workItemId: input.workItem?.workItemId || input.attention.workItemId,
        },
        attention: input.attention,
        managementUrl: linked.url,
      },
    };
  }

  async function invoke(method, input, fallback) {
    const checked = await payload(input);
    if (!checked.ok) return checked;
    const fn = fanout[method];
    if (typeof fn === 'function') return fn({ ...checked.value, ...fallback });
    return fanout.enqueue({ ...checked.value, ...fallback });
  }

  async function notifyReminder(input = {}) {
    return invoke('notifyReminder', input, {
      reminderNumber: input.reminderNumber,
      kind: 'reminder',
    });
  }

  async function notifyEscalation(input = {}) {
    return invoke('notifyEscalation', input, { kind: 'escalation' });
  }

  async function notifyDecision(input = {}) {
    return invoke('notifyResolution', input, {
      status: 'DECIDED',
      action: input.action || input.attention?.decisionAction,
    });
  }

  async function notifyResolution(input = {}) {
    return invoke('notifyResolution', input, {
      status: input.status || input.attention?.status,
      action: input.action || input.attention?.decisionAction,
    });
  }

  async function notifyOutcome(input = {}) {
    return invoke('notifyOutcome', input, {
      stage: input.stage,
      decisionId: input.decisionId,
      summary: input.summary,
    });
  }

  return Object.freeze({
    notifyReminder,
    notifyEscalation,
    notifyDecision,
    notifyResolution,
    notifyOutcome,
  });
}

function resultAttention(result) {
  return result?.attention || result?.result?.attention || null;
}

export function createAttentionLifecycle({
  service,
  notifier,
  clock = Date.now,
  reminderAfterMs,
  escalationBeforeMs,
  maxReminders,
  interval,
} = {}) {
  const listAttention = service?.projection?.listAttention || service?.listAttention;
  if (
    !service ||
    typeof listAttention !== 'function' ||
    typeof service.expireAttention !== 'function'
  )
    throw new TypeError('Attention lifecycle requires listAttention and expireAttention');
  if (!notifier || typeof notifier !== 'object')
    throw new TypeError('A lifecycle notifier is required');
  if (typeof clock !== 'function' || !Number.isFinite(clock()))
    throw new TypeError('clock must return a timestamp');
  if (!Number.isSafeInteger(reminderAfterMs) || reminderAfterMs <= 0)
    throw new TypeError('reminderAfterMs must be a positive integer');
  if (!Number.isSafeInteger(escalationBeforeMs) || escalationBeforeMs <= 0)
    throw new TypeError('escalationBeforeMs must be a positive integer');
  if (!Number.isSafeInteger(maxReminders) || maxReminders < 0 || maxReminders > 100)
    throw new TypeError('maxReminders must be an integer between 0 and 100');
  if (
    interval !== undefined &&
    (!Number.isSafeInteger(interval) || interval < 1 || interval > 24 * 60 * 60 * 1000)
  )
    throw new TypeError('interval must be a bounded positive integer');

  const state = new Map();
  let activeTick = null;
  let timer = null;
  let lastResult = null;

  function stateFor(attention) {
    const existing = state.get(attention.requestId);
    if (existing?.revision === attention.revision) return existing;
    const next = {
      revision: attention.revision,
      reminderCount: 0,
      escalated: false,
      expiredNotified: false,
    };
    state.set(attention.requestId, next);
    return next;
  }

  async function notify(method, input) {
    const fn = notifier[method] || notifier.notify;
    if (typeof fn !== 'function')
      return failure('NOTIFICATION_NOTIFIER_UNAVAILABLE', 'Lifecycle notifier is unavailable');
    try {
      const result = await fn.call(notifier, input);
      return result && typeof result === 'object'
        ? result
        : failure('NOTIFICATION_NOTIFIER_FAILED', 'Lifecycle notifier returned no result');
    } catch {
      return failure('NOTIFICATION_NOTIFIER_FAILED', 'Lifecycle notification failed');
    }
  }

  async function runTick() {
    const listed = await listAttention();
    if (!listed.ok) return listed;
    if (!Array.isArray(listed.attention))
      return failure('ATTENTION_LIST_INVALID', 'Attention projection is invalid');
    const now = clock();
    const summary = {
      ok: true,
      scanned: listed.attention.length,
      reminded: 0,
      escalated: 0,
      expired: 0,
      errors: [],
    };
    for (const attention of listed.attention) {
      if (!validAttention(attention)) {
        summary.errors.push({ attentionId: null, action: 'validate', code: 'ATTENTION_INVALID' });
        continue;
      }
      if (!EXPIRABLE_ATTENTION_STATES.has(attention.status)) continue;
      const attentionState = stateFor(attention);
      const expiresAt = Date.parse(attention.expiresAt);
      if (!Number.isFinite(expiresAt)) {
        summary.errors.push({
          attentionId: attention.requestId,
          action: 'validate',
          code: 'ATTENTION_EXPIRY_INVALID',
        });
        continue;
      }
      if (expiresAt <= now) {
        let expired;
        try {
          expired = await service.expireAttention({ attentionId: attention.requestId, now });
        } catch {
          expired = failure('ATTENTION_EXPIRE_FAILED', 'Attention expiration failed');
        }
        if (!expired?.ok) {
          summary.errors.push({
            attentionId: attention.requestId,
            action: 'expire',
            code: expired?.code || 'ATTENTION_EXPIRE_FAILED',
          });
          continue;
        }
        const terminal = resultAttention(expired);
        if (terminal?.status === 'EXPIRED' || expired.type === 'attention.expired') {
          summary.expired += 1;
          if (!attentionState.expiredNotified) {
            attentionState.expiredNotified = true;
            const notified = await notify('notifyOutcome', {
              attention: terminal || { ...attention, status: 'EXPIRED' },
              workItem: {
                workItemId: attention.workItemId,
                artifactHash: attention.artifactHash,
              },
              stage: 'expired',
              summary: '该请求已过期，不会自动批准或继续执行。',
            });
            if (!notified.ok)
              summary.errors.push({
                attentionId: attention.requestId,
                action: 'notify_expired',
                code: notified.code || 'NOTIFICATION_FAILED',
              });
          }
        }
        continue;
      }
      if (!ACTIVE_ATTENTION_STATES.has(attention.status)) continue;
      const createdAt = Date.parse(attention.createdAt || attention.updatedAt);
      if (!Number.isFinite(createdAt)) {
        summary.errors.push({
          attentionId: attention.requestId,
          action: 'validate',
          code: 'ATTENTION_CREATED_AT_INVALID',
        });
        continue;
      }
      const escalationAt = expiresAt - escalationBeforeMs;
      const reminderDue = Math.min(
        maxReminders,
        Math.max(0, Math.floor((now - createdAt) / reminderAfterMs)),
      );
      if (now >= escalationAt && !attentionState.escalated) {
        attentionState.escalated = true;
        attentionState.reminderCount = Math.max(attentionState.reminderCount, reminderDue);
        const notified = await notify('notifyEscalation', {
          attention,
          workItem: {
            workItemId: attention.workItemId,
            artifactHash: attention.artifactHash,
          },
        });
        summary.escalated += 1;
        if (!notified.ok)
          summary.errors.push({
            attentionId: attention.requestId,
            action: 'escalate',
            code: notified.code || 'NOTIFICATION_FAILED',
          });
        continue;
      }
      if (reminderDue > attentionState.reminderCount) {
        attentionState.reminderCount = reminderDue;
        const notified = await notify('notifyReminder', {
          attention,
          workItem: {
            workItemId: attention.workItemId,
            artifactHash: attention.artifactHash,
          },
          reminderNumber: reminderDue,
        });
        summary.reminded += 1;
        if (!notified.ok)
          summary.errors.push({
            attentionId: attention.requestId,
            action: 'remind',
            code: notified.code || 'NOTIFICATION_FAILED',
          });
      }
    }
    return summary;
  }

  async function tick() {
    if (activeTick) return activeTick;
    activeTick = runTick().finally(() => {
      activeTick = null;
    });
    return activeTick;
  }

  function start() {
    if (timer || interval === undefined)
      return failure('LIFECYCLE_INTERVAL_REQUIRED', 'A lifecycle interval is required');
    timer = setInterval(() => {
      tick()
        .then((result) => {
          lastResult = result;
        })
        .catch(() => {
          lastResult = failure('LIFECYCLE_TICK_FAILED', 'Attention lifecycle tick failed');
        });
    }, interval);
    timer.unref?.();
    return { ok: true, interval };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    return { ok: true };
  }

  return Object.freeze({
    tick,
    start,
    stop,
    status: () => ({
      running: Boolean(timer),
      lastResult,
      tracked: state.size,
    }),
  });
}
