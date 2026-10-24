import test from 'node:test';
import assert from 'node:assert/strict';
import { createExceptionInbox } from '../src/codex/control/exception-inbox.js';
import { createSseHub } from '../src/codex/control/sse-hub.js';

const NOW = Date.parse('2026-10-24T12:00:00.000Z');
const at = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
const later = (minutes) => new Date(NOW + minutes * 60_000).toISOString();

function workItem(overrides = {}) {
  return {
    workItemId: 'work-1',
    projectId: 'project-a',
    title: 'Review delivery',
    executionState: 'WAITING_FOR_USER',
    createdAt: at(120),
    updatedAt: at(30),
    revision: 2,
    ...overrides,
  };
}

function attention(overrides = {}) {
  return {
    requestId: 'attention-1',
    workItemId: 'work-1',
    projectId: 'project-a',
    type: 'H1_APPROVAL',
    status: 'OPEN',
    title: 'Approve scope',
    summary: 'A human decision is required.',
    actions: ['approve', 'request_changes', 'cancel'],
    createdAt: at(90),
    updatedAt: at(45),
    expiresAt: later(120),
    revision: 1,
    ...overrides,
  };
}

function projectionFor({
  attention: attentionEntries = [],
  workItems = [],
  notifications = [],
} = {}) {
  return {
    async listAttention() {
      return { ok: true, attention: structuredClone(attentionEntries) };
    },
    async listWorkItems() {
      return { ok: true, workItems: structuredClone(workItems) };
    },
    async listNotifications() {
      return { ok: true, notifications: structuredClone(notifications) };
    },
  };
}

test('exception inbox orders human-action items by risk and urgency only', async () => {
  const inbox = createExceptionInbox({
    projection: projectionFor({
      attention: [
        attention({
          requestId: 'attention-low',
          type: 'CLARIFICATION',
          title: 'Clarify',
          expiresAt: null,
          createdAt: at(5),
        }),
        attention({
          requestId: 'attention-high',
          type: 'BLOCKED',
          title: 'Blocked',
          expiresAt: null,
          createdAt: at(15),
        }),
        attention({
          requestId: 'attention-critical-older',
          type: 'H3_APPROVAL',
          title: 'Approve release',
          expiresAt: later(240),
          createdAt: at(60),
        }),
        attention({
          requestId: 'attention-critical-urgent',
          type: 'H1_APPROVAL',
          title: 'Approve scope',
          expiresAt: later(30),
          createdAt: at(30),
        }),
      ],
      workItems: [
        workItem({
          workItemId: 'running-work',
          projectId: 'project-a',
          executionState: 'RUNNING',
        }),
      ],
    }),
    clock: () => NOW,
  });

  const result = await inbox.list();
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.items.map((item) => item.id),
    [
      'attention:attention-critical-urgent',
      'attention:attention-critical-older',
      'attention:attention-high',
      'attention:attention-low',
    ],
  );
  assert.equal(
    result.items.some((item) => item.workItemId === 'running-work'),
    false,
  );
  assert.deepEqual(
    result.items.map((item) => item.risk),
    ['critical', 'critical', 'high', 'low'],
  );
  assert.deepEqual(
    result.items.map((item) => item.riskRank),
    [0, 0, 1, 3],
  );
  assert.ok(result.items[0].waitingMs > 0);
  assert.ok(result.items[0].expiresInMs > 0);
  assert.deepEqual(result.items[0].actions, ['approve', 'request_changes', 'cancel']);
});

test('expired Attentions and failed notifications remain visible with bounded metadata', async () => {
  const sensitiveSummary = 'See C:\\Users\\alice\\secret.txt and token=abcdefghijk';
  const inbox = createExceptionInbox({
    projection: projectionFor({
      attention: [
        attention({
          requestId: 'expired-attention',
          status: 'EXPIRED',
          expiresAt: at(10),
          summary: 'Expired approval needs a new request.',
        }),
        attention({
          requestId: 'failed-channel',
          type: 'BUDGET',
          summary: sensitiveSummary,
          expiresAt: later(120),
        }),
      ],
      notifications: [
        {
          notificationId: 'notification-1',
          attentionId: 'failed-channel',
          workItemId: 'work-1',
          status: 'failed',
          lastError: { code: 'FEISHU_DOWN', message: 'do not expose this' },
        },
      ],
    }),
    clock: () => NOW,
  });

  const result = await inbox.list();
  assert.equal(result.ok, true);
  const expired = result.items.find((item) => item.attentionId === 'expired-attention');
  const failed = result.items.find((item) => item.attentionId === 'failed-channel');
  assert.equal(expired.expired, true);
  assert.ok(expired.expiresInMs < 0);
  assert.equal(failed.notificationFailure, true);
  assert.equal(failed.risk, 'medium');
  assert.doesNotMatch(JSON.stringify(result), /Users|secret\.txt|token=|abcdefghijk|FEISHU_DOWN/);
});

test('project filters cannot cross project boundaries', async () => {
  const inbox = createExceptionInbox({
    projection: projectionFor({
      attention: [
        attention({ requestId: 'a-attention', projectId: 'project-a' }),
        attention({
          requestId: 'b-attention',
          projectId: 'project-b',
          workItemId: 'work-b',
        }),
      ],
    }),
    clock: () => NOW,
  });

  const filtered = await inbox.list({ projectIds: ['project-b'] });
  assert.deepEqual(
    filtered.items.map((item) => item.attentionId),
    ['b-attention'],
  );
  const denied = await inbox.list({ projectIds: ['project-c'] });
  assert.deepEqual(denied.items, []);
  const riskFiltered = await inbox.list({ risk: 'critical' });
  assert.deepEqual(
    riskFiltered.items.map((item) => item.attentionId),
    ['a-attention', 'b-attention'],
  );
  const statusFiltered = await inbox.list({ status: 'OPEN' });
  assert.equal(statusFiltered.items.length, 2);
});

test('non-owner roles never receive a broader project or action scope', async () => {
  const inbox = createExceptionInbox({
    projection: projectionFor({
      attention: [
        attention({ requestId: 'a-attention', projectId: 'project-a' }),
        attention({
          requestId: 'b-attention',
          projectId: 'project-b',
          workItemId: 'work-b',
        }),
      ],
    }),
    clock: () => NOW,
  });

  const unboundedViewer = await inbox.list({ actor: { role: 'viewer' } });
  assert.deepEqual(unboundedViewer.items, []);

  const approver = await inbox.list({
    actor: { role: 'approver' },
    allowedProjects: ['project-a'],
    tools: ['approve'],
  });
  assert.deepEqual(
    approver.items.map((item) => item.attentionId),
    ['a-attention'],
  );
  assert.deepEqual(approver.items[0].actions, ['approve']);

  const owner = await inbox.list({
    actor: { role: 'owner' },
    allowedProjects: ['project-b'],
  });
  assert.deepEqual(
    owner.items.map((item) => item.attentionId),
    ['b-attention'],
  );
});

test('pagination is deterministic, bounded and advances a monotonic version', async () => {
  const attentionEntries = [
    attention({
      requestId: 'one',
      type: 'CLARIFICATION',
      summary: 'One',
      expiresAt: null,
      createdAt: at(30),
    }),
    attention({
      requestId: 'two',
      type: 'CLARIFICATION',
      summary: 'Two',
      expiresAt: null,
      createdAt: at(20),
    }),
    attention({
      requestId: 'three',
      type: 'CLARIFICATION',
      summary: 'Three',
      expiresAt: null,
      createdAt: at(10),
    }),
  ];
  const feed = { attention: attentionEntries };
  const projection = {
    async listAttention() {
      return { ok: true, attention: structuredClone(feed.attention) };
    },
    async listWorkItems() {
      return { ok: true, workItems: [] };
    },
    async listNotifications() {
      return { ok: true, notifications: [] };
    },
  };
  const inbox = createExceptionInbox({ projection, clock: () => NOW });

  const first = await inbox.list({ limit: 2 });
  const second = await inbox.list({ limit: 2, cursor: first.nextCursor });
  assert.deepEqual(
    first.items.map((item) => item.attentionId),
    ['one', 'two'],
  );
  assert.deepEqual(
    second.items.map((item) => item.attentionId),
    ['three'],
  );
  assert.equal(first.total, 3);
  assert.equal(second.nextCursor, null);

  const version = inbox.version;
  feed.attention.push(
    attention({
      requestId: 'four',
      type: 'BLOCKED',
      summary: 'Four',
      expiresAt: null,
      createdAt: at(5),
    }),
  );
  const refreshed = await inbox.list({ sinceVersion: version });
  assert.ok(refreshed.version > version);
  assert.equal(refreshed.changed, true);
  assert.ok(refreshed.reconnectHintMs > 0);
});

test('inbox tolerates missing, failed and malformed projection methods', async () => {
  const inbox = createExceptionInbox({
    projection: {
      async listAttention() {
        throw new Error('attention unavailable');
      },
      listWorkItems() {
        return { ok: false, workItems: [] };
      },
    },
    notifications: async () => {
      throw new Error('notification unavailable');
    },
    clock: () => NOW,
  });
  const result = await inbox.list();
  assert.equal(result.ok, true);
  assert.deepEqual(result.items, []);
});

test('SSE frames are bounded, sanitized, replayable and expose polling fallback', () => {
  const hub = createSseHub({
    clock: () => NOW,
    maxClients: 3,
    maxEventsPerClient: 4,
    eventLimit: 4,
    heartbeatMs: 1000,
    autoHeartbeat: false,
  });
  const client = hub.subscribe({ id: 'client-1' });
  assert.equal(client.ok, true);

  const first = hub.publish({
    type: 'attention.updated',
    projectId: 'project-a',
    summary: 'Approval is still waiting.',
  });
  const second = hub.publish({
    eventId: 'state-2',
    type: 'work_item.blocked',
    projectId: 'project-b',
    version: 8,
    summary: 'Execution is blocked.',
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(Object.keys(second.frame).sort(), [
    'id',
    'projectId',
    'summary',
    'type',
    'version',
  ]);

  const replay = hub.subscribe({ id: 'client-2', lastEventId: first.frame.id });
  assert.equal(replay.ok, true);
  assert.deepEqual(
    replay.replay.map((frame) => frame.id),
    ['state-2'],
  );

  const polled = hub.poll({ sinceVersion: 0 });
  assert.equal(polled.changed, true);
  assert.ok(polled.version >= 8);
  assert.ok(polled.reconnectHintMs > 0);
  assert.equal(Object.hasOwn(polled, 'items'), false);

  const received = [];
  const callbackClient = hub.subscribe('callback-client', {
    onEvent: (frame) => {
      received.push(frame);
      return true;
    },
  });
  assert.equal(callbackClient.ok, true);
  hub.emit({ type: 'decision.applied', projectId: 'project-a', summary: 'Decision applied.' });
  assert.equal(received.length, 1);
  assert.equal(received[0].type, 'decision.applied');

  const drained = hub.drain('client-1');
  assert.deepEqual(
    drained.frames.map((frame) => frame.id),
    [first.frame.id, 'state-2', 'evt-2'],
  );
  hub.close();
});

test('SSE backpressure drops queued frames and signals a reconnect reset', () => {
  const hub = createSseHub({
    clock: () => NOW,
    maxEventsPerClient: 2,
    eventLimit: 10,
    heartbeatMs: 1000,
    autoHeartbeat: false,
  });
  hub.subscribe({ id: 'slow-client' });
  hub.publish({ type: 'work_item.updated', projectId: 'project-a', summary: 'One' });
  hub.publish({ type: 'work_item.updated', projectId: 'project-a', summary: 'Two' });
  const overflow = hub.publish({
    type: 'work_item.updated',
    projectId: 'project-a',
    summary: 'Three',
  });
  assert.equal(overflow.dropped, 1);

  const drained = hub.drain('slow-client');
  assert.deepEqual(drained.frames, []);
  assert.equal(drained.reset, true);
  assert.equal(drained.reason, 'CLIENT_BACKPRESSURE');
  assert.ok(drained.reconnectHintMs > 0);
  hub.close();
});

test('SSE fails closed for credentials, local paths, logs, CoT, customer names and diffs', () => {
  const hub = createSseHub({ clock: () => NOW, autoHeartbeat: false });
  const unsafe = [
    'token=super-secret-value',
    'C:\\Users\\alice\\project\\secret.txt',
    'stdout: full raw output',
    'chain of thought: hidden reasoning',
    'customerName: Acme',
    'diff --git a/file.js b/file.js',
  ];
  for (const summary of unsafe) {
    const result = hub.publish({
      type: 'evidence.updated',
      projectId: 'project-a',
      summary,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SSE_EVENT_REJECTED');
  }
  const extraField = hub.publish({
    type: 'evidence.updated',
    projectId: 'project-a',
    summary: 'Safe summary.',
    rawLog: 'secret',
  });
  assert.equal(extraField.ok, false);
  assert.equal(hub.version, 0);
  hub.close();
});

test('SSE replay rejects expired cursors and heartbeat/unsubscribe release clients', () => {
  let now = NOW;
  const hub = createSseHub({
    clock: () => now,
    maxEventsPerClient: 1,
    eventLimit: 1,
    heartbeatMs: 1000,
    autoHeartbeat: false,
  });
  hub.publish({ type: 'a', projectId: 'project-a', summary: 'One' });
  hub.publish({ type: 'b', projectId: 'project-a', summary: 'Two' });
  const expired = hub.subscribe({ id: 'stale', lastEventId: 'evt-1' });
  assert.equal(expired.ok, true);
  assert.equal(expired.reset, true);
  assert.equal(expired.reason, 'REPLAY_UNAVAILABLE');

  const idle = hub.subscribe({ id: 'idle' });
  assert.equal(idle.ok, true);
  now += 2500;
  const heartbeat = hub.heartbeat();
  assert.ok(heartbeat.cleaned >= 1);

  const removed = hub.subscribe({ id: 'removed' });
  assert.equal(removed.ok, true);
  assert.equal(hub.unsubscribe('removed').ok, true);
  assert.equal(hub.clientCount, 0);
  hub.close();
  assert.equal(hub.clientCount, 0);
});
