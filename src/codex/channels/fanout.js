import {
  createChannelAdapter,
  prepareNotificationMessage,
  validateChannelName,
} from './adapter.js';
import { createNotificationOutbox } from './outbox.js';

const failure = (code, message) => ({ ok: false, code, message });
const boundedText = (value, maximum = 512) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;

function normalizeChannels(channels) {
  const entries = Array.isArray(channels)
    ? channels.map((entry) => ({
        name: entry?.name || entry?.channel,
        config: entry,
      }))
    : channels && typeof channels === 'object'
      ? Object.entries(channels).map(([name, config]) => ({
          name,
          config:
            config && typeof config === 'object' && !config.send ? config : { notifier: config },
        }))
      : [];
  if (entries.length === 0) throw new TypeError('At least one notification channel is required');
  const seen = new Set();
  return entries.map(({ name, config }) => {
    const checked = validateChannelName(name);
    if (!checked.ok) throw new TypeError(checked.message);
    if (seen.has(name)) throw new TypeError(`Notification channel is duplicated: ${name}`);
    seen.add(name);
    const notifier =
      config.notifier || config.adapter || (typeof config.send === 'function' ? config : null);
    if (!notifier || typeof notifier.send !== 'function')
      throw new TypeError(`A notification sender is required for ${name}`);
    return { name, config, notifier };
  });
}

function baseDedupeKey(input, attention) {
  const attentionKey =
    input.attentionKey || attention.attentionKey || attention.requestId || input.attentionId;
  const revision = input.revision ?? attention.revision;
  const kind = input.kind || 'attention';
  if (!boundedText(attentionKey) || !Number.isSafeInteger(revision) || revision < 0)
    return failure('NOTIFICATION_INVALID', 'Attention key and revision are required');
  if (!boundedText(kind, 64))
    return failure('NOTIFICATION_INVALID', 'Notification kind is invalid');
  return { ok: true, key: input.dedupeKey || `${attentionKey}:${revision}:${kind}` };
}

export function createNotificationFanout({
  store,
  channels,
  clock = Date.now,
  randomId,
  maxAttempts = 8,
  baseDelayMs = 1000,
  maxDelayMs = 10 * 60 * 1000,
  concurrency = 1,
} = {}) {
  if (!store || typeof store.enqueueNotification !== 'function')
    throw new TypeError('A notification store is required');
  if (typeof store.claimPendingNotifications !== 'function')
    throw new TypeError('A claimable notification store is required');
  const configured = normalizeChannels(channels).map((entry, index) => {
    const notifier = createChannelAdapter({
      name: entry.name,
      notifier: entry.notifier,
      timeoutMs: entry.config.timeoutMs,
      dedupeLimit: entry.config.dedupeLimit,
    });
    return {
      name: entry.name,
      outbox: createNotificationOutbox({
        store,
        notifier,
        channel: entry.name,
        clock,
        ...(randomId ? { randomId } : {}),
        maxAttempts: entry.config.maxAttempts ?? maxAttempts,
        baseDelayMs: entry.config.baseDelayMs ?? baseDelayMs,
        maxDelayMs: entry.config.maxDelayMs ?? maxDelayMs,
        concurrency: entry.config.concurrency ?? concurrency,
        ownerId: `outbox-${entry.name}-${process.pid}-${index}`,
      }),
    };
  });

  async function enqueue(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return failure('NOTIFICATION_INVALID', 'Notification input is invalid');
    const attention = input.attention || {};
    const dedupe = baseDedupeKey(input, attention);
    if (!dedupe.ok) return dedupe;
    const prepared = prepareNotificationMessage({
      workItem: input.workItem || { workItemId: attention.workItemId || 'work-unknown' },
      attention,
      notification: input.notification,
      managementUrl: input.managementUrl,
      kind: input.kind || 'attention',
      dedupeKey: dedupe.key,
      version: input.version,
    });
    if (!prepared.ok) return prepared;
    const settled = await Promise.allSettled(
      configured.map(async ({ name, outbox }) => {
        const channelDedupeKey = `${dedupe.key}:${name}`;
        const result = await outbox.enqueue({
          ...prepared.value,
          kind: input.kind || 'attention',
          dedupeKey: channelDedupeKey,
          ...(Number.isSafeInteger(input.maxAttempts) ? { maxAttempts: input.maxAttempts } : {}),
        });
        return { channel: name, ...result };
      }),
    );
    const results = settled.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : failure(
            'NOTIFICATION_ENQUEUE_FAILED',
            `Notification enqueue failed for ${configured[index].name}`,
          ),
    );
    const accepted = results.filter((entry) => entry.ok).length;
    return {
      ok: accepted === results.length,
      ...(accepted === results.length ? {} : { code: 'NOTIFICATION_PARTIAL_ENQUEUE' }),
      accepted,
      duplicates: results.filter((entry) => entry.duplicate).length,
      results,
    };
  }

  async function drain(options = {}) {
    const settled = await Promise.allSettled(
      configured.map(async ({ name, outbox }) => ({
        channel: name,
        ...(await outbox.drain(options)),
      })),
    );
    const results = settled.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : failure(
            'NOTIFICATION_DRAIN_FAILED',
            `Notification drain failed for ${configured[index].name}`,
          ),
    );
    return {
      ok: results.every((entry) => entry.ok),
      sent: results.reduce((total, entry) => total + (entry.sent || 0), 0),
      failed: results.reduce((total, entry) => total + (entry.failed || 0), 0),
      results,
    };
  }

  async function notifyReminder({ workItem, attention, managementUrl, reminderNumber } = {}) {
    if (!Number.isSafeInteger(reminderNumber) || reminderNumber < 1 || reminderNumber > 100)
      return failure('NOTIFICATION_INVALID', 'Reminder number is invalid');
    return enqueue({
      kind: 'reminder',
      workItem,
      attention,
      managementUrl,
      dedupeKey: `${attention?.attentionKey || attention?.requestId}:${attention?.revision}:reminder:${reminderNumber}`,
      notification: {
        kind: 'reminder',
        reminderNumber,
        status: attention?.status,
        summary: '提醒：该事项仍在等待你的处理。',
      },
    });
  }

  async function notifyEscalation({ workItem, attention, managementUrl } = {}) {
    return enqueue({
      kind: 'escalation',
      workItem,
      attention,
      managementUrl,
      dedupeKey: `${attention?.attentionKey || attention?.requestId}:${attention?.revision}:escalation`,
      notification: {
        kind: 'escalation',
        stage: 'escalated',
        status: attention?.status,
        summary: '该事项即将过期，请尽快在认证管理端处理。',
      },
    });
  }

  async function notifyResolution({
    workItem,
    attention,
    managementUrl,
    status = attention?.status,
    action = attention?.decisionAction,
  } = {}) {
    const resolutionKey =
      attention?.decisionId ||
      attention?.supersededBy ||
      attention?.expiredAt ||
      `${status}:${attention?.updatedAt || attention?.revision}`;
    return enqueue({
      kind: 'resolution',
      workItem,
      attention,
      managementUrl,
      dedupeKey: `${attention?.attentionKey || attention?.requestId}:${attention?.revision}:resolution:${status}:${resolutionKey}`,
      notification: {
        kind: 'resolution',
        status,
        action,
        decidedAt: attention?.decidedAt || attention?.updatedAt,
        expiredAt: attention?.expiredAt,
      },
    });
  }

  async function notifyOutcome({
    workItem,
    attention,
    managementUrl,
    stage,
    decisionId,
    summary,
  } = {}) {
    if (!['failed', 'recovered', 'completed', 'expired'].includes(stage))
      return failure('NOTIFICATION_INVALID', 'Outcome stage is invalid');
    const outcomeKey = decisionId || attention?.decisionId || attention?.updatedAt || stage;
    return enqueue({
      kind: 'resolution',
      workItem,
      attention,
      managementUrl,
      dedupeKey: `${attention?.attentionKey || attention?.requestId}:${attention?.revision}:resolution:${stage}:${outcomeKey}`,
      notification: {
        kind: 'resolution',
        stage,
        outcome: stage,
        summary,
        status: attention?.status,
        decisionId,
        failedAt: stage === 'failed' ? new Date(clock()).toISOString() : undefined,
        recoveredAt: stage === 'recovered' ? new Date(clock()).toISOString() : undefined,
        completedAt: stage === 'completed' ? new Date(clock()).toISOString() : undefined,
        expiredAt: stage === 'expired' ? attention?.expiredAt : undefined,
      },
    });
  }

  return Object.freeze({
    enqueue,
    drain,
    notify: (input) => enqueue(input),
    notifyReminder,
    notifyEscalation,
    notifyResolution,
    notifyOutcome,
    channels: Object.freeze(configured.map((entry) => entry.name)),
  });
}
