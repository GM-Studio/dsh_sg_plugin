import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagementServer } from '../src/codex/management/server.js';

function services() {
  const calls = [];
  return {
    calls,
    projection: {
      health: async () => ({ ok: true, status: 'healthy' }),
      overview: async () => ({
        ok: true,
        projects: [{ projectId: 'project-1', name: 'CRM' }],
        counts: { workItems: 1, waiting: 1 },
      }),
      listWorkItems: async () => ({
        ok: true,
        workItems: [{ workItemId: 'work-1', executionState: 'WAITING_FOR_USER' }],
      }),
      getWorkItem: async (id) => ({
        ok: true,
        workItem: { workItemId: id, summary: { status: 'WAITING_FOR_USER' } },
        run: { runId: 'run-1', executionState: 'WAITING_FOR_USER' },
        decisions: [],
        notifications: [],
      }),
      getRun: async (id) => ({ ok: true, run: { runId: id, currentPhase: 'REVIEWING' } }),
      listAttention: async () => ({ ok: true, attention: [{ requestId: 'attention-1' }] }),
      getAttentionDocument: async (id) => ({
        ok: true,
        attentionId: id,
        document: {
          path: '.specgate/codex/changes/change-1/requirements/revision-1.md',
          content: '# 需求文档\n\n<script>alert("unsafe")</script>',
        },
      }),
      listNotifications: async () => ({
        ok: true,
        notifications: [{ notificationId: 'notice-1' }],
      }),
    },
    decisions: {
      create: async (input) => {
        calls.push(['create', input]);
        return { ok: true, decision: { decisionId: 'decision-1' } };
      },
      pause: async (input) => {
        calls.push(['pause', input]);
        return { ok: true };
      },
      resume: async (input) => {
        calls.push(['resume', input]);
        return { ok: true };
      },
      retry: async (input) => {
        calls.push(['retry', input]);
        return { ok: true };
      },
      cancel: async (input) => {
        calls.push(['cancel', input]);
        return { ok: true };
      },
      requestChanges: async (input) => {
        calls.push(['requestChanges', input]);
        return { ok: true };
      },
      resendNotification: async (input) => {
        calls.push(['resendNotification', input]);
        return { ok: true };
      },
    },
    workItems: {
      async create(input) {
        calls.push(['createWorkItem', input]);
        return { ok: true, workItem: { workItemId: 'work-created' } };
      },
    },
    deliveries: {
      async accept(input) {
        calls.push(['acceptDelivery', input]);
        return { ok: true, deliveryAccepted: true };
      },
    },
  };
}

async function setup(t, injected = services()) {
  const management = createManagementServer({
    services: injected,
    pairingToken: 'pairing-token-with-enough-entropy',
  });
  const started = await management.start();
  t.after(() => management.close());
  const paired = await fetch(`${started.baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'pairing-token-with-enough-entropy' }),
  });
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await paired.json();
  return { ...started, services: injected, cookie, csrfToken };
}

test('automatic management ports retry browser-blocked allocations before publishing a URL', async (t) => {
  const management = createManagementServer({ services: services() });
  t.after(() => management.close());
  const actualAddress = management.server.address.bind(management.server);
  let addressCalls = 0;
  t.mock.method(management.server, 'address', () => {
    const address = actualAddress();
    return ++addressCalls === 1 ? { ...address, port: 6000 } : address;
  });
  const listen = t.mock.method(management.server, 'listen');
  const started = await management.start();
  assert.notEqual(started.port, 6000);
  assert.equal(listen.mock.callCount(), 2);
  assert.ok(listen.mock.calls.every(({ arguments: args }) => args[0] === 0));
  const response = await fetch(`${started.baseUrl}/`);
  assert.equal(response.status, 200);
});

test('an explicit browser-blocked management port is rejected without rebinding', async (t) => {
  const management = createManagementServer({ services: services() });
  t.after(() => management.close());
  const listen = t.mock.method(management.server, 'listen', () => {
    throw new Error('Blocked ports must be rejected before listening');
  });
  await assert.rejects(management.start({ port: 6000 }), { code: 'MANAGEMENT_PORT_BLOCKED' });
  assert.equal(listen.mock.callCount(), 0);
});

test('repeated browser-blocked dynamic allocations fail within a bound and close the listener', async (t) => {
  const management = createManagementServer({ services: services() });
  t.after(() => management.close());
  const actualAddress = management.server.address.bind(management.server);
  t.mock.method(management.server, 'address', () => ({ ...actualAddress(), port: 6000 }));
  const listen = t.mock.method(management.server, 'listen');
  await assert.rejects(management.start(), { code: 'MANAGEMENT_PORT_UNAVAILABLE' });
  assert.ok(listen.mock.callCount() > 1 && listen.mock.callCount() <= 16);
  assert.equal(management.server.listening, false);
});

test('all management query routes are available through GET', async (t) => {
  const server = await setup(t);
  for (const [path, key] of [
    ['/api/health', null],
    ['/api/projects', 'projects'],
    ['/api/work-items', 'workItems'],
    ['/api/work-items/work-1', 'workItem'],
    ['/api/runs/run-1', 'run'],
    ['/api/attention', 'attention'],
    ['/api/notifications', 'notifications'],
  ]) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      headers: { cookie: server.cookie },
    });
    assert.equal(response.status, 200, path);
    const body = await response.json();
    assert.equal(body.ok, true, path);
    if (key) assert.ok(body[key], path);
  }
});

test('management shell is served without exposing API data', async (t) => {
  const server = await setup(t);
  const response = await fetch(`${server.baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /SpecGate/);
  assert.match(html, /异步交付控制台/);
  assert.doesNotMatch(html, /local-owner|csrfToken|projectRoot/);
});

test('H1 attention documents open as authenticated escaped HTML pages', async (t) => {
  const server = await setup(t);
  const response = await fetch(`${server.baseUrl}/api/attention/attention-1/document`, {
    headers: { cookie: server.cookie },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /需求文档/);
  assert.match(html, /&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /SpecGate 审批文档/);
});

test('all management mutations use POST and route to the shared Decision service', async (t) => {
  const server = await setup(t);
  for (const [path, expected] of [
    ['/api/work-items/pause', 'pause'],
    ['/api/work-items/resume', 'resume'],
    ['/api/work-items/retry', 'retry'],
    ['/api/work-items/cancel', 'cancel'],
    ['/api/work-items/request-changes', 'requestChanges'],
    ['/api/notifications/resend', 'resendNotification'],
    ['/api/work-items/create', 'createWorkItem'],
    ['/api/deliveries/accept', 'acceptDelivery'],
  ]) {
    const response = await fetch(`${server.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        cookie: server.cookie,
        'content-type': 'application/json',
        'x-specgate-csrf': server.csrfToken,
      },
      body: JSON.stringify({ workItemId: 'work-1', expectedVersion: 2 }),
    });
    assert.equal(response.status, 200, path);
    assert.ok(
      server.services.calls.some(([name]) => name === expected),
      path,
    );
  }
});

test('wrong methods and malformed bodies return JSON', async (t) => {
  const server = await setup(t);
  const wrong = await fetch(`${server.baseUrl}/api/work-items`, {
    method: 'POST',
    headers: {
      cookie: server.cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': server.csrfToken,
    },
    body: '{}',
  });
  assert.equal(wrong.status, 405);
  const malformed = await fetch(`${server.baseUrl}/api/work-items/pause`, {
    method: 'POST',
    headers: {
      cookie: server.cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': server.csrfToken,
    },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).ok, false);
});

function memoryStore() {
  let state = { sessions: {}, pairing: {} };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  return {
    load: () => clone(state),
    save: (next) => {
      state = clone(next);
    },
    remove: (id) => {
      delete state.sessions[id];
    },
    raw: () => state,
  };
}

test('query and mutation routes keep working after a restart with a durable store', async (t) => {
  const store = memoryStore();
  const firstServices = services();
  const firstServer = createManagementServer({
    services: firstServices,
    pairingToken: 'pairing-token-with-enough-entropy',
    sessionStore: store,
  });
  const started = await firstServer.start();
  const paired = await fetch(`${started.baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'pairing-token-with-enough-entropy' }),
  });
  assert.equal(paired.status, 200);
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await paired.json();
  await firstServer.close();

  const secondServices = services();
  const secondServer = createManagementServer({
    services: secondServices,
    pairingToken: 'pairing-token-with-enough-entropy',
    sessionStore: store,
  });
  const restarted = await secondServer.start();
  t.after(() => secondServer.close());

  for (const [path, key] of [
    ['/api/health', null],
    ['/api/work-items/work-1', 'workItem'],
  ]) {
    const response = await fetch(`${restarted.baseUrl}${path}`, { headers: { cookie } });
    assert.equal(response.status, 200, path);
    const body = await response.json();
    assert.equal(body.ok, true, path);
    if (key) assert.ok(body[key], path);
  }

  const mutation = await fetch(`${restarted.baseUrl}/api/work-items/pause`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': csrfToken,
    },
    body: JSON.stringify({ workItemId: 'work-1', expectedVersion: 2 }),
  });
  assert.equal(mutation.status, 200);
  assert.ok(secondServices.calls.some(([name]) => name === 'pause'));
});

test('existing query routes serve the cross-project portfolio and attention data', async (t) => {
  const injected = {
    projection: {
      health: async () => ({ ok: true, status: 'healthy' }),
      overview: async () => ({
        ok: true,
        projects: [
          { projectId: 'project-1', name: 'CRM', status: 'READY', projectRoot: 'C:/work/crm' },
          {
            projectId: 'project-2',
            name: 'Billing',
            status: 'READY',
            projectRoot: '/home/me/billing',
          },
        ],
      }),
      listWorkItems: async () => ({
        ok: true,
        workItems: [
          {
            workItemId: 'work-1',
            projectId: 'project-1',
            executionState: 'RUNNING',
            hostHealth: 'ONLINE',
            title: 'A',
          },
          {
            workItemId: 'work-2',
            projectId: 'project-1',
            executionState: 'FAILED',
            hostHealth: 'OFFLINE',
            title: 'B',
          },
          {
            workItemId: 'work-3',
            projectId: 'project-2',
            executionState: 'WAITING_FOR_USER',
            hostHealth: 'ONLINE',
            title: 'C',
          },
        ],
      }),
      listAttention: async () => ({
        ok: true,
        attention: [
          {
            requestId: 'attention-1',
            workItemId: 'work-1',
            projectId: 'project-1',
            type: 'H1_APPROVAL',
            status: 'OPEN',
            revision: 1,
            createdAt: '2025-01-01T00:00:00.000Z',
            expiresAt: '2025-01-02T00:00:00.000Z',
          },
          {
            requestId: 'attention-2',
            workItemId: 'work-3',
            projectId: 'project-2',
            type: 'CLARIFICATION',
            status: 'REMINDED',
            revision: 1,
            createdAt: '2025-01-02T00:00:00.000Z',
            expiresAt: '2025-01-03T00:00:00.000Z',
          },
        ],
      }),
    },
    decisions: { create: async () => ({ ok: true }) },
  };
  const server = await setup(t, injected);

  const projectsResponse = await fetch(`${server.baseUrl}/api/projects`, {
    headers: { cookie: server.cookie },
  });
  const projects = (await projectsResponse.json()).projects;
  assert.equal(projects.length, 2);
  assert.ok(projects.every((project) => typeof project.projectId === 'string' && project.name));
  // Host health is derived client-side from WorkItems, so no project root leaks.
  assert.ok(projects.every((project) => project.projectRoot === undefined));

  const workItemsResponse = await fetch(`${server.baseUrl}/api/work-items`, {
    headers: { cookie: server.cookie },
  });
  const workItems = (await workItemsResponse.json()).workItems;
  assert.equal(workItems.length, 3);
  assert.ok(
    workItems.every(
      (item) => typeof item.projectId === 'string' && typeof item.executionState === 'string',
    ),
  );
  assert.ok(workItems.some((item) => item.hostHealth === 'OFFLINE'));

  const attentionResponse = await fetch(`${server.baseUrl}/api/attention`, {
    headers: { cookie: server.cookie },
  });
  const attention = (await attentionResponse.json()).attention;
  assert.equal(attention.length, 2);
  assert.ok(attention.every((entry) => entry.projectId && entry.type && entry.status));
});
