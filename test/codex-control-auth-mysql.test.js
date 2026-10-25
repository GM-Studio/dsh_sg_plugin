import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { readMysqlTestOptions } from './mysql-test-config.mjs';
import { createMysqlAuthStore } from '../src/codex/core/control/auth/mysql-auth-store.js';
import { createAuthService } from '../src/codex/core/control/auth/auth-service.js';
import { createManagementServer } from '../src/codex/management/server.js';
import {
  createMysqlBackup,
  restoreMysqlBackup,
} from '../src/codex/core/control/persistence/mysql-backup.js';
import {
  createMysqlPool,
  migrateMysql,
} from '../src/codex/core/control/persistence/mysql-repository.js';
import { currentTotp } from '../src/codex/control/step-up.js';

const AT = '2026-10-24T01:00:00.000Z';
const FUTURE = '2026-10-24T01:10:00.000Z';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = path.join(root, 'src/codex/core/control/persistence/migrations');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const passed = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};

test('M2 migration preserves M1 and adds authentication hardening schema', async () => {
  const initial = await fs.readFile(path.join(migrationDirectory, '001-initial.sql'), 'utf8');
  const hardening = await fs.readFile(
    path.join(migrationDirectory, '003-auth-hardening.sql'),
    'utf8',
  );

  assert.match(hardening, /ALTER TABLE control_user/);
  assert.match(hardening, /ADD COLUMN username VARCHAR\(128\)/);
  assert.match(hardening, /utf8mb4_0900_bin/);
  assert.match(hardening, /UNIQUE KEY uq_control_user_username \(username\)/);
  assert.match(hardening, /totp_enrolled_at DATETIME\(3\)/);
  assert.match(hardening, /totp_enrollment_required TINYINT\(1\)/);
  assert.match(hardening, /totp_last_used_counter BIGINT UNSIGNED/);
  assert.match(hardening, /CREATE TABLE IF NOT EXISTS auth_challenge/);
  assert.match(hardening, /session_id VARCHAR\(128\) NULL/);
  assert.match(hardening, /action VARCHAR\(128\) NULL/);
  assert.match(hardening, /resource_id VARCHAR\(256\) NULL/);
  assert.match(hardening, /proof_expires_at DATETIME\(3\) NULL/);
  assert.match(hardening, /PROOF_READY/);
  assert.match(hardening, /PROOF_CONSUMED/);
  assert.match(hardening, /CREATE TABLE IF NOT EXISTS attention_nonce/);
  assert.match(hardening, /redeemed_by_session_id/);
  assert.match(hardening, /CREATE TABLE IF NOT EXISTS auth_rate_limit/);
  assert.match(hardening, /CREATE TABLE IF NOT EXISTS auth_audit/);
  assert.match(hardening, /UNIQUE KEY uq_auth_challenge_proof \(proof_hash\)/);
  assert.match(hardening, /UNIQUE KEY uq_attention_nonce_hash \(token_hash\)/);
  assert.match(hardening, /UNIQUE KEY uq_auth_rate_limit_key \(scope, rate_key_hash\)/);
  assert.match(hardening, /CONSTRAINT chk_auth_audit_action CHECK/);
  assert.match(hardening, /event VARCHAR\(128\) NOT NULL/);
  assert.match(hardening, /outcome VARCHAR\(16\) NOT NULL/);
  assert.match(hardening, /AUTH_LOGIN_FAILURE/);
  assert.match(hardening, /AUTH_RATE_LIMITED/);
  assert.match(hardening, /CREATE TRIGGER auth_audit_no_update/);
  assert.match(hardening, /CREATE TRIGGER auth_audit_no_delete/);
  assert.match(initial, /UNIQUE KEY uq_session_token \(token_hash\)/);
});

test('MySQL auth store requires a pool', () => {
  assert.throws(() => createMysqlAuthStore({}), /MySQL pool/);
  const store = createMysqlAuthStore({ pool: { getConnection() {} } });
  for (const method of [
    'findUserByUsername',
    'getUser',
    'createUser',
    'updateUser',
    'consumeTotpCounter',
    'getDevice',
    'saveDevice',
    'listDevices',
    'saveSession',
    'getSessionByTokenHash',
    'touchSession',
    'revokeSession',
    'revokeSessionsForDevice',
    'saveChallenge',
    'getChallenge',
    'consumeChallenge',
    'findChallengeByProofHash',
    'saveNonce',
    'consumeNonce',
    'consumeRateLimit',
    'appendAuthAudit',
    'listAuthAudit',
  ])
    assert.equal(typeof store[method], 'function', `${method} must be exposed`);
});

test('real MySQL M2 auth hardening and concurrency', { timeout: 60000 }, async (t) => {
  const options = await readMysqlTestOptions();
  delete options.database;
  const admin = await mysql.createConnection({
    ...options,
    timezone: 'Z',
    dateStrings: true,
    multipleStatements: false,
  });
  const database = `sg_m2_${randomUUID().replaceAll('-', '')}`;
  const pools = [];
  t.after(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  });
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
  );
  const pool = createMysqlPool({ ...options, database, connectionLimit: 10 });
  pools.push(pool);
  const store = createMysqlAuthStore({ pool, clock: () => Date.parse(AT) });

  await t.test('migration can be repeated without guessing applied state', async () => {
    passed(await migrateMysql({ pool }));
    const repeated = passed(await migrateMysql({ pool }));
    assert.deepEqual(repeated.applied, []);
  });

  await t.test('authentication records and TOTP counters are durable', async () => {
    passed(
      await store.createUser({
        userId: 'user-1',
        username: 'Owner',
        displayName: 'Owner',
        passwordHash: 'argon2id$test$password-hash',
        totpSecretCiphertext: 'v1.test-ciphertext',
        totpEnrolledAt: AT,
        totpEnrollmentRequired: false,
      }),
    );
    const user = passed(await store.findUserByUsername('Owner')).user;
    assert.equal(user.username, 'Owner');
    assert.equal(user.totpEnrollmentRequired, false);
    assert.equal(
      (await store.findUserByUsername('owner')).user,
      null,
      'username lookup must remain case-sensitive',
    );

    const concurrent = await Promise.all([
      store.consumeTotpCounter('user-1', 100, { at: AT }),
      store.consumeTotpCounter('user-1', 100, { at: AT }),
    ]);
    assert.equal(concurrent.filter((result) => result.ok).length, 1);
    assert.equal(concurrent.filter((result) => result.code === 'TOTP_COUNTER_REPLAY').length, 1);
    assert.equal(
      (await store.consumeTotpCounter('user-1', 99, { at: AT })).code,
      'TOTP_COUNTER_REPLAY',
    );
    passed(await store.consumeTotpCounter('user-1', 101, { at: AT }));
  });

  await t.test('rate limits serialize under concurrency', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.consumeRateLimit({
          scope: 'login',
          key: 'same-client',
          limit: 3,
          windowMs: 60000,
          at: AT,
        }),
      ),
    );
    const [[stored]] = await pool.query(
      `SELECT attempts, window_started_at, reset_at, blocked_until
         FROM auth_rate_limit WHERE scope = ? AND rate_key_hash = ?`,
      ['login', digest('same-client')],
    );
    const [[{ count }]] = await pool.query(
      'SELECT COUNT(*) AS count FROM auth_rate_limit WHERE scope = ?',
      ['login'],
    );
    const summary = JSON.stringify({ attempts, stored, count });
    assert.equal(Number(count), 1, summary);
    assert.equal(attempts.filter((result) => result.ok && result.allowed).length, 3, summary);
    assert.equal(attempts.filter((result) => result.ok && !result.allowed).length, 5, summary);
    assert.equal(
      attempts.filter((result) => !result.allowed && result.retryAfterMs > 0).length,
      5,
      summary,
    );
  });

  await t.test('challenge and proof consumption have one winner', async () => {
    const proofHash = digest('step-up-proof');
    passed(
      await store.saveChallenge({
        challengeId: 'challenge-1',
        userId: 'user-1',
        challengeType: 'STEP_UP',
        proofHash,
        expiresAt: FUTURE,
        metadata: { operation: 'resume' },
        createdAt: AT,
      }),
    );
    const consumed = await Promise.all([
      store.consumeChallenge({ challengeId: 'challenge-1', proofHash, at: AT }),
      store.consumeChallenge({ challengeId: 'challenge-1', proofHash, at: AT }),
    ]);
    assert.equal(consumed.filter((result) => result.ok).length, 1);
    assert.equal(consumed.filter((result) => result.code === 'CHALLENGE_CONSUMED').length, 1);
    const proofConsumed = await Promise.all([
      store.consumeChallenge({
        challengeId: 'challenge-1',
        expectedStatus: 'PROOF_READY',
        expectedProofHash: proofHash,
        at: AT,
      }),
      store.consumeChallenge({
        challengeId: 'challenge-1',
        expectedStatus: 'PROOF_READY',
        expectedProofHash: proofHash,
        at: AT,
      }),
    ]);
    assert.equal(proofConsumed.filter((result) => result.ok).length, 1);
    assert.equal(proofConsumed.filter((result) => result.code === 'CHALLENGE_CONSUMED').length, 1);
    assert.equal(
      (
        await store.saveChallenge({
          challengeId: 'challenge-2',
          userId: 'user-1',
          challengeType: 'STEP_UP',
          proofHash,
          expiresAt: FUTURE,
        })
      ).code,
      'CHALLENGE_PROOF_CONFLICT',
    );
    assert.equal(
      passed(await store.findChallengeByProofHash(proofHash)).challenge.challengeId,
      'challenge-1',
    );
  });

  await t.test('real auth service login and step-up persist safely in MySQL', async () => {
    let now = Date.parse(AT);
    const service = createAuthService({
      store,
      encryptionKey: Buffer.alloc(32, 9),
      deviceConfirmationCodeHash: digest('new-device-code'),
      clock: () => now,
    });
    const created = passed(
      await service.createUser({
        username: 'service-owner',
        password: 'correct horse battery staple',
        displayName: 'Service Owner',
        role: 'approver',
      }),
    );
    const login = passed(
      await service.login({
        username: 'service-owner',
        password: 'correct horse battery staple',
        totpCode: currentTotp(created.totpSecret, { clock: () => now }),
        deviceId: 'service-device',
        deviceName: 'Service Browser',
        deviceConfirmationCode: 'new-device-code',
        clientKey: '203.0.113.10',
      }),
    );
    const authenticated = passed(await service.authenticate({ token: login.token }));
    assert.equal(authenticated.device.deviceId, 'service-device');
    assert.equal(service.verifyCsrf(authenticated.session, login.csrfToken), true);
    now += 30_000;
    const challenge = passed(
      await service.beginStepUp({
        token: login.token,
        csrf: login.csrfToken,
        action: 'resume',
        resourceId: 'work-service-1',
      }),
    );
    const proof = passed(
      await service.completeStepUp({
        token: login.token,
        csrf: login.csrfToken,
        challengeId: challenge.challengeId,
        totpCode: currentTotp(created.totpSecret, { clock: () => now }),
      }),
    );
    passed(
      await service.authorizeStepUp({
        token: login.token,
        proof: proof.proof,
        action: 'resume',
        resourceId: 'work-service-1',
      }),
    );
    assert.equal(
      (
        await service.authorizeStepUp({
          token: login.token,
          proof: proof.proof,
          action: 'resume',
          resourceId: 'work-service-1',
        })
      ).code,
      'STEP_UP_PROOF_REPLAYED',
    );
    const [[storedUser]] = await pool.query(
      'SELECT password_hash, totp_secret_ciphertext FROM control_user WHERE username = ?',
      ['service-owner'],
    );
    assert.match(storedUser.password_hash, /^\$scrypt\$/);
    assert.match(storedUser.totp_secret_ciphertext, /^sg-auth-v1\./);
    assert.doesNotMatch(storedUser.totp_secret_ciphertext, new RegExp(created.totpSecret));
  });

  await t.test('device revocation cascades to sessions atomically', async () => {
    passed(
      await store.saveDevice({
        deviceId: 'device-1',
        userId: 'user-1',
        name: 'Laptop',
      }),
    );
    for (const suffix of ['a', 'b']) {
      passed(
        await store.saveSession({
          sessionId: `session-${suffix}`,
          userId: 'user-1',
          deviceId: 'device-1',
          tokenHash: digest(`session-token-${suffix}`),
          csrfHash: digest(`csrf-${suffix}`),
          expiresAt: FUTURE,
        }),
      );
    }
    const revoked = passed(await store.revokeSessionsForDevice('device-1', { at: AT }));
    assert.equal(revoked.device.status, 'REVOKED');
    assert.equal(revoked.revokedSessions, 2);
    for (const suffix of ['a', 'b']) {
      const session = passed(
        await store.getSessionByTokenHash(digest(`session-token-${suffix}`)),
      ).session;
      assert.equal(session.status, 'REVOKED');
    }
  });

  await t.test('real HTTP account login and step-up use the MySQL auth service', async (t) => {
    let now = Date.parse(AT) + 120_000;
    const service = createAuthService({
      store,
      encryptionKey: Buffer.alloc(32, 11),
      deviceConfirmationCodeHash: digest('http-device-code'),
      clock: () => now,
    });
    const created = passed(
      await service.createUser({
        username: 'http-owner',
        password: 'correct horse battery staple',
        displayName: 'HTTP Owner',
        role: 'owner',
      }),
    );
    const calls = [];
    const management = createManagementServer({
      authService: service,
      clock: () => now,
      services: {
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
            calls.push(input);
            return { ok: true, workItem: { executionState: 'QUEUED' } };
          },
        },
      },
    });
    const started = await management.start();
    t.after(() => management.close());
    const login = await fetch(`${started.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'http-owner',
        password: 'correct horse battery staple',
        totpCode: currentTotp(created.totpSecret, { clock: () => now }),
        deviceId: 'http-device',
        deviceName: 'HTTP Browser',
        deviceConfirmationCode: 'http-device-code',
      }),
    });
    const loginBody = await login.json();
    assert.equal(login.status, 200, JSON.stringify(loginBody));
    const cookie = login.headers.get('set-cookie').split(';')[0];
    now += 30_000;
    const challenge = await fetch(`${started.baseUrl}/api/auth/step-up/challenge`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'x-specgate-csrf': loginBody.csrfToken,
      },
      body: JSON.stringify({ action: 'resume', resourceId: 'http-work-1' }),
    });
    const challengeBody = await challenge.json();
    assert.equal(challenge.status, 200, JSON.stringify(challengeBody));
    const verification = await fetch(`${started.baseUrl}/api/auth/step-up/verify`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'x-specgate-csrf': loginBody.csrfToken,
      },
      body: JSON.stringify({
        challengeId: challengeBody.challengeId,
        totpCode: currentTotp(created.totpSecret, { clock: () => now }),
      }),
    });
    const verificationBody = await verification.json();
    assert.equal(verification.status, 200, JSON.stringify(verificationBody));
    const resumed = await fetch(`${started.baseUrl}/api/work-items/resume`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        'x-specgate-csrf': loginBody.csrfToken,
      },
      body: JSON.stringify({
        workItemId: 'http-work-1',
        stepUpProof: verificationBody.proof,
      }),
    });
    const resumedBody = await resumed.json();
    assert.equal(resumed.status, 200, JSON.stringify(resumedBody));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authLevel, 'step-up');
  });

  await t.test('auth audit is redacted and append-only', async () => {
    const audit = passed(
      await store.appendAuthAudit({
        auditId: 'audit-1',
        event: 'login_failed',
        outcome: 'failure',
        actorId: 'user-1',
        userId: 'user-1',
        sourceIpHash: digest('203.0.113.5'),
        userAgentHash: digest('test-agent'),
        detail: {
          password: 'raw-password',
          token: 'raw-token',
          totpSecret: 'raw-totp-seed',
          nested: { proofHash: 'raw-proof', reason: 'bad password' },
        },
        createdAt: AT,
      }),
    ).audit;
    assert.equal('password' in audit.detail, false);
    assert.equal('token' in audit.detail, false);
    assert.equal('totpSecret' in audit.detail, false);
    assert.equal('proofHash' in audit.detail.nested, false);
    assert.equal(audit.detail.nested.reason, 'bad password');
    assert.equal(audit.event, 'login_failed');
    assert.equal(audit.outcome, 'failure');
    const [[row]] = await pool.query('SELECT detail_json FROM auth_audit WHERE auth_audit_id = ?', [
      'audit-1',
    ]);
    const serializedDetail = JSON.stringify(row.detail_json);
    assert.equal(serializedDetail.includes('raw-password'), false);
    assert.equal(serializedDetail.includes('raw-token'), false);
    assert.equal(serializedDetail.includes('raw-totp-seed'), false);
    assert.equal(
      (
        await store.appendAuthAudit({
          action: 'UNCHECKED_ACTION',
          targetType: 'user',
          targetId: 'user-1',
        })
      ).code,
      'AUTH_AUDIT_INVALID',
    );
    await assert.rejects(
      pool.query('UPDATE auth_audit SET event = ? WHERE auth_audit_id = ?', [
        'AUTH_LOGIN_SUCCESS',
        'audit-1',
      ]),
      /append-only/,
    );
  });

  await t.test('logical backup and restore preserve authentication state', async () => {
    const key = Buffer.alloc(32, 5);
    const backup = passed(await createMysqlBackup({ pool, key })).backup;
    const targetDatabase = `sg_m2_restore_${randomUUID().replaceAll('-', '')}`;
    await admin.query(
      `CREATE DATABASE \`${targetDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
    );
    const targetPool = createMysqlPool({
      ...options,
      database: targetDatabase,
      connectionLimit: 4,
    });
    try {
      const restored = await restoreMysqlBackup({ pool: targetPool, key, backup });
      assert.equal(restored.ok, true, JSON.stringify(restored));
      const tables = [
        'control_user',
        'device',
        'auth_session',
        'auth_challenge',
        'auth_rate_limit',
        'auth_audit',
      ];
      for (const table of tables) {
        const [[source]] = await pool.query(`SELECT COUNT(*) AS count FROM ${table}`);
        const [[target]] = await targetPool.query(`SELECT COUNT(*) AS count FROM ${table}`);
        assert.equal(Number(target.count), Number(source.count), table);
      }
    } finally {
      await targetPool.end();
      await admin.query(`DROP DATABASE IF EXISTS \`${targetDatabase}\``);
    }
  });
});
