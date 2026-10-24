import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createManagementServer } from '../src/codex/management/server.js';

const NOW = Date.parse('2026-10-24T10:00:00.000Z');
const TOKEN = 'opaque-session-token';
const CSRF = 'csrf-token';
const hash = (value) => createHash('sha256').update(value).digest('hex');

function controlServices() {
  const calls = [];
  return {
    calls,
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
      async resume(input) {
        calls.push(['resume', input]);
        return { ok: true, workItem: { executionState: 'QUEUED' } };
      },
      async pause(input) {
        calls.push(['pause', input]);
        return { ok: true };
      },
    },
  };
}

function accountService() {
  let deviceRevoked = false;
  const proofs = new Map();
  const challenges = new Map();
  const devices = [
    {
      deviceId: 'device-current',
      name: 'Current browser',
      status: 'ACTIVE',
      current: true,
    },
  ];
  return {
    devices,
    async login(input) {
      assert.equal(input.password, 'correct horse battery staple');
      assert.equal(input.totpCode, '123456');
      assert.equal(input.deviceId, 'device-current');
      return {
        ok: true,
        token: TOKEN,
        csrfToken: CSRF,
        expiresAt: NOW + 60_000,
        user: { userId: 'user-1', username: 'owner', role: 'owner' },
        device: devices[0],
      };
    },
    async authenticate({ token }) {
      if (token !== TOKEN || deviceRevoked) return { ok: false, code: 'UNAUTHORIZED' };
      return {
        ok: true,
        session: {
          sessionId: 'session-1',
          userId: 'user-1',
          deviceId: 'device-current',
          csrfHash: hash(CSRF),
          authLevel: 'session',
          expiresAt: new Date(NOW + 60_000).toISOString(),
          createdAt: new Date(NOW).toISOString(),
        },
        user: { userId: 'user-1', username: 'owner', role: 'owner' },
        device: devices[0],
      };
    },
    verifyCsrf(session, supplied) {
      return session.csrfHash === hash(supplied);
    },
    async beginStepUp({ action, resourceId }) {
      const challengeId = `challenge-${challenges.size + 1}`;
      challenges.set(challengeId, { action, resourceId });
      return { ok: true, challengeId, expiresAt: NOW + 60_000 };
    },
    async completeStepUp({ challengeId }) {
      const challenge = challenges.get(challengeId);
      if (!challenge) return { ok: false, code: 'CHALLENGE_INVALID' };
      challenges.delete(challengeId);
      const proof = `proof-${challenge.action}-${challenge.resourceId}`;
      proofs.set(proof, challenge);
      return { ok: true, proof, ...challenge, expiresAt: NOW + 60_000 };
    },
    async authorizeStepUp({ proof, action, resourceId }) {
      const stored = proofs.get(proof);
      if (!stored || stored.action !== action || stored.resourceId !== resourceId)
        return { ok: false, code: 'STEP_UP_REQUIRED' };
      proofs.delete(proof);
      return { ok: true };
    },
    async listDevices() {
      return { ok: true, devices };
    },
    async revokeDevice({ deviceId, proof }) {
      const stored = proofs.get(proof);
      if (!stored || stored.action !== 'device.revoke' || stored.resourceId !== deviceId)
        return { ok: false, code: 'STEP_UP_REQUIRED' };
      proofs.delete(proof);
      const device = devices.find((entry) => entry.deviceId === deviceId);
      if (device) device.status = 'REVOKED';
      if (deviceId === 'device-current') deviceRevoked = true;
      return { ok: true, device };
    },
    async redeemAttentionNonce({ nonce }) {
      return nonce === 'attention-nonce'
        ? { ok: true, attentionId: 'attention-1' }
        : { ok: false, code: 'NONCE_INVALID' };
    },
    async createAttentionNonce() {
      return { ok: true, nonce: 'attention-nonce', expiresAt: NOW + 60_000 };
    },
    async logout() {
      return { ok: true };
    },
  };
}

async function start(t) {
  const services = controlServices();
  const authService = accountService();
  const management = createManagementServer({
    services,
    authService,
    clock: () => NOW,
  });
  const started = await management.start();
  t.after(() => management.close());
  const login = await fetch(`${started.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'owner',
      password: 'correct horse battery staple',
      totpCode: '123456',
      deviceId: 'device-current',
      deviceName: 'Current browser',
    }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const body = await login.json();
  assert.equal(body.csrfToken, CSRF);
  return { ...started, cookie, csrfToken: body.csrfToken, services, authService };
}

function post(baseUrl, path, cookie, csrfToken, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      ...(csrfToken ? { 'x-specgate-csrf': csrfToken } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('account mode advertises password and TOTP login and disables pairing sessions', async (t) => {
  const server = await start(t);
  const methods = await fetch(`${server.baseUrl}/api/auth/methods`);
  assert.deepEqual((await methods.json()).methods, ['password', 'totp']);
  const pairing = await post(server.baseUrl, '/api/session', null, null, { token: 'old-pairing' });
  assert.equal(pairing.status, 401);
  assert.equal((await pairing.json()).code, 'PAIRING_DISABLED');
  const session = await fetch(`${server.baseUrl}/api/session`, {
    headers: { cookie: server.cookie },
  });
  const sessionBody = await session.json();
  assert.equal(
    sessionBody.mode,
    'account',
    JSON.stringify({ status: session.status, sessionBody }),
  );
});

test('high-risk mutations require a CSRF-bound, action-bound, one-time TOTP proof', async (t) => {
  const server = await start(t);
  const withoutCsrf = await post(server.baseUrl, '/api/work-items/resume', server.cookie, null, {
    workItemId: 'work-1',
  });
  assert.equal(withoutCsrf.status, 403);
  const withoutProof = await post(
    server.baseUrl,
    '/api/work-items/resume',
    server.cookie,
    server.csrfToken,
    { workItemId: 'work-1' },
  );
  assert.equal(withoutProof.status, 403);
  assert.equal((await withoutProof.json()).code, 'STEP_UP_REQUIRED');

  const challenge = await post(
    server.baseUrl,
    '/api/auth/step-up/challenge',
    server.cookie,
    server.csrfToken,
    { action: 'resume', resourceId: 'work-1' },
  );
  const challengeBody = await challenge.json();
  assert.equal(challengeBody.ok, true);
  const verified = await post(
    server.baseUrl,
    '/api/auth/step-up/verify',
    server.cookie,
    server.csrfToken,
    { challengeId: challengeBody.challengeId, totpCode: '123456' },
  );
  const proof = (await verified.json()).proof;
  const accepted = await post(
    server.baseUrl,
    '/api/work-items/resume',
    server.cookie,
    server.csrfToken,
    { workItemId: 'work-1', stepUpProof: proof },
  );
  assert.equal(accepted.status, 200);
  const call = server.services.calls.find(([name]) => name === 'resume');
  assert.equal(call[1].authLevel, 'step-up');
  assert.equal(call[1].actorId, 'user-1');

  const replay = await post(
    server.baseUrl,
    '/api/work-items/resume',
    server.cookie,
    server.csrfToken,
    { workItemId: 'work-1', stepUpProof: proof },
  );
  assert.equal(replay.status, 403);
});

test('device listing and revocation use an authenticated session and bound proof', async (t) => {
  const server = await start(t);
  const listed = await fetch(`${server.baseUrl}/api/auth/devices`, {
    headers: { cookie: server.cookie },
  });
  assert.equal((await listed.json()).devices.length, 1);
  const challenge = await post(
    server.baseUrl,
    '/api/auth/step-up/challenge',
    server.cookie,
    server.csrfToken,
    { action: 'device.revoke', resourceId: 'device-current' },
  );
  const challengeBody = await challenge.json();
  const verified = await post(
    server.baseUrl,
    '/api/auth/step-up/verify',
    server.cookie,
    server.csrfToken,
    { challengeId: challengeBody.challengeId, totpCode: '123456' },
  );
  const proof = (await verified.json()).proof;
  const revoked = await post(
    server.baseUrl,
    '/api/auth/devices/revoke',
    server.cookie,
    server.csrfToken,
    { deviceId: 'device-current', stepUpProof: proof },
  );
  assert.equal(revoked.status, 200);
  const stale = await fetch(`${server.baseUrl}/api/health`, {
    headers: { cookie: server.cookie },
  });
  assert.equal(stale.status, 401);
});

test('attention nonces require login and only redeem the target without creating a session', async (t) => {
  const server = await start(t);
  const unauthenticated = await post(server.baseUrl, '/api/auth/attention/redeem', null, null, {
    nonce: 'attention-nonce',
  });
  assert.equal(unauthenticated.status, 401);
  const redeemed = await post(
    server.baseUrl,
    '/api/auth/attention/redeem',
    server.cookie,
    server.csrfToken,
    { nonce: 'attention-nonce' },
  );
  assert.equal(redeemed.status, 200);
  assert.equal((await redeemed.json()).attentionId, 'attention-1');
  assert.equal(redeemed.headers.get('set-cookie'), null);
});
