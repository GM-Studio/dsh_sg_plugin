import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { currentTotp } from '../src/codex/control/step-up.js';
import { createMemoryAuthStore } from '../src/codex/core/control/auth/memory-auth-store.js';
import { createAuthService } from '../src/codex/core/control/auth/auth-service.js';
import {
  hashPassword,
  parsePasswordHash,
  verifyPassword,
} from '../src/codex/core/control/auth/password.js';
import { createSecretBox } from '../src/codex/core/control/auth/secret-box.js';
import { mutationAuth, requiredAuth } from '../src/codex/core/control/auth/policy.js';

const passwordHasher = Object.freeze({
  hash: async (password) => `test$${password}`,
  verify: async (password, stored) => stored === `test$${password}`,
});

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

function createHarness({
  rateLimit = {
    login: { limit: 20, windowMs: 60_000 },
    totp: { limit: 20, windowMs: 60_000 },
  },
} = {}) {
  let now = 1_700_000_000_000;
  const store = createMemoryAuthStore({ clock: () => now });
  let id = 0;
  let token = 0;
  const service = createAuthService({
    store,
    encryptionKey: Buffer.alloc(32, 7),
    clock: () => now,
    randomId: (kind) => `${kind}_${++id}`,
    randomToken: () => `raw-${++token}-${'x'.repeat(40)}`,
    deviceConfirmationCodeHash: sha256('confirm-device'),
    passwordHash: passwordHasher,
    rateLimit,
  });
  return {
    store,
    service,
    advance(ms = 30_000) {
      now += ms;
    },
    totp(secret, offset = 0) {
      return currentTotp(secret, { clock: () => now + offset * 30_000 });
    },
  };
}

async function initialize(harness, username = 'owner') {
  const owner = await harness.service.initializeOwner({
    username,
    password: 'correct horse battery staple',
    displayName: 'Owner',
  });
  assert.equal(owner.ok, true);
  return owner;
}

async function enroll(harness, owner, { deviceId = 'device-a', deviceName = 'Laptop' } = {}) {
  const missing = await harness.service.login({
    username: owner.username,
    password: 'correct horse battery staple',
    totpCode: harness.totp(owner.totpSecret),
    deviceId,
    deviceName,
    clientKey: '127.0.0.1',
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'DEVICE_CONFIRMATION_REQUIRED');
  const login = await harness.service.login({
    username: owner.username,
    password: 'correct horse battery staple',
    totpCode: harness.totp(owner.totpSecret),
    deviceId,
    deviceName,
    deviceConfirmationCode: 'confirm-device',
    clientKey: '127.0.0.1',
  });
  assert.equal(login.ok, true);
  return login;
}

test('password hashes use a bounded scrypt format and reject malformed records', async () => {
  const first = await hashPassword('correct horse battery staple');
  const second = await hashPassword('correct horse battery staple');
  assert.notEqual(first, second);
  assert.match(first, /^\$scrypt\$n=16384,r=8,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.deepEqual(parsePasswordHash(first), {
    n: 16384,
    r: 8,
    p: 1,
    salt: parsePasswordHash(first).salt,
    hash: parsePasswordHash(first).hash,
  });
  assert.equal(await verifyPassword('correct horse battery staple', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  const tampered = `${first.slice(0, 20)}${first[20] === 'A' ? 'B' : 'A'}${first.slice(21)}`;
  assert.equal(await verifyPassword('correct horse battery staple', tampered), false);
  assert.equal(parsePasswordHash('not-a-password-hash'), false);
  assert.equal(await verifyPassword('anything', 'not-a-password-hash'), false);
  assert.equal(
    await verifyPassword(
      'anything',
      '$scrypt$n=2,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA$Zm9vYmFyZm9vYmFyZm9vYmFy',
    ),
    false,
  );
});

test('AES-256-GCM secret box requires an explicit key and authenticates context', () => {
  const key = Buffer.alloc(32, 9);
  const box = createSecretBox(key);
  const sealed = box.seal('totp-seed', 'totp:user-1');
  assert.doesNotMatch(sealed, /totp-seed/);
  assert.equal(box.open(sealed, 'totp:user-1'), 'totp-seed');
  assert.throws(() => box.open(sealed, 'totp:user-2'));
  assert.throws(() => createSecretBox(Buffer.alloc(16, 9)), /32-byte/);
  const tampered = `${sealed.slice(0, -1)}${sealed.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => box.open(tampered, 'totp:user-1'));
});

test('owner initialization seals TOTP at rest and login stores only token hashes', async (t) => {
  const harness = createHarness();
  t.after(() => assert.ok(harness.store));
  const owner = await initialize(harness);
  assert.match(owner.otpauth, /^otpauth:\/\/totp\//);
  const secondOwner = await harness.service.initializeOwner({
    username: 'second-owner',
    password: 'another password',
    displayName: 'Second Owner',
  });
  assert.equal(secondOwner.ok, false);
  assert.equal(secondOwner.code, 'OWNER_ALREADY_INITIALIZED');

  const stored = await harness.store.getUser(owner.userId);
  assert.equal(stored.ok, true);
  assert.equal(stored.user.totpSecret, undefined);
  assert.notEqual(stored.user.totpSecretCiphertext, owner.totpSecret);
  const box = createSecretBox(Buffer.alloc(32, 7));
  assert.equal(
    box.open(stored.user.totpSecretCiphertext, `totp:${owner.userId}`),
    owner.totpSecret,
  );

  const missingConfirmation = await harness.service.login({
    username: owner.username,
    password: 'correct horse battery staple',
    totpCode: harness.totp(owner.totpSecret),
    deviceId: 'device-a',
    deviceName: 'Laptop',
    clientKey: '127.0.0.1',
  });
  assert.equal(missingConfirmation.ok, false);
  assert.equal(missingConfirmation.code, 'DEVICE_CONFIRMATION_REQUIRED');

  const login = await harness.service.login({
    username: owner.username,
    password: 'correct horse battery staple',
    totpCode: harness.totp(owner.totpSecret),
    deviceId: 'device-a',
    deviceName: 'Laptop',
    deviceConfirmationCode: 'confirm-device',
    clientKey: '127.0.0.1',
  });
  assert.equal(login.ok, true);
  assert.equal(typeof login.token, 'string');
  assert.equal(typeof login.csrfToken, 'string');

  const sessionByToken = await harness.store.getSessionByTokenHash(sha256(login.token));
  assert.equal(sessionByToken.ok, true);
  assert.equal(sessionByToken.session.tokenHash, sha256(login.token));
  assert.equal(sessionByToken.session.csrfHash, sha256(login.csrfToken));
  assert.equal(sessionByToken.session.userId, owner.userId);
  assert.equal(sessionByToken.session.deviceId, 'device-a');
  assert.equal(JSON.stringify(sessionByToken.session).includes(login.token), false);
  assert.equal(JSON.stringify(sessionByToken.session).includes(login.csrfToken), false);

  const authenticated = await harness.service.authenticate({ token: login.token });
  assert.equal(authenticated.ok, true);
  assert.equal(authenticated.user.userId, owner.userId);
  assert.equal(authenticated.device.deviceId, 'device-a');
  assert.equal(harness.service.verifyCsrf(authenticated.session, login.csrfToken), true);
  assert.equal(harness.service.verifyCsrf(authenticated.session, 'wrong'), false);

  const badLogout = await harness.service.logout({ token: login.token, csrf: 'wrong' });
  assert.equal(badLogout.ok, false);
  assert.equal(badLogout.code, 'CSRF_INVALID');
  const logout = await harness.service.logout({ token: login.token, csrf: login.csrfToken });
  assert.equal(logout.ok, true);
  assert.equal((await harness.service.authenticate({ token: login.token })).ok, false);
});

test('login and TOTP limits are atomic and TOTP replay is rejected', async () => {
  const harness = createHarness({
    rateLimit: {
      login: { limit: 2, windowMs: 60_000 },
      totp: { limit: 20, windowMs: 60_000 },
    },
  });
  const owner = await initialize(harness);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const invalid = await harness.service.login({
      username: owner.username,
      password: 'wrong password',
      totpCode: harness.totp(owner.totpSecret),
      deviceId: 'device-a',
      deviceName: 'Laptop',
      deviceConfirmationCode: 'confirm-device',
      clientKey: '198.51.100.7',
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'INVALID_CREDENTIALS');
  }
  const rateLimited = await harness.service.login({
    username: owner.username,
    password: 'correct horse battery staple',
    totpCode: harness.totp(owner.totpSecret),
    deviceId: 'device-a',
    deviceName: 'Laptop',
    deviceConfirmationCode: 'confirm-device',
    clientKey: '198.51.100.7',
  });
  assert.equal(rateLimited.ok, false);
  assert.equal(rateLimited.code, 'RATE_LIMITED');
  assert.ok(rateLimited.retryAfterMs > 0);

  const replayHarness = createHarness();
  const replayOwner = await initialize(replayHarness);
  await enroll(replayHarness, replayOwner);
  replayHarness.advance();
  const code = replayHarness.totp(replayOwner.totpSecret);
  const first = await replayHarness.service.login({
    username: replayOwner.username,
    password: 'correct horse battery staple',
    totpCode: code,
    deviceId: 'device-a',
    deviceName: 'Laptop',
    clientKey: '127.0.0.1',
  });
  assert.equal(first.ok, true);
  const replay = await replayHarness.service.login({
    username: replayOwner.username,
    password: 'correct horse battery staple',
    totpCode: code,
    deviceId: 'device-a',
    deviceName: 'Laptop',
    clientKey: '127.0.0.1',
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'TOTP_REPLAYED');
});

test('concurrent TOTP logins consume a counter exactly once', async () => {
  const harness = createHarness();
  const owner = await initialize(harness);
  await enroll(harness, owner);
  harness.advance();
  const input = {
    username: owner.username,
    password: 'correct horse battery staple',
    totpCode: harness.totp(owner.totpSecret),
    deviceId: 'device-a',
    deviceName: 'Laptop',
    clientKey: '127.0.0.1',
  };
  const results = await Promise.all([harness.service.login(input), harness.service.login(input)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.code === 'TOTP_REPLAYED').length, 1);
});

test('step-up challenges and proofs are one-time and strictly bound', async () => {
  const harness = createHarness();
  const owner = await initialize(harness);
  const login = await enroll(harness, owner);
  const missingCsrf = await harness.service.beginStepUp({
    token: login.token,
    csrf: 'wrong',
    action: 'approve',
    resourceId: 'attention-1',
  });
  assert.equal(missingCsrf.ok, false);
  assert.equal(missingCsrf.code, 'CSRF_INVALID');

  harness.advance();
  const challenge = await harness.service.beginStepUp({
    token: login.token,
    csrf: login.csrfToken,
    action: 'approve',
    resourceId: 'attention-1',
  });
  assert.equal(challenge.ok, true);
  assert.equal(challenge.action, 'approve');
  assert.equal(challenge.resourceId, 'attention-1');
  const completed = await harness.service.completeStepUp({
    token: login.token,
    csrf: login.csrfToken,
    challengeId: challenge.challengeId,
    totpCode: harness.totp(owner.totpSecret),
  });
  assert.equal(completed.ok, true);
  assert.equal(typeof completed.proof, 'string');
  assert.equal(completed.action, 'approve');
  assert.equal(completed.resourceId, 'attention-1');

  const wrongAction = await harness.service.authorizeStepUp({
    token: login.token,
    proof: completed.proof,
    action: 'cancel',
    resourceId: 'attention-1',
  });
  assert.equal(wrongAction.ok, false);
  assert.equal(wrongAction.code, 'STEP_UP_BINDING_MISMATCH');

  const authorized = await harness.service.authorizeStepUp({
    token: login.token,
    proof: completed.proof,
    action: 'approve',
    resourceId: 'attention-1',
  });
  assert.equal(authorized.ok, true);
  const replayed = await harness.service.authorizeStepUp({
    token: login.token,
    proof: completed.proof,
    action: 'approve',
    resourceId: 'attention-1',
  });
  assert.equal(replayed.ok, false);
  assert.equal(replayed.code, 'STEP_UP_PROOF_REPLAYED');

  const challengeReplay = await harness.service.completeStepUp({
    token: login.token,
    csrf: login.csrfToken,
    challengeId: challenge.challengeId,
    totpCode: harness.totp(owner.totpSecret),
  });
  assert.equal(challengeReplay.ok, false);
  assert.equal(challengeReplay.code, 'STEP_UP_CHALLENGE_REPLAYED');
});

test('concurrent proof consumption succeeds only once', async () => {
  const harness = createHarness();
  const owner = await initialize(harness);
  const login = await enroll(harness, owner);
  harness.advance();
  const challenge = await harness.service.beginStepUp({
    token: login.token,
    csrf: login.csrfToken,
    action: 'resume',
    resourceId: 'run-1',
  });
  const completed = await harness.service.completeStepUp({
    token: login.token,
    csrf: login.csrfToken,
    challengeId: challenge.challengeId,
    totpCode: harness.totp(owner.totpSecret),
  });
  assert.equal(completed.ok, true);
  const results = await Promise.all([
    harness.service.authorizeStepUp({
      token: login.token,
      proof: completed.proof,
      action: 'resume',
      resourceId: 'run-1',
    }),
    harness.service.authorizeStepUp({
      token: login.token,
      proof: completed.proof,
      action: 'resume',
      resourceId: 'run-1',
    }),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok).length, 1);
});

test('device revocation requires bound step-up proof and cascades sessions', async () => {
  const harness = createHarness();
  const owner = await initialize(harness);
  const first = await enroll(harness, owner, { deviceId: 'device-a', deviceName: 'Laptop' });
  harness.advance();
  const second = await enroll(harness, owner, { deviceId: 'device-b', deviceName: 'Phone' });
  const listed = await harness.service.listDevices({ token: second.token });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.devices.map((device) => device.deviceId).sort(), [
    'device-a',
    'device-b',
  ]);

  harness.advance();
  const challenge = await harness.service.beginStepUp({
    token: second.token,
    csrf: second.csrfToken,
    action: 'device.revoke',
    resourceId: 'device-a',
  });
  const completed = await harness.service.completeStepUp({
    token: second.token,
    csrf: second.csrfToken,
    challengeId: challenge.challengeId,
    totpCode: harness.totp(owner.totpSecret),
  });
  assert.equal(completed.ok, true);
  const revoked = await harness.service.revokeDevice({
    token: second.token,
    csrf: second.csrfToken,
    deviceId: 'device-a',
    proof: completed.proof,
  });
  assert.equal(revoked.ok, true);
  assert.ok(revoked.revokedSessions >= 1);
  assert.equal((await harness.service.authenticate({ token: first.token })).ok, false);
  assert.equal((await harness.service.authenticate({ token: second.token })).ok, true);
  const replay = await harness.service.revokeDevice({
    token: second.token,
    csrf: second.csrfToken,
    deviceId: 'device-a',
    proof: completed.proof,
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'STEP_UP_PROOF_REPLAYED');
});

test('attention nonces are single-use, expire, and never establish a session', async () => {
  const harness = createHarness();
  const owner = await initialize(harness);
  const login = await enroll(harness, owner);
  const issued = await harness.service.createAttentionNonce({
    attentionId: 'attention-1',
    ttlMs: 60_000,
  });
  assert.equal(issued.ok, true);
  assert.equal(typeof issued.nonce, 'string');
  assert.ok(issued.expiresAt > 1_700_000_000_000);

  const unauthenticated = await harness.service.redeemAttentionNonce({
    token: issued.nonce,
    nonce: issued.nonce,
  });
  assert.equal(unauthenticated.ok, false);
  assert.equal(unauthenticated.code, 'UNAUTHORIZED');
  assert.equal((await harness.service.authenticate({ token: issued.nonce })).ok, false);

  const redeemed = await harness.service.redeemAttentionNonce({
    token: login.token,
    nonce: issued.nonce,
  });
  assert.equal(redeemed.ok, true);
  assert.equal(redeemed.attentionId, 'attention-1');
  assert.equal(redeemed.token, undefined);
  assert.equal(redeemed.csrfToken, undefined);
  const replay = await harness.service.redeemAttentionNonce({
    token: login.token,
    nonce: issued.nonce,
  });
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'ATTENTION_NONCE_REPLAYED');

  const expiring = await harness.service.createAttentionNonce({
    attentionId: 'attention-2',
    ttlMs: 10,
  });
  harness.advance(11);
  const expired = await harness.service.redeemAttentionNonce({
    token: login.token,
    nonce: expiring.nonce,
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'ATTENTION_NONCE_EXPIRED');
});

test('central auth policy maps sensitive mutations to step-up', () => {
  assert.equal(requiredAuth('pause'), 'session');
  for (const action of [
    'resume',
    'retry',
    'request_changes',
    'approve',
    'cancel',
    'accept_delivery',
  ]) {
    assert.equal(requiredAuth(action), 'step-up');
  }
  assert.equal(requiredAuth('unknown-action'), null);
  assert.deepEqual(mutationAuth('approve', 'attention-1'), {
    action: 'approve',
    resourceId: 'attention-1',
    authLevel: 'step-up',
    stepUpRequired: true,
  });
});

test('audit records include security events without credential material', async () => {
  const harness = createHarness();
  const owner = await initialize(harness);
  const login = await enroll(harness, owner);
  harness.advance();
  const challenge = await harness.service.beginStepUp({
    token: login.token,
    csrf: login.csrfToken,
    action: 'approve',
    resourceId: 'attention-audit',
  });
  const completed = await harness.service.completeStepUp({
    token: login.token,
    csrf: login.csrfToken,
    challengeId: challenge.challengeId,
    totpCode: harness.totp(owner.totpSecret),
  });
  assert.equal(completed.ok, true);
  const nonce = await harness.service.createAttentionNonce({
    attentionId: 'attention-audit',
    ttlMs: 60_000,
  });
  await harness.service.redeemAttentionNonce({ token: login.token, nonce: nonce.nonce });
  await harness.service.logout({ token: login.token, csrf: login.csrfToken });

  const audited = await harness.store.listAuthAudit();
  assert.equal(audited.ok, true);
  assert.ok(audited.audits.length >= 8);
  const serialized = JSON.stringify(audited.audits);
  for (const secret of [
    'correct horse battery staple',
    owner.totpSecret,
    harness.totp(owner.totpSecret),
    login.token,
    login.csrfToken,
    completed.proof,
    nonce.nonce,
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.doesNotMatch(serialized, /"(?:password|totpCode|token|csrf|proof|nonce|secret)"\s*:/);
});
