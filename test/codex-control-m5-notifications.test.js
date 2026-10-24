import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChannelAdapter,
  createFeishuAdapter,
  prepareNotificationMessage,
  sanitizeNotificationPayload,
  validateChannelName,
  validateWebhookUrl,
} from '../src/codex/channels/adapter.js';
import { createDingTalkNotifier } from '../src/codex/channels/dingtalk.js';
import { createNotificationFanout } from '../src/codex/channels/fanout.js';
import {
  createAttentionLifecycle,
  createAttentionLifecycleNotifier,
} from '../src/codex/control/attention-lifecycle.js';

const webhook = 'https://oapi.dingtalk.com/robot/send?access_token=example';
const managementUrl = 'https://management.example.test/#attention=attention-1';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

function fakeStore() {
  const notifications = new Map();
  const byDedupe = new Map();
  return {
    notifications,
    async enqueueNotification(record) {
      const existingId = byDedupe.get(record.dedupeKey);
      if (existingId) {
        return {
          ok: true,
          duplicate: true,
          notification: structuredClone(notifications.get(existingId)),
        };
      }
      const notification = {
        ...structuredClone(record),
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: record.nextAttemptAt,
        leaseOwner: null,
        lastError: null,
        receipt: null,
      };
      notifications.set(notification.notificationId, notification);
      byDedupe.set(notification.dedupeKey, notification.notificationId);
      return { ok: true, duplicate: false, notification: structuredClone(notification) };
    },
    async claimPendingNotifications({ now, limit, owner, channel }) {
      const claimed = [...notifications.values()]
        .filter(
          (entry) =>
            ['pending', 'failed', 'sending'].includes(entry.status) &&
            Date.parse(entry.nextAttemptAt) <= now &&
            (channel === undefined || entry.channel === channel),
        )
        .slice(0, limit);
      for (const notification of claimed) {
        notification.status = 'sending';
        notification.attemptCount += 1;
        notification.leaseOwner = owner;
      }
      return { ok: true, notifications: structuredClone(claimed) };
    },
    async markNotificationSent({ notificationId, receipt }) {
      const notification = notifications.get(notificationId);
      notification.status = 'sent';
      notification.receipt = receipt;
      notification.leaseOwner = null;
      return { ok: true, notification: structuredClone(notification) };
    },
    async markNotificationFailed({ notificationId, code, message, nextAttemptAt }) {
      const notification = notifications.get(notificationId);
      notification.status =
        notification.attemptCount >= notification.maxAttempts ? 'failed' : 'pending';
      notification.lastError = { code, message };
      notification.nextAttemptAt = nextAttemptAt;
      notification.leaseOwner = null;
      return { ok: true, notification: structuredClone(notification) };
    },
    async getNotification(notificationId) {
      return notifications.has(notificationId)
        ? { ok: true, notification: structuredClone(notifications.get(notificationId)) }
        : { ok: false, code: 'NOTIFICATION_NOT_FOUND' };
    },
  };
}

function attention(overrides = {}) {
  return {
    requestId: 'attention-1',
    workItemId: 'work-1',
    attentionKey: 'attention-key-1',
    revision: 1,
    type: 'H1_APPROVAL',
    status: 'OPEN',
    reason: 'Confirm the release scope',
    question: 'Proceed?',
    actions: ['approve', 'request_changes'],
    summary: 'Checks passed',
    risks: [],
    evidence: [],
    artifactHash: 'a'.repeat(64),
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
    expiresAt: '2026-10-24T01:00:00.000Z',
    ...overrides,
  };
}

test('channel contracts require known outbound HTTPS adapters and reject inbound options', () => {
  assert.equal(validateChannelName('feishu').ok, true);
  assert.equal(validateChannelName('dingtalk').ok, true);
  assert.equal(validateChannelName('inbound').ok, false);
  assert.equal(validateWebhookUrl(webhook).ok, true);
  assert.equal(validateWebhookUrl('http://oapi.dingtalk.com/robot/send').ok, false);
  assert.equal(validateWebhookUrl('https://user:pass@oapi.dingtalk.com/robot/send').ok, false);
  assert.throws(
    () =>
      createChannelAdapter({
        name: 'webhook',
        webhookUrl: webhook,
        timeoutMs: 60_001,
      }),
    /timeoutMs/,
  );
  assert.throws(
    () => createDingTalkNotifier({ webhookUrl: webhook, callbackUrl: 'https://callback.test' }),
    /Inbound callbacks/,
  );
  assert.throws(
    () =>
      createChannelAdapter({
        name: 'webhook',
        webhookUrl: webhook,
        onMessage() {},
      }),
    /Inbound callbacks/,
  );
});

test('Feishu and DingTalk adapters normalize receipts and DingTalk never sends a duplicate key', async () => {
  const feishu = createFeishuAdapter({
    webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/example',
    fetchImpl: async () => response({ code: 0, data: { message_id: 'feishu-1' } }),
  });
  const feishuResult = await feishu.send({
    workItem: { workItemId: 'work-1', title: 'Export' },
    attention: attention(),
    managementUrl,
  });
  assert.equal(feishuResult.ok, true);
  assert.equal(feishuResult.receipt.provider, 'feishu');

  const calls = [];
  const dingtalk = createDingTalkNotifier({
    webhookUrl: webhook,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return response({ errcode: 0, task_id: 'ding-1' });
    },
  });
  const message = {
    workItem: {
      workItemId: 'work-1',
      projectRoot: 'C:\\customer-secret\\project',
      title: 'C:\\customer-secret\\project\\report.md',
    },
    attention: attention({
      status: 'DELIVERED',
      summary: 'token=abcdefghijklmnop and /home/owner/private/output.log',
    }),
    managementUrl,
    kind: 'attention',
    dedupeKey: 'attention-key-1:1:attention',
  };
  const first = await dingtalk.send(message);
  const second = await dingtalk.send(message);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.receipt.provider, 'dingtalk');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].msgtype, 'actionCard');
  assert.ok(calls[0].actionCard.singleURL);
  const serialized = JSON.stringify(calls[0]);
  assert.doesNotMatch(serialized, /customer-secret|abcdefghijklmnop|home\/owner|projectRoot/);
});

test('fanout isolates one failed channel from another and deduplicates per channel', async () => {
  const store = fakeStore();
  const sent = [];
  const fanout = createNotificationFanout({
    store,
    clock: () => Date.parse('2026-10-24T00:00:00.000Z'),
    maxAttempts: 1,
    channels: [
      {
        name: 'feishu',
        notifier: {
          async send() {
            return { ok: false, code: 'FEISHU_HTTP_ERROR', message: 'down' };
          },
        },
      },
      {
        name: 'dingtalk',
        notifier: {
          async send(message) {
            sent.push(message);
            return { ok: true, receipt: { messageId: 'ding-1', status: 200 } };
          },
        },
      },
    ],
  });
  const input = {
    workItem: { workItemId: 'work-1', title: 'Export' },
    attention: attention(),
    managementUrl,
  };
  const first = await fanout.enqueue(input);
  const second = await fanout.enqueue(input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.duplicates, 2);
  assert.equal(store.notifications.size, 2);
  const drained = await fanout.drain();
  assert.equal(drained.ok, true);
  assert.equal(drained.sent, 1);
  assert.equal(drained.failed, 1);
  assert.equal(sent.length, 1);
  const byChannel = new Map(
    [...store.notifications.values()].map((entry) => [entry.channel, entry]),
  );
  assert.equal(byChannel.get('feishu').status, 'failed');
  assert.equal(byChannel.get('dingtalk').status, 'sent');
});

test('object-shaped channel configuration preserves independent notifier identities', async () => {
  const store = fakeStore();
  const sentByChannel = { feishu: 0, dingtalk: 0 };
  const fanout = createNotificationFanout({
    store,
    clock: () => Date.parse('2026-10-24T00:00:00.000Z'),
    channels: {
      feishu: {
        notifier: {
          async send() {
            sentByChannel.feishu += 1;
            return { ok: true, receipt: { provider: 'feishu', messageId: 'fs-1' } };
          },
        },
      },
      dingtalk: {
        notifier: {
          async send() {
            sentByChannel.dingtalk += 1;
            return { ok: true, receipt: { provider: 'dingtalk', messageId: 'ding-1' } };
          },
        },
      },
    },
  });
  await fanout.enqueue({
    workItem: { workItemId: 'work-1', title: 'Export' },
    attention: attention(),
    managementUrl,
  });
  const drained = await fanout.drain();
  assert.equal(drained.ok, true);
  assert.equal(drained.sent, 2);
  assert.deepEqual(sentByChannel, { feishu: 1, dingtalk: 1 });
});

test('all-channel outage is contained and delivery exceeds neither maxAttempts nor one send per event', async () => {
  let now = Date.parse('2026-10-24T00:00:00.000Z');
  const store = fakeStore();
  const attempts = new Map();
  const failing = (name) => ({
    async send() {
      attempts.set(name, (attempts.get(name) || 0) + 1);
      return { ok: false, code: `${name.toUpperCase()}_HTTP_ERROR`, message: 'down' };
    },
  });
  const fanout = createNotificationFanout({
    store,
    clock: () => now,
    channels: [
      { name: 'feishu', maxAttempts: 2, baseDelayMs: 100, notifier: failing('feishu') },
      { name: 'dingtalk', maxAttempts: 2, baseDelayMs: 100, notifier: failing('dingtalk') },
    ],
  });
  await fanout.enqueue({
    workItem: { workItemId: 'work-1', title: 'Export' },
    attention: attention(),
    managementUrl,
  });
  const first = await fanout.drain();
  assert.equal(first.sent, 0);
  assert.equal(first.failed, 2);
  now += 100;
  await fanout.drain();
  now += 10_000;
  await fanout.drain();
  assert.equal(attempts.get('feishu'), 2);
  assert.equal(attempts.get('dingtalk'), 2);
  assert.ok([...store.notifications.values()].every((entry) => entry.status === 'failed'));
});

test('notification redaction is bounded, fail-closed for forbidden fields, and repeated before send', async () => {
  const forbidden = prepareNotificationMessage({
    workItem: { workItemId: 'work-1', title: 'Export' },
    attention: attention(),
    notification: { customerName: 'Example Customer' },
  });
  assert.equal(forbidden.ok, false);
  assert.equal(
    sanitizeNotificationPayload({
      workItem: {},
      attention: {},
      notification: { rawLog: 'line one' },
    }).ok,
    false,
  );

  const store = fakeStore();
  const bodies = [];
  const fanout = createNotificationFanout({
    store,
    clock: () => Date.parse('2026-10-24T00:00:00.000Z'),
    maxAttempts: 1,
    channels: [
      {
        name: 'dingtalk',
        notifier: createDingTalkNotifier({
          webhookUrl: webhook,
          fetchImpl: async (_url, options) => {
            bodies.push(JSON.parse(options.body));
            return response({ errcode: 0 });
          },
        }),
      },
    ],
  });
  const result = await fanout.enqueue({
    workItem: {
      workItemId: 'work-1',
      title: 'C:\\private\\client-a\\report.md',
    },
    attention: attention({
      summary: 'Use Bearer abcdefghijklmnop and open /tmp/private/output.log',
    }),
    managementUrl,
  });
  assert.equal(result.ok, true);
  const stored = JSON.stringify([...store.notifications.values()][0].message);
  assert.doesNotMatch(stored, /private|client-a|abcdefghijklmnop|tmp\/private/);
  await fanout.drain();
  assert.equal(bodies.length, 1);
  assert.doesNotMatch(
    JSON.stringify(bodies[0]),
    /private|client-a|abcdefghijklmnop|tmp\/private|rawLog|sourceDiff|projectRoot/,
  );
});

test('Attention lifecycle emits bounded reminders, escalates once, and expires independently of channels', async () => {
  const base = Date.parse('2026-10-24T00:00:00.000Z');
  let now = base;
  let current = attention({
    createdAt: new Date(base).toISOString(),
    updatedAt: new Date(base).toISOString(),
    expiresAt: new Date(base + 100_000).toISOString(),
  });
  const calls = [];
  const service = {
    projection: {
      async listAttention() {
        return { ok: true, attention: [structuredClone(current)] };
      },
    },
    async expireAttention({ now: expiry }) {
      if (Date.parse(current.expiresAt) > expiry)
        return { ok: true, type: 'attention.expire_noop', result: { attention: current } };
      current = {
        ...current,
        status: 'EXPIRED',
        expiredAt: new Date(expiry).toISOString(),
        updatedAt: new Date(expiry).toISOString(),
      };
      return {
        ok: true,
        type: 'attention.expired',
        result: { attention: structuredClone(current) },
      };
    },
  };
  const notifier = {
    async notifyReminder(value) {
      calls.push(['reminder', value.reminderNumber]);
      return { ok: true };
    },
    async notifyEscalation() {
      calls.push(['escalation']);
      return { ok: true };
    },
    async notifyOutcome(value) {
      calls.push(['outcome', value.stage]);
      return { ok: true };
    },
  };
  const lifecycle = createAttentionLifecycle({
    service,
    notifier,
    clock: () => now,
    reminderAfterMs: 10_000,
    escalationBeforeMs: 15_000,
    maxReminders: 2,
  });

  assert.equal((await lifecycle.tick()).reminded, 0);
  now = base + 10_000;
  assert.equal((await lifecycle.tick()).reminded, 1);
  assert.equal((await lifecycle.tick()).reminded, 0);
  now = base + 20_000;
  assert.equal((await lifecycle.tick()).reminded, 1);
  now = base + 30_000;
  assert.equal((await lifecycle.tick()).reminded, 0);
  now = base + 85_000;
  assert.equal((await lifecycle.tick()).escalated, 1);
  assert.equal((await lifecycle.tick()).escalated, 0);
  now = base + 100_000;
  const expired = await lifecycle.tick();
  assert.equal(expired.expired, 1);
  assert.equal(current.status, 'EXPIRED');
  assert.deepEqual(calls, [
    ['reminder', 1],
    ['reminder', 2],
    ['escalation'],
    ['outcome', 'expired'],
  ]);
});

test('lifecycle always expires locally even when every notification method fails', async () => {
  const base = Date.parse('2026-10-24T00:00:00.000Z');
  let now = base + 10_000;
  let current = attention({
    createdAt: new Date(base).toISOString(),
    expiresAt: new Date(base + 60_000).toISOString(),
  });
  const service = {
    async listAttention() {
      return { ok: true, attention: [structuredClone(current)] };
    },
    async expireAttention({ now: expiry }) {
      current = { ...current, status: 'EXPIRED', expiredAt: new Date(expiry).toISOString() };
      return {
        ok: true,
        type: 'attention.expired',
        result: { attention: structuredClone(current) },
      };
    },
  };
  const outage = {
    async notifyReminder() {
      throw new Error('channel unavailable');
    },
    async notifyEscalation() {
      throw new Error('channel unavailable');
    },
    async notifyOutcome() {
      throw new Error('channel unavailable');
    },
  };
  const lifecycle = createAttentionLifecycle({
    service,
    notifier: outage,
    clock: () => now,
    reminderAfterMs: 10_000,
    escalationBeforeMs: 15_000,
    maxReminders: 3,
  });
  const reminded = await lifecycle.tick();
  assert.equal(reminded.reminded, 1);
  assert.equal(reminded.errors[0].action, 'remind');
  now = base + 60_000;
  const expired = await lifecycle.tick();
  assert.equal(expired.expired, 1);
  assert.equal(expired.errors[0].action, 'notify_expired');
  assert.equal(current.status, 'EXPIRED');
});

test('lifecycle notifier creates an Attention-only short-lived link for outcome and decision messages', async () => {
  const calls = [];
  const fanout = {
    async notifyOutcome(value) {
      calls.push(['outcome', value]);
      return { ok: true };
    },
    async notifyResolution(value) {
      calls.push(['resolution', value]);
      return { ok: true };
    },
    async enqueue() {
      throw new Error('not expected');
    },
  };
  const notifier = createAttentionLifecycleNotifier({
    fanout,
    managementBaseUrl: 'https://management.example.test/',
    credentialFactory: (current) => ({
      parameter: 'nonce',
      value: `nonce-${current.requestId}`,
    }),
  });
  await notifier.notifyOutcome({
    attention: attention({ status: 'BLOCKED' }),
    stage: 'failed',
    summary: 'Recovery requires attention',
  });
  await notifier.notifyDecision({
    attention: attention({
      status: 'DECIDED',
      decisionAction: 'approve',
      decisionId: 'decision-1',
    }),
    action: 'approve',
  });
  await notifier.notifyResolution({
    attention: attention({ status: 'EXPIRED', expiredAt: '2026-10-24T01:00:00.000Z' }),
    status: 'EXPIRED',
  });
  await notifier.notifyOutcome({
    attention: attention({ status: 'BLOCKED' }),
    stage: 'recovered',
  });
  await notifier.notifyOutcome({
    attention: attention({ status: 'COMPLETED' }),
    stage: 'completed',
  });
  assert.equal(calls[0][0], 'outcome');
  assert.match(calls[0][1].managementUrl, /#attention=attention-1&nonce=nonce-attention-1$/);
  assert.equal(calls[0][1].stage, 'failed');
  assert.equal(calls[1][0], 'resolution');
  assert.equal(calls[1][1].action, 'approve');
  assert.equal(calls[2][0], 'resolution');
  assert.equal(calls[2][1].status, 'EXPIRED');
  assert.equal(calls[3][1].stage, 'recovered');
  assert.equal(calls[4][1].stage, 'completed');
});
