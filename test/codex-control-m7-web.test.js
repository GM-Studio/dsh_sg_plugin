import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createManagementServer } from '../src/codex/management/server.js';
import { createExceptionInbox } from '../src/codex/control/exception-inbox.js';
import { createSseHub } from '../src/codex/control/sse-hub.js';

const PAIRING = 'm7-web-pairing-token';
const NOW = Date.parse('2026-10-24T08:00:00.000Z');

function projection() {
  return {
    health: async () => ({ ok: true, status: 'healthy' }),
    overview: async () => ({
      ok: true,
      projects: [
        { projectId: 'project-1', name: 'One' },
        { projectId: 'project-2', name: 'Two' },
      ],
      version: 4,
    }),
    listWorkItems: async () => ({
      ok: true,
      version: 4,
      workItems: [
        {
          workItemId: 'work-1',
          projectId: 'project-1',
          executionState: 'WAITING_FOR_USER',
          title: 'Review release',
          updatedAt: '2026-10-24T06:00:00.000Z',
        },
        {
          workItemId: 'work-2',
          projectId: 'project-2',
          executionState: 'BLOCKED',
          title: 'Blocked work',
          updatedAt: '2026-10-24T05:00:00.000Z',
        },
      ],
    }),
    getWorkItem: async (workItemId) => ({
      ok: true,
      workItem: { workItemId, projectId: 'project-1', title: 'Review release' },
    }),
    getRun: async (runId) => ({ ok: true, run: { runId } }),
    listAttention: async () => ({
      ok: true,
      version: 4,
      attention: [
        {
          requestId: 'attention-1',
          workItemId: 'work-1',
          projectId: 'project-1',
          type: 'H1_APPROVAL',
          status: 'OPEN',
          revision: 2,
          workItemVersion: 3,
          artifactHash: 'a'.repeat(64),
          reason: 'Approve scope',
          question: 'Approve?',
          actions: ['approve', 'request_changes'],
          createdAt: '2026-10-24T06:00:00.000Z',
          updatedAt: '2026-10-24T06:00:00.000Z',
          expiresAt: '2026-10-24T09:00:00.000Z',
        },
      ],
    }),
    listNotifications: async () => ({
      ok: true,
      version: 4,
      notifications: [
        {
          notificationId: 'notification-1',
          attentionId: 'attention-1',
          projectId: 'project-1',
          status: 'failed',
          channel: 'feishu',
          lastError: { code: 'FEISHU_DOWN' },
        },
      ],
    }),
  };
}

async function start(t) {
  const sseHub = createSseHub({ clock: () => NOW, autoHeartbeat: false });
  const management = createManagementServer({
    services: {
      projection: projection(),
      decisions: { create: async () => ({ ok: true }) },
    },
    exceptionInbox: createExceptionInbox({
      projection: projection(),
      clock: () => NOW,
    }),
    sseHub,
    pairingToken: PAIRING,
    clock: () => NOW,
  });
  const started = await management.start();
  t.after(() => management.close());
  const paired = await fetch(`${started.baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: PAIRING }),
  });
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  return { ...started, cookie, sseHub };
}

test('exception inbox API is authenticated, ranked and filterable by project', async (t) => {
  const server = await start(t);
  assert.equal((await fetch(`${server.baseUrl}/api/inbox`)).status, 401);
  const response = await fetch(
    `${server.baseUrl}/api/inbox?projectId=project-1&risk=critical&limit=10`,
    { headers: { cookie: server.cookie } },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].attentionId, 'attention-1');
  assert.equal(body.items[0].notificationFailure, true);
  assert.equal(body.items[0].projectId, 'project-1');
  assert.equal(body.items[0].attentionRevision, 2);
  assert.equal(body.items[0].artifactHash, 'a'.repeat(64));
  assert.equal(typeof body.reconnectHintMs, 'number');
});

test('SSE endpoint emits a bounded state-change frame for its project', async (t) => {
  const server = await start(t);
  const url = new URL(`${server.baseUrl}/api/events?projectId=project-1`);
  const { chunks, request } = await new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { headers: { cookie: server.cookie, accept: 'text/event-stream' } },
      (response) => {
        assert.equal(response.statusCode, 200);
        assert.match(response.headers['content-type'], /text\/event-stream/);
        const output = [];
        response.on('data', (chunk) => {
          output.push(String(chunk));
          if (output.join('').includes('event: state.changed')) {
            resolve({ chunks: output, request: req });
          }
        });
        server.sseHub.publish({
          type: 'state.changed',
          projectId: 'project-1',
          summary: 'Control state changed',
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.match(chunks.join(''), /"projectId":"project-1"/);
  assert.doesNotMatch(chunks.join(''), /token|cookie|password/i);
  request.destroy();
});

test('management UI uses inbox plus EventSource and retains polling fallback', () => {
  const app = fs.readFileSync(path.resolve('src/codex/management/public/app.js'), 'utf8');
  const html = fs.readFileSync(path.resolve('src/codex/management/public/index.html'), 'utf8');
  assert.match(app, /new EventSource\(/);
  assert.match(app, /\/api\/events/);
  assert.match(app, /\/api\/inbox/);
  assert.match(app, /15000/);
  assert.match(app, /eventSource/);
  assert.match(html, /id="inbox-project-filter"/);
  assert.match(html, /id="inbox-risk-filter"/);
  assert.match(html, /id="inbox-status-filter"/);
});
