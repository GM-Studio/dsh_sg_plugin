import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createManagementServer } from '../src/codex/management/server.js';

function services() {
  return {
    projection: {
      async health() {
        return { ok: true, status: 'healthy' };
      },
      async overview() {
        return { ok: true, projects: [], counts: {} };
      },
      async listWorkItems() {
        return { ok: true, workItems: [] };
      },
      async getWorkItem(id) {
        return { ok: true, workItem: { workItemId: id } };
      },
      async getRun(id) {
        return { ok: true, run: { runId: id } };
      },
      async listAttention() {
        return { ok: true, attention: [] };
      },
      async listNotifications() {
        return { ok: true, notifications: [] };
      },
    },
    decisions: {
      async pause() {
        return { ok: true, workItem: { executionState: 'PAUSED' } };
      },
    },
  };
}

const remoteOptions = {
  deploymentMode: 'remote',
  host: '127.0.0.1',
  secureCookie: true,
  trustProxyHttps: true,
  allowedHosts: ['control.example.test'],
  allowedOrigins: ['https://control.example.test'],
  trustedProxies: ['127.0.0.1'],
};

async function startRemote(t, overrides = {}) {
  const management = createManagementServer({
    services: services(),
    pairingToken: 'pairing-token-with-enough-entropy',
    ...remoteOptions,
    ...overrides,
  });
  const started = await management.start();
  t.after(() => management.close());
  return { management, ...started };
}

function remoteHeaders(extra = {}) {
  return {
    host: 'control.example.test',
    'x-forwarded-proto': 'https',
    ...extra,
  };
}

function request(baseUrl, pathname, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(pathname, baseUrl);
    const payload = body === null ? null : JSON.stringify(body);
    const request = http.request(
      target,
      {
        method,
        headers: {
          ...headers,
          ...(payload === null
            ? {}
            : {
                'content-length': Buffer.byteLength(payload),
              }),
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

test('remote mode refuses incomplete deployment configuration', () => {
  const invalid = [
    { allowedHosts: [] },
    { allowedOrigins: [] },
    { trustedProxies: [] },
    { trustProxyHttps: false },
    { secureCookie: false },
    { host: '0.0.0.0' },
    { allowedOrigins: ['http://control.example.test'] },
  ];
  for (const override of invalid) {
    assert.throws(
      () =>
        createManagementServer({
          services: services(),
          pairingToken: 'pairing-token-with-enough-entropy',
          ...remoteOptions,
          ...override,
        }),
      (error) => error?.code === 'REMOTE_MODE_CONFIG_INVALID',
      JSON.stringify(override),
    );
  }
});

test('remote mode rejects forged Host, Origin and untrusted proxy metadata', async (t) => {
  const server = await startRemote(t);

  const forgedHost = await request(server.baseUrl, '/api/health', {
    headers: remoteHeaders({ host: 'attacker.example.test' }),
  });
  assert.equal(forgedHost.status, 400);
  assert.equal(forgedHost.body.code, 'HOST_NOT_ALLOWED');

  const missingHttps = await request(server.baseUrl, '/api/session', {
    method: 'POST',
    headers: { host: 'control.example.test' },
    body: { token: 'pairing-token-with-enough-entropy' },
  });
  assert.equal(missingHttps.status, 403);
  assert.equal(missingHttps.body.code, 'HTTPS_REQUIRED');

  const missingOrigin = await request(server.baseUrl, '/api/session', {
    method: 'POST',
    headers: remoteHeaders({ 'content-type': 'application/json' }),
    body: { token: 'pairing-token-with-enough-entropy' },
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOrigin.body.code, 'ORIGIN_REQUIRED');

  const forgedOrigin = await request(server.baseUrl, '/api/session', {
    method: 'POST',
    headers: remoteHeaders({
      origin: 'https://attacker.example.test',
    }),
    body: { token: 'pairing-token-with-enough-entropy' },
  });
  assert.equal(forgedOrigin.status, 403);
  assert.equal(forgedOrigin.body.code, 'ORIGIN_NOT_ALLOWED');
});

test('remote mode accepts trusted HTTPS proxy traffic and emits a Secure cookie', async (t) => {
  const server = await startRemote(t);
  const paired = await request(server.baseUrl, '/api/session', {
    method: 'POST',
    headers: remoteHeaders({
      origin: 'https://control.example.test',
      'content-type': 'application/json',
    }),
    body: { token: 'pairing-token-with-enough-entropy' },
  });
  assert.equal(paired.status, 200);
  assert.match(paired.headers['set-cookie'][0], /; Secure/);
  const cookie = paired.headers['set-cookie'][0].split(';')[0];
  const health = await request(server.baseUrl, '/api/health', {
    headers: remoteHeaders({ cookie }),
  });
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'healthy');
});

test('remote mode rejects a direct client that is not a configured proxy', async (t) => {
  const server = await startRemote(t, { trustedProxies: ['10.0.0.1'] });
  const response = await request(server.baseUrl, '/api/health', {
    headers: remoteHeaders(),
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'UNTRUSTED_PROXY');
});
