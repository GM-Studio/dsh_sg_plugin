import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttentionNotifier, createNotificationOutbox } from '../src/codex/channels/outbox.js';

function fakeStore() {
  const notifications = new Map();
  const calls = [];
  return {
    notifications,
    calls,
    async enqueueNotification(record) {
      calls.push(['enqueue', record]);
      const existing = [...notifications.values()].find(
        (entry) => entry.dedupeKey === record.dedupeKey,
      );
      if (existing) return { ok: true, duplicate: true, notification: structuredClone(existing) };
      const notification = {
        ...structuredClone(record),
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: record.nextAttemptAt || '2026-10-22T10:00:00.000Z',
        leaseOwner: null,
      };
      notifications.set(notification.notificationId, notification);
      return { ok: true, duplicate: false, notification: structuredClone(notification) };
    },
    async claimPendingNotifications({ now, limit, owner }) {
      calls.push(['claim', { now, limit, owner }]);
      const claimed = [...notifications.values()]
        .filter(
          (entry) =>
            entry.status === 'pending' &&
            Date.parse(entry.nextAttemptAt) <= now &&
            entry.leaseOwner === null,
        )
        .slice(0, limit);
      for (const entry of claimed) {
        entry.status = 'sending';
        entry.leaseOwner = owner;
        entry.attemptCount += 1;
      }
      return { ok: true, notifications: structuredClone(claimed) };
    },
    async markNotificationSent({ notificationId, receipt }) {
      calls.push(['sent', notificationId]);
      const notification = notifications.get(notificationId);
      notification.status = 'sent';
      notification.receipt = receipt;
      notification.leaseOwner = null;
      return { ok: true, notification: structuredClone(notification) };
    },
    async markNotificationFailed({ notificationId, code, message, nextAttemptAt }) {
      calls.push(['failed', notificationId, nextAttemptAt]);
      const notification = notifications.get(notificationId);
      notification.status = 'pending';
      notification.lastError = { code, message };
      notification.nextAttemptAt = nextAttemptAt;
      notification.leaseOwner = null;
      return { ok: true, notification: structuredClone(notification) };
    },
    async getNotification(id) {
      return notifications.has(id)
        ? { ok: true, notification: structuredClone(notifications.get(id)) }
        : { ok: false, code: 'NOTIFICATION_NOT_FOUND' };
    },
  };
}

test('Outbox deduplicates Attention notifications and sends once', async () => {
  const store = fakeStore();
  const sent = [];
  const outbox = createNotificationOutbox({
    store,
    notifier: {
      async send(message) {
        sent.push(message);
        return { ok: true, receipt: { messageId: 'm-1' } };
      },
    },
    clock: () => Date.parse('2026-10-22T10:00:00.000Z'),
    randomId: () => 'fixed',
  });
  const input = {
    attentionId: 'attention-1',
    attentionKey: 'k-1',
    revision: 1,
    workItem: { workItemId: 'work-1', title: 'Export' },
    attention: { requestId: 'attention-1', actions: [], risks: [] },
    managementUrl: 'https://management.example.test/#attention=attention-1',
  };
  const first = await outbox.enqueue(input);
  const second = await outbox.enqueue(input);
  assert.equal(first.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(store.notifications.size, 1);
  const drained = await outbox.drain();
  assert.equal(drained.ok, true);
  assert.equal(sent.length, 1);
  assert.equal([...store.notifications.values()][0].status, 'sent');
});

test('Outbox failure does not block and schedules exponential retry', async () => {
  const store = fakeStore();
  const outbox = createNotificationOutbox({
    store,
    notifier: {
      async send() {
        return { ok: false, code: 'FEISHU_HTTP_ERROR', message: 'down' };
      },
    },
    clock: () => Date.parse('2026-10-22T10:00:00.000Z'),
    baseDelayMs: 1000,
  });
  await outbox.enqueue({
    notificationId: 'notification-1',
    attentionId: 'attention-1',
    dedupeKey: 'k-1',
    message: { workItem: {}, attention: {} },
  });
  const result = await outbox.drain();
  assert.equal(result.ok, true);
  assert.equal(result.failed, 1);
  const notification = store.notifications.get('notification-1');
  assert.equal(notification.status, 'pending');
  assert.equal(notification.nextAttemptAt, '2026-10-22T10:00:01.000Z');
  assert.equal(notification.lastError.code, 'FEISHU_HTTP_ERROR');
});

test('a new Outbox instance can continue pending delivery after restart', async () => {
  const store = fakeStore();
  let attempts = 0;
  const notifier = {
    async send() {
      attempts += 1;
      return attempts === 1
        ? { ok: false, code: 'FEISHU_TIMEOUT', message: 'timeout' }
        : { ok: true, receipt: { messageId: 'm-2' } };
    },
  };
  let now = Date.parse('2026-10-22T10:00:00.000Z');
  const first = createNotificationOutbox({
    store,
    notifier,
    clock: () => now,
    baseDelayMs: 1000,
  });
  await first.enqueue({
    notificationId: 'notification-1',
    attentionId: 'attention-1',
    dedupeKey: 'k-1',
    message: { workItem: {}, attention: {} },
  });
  await first.drain();
  now += 2000;
  const restarted = createNotificationOutbox({ store, notifier, clock: () => now });
  const resumed = await restarted.drain();
  assert.equal(resumed.ok, true);
  assert.equal(resumed.sent, 1);
  assert.equal(store.notifications.get('notification-1').status, 'sent');
});

test('Attention notifier builds a stable secure management link', async () => {
  const enqueued = [];
  const notifier = createAttentionNotifier({
    outbox: {
      async enqueue(value) {
        enqueued.push(value);
        return { ok: true, notification: { notificationId: 'notification-1' } };
      },
    },
    managementBaseUrl: 'https://management.example.test/',
    tokenFactory: () => 'pair-token',
  });
  const first = await notifier.notify({
    workItem: { workItemId: 'work-1', title: 'Export' },
    attention: {
      requestId: 'attention-1',
      attentionKey: 'key-1',
      revision: 2,
      actions: ['approve'],
      risks: [],
    },
  });
  const second = await notifier.notify({
    workItem: { workItemId: 'work-1', title: 'Export' },
    attention: {
      requestId: 'attention-1',
      attentionKey: 'key-1',
      revision: 2,
      actions: ['approve'],
      risks: [],
    },
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(enqueued[0].dedupeKey, 'key-1:2');
  assert.match(enqueued[0].managementUrl, /#attention=attention-1&token=pair-token$/);
});

test('Attention resolution uses a stable dedupe key and resolution card payload', async () => {
  const enqueued = [];
  const notifier = createAttentionNotifier({
    outbox: {
      async enqueue(value) {
        enqueued.push(value);
        return { ok: true, notification: { notificationId: 'resolution-1' } };
      },
    },
    managementBaseUrl: 'https://management.example.test/',
    tokenFactory: () => 'pair-token',
  });
  const input = {
    workItem: { workItemId: 'work-1', title: 'Export' },
    attention: {
      requestId: 'attention-1',
      attentionKey: 'key-1',
      revision: 2,
      status: 'DECIDED',
      decisionId: 'decision-1',
      decisionAction: 'approve',
      decidedAt: '2026-10-22T10:05:00.000Z',
    },
  };
  const first = await notifier.notifyResolution(input);
  const second = await notifier.notifyResolution(input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(enqueued[0].kind, 'resolution');
  assert.equal(enqueued[0].dedupeKey, 'resolution:key-1:2:DECIDED:decision-1');
  assert.equal(enqueued[0].notification.kind, 'resolution');
  assert.equal(enqueued[0].notification.action, 'approve');
});

test('account-mode attention links carry a short-lived nonce instead of a pairing token', async () => {
  const enqueued = [];
  const notifier = createAttentionNotifier({
    outbox: {
      async enqueue(value) {
        enqueued.push(value);
        return { ok: true };
      },
    },
    managementBaseUrl: 'https://management.example.test/',
    credentialFactory: (attention) => ({
      parameter: 'nonce',
      value: `nonce-${attention.requestId}`,
    }),
  });
  const result = await notifier.notify({
    workItem: { workItemId: 'work-1', title: 'Export' },
    attention: {
      requestId: 'attention-1',
      attentionKey: 'key-1',
      revision: 1,
      actions: ['approve'],
    },
  });
  assert.equal(result.ok, true);
  assert.match(enqueued[0].managementUrl, /#attention=attention-1&nonce=nonce-attention-1$/);
  assert.doesNotMatch(enqueued[0].managementUrl, /token=/);
});
