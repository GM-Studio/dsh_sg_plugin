import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagementServer } from '../src/codex/management/server.js';

function services() {
  const calls = [];
  return {
    calls,
    projection: {
      async health() {
        calls.push(['health']);
        return { ok: true, status: 'healthy' };
      },
      async overview() {
        calls.push(['overview']);
        return { ok: true, projects: [], counts: {} };
      },
      async listWorkItems() {
        calls.push(['listWorkItems']);
        return { ok: true, workItems: [] };
      },
      async getWorkItem(id) {
        calls.push(['getWorkItem', id]);
        return { ok: true, workItem: { workItemId: id, projectRoot: 'C:\\secret\\project' } };
      },
      async getRun(id) {
        calls.push(['getRun', id]);
        return { ok: true, run: { runId: id } };
      },
      async listAttention() {
        calls.push(['listAttention']);
        return { ok: true, attention: [] };
      },
      async listNotifications() {
        calls.push(['listNotifications']);
        return { ok: true, notifications: [] };
      },
    },
    decisions: {
      async pause(input) {
        calls.push(['pause', input]);
        return { ok: true, workItem: { executionState: 'PAUSED' } };
      },
      async create(input) {
        calls.push(['create', input]);
        return { ok: true, decision: { decisionId: 'decision-1' } };
      },
    },
  };
}

async function start(t, overrides = {}) {
  const injected = services();
  const management = createManagementServer({
    services: injected,
    pairingToken: 'pairing-token-with-enough-entropy',
    clock: () => Date.parse('2026-10-22T10:00:00.000Z'),
    ...overrides,
  });
  const started = await management.start();
  t.after(() => management.close());
  return { management, services: injected, ...started };
}

async function pair(baseUrl, token = 'pairing-token-with-enough-entropy') {
  return fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

test('pairing token is one-time and yields HttpOnly session plus CSRF token', async (t) => {
  const server = await start(t);
  const response = await pair(server.baseUrl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.csrfToken, /^[a-f0-9]{64}$/);
  const second = await pair(server.baseUrl);
  assert.equal(second.status, 401);
});

test('attention links can use independently expiring one-time pairing tokens', async (t) => {
  const server = await start(t);
  const issued = server.management.issuePairingToken({ ttlMs: 60000 });
  const first = await pair(server.baseUrl, issued.token);
  assert.equal(first.status, 200);
  const second = await pair(server.baseUrl, issued.token);
  assert.equal(second.status, 401);
  const original = await pair(server.baseUrl);
  assert.equal(original.status, 200);
});

test('queries require a session and never invoke mutation services', async (t) => {
  const server = await start(t);
  const unauthorized = await fetch(`${server.baseUrl}/api/health`);
  assert.equal(unauthorized.status, 401);
  const paired = await pair(server.baseUrl);
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${server.baseUrl}/api/work-items/work-1`, {
    headers: { cookie },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.workItem.workItemId, 'work-1');
  assert.doesNotMatch(JSON.stringify(body), /C:\\\\secret/);
  assert.equal(
    server.services.calls.some(([name]) => name === 'pause'),
    false,
  );
});

test('mutations require CSRF and pass the session actor instead of body identity', async (t) => {
  const server = await start(t);
  const paired = await pair(server.baseUrl);
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await paired.json();
  const rejected = await fetch(`${server.baseUrl}/api/work-items/pause`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ workItemId: 'work-1', expectedVersion: 2 }),
  });
  assert.equal(rejected.status, 403);
  const accepted = await fetch(`${server.baseUrl}/api/work-items/pause`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': csrfToken,
    },
    body: JSON.stringify({
      workItemId: 'work-1',
      expectedVersion: 2,
      actorId: 'forged-owner',
    }),
  });
  assert.equal(accepted.status, 200);
  const call = server.services.calls.find(([name]) => name === 'pause');
  assert.equal(call[1].actorId, 'local-owner');
  assert.equal(call[1].source, 'web');
});

test('step-up and security headers fail closed', async (t) => {
  const server = await start(t, {
    services: {
      ...services(),
      verifyStepUp: async (code) => code === '123456',
    },
  });
  const paired = await pair(server.baseUrl);
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await paired.json();
  const bad = await fetch(`${server.baseUrl}/api/decisions`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': csrfToken,
    },
    body: JSON.stringify({ stepUpCode: '000000' }),
  });
  assert.equal(bad.status, 403);
  assert.match(bad.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(bad.headers.get('x-content-type-options'), 'nosniff');
});

test('expired sessions and unsafe static paths fail without filesystem escape', async (t) => {
  let now = Date.parse('2026-10-22T10:00:00.000Z');
  const server = await start(t, { clock: () => now, sessionTtlMs: 1000 });
  const paired = await pair(server.baseUrl);
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  now += 2000;
  const expired = await fetch(`${server.baseUrl}/api/health`, { headers: { cookie } });
  assert.equal(expired.status, 401);
  const traversal = await fetch(`${server.baseUrl}/..%2fpackage.json`);
  assert.equal(traversal.status, 404);
});

test('management requests have a bounded per-client rate limit', async (t) => {
  const server = await start(t, { rateLimitPerMinute: 2 });
  assert.equal((await fetch(`${server.baseUrl}/api/session`)).status, 401);
  assert.equal((await fetch(`${server.baseUrl}/api/session`)).status, 401);
  const limited = await fetch(`${server.baseUrl}/api/session`);
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, 'RATE_LIMITED');
});

test('HTTPS deployment mode marks the session cookie Secure', async (t) => {
  const server = await start(t, { secureCookie: true });
  const paired = await pair(server.baseUrl);
  assert.equal(paired.status, 200);
  assert.match(paired.headers.get('set-cookie'), /; Secure/);
});
