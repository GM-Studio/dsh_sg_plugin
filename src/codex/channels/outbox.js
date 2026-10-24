import { hashValue } from '../events.js';
import { validateManagementUrl } from './feishu.js';
import { prepareNotificationMessage, validateChannelName } from './adapter.js';
import { randomUUID } from 'node:crypto';

const failure = (code, message) => ({ ok: false, code, message });
const text = (value, maximum = 4000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;

export function createNotificationOutbox({
  store,
  notifier,
  clock = Date.now,
  randomId = () => randomUUID(),
  maxAttempts = 8,
  baseDelayMs = 1000,
  maxDelayMs = 10 * 60 * 1000,
  concurrency = 1,
  ownerId = `outbox-${process.pid}`,
  channel = null,
} = {}) {
  if (!store || typeof store.enqueueNotification !== 'function')
    throw new TypeError('A notification store is required');
  if (!notifier || typeof notifier.send !== 'function')
    throw new TypeError('A notification sender is required');
  for (const value of [maxAttempts, baseDelayMs, maxDelayMs, concurrency]) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError('Outbox limits must be positive integers');
  }
  if (channel !== null && !validateChannelName(channel).ok)
    throw new TypeError('Outbox channel must be feishu, dingtalk or webhook');

  async function enqueue(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return failure('NOTIFICATION_INVALID', 'Notification input is invalid');
    const sourceMessage =
      input.message && typeof input.message === 'object'
        ? input.message
        : {
            workItem: input.workItem || {},
            attention: input.attention || {},
            ...(input.managementUrl ? { managementUrl: input.managementUrl } : {}),
            ...(input.notification ? { notification: input.notification } : {}),
          };
    const attention = input.attention || sourceMessage.attention || {};
    const attentionKey = input.attentionKey || attention.attentionKey;
    const revision = input.revision || attention.revision;
    const dedupeKey =
      input.dedupeKey ||
      (text(attentionKey, 512) && Number.isSafeInteger(revision)
        ? `${attentionKey}:${revision}`
        : null);
    if (!text(dedupeKey, 512))
      return failure('NOTIFICATION_INVALID', 'A stable attention key and revision are required');
    const notificationId =
      input.notificationId || `notification-${hashValue({ dedupeKey }).slice(0, 20)}`;
    const prepared = prepareNotificationMessage(sourceMessage);
    if (!prepared.ok) return prepared;
    const attempts = input.maxAttempts === undefined ? maxAttempts : input.maxAttempts;
    if (!Number.isSafeInteger(attempts) || attempts <= 0 || attempts > 100)
      return failure('NOTIFICATION_INVALID', 'Notification maxAttempts is invalid');
    const recordChannel = channel || input.channel || null;
    if (recordChannel && !validateChannelName(recordChannel).ok)
      return failure('NOTIFICATION_INVALID', 'Notification channel is invalid');
    const record = {
      notificationId,
      workItemId:
        input.workItemId ||
        input.workItem?.workItemId ||
        sourceMessage.workItem?.workItemId ||
        'work-unknown',
      attentionId: input.attentionId || attention.requestId || 'attention-unknown',
      kind: input.kind || 'attention',
      ...(recordChannel ? { channel: recordChannel } : {}),
      dedupeKey,
      message: {
        ...prepared.value,
        dedupeKey,
        notificationId,
      },
      maxAttempts: attempts,
      nextAttemptAt: new Date(clock()).toISOString(),
      createdBy: ownerId,
      requestId: randomId(),
    };
    if (!text(record.workItemId, 128) || !text(record.attentionId, 128))
      return failure('NOTIFICATION_INVALID', 'Notification WorkItem or Attention id is invalid');
    return store.enqueueNotification(record);
  }

  async function deliver(notification) {
    if ((notification.attemptCount || 0) > (notification.maxAttempts || maxAttempts)) {
      return store.markNotificationFailed({
        notificationId: notification.notificationId,
        owner: ownerId,
        code: 'NOTIFICATION_RETRY_EXHAUSTED',
        message: 'Notification retry limit was reached',
        nextAttemptAt: new Date(8_640_000_000_000_000).toISOString(),
      });
    }
    const prepared = prepareNotificationMessage(notification.message);
    if (!prepared.ok)
      return store.markNotificationFailed({
        notificationId: notification.notificationId,
        owner: ownerId,
        code: prepared.code,
        message: prepared.message,
        nextAttemptAt: new Date(clock()).toISOString(),
      });
    let result;
    try {
      result = await notifier.send(prepared.value);
    } catch {
      result = failure('NOTIFICATION_DELIVERY_FAILED', 'Notification delivery failed');
    }
    if (result?.ok) {
      return store.markNotificationSent({
        notificationId: notification.notificationId,
        owner: ownerId,
        receipt: result.receipt || null,
      });
    }
    const delay = Math.min(
      maxDelayMs,
      baseDelayMs * 2 ** Math.max(0, (notification.attemptCount || 1) - 1),
    );
    return store.markNotificationFailed({
      notificationId: notification.notificationId,
      owner: ownerId,
      code: result?.code || 'NOTIFICATION_DELIVERY_FAILED',
      message: String(result?.message || 'Notification delivery failed').slice(0, 1000),
      nextAttemptAt: new Date(clock() + delay).toISOString(),
    });
  }

  async function drain({ maxBatches = 100 } = {}) {
    if (!Number.isSafeInteger(maxBatches) || maxBatches < 1)
      return failure('INVALID_ARGUMENT', 'maxBatches must be positive');
    let sent = 0;
    let failed = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const claimed = await store.claimPendingNotifications({
        now: clock(),
        limit: concurrency,
        owner: ownerId,
        ...(channel ? { channel } : {}),
      });
      if (!claimed.ok) return claimed;
      if (!claimed.notifications?.length) break;
      const results = await Promise.allSettled(claimed.notifications.map(deliver));
      for (const result of results) {
        if (result.status === 'rejected')
          return failure('NOTIFICATION_DELIVERY_FAILED', 'Notification delivery failed');
        if (!result.value.ok) return result.value;
        if (result.value.notification?.status === 'sent') sent += 1;
        else failed += 1;
      }
    }
    return { ok: true, sent, failed };
  }

  return Object.freeze({
    enqueue,
    drain,
    getNotification: (id) => store.getNotification(id),
  });
}

export function createAttentionNotifier({
  outbox,
  managementBaseUrl,
  tokenFactory = () => null,
  credentialFactory = null,
} = {}) {
  if (!outbox || typeof outbox.enqueue !== 'function')
    throw new TypeError('A notification outbox is required');
  const checked = validateManagementUrl(managementBaseUrl);
  if (!checked.ok) throw new TypeError(checked.message);
  const base = checked.url.endsWith('/') ? checked.url : `${checked.url}/`;

  async function accessCredential(attention) {
    const generated =
      typeof credentialFactory === 'function'
        ? await credentialFactory(attention)
        : tokenFactory
          ? { parameter: 'token', value: await tokenFactory(attention) }
          : null;
    if (!generated || typeof generated !== 'object') return null;
    if (!['token', 'nonce'].includes(generated.parameter)) return null;
    return typeof generated.value === 'string' && generated.value.length > 0 ? generated : null;
  }

  async function managementFragment(attention) {
    const credential = await accessCredential(attention);
    return [
      `attention=${encodeURIComponent(attention.requestId)}`,
      ...(credential ? [`${credential.parameter}=${encodeURIComponent(credential.value)}`] : []),
    ].join('&');
  }

  async function notify({ workItem, attention } = {}) {
    if (
      !workItem ||
      typeof workItem !== 'object' ||
      !attention ||
      typeof attention !== 'object' ||
      !text(attention.requestId, 128) ||
      !Number.isSafeInteger(attention.revision)
    )
      return failure('NOTIFICATION_INVALID', 'WorkItem and Attention state are required');
    const fragment = await managementFragment(attention);
    const managementUrl = `${base}#${fragment}`;
    return outbox.enqueue({
      kind: 'attention',
      workItem,
      attention,
      managementUrl,
      dedupeKey: `${attention.attentionKey || attention.requestId}:${attention.revision}`,
    });
  }

  async function notifyResolution({ workItem, attention } = {}) {
    if (
      !workItem ||
      typeof workItem !== 'object' ||
      !attention ||
      typeof attention !== 'object' ||
      !text(attention.requestId, 128) ||
      !Number.isSafeInteger(attention.revision) ||
      !['DECIDED', 'SUPERSEDED', 'EXPIRED'].includes(attention.status)
    )
      return failure('NOTIFICATION_INVALID', 'A resolved AttentionRequest is required');
    const fragment = await managementFragment(attention);
    const managementUrl = `${base}#${fragment}`;
    const resolutionKey =
      attention.decisionId ||
      attention.supersededBy ||
      `${attention.status}:${attention.updatedAt || attention.revision}`;
    return outbox.enqueue({
      kind: 'resolution',
      workItem,
      attention,
      managementUrl,
      dedupeKey: `resolution:${attention.attentionKey || attention.requestId}:${attention.revision}:${attention.status}:${resolutionKey}`,
      notification: {
        kind: 'resolution',
        status: attention.status,
        action: attention.decisionAction || null,
        decidedAt: attention.decidedAt || attention.updatedAt || null,
      },
    });
  }

  return Object.freeze({ notify, notifyResolution });
}
