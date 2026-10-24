import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createConfiguredAuthService } from '../src/codex/control/auth-runtime.js';
import { currentTotp } from '../src/codex/control/step-up.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');

test('remote auth runtime fails closed without MySQL and TOTP encryption configuration', async () => {
  const result = await createConfiguredAuthService({ config: {} });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'AUTH_CONFIG_REQUIRED');
});

test(
  'configured MySQL auth runtime migrates, provisions and logs in',
  {
    skip:
      !process.env.SPECGATE_MYSQL_TEST_CONFIG &&
      'NOT_RUN: set SPECGATE_MYSQL_TEST_CONFIG to a local JSON connection file',
    timeout: 60000,
  },
  async (t) => {
    const adminOptions = JSON.parse(
      await fs.readFile(process.env.SPECGATE_MYSQL_TEST_CONFIG, 'utf8'),
    );
    delete adminOptions.database;
    const admin = await mysql.createConnection({
      ...adminOptions,
      timezone: 'Z',
      dateStrings: true,
      multipleStatements: false,
    });
    const database = `sg_auth_runtime_${randomUUID().replaceAll('-', '')}`;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sg-auth-runtime-'));
    const configPath = path.join(directory, 'mysql.json');
    t.after(async () => {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.end();
      await fs.rm(directory, { recursive: true, force: true });
    });
    await admin.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
    );
    await fs.writeFile(
      configPath,
      JSON.stringify({ ...adminOptions, database, connectionLimit: 6 }),
      'utf8',
    );
    const runtime = await createConfiguredAuthService({
      config: {
        mysqlConfigPath: configPath,
        authEncryptionKey: 'd'.repeat(64),
        authDeviceConfirmationCodeHash: digest('runtime-confirmation'),
      },
    });
    t.after(() => runtime.ok && runtime.close());
    assert.equal(runtime.ok, true, JSON.stringify(runtime));
    const owner = await runtime.authService.initializeOwner({
      username: 'runtime-owner',
      password: 'correct horse battery staple',
      displayName: 'Runtime Owner',
    });
    assert.equal(owner.ok, true, JSON.stringify(owner));
    const stored = await runtime.store.findUserByUsername('runtime-owner');
    assert.equal(stored.ok, true);
    assert.match(stored.user.passwordHash, /^\$scrypt\$/);
    assert.match(stored.user.totpSecretCiphertext, /^sg-auth-v1\./);
    assert.doesNotMatch(
      JSON.stringify(stored.user.totpSecretCiphertext),
      new RegExp(owner.totpSecret),
    );
    const login = await runtime.authService.login({
      username: 'runtime-owner',
      password: 'correct horse battery staple',
      totpCode: currentTotp(owner.totpSecret),
      deviceId: 'runtime-device',
      deviceName: 'Runtime Browser',
      deviceConfirmationCode: 'runtime-confirmation',
      clientKey: '203.0.113.20',
    });
    assert.equal(login.ok, true, JSON.stringify(login));
    assert.equal(typeof login.token, 'string');
  },
);
