import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createManagementServer } from '../src/codex/management/server.js';

const PAIRING = 'worker-management-pairing-token';
const WORKER_TOKEN = 'sgw_test_worker_token_0123456789';

function controlServices() {
  return {
    async verifyStepUp(code) {
      return code === '246810' ? 'step-up' : null;
    },
    projection: {
      health: async () => ({ ok: true, status: 'healthy' }),
      overview: async () => ({ ok: true, projects: [] }),
      listWorkItems: async () => ({ ok: true, workItems: [] }),
      getWorkItem: async (id) => ({ ok: true, workItem: { workItemId: id } }),
      getRun: async (id) => ({ ok: true, run: { runId: id } }),
      listAttention: async () => ({ ok: true, attention: [] }),
      listNotifications: async () => ({ ok: true, notifications: [] }),
    },
    decisions: {
      create: async () => ({ ok: true }),
    },
  };
}

function workerGateway() {
  const calls = [];
  return {
    calls,
    async register(input) {
      calls.push(['register', input]);
      return {
        ok: true,
        worker: { workerId: 'worker-1', tokenHash: 'a'.repeat(64) },
        token: WORKER_TOKEN,
      };
    },
    async rotateToken(input) {
      calls.push(['rotateToken', input]);
      return { ok: true, token: 'sgw_rotated_worker_token_0123456789' };
    },
    async revoke(input) {
      calls.push(['revoke', input]);
      return { ok: true, workerId: input.workerId };
    },
    async listWorkers() {
      calls.push(['listWorkers']);
      return { ok: true, workers: [{ workerId: 'worker-1', status: 'ONLINE' }] };
    },
    async setProjects(input) {
      calls.push(['setProjects', input]);
      return { ok: true, projectIds: input.projectIds };
    },
    async connect(input) {
      calls.push(['connect', input]);
      return { ok: true, workerId: 'worker-1', heartbeatIntervalMs: 15000 };
    },
    async sync(input) {
      calls.push(['sync', input]);
      return { ok: true, cursor: 1, commands: [], pendingDecisions: [] };
    },
    async claim(input) {
      calls.push(['claim', input]);
      return { ok: true, idle: true };
    },
    async heartbeat(input) {
      calls.push(['heartbeat', input]);
      return { ok: true, run: { runId: input.runId, revision: 2 } };
    },
    async reportEvents(input) {
      calls.push(['reportEvents', input]);
      return { ok: true, accepted: input.events.length };
    },
    async pullCommands(input) {
      calls.push(['pullCommands', input]);
      return { ok: true, commands: [{ commandId: 'command-1', kind: 'CLAIM' }], cursor: 1 };
    },
    async ackCommand(input) {
      calls.push(['ackCommand', input]);
      return { ok: true, commandId: input.commandId };
    },
    async release(input) {
      calls.push(['release', input]);
      return { ok: true, released: true };
    },
    async reportWaiting(input) {
      calls.push(['reportWaiting', input]);
      return { ok: true, status: 'waiting', attention: { requestId: 'attention-1' } };
    },
    async finishRun(input) {
      calls.push(['finishRun', input]);
      return { ok: true, status: input.status };
    },
    async beginDecisionApply(input) {
      calls.push(['beginDecisionApply', input]);
      return { ok: true, decision: { decisionId: input.decisionId, applyStatus: 'PENDING_APPLY' } };
    },
    async completeDecisionApply(input) {
      calls.push(['completeDecisionApply', input]);
      return { ok: true, decision: { decisionId: input.decisionId, status: 'APPLIED' } };
    },
    async failDecisionApply(input) {
      calls.push(['failDecisionApply', input]);
      return { ok: false, code: 'DECISION_APPLY_FAILED' };
    },
    async issueCommand(input) {
      calls.push(['issueCommand', input]);
      return { ok: true, command: { commandId: 'command-1', kind: input.kind } };
    },
  };
}

async function start(t) {
  const gateway = workerGateway();
  const management = createManagementServer({
    services: controlServices(),
    workerGateway: gateway,
    pairingToken: PAIRING,
  });
  const started = await management.start();
  t.after(() => management.close());
  const paired = await fetch(`${started.baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: PAIRING }),
  });
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await paired.json();
  return { ...started, cookie, csrfToken, gateway };
}

function adminPost(server, pathname, body) {
  return fetch(`${server.baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      cookie: server.cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': server.csrfToken,
    },
    body: JSON.stringify({ ...body, stepUpCode: '246810' }),
  });
}

function workerPost(server, pathname, body) {
  return fetch(`${server.baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${WORKER_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function request(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === null ? null : JSON.stringify(body);
    const request = http.request(
      new URL(url),
      {
        method,
        headers: {
          ...headers,
          ...(payload === null ? {} : { 'content-length': Buffer.byteLength(payload) }),
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: text ? JSON.parse(text) : null,
          });
        });
      },
    );
    request.on('error', reject);
    if (payload !== null) request.write(payload);
    request.end();
  });
}

test('worker administration requires a trusted session, CSRF and step-up', async (t) => {
  const server = await start(t);
  const unauthorized = await fetch(`${server.baseUrl}/api/workers`);
  assert.equal(unauthorized.status, 401);
  const missingStepUp = await fetch(`${server.baseUrl}/api/workers/register`, {
    method: 'POST',
    headers: {
      cookie: server.cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': server.csrfToken,
    },
    body: JSON.stringify({ displayName: 'Laptop', projectIds: ['project-1'] }),
  });
  assert.equal(missingStepUp.status, 403);
  const registered = await adminPost(server, '/api/workers/register', {
    displayName: 'Laptop',
    projectIds: ['project-1'],
    capabilities: { codex: 'exec-json' },
  });
  const body = await registered.json();
  assert.equal(registered.status, 200);
  assert.equal(body.token, WORKER_TOKEN);
  assert.equal(JSON.stringify(body).includes('tokenHash'), false);
  const call = server.gateway.calls.find(([name]) => name === 'register');
  assert.equal(call[1].actorId, 'local-owner');
  assert.equal(Object.hasOwn(call[1], 'source'), false);
  assert.equal(Object.hasOwn(call[1], 'authLevel'), false);
  const listed = await fetch(`${server.baseUrl}/api/workers`, {
    headers: { cookie: server.cookie },
  });
  assert.equal((await listed.json()).workers.length, 1);
});

test('worker management rotates, updates and revokes without leaking tokens', async (t) => {
  const server = await start(t);
  for (const [path, body] of [
    ['/api/workers/rotate', { workerId: 'worker-1' }],
    ['/api/workers/projects', { workerId: 'worker-1', projectIds: ['project-2'] }],
    ['/api/workers/revoke', { workerId: 'worker-1' }],
    ['/api/workers/commands', { workerId: 'worker-1', kind: 'CLAIM', payload: {} }],
  ]) {
    const response = await adminPost(server, path, body);
    assert.equal(response.status, 200, path);
  }
  const auditText = JSON.stringify(server.gateway.calls);
  assert.doesNotMatch(auditText, /246810/);
});

test('worker API uses independent bearer auth without cookies or CSRF', async (t) => {
  const server = await start(t);
  const noBearer = await fetch(`${server.baseUrl}/api/worker/connect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(noBearer.status, 401);
  const connected = await workerPost(server, '/api/worker/connect', {
    capabilities: { codex: 'exec-json' },
  });
  assert.equal(connected.status, 200);
  const synced = await workerPost(server, '/api/worker/sync', { cursor: 0, waitMs: 0 });
  assert.equal(synced.status, 200);
  const commands = await fetch(`${server.baseUrl}/api/worker/commands?after=0&limit=5`, {
    headers: { authorization: `Bearer ${WORKER_TOKEN}` },
  });
  assert.equal(commands.status, 200);
  const claimed = await workerPost(server, '/api/worker/claim', { leaseMs: 30000 });
  assert.equal(claimed.status, 200);
  const heartbeat = await workerPost(server, '/api/worker/heartbeat', {
    runId: 'run-1',
    leaseToken: 'lease-token',
    expectedRunVersion: 1,
  });
  assert.equal(heartbeat.status, 200);
  const events = await workerPost(server, '/api/worker/events', {
    events: [{ eventId: 'event-1', dedupeKey: 'evidence-1', type: 'evidence', payload: {} }],
  });
  assert.equal(events.status, 200);
  const ack = await workerPost(server, '/api/worker/commands/ack', { commandId: 'command-1' });
  assert.equal(ack.status, 200);
  const released = await workerPost(server, '/api/worker/release', {
    runId: 'run-1',
    leaseToken: 'lease-token',
  });
  assert.equal(released.status, 200);
  const waiting = await workerPost(server, '/api/worker/waiting', {
    runId: 'run-1',
    leaseToken: 'lease-token',
    sessionId: 'session-1',
    waiting: {
      type: 'H1_APPROVAL',
      reason: 'Confirm',
      question: 'Approve?',
      actions: ['approve', 'request_changes'],
      artifactHash: 'a'.repeat(64),
    },
  });
  assert.equal(waiting.status, 200);
  const finished = await workerPost(server, '/api/worker/finish', {
    runId: 'run-1',
    leaseToken: 'lease-token',
    status: 'COMPLETED',
    outcome: { summary: 'done' },
  });
  assert.equal(finished.status, 200);
  const applying = await workerPost(server, '/api/worker/decisions/apply', {
    decisionId: 'decision-1',
    workItemId: 'work-1',
  });
  assert.equal(applying.status, 200);
  const completedApply = await workerPost(server, '/api/worker/decisions/complete', {
    decisionId: 'decision-1',
    workItemId: 'work-1',
  });
  assert.equal(completedApply.status, 200);
  const failedApply = await workerPost(server, '/api/worker/decisions/fail', {
    decisionId: 'decision-1',
    workItemId: 'work-1',
    error: 'session unavailable',
  });
  assert.equal(failedApply.status, 409);
  const calls = server.gateway.calls;
  assert.ok(calls.some(([name]) => name === 'connect'));
  assert.ok(calls.some(([name]) => name === 'sync'));
  assert.ok(calls.some(([name]) => name === 'claim'));
  assert.ok(calls.some(([name]) => name === 'heartbeat'));
  assert.ok(calls.some(([name]) => name === 'reportEvents'));
  assert.ok(calls.some(([name]) => name === 'ackCommand'));
  assert.ok(calls.some(([name]) => name === 'release'));
  assert.ok(calls.some(([name]) => name === 'reportWaiting'));
  assert.ok(calls.some(([name]) => name === 'finishRun'));
  assert.ok(calls.some(([name]) => name === 'beginDecisionApply'));
  assert.ok(calls.some(([name]) => name === 'completeDecisionApply'));
  assert.ok(calls.some(([name]) => name === 'failDecisionApply'));
});

test('worker API rejects unknown routes and malformed command cursors', async (t) => {
  const server = await start(t);
  const unknown = await workerPost(server, '/api/worker/shell', { command: 'whoami' });
  assert.equal(unknown.status, 404);
  const malformed = await fetch(`${server.baseUrl}/api/worker/commands?after=nope`, {
    headers: { authorization: `Bearer ${WORKER_TOKEN}` },
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, 'INVALID_ARGUMENT');
});

test('remote worker requests keep HTTPS/Host boundaries without browser Origin', async (t) => {
  const gateway = workerGateway();
  const management = createManagementServer({
    services: controlServices(),
    authService: {
      login: async () => ({ ok: false }),
      authenticate: async () => ({ ok: false }),
      verifyCsrf: () => false,
      beginStepUp: async () => ({ ok: false }),
      completeStepUp: async () => ({ ok: false }),
      authorizeStepUp: async () => ({ ok: false }),
      listDevices: async () => ({ ok: true, devices: [] }),
      revokeDevice: async () => ({ ok: true }),
      logout: async () => ({ ok: true }),
      redeemAttentionNonce: async () => ({ ok: true }),
      createAttentionNonce: async () => ({ ok: true }),
    },
    workerGateway: gateway,
    deploymentMode: 'remote',
    secureCookie: true,
    trustProxyHttps: true,
    allowedHosts: ['control.example.test'],
    allowedOrigins: ['https://control.example.test'],
    trustedProxies: ['127.0.0.1'],
    // 平台无关的绝对路径：Windows 的 C:\... 在 Linux 上不是绝对路径，
    // 会让 server.js 的 path.isAbsolute 校验抛 REMOTE_MODE_CONFIG_INVALID。
    mysqlConfigPath: path.resolve('/secure/mysql.json'),
    authEncryptionKey: 'a'.repeat(64),
    authDeviceConfirmationCodeHash: 'b'.repeat(64),
  });
  const started = await management.start();
  t.after(() => management.close());
  const response = await request(`${started.baseUrl}/api/worker/connect`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${WORKER_TOKEN}`,
      'content-type': 'application/json',
      host: 'control.example.test',
      'x-forwarded-proto': 'https',
    },
    body: {},
  });
  assert.equal(response.status, 200);
});
