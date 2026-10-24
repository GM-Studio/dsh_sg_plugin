import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
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
  mysqlConfigPath: 'C:\\secure\\mysql.json',
  authEncryptionKey: 'a'.repeat(64),
  authDeviceConfirmationCodeHash: 'b'.repeat(64),
};

function accountAuth() {
  const csrf = 'remote-csrf';
  const csrfHash = createHash('sha256').update(csrf).digest('hex');
  const device = { deviceId: 'device-1', name: 'Phone', status: 'ACTIVE' };
  return {
    async login() {
      return {
        ok: true,
        token: 'remote-session',
        csrfToken: csrf,
        expiresAt: Date.parse('2026-10-24T11:00:00.000Z'),
        user: { userId: 'owner-1', username: 'owner', role: 'owner' },
        device,
      };
    },
    async authenticate({ token }) {
      if (token !== 'remote-session') return { ok: false, code: 'UNAUTHORIZED' };
      return {
        ok: true,
        session: {
          sessionId: 'session-1',
          userId: 'owner-1',
          deviceId: device.deviceId,
          csrfHash,
          authLevel: 'session',
          createdAt: '2026-10-24T10:00:00.000Z',
          expiresAt: '2026-10-24T11:00:00.000Z',
        },
        user: { userId: 'owner-1', username: 'owner', role: 'owner' },
        device,
      };
    },
    verifyCsrf: (session, supplied) =>
      session.csrfHash === createHash('sha256').update(supplied).digest('hex'),
    beginStepUp: async () => ({
      ok: true,
      challengeId: 'challenge-1',
      expiresAt: Date.now() + 60000,
    }),
    completeStepUp: async () => ({ ok: true, proof: 'proof-1', expiresAt: Date.now() + 60000 }),
    authorizeStepUp: async () => ({ ok: true }),
    listDevices: async () => ({ ok: true, devices: [device] }),
    revokeDevice: async () => ({ ok: true }),
    logout: async () => ({ ok: true }),
    redeemAttentionNonce: async () => ({ ok: true, attentionId: 'attention-1' }),
    createAttentionNonce: async () => ({ ok: true, nonce: 'nonce-1' }),
  };
}

async function startRemote(t, overrides = {}) {
  const management = createManagementServer({
    services: services(),
    authService: accountAuth(),
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
    { authService: null },
    { mysqlConfigPath: null },
    { authEncryptionKey: null },
    { authDeviceConfirmationCodeHash: null },
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

  const missingHttps = await request(server.baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { host: 'control.example.test' },
    body: { username: 'owner', password: 'secret', totpCode: '123456' },
  });
  assert.equal(missingHttps.status, 403);
  assert.equal(missingHttps.body.code, 'HTTPS_REQUIRED');

  const missingOrigin = await request(server.baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: remoteHeaders({ 'content-type': 'application/json' }),
    body: { username: 'owner', password: 'secret', totpCode: '123456' },
  });
  assert.equal(missingOrigin.status, 403);
  assert.equal(missingOrigin.body.code, 'ORIGIN_REQUIRED');

  const forgedOrigin = await request(server.baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: remoteHeaders({
      origin: 'https://attacker.example.test',
    }),
    body: { username: 'owner', password: 'secret', totpCode: '123456' },
  });
  assert.equal(forgedOrigin.status, 403);
  assert.equal(forgedOrigin.body.code, 'ORIGIN_NOT_ALLOWED');
});

test('remote mode accepts trusted HTTPS proxy traffic and emits a Secure cookie', async (t) => {
  const server = await startRemote(t);
  const paired = await request(server.baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: remoteHeaders({
      origin: 'https://control.example.test',
      'content-type': 'application/json',
    }),
    body: {
      username: 'owner',
      password: 'secret',
      totpCode: '123456',
      deviceId: 'device-1',
      deviceName: 'Phone',
    },
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
