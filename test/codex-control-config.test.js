import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  CONTROL_MODE_ENV,
  controlExecutionEnvironment,
  localControlEnvironment,
  resolveControlEnvironment,
  resolveControlMode,
  validateManagementDeployment,
} from '../src/codex/control/config.js';
import { hashValue } from '../src/codex/events.js';

test('control execution receives only portable runtime variables and no control secrets', () => {
  const child = controlExecutionEnvironment({
    env: {
      PATH: '/usr/local/bin:/usr/bin',
      HOME: '/home/owner',
      HTTPS_PROXY: 'https://proxy.example.test',
      CODEX_HOME: '/home/owner/.codex',
      CREDENTIAL_LOOKS_UNRELATED: 'must-not-cross',
      SPECGATE_FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/secret',
      SPECGATE_MFA_SECRET: 'ABCDEFGHIJKLMNOP',
    },
    projectRoot: '/work/product',
    controlRoot: '/home/owner/.codex/specgate-control',
    workItemId: 'work-1',
  });

  assert.equal(child.PATH, '/usr/local/bin:/usr/bin');
  assert.equal(child.HOME, '/home/owner');
  assert.equal(child.HTTPS_PROXY, 'https://proxy.example.test');
  assert.equal(child.CODEX_HOME, '/home/owner/.codex');
  assert.equal(child.SPECGATE_PROJECT_ROOT, '/work/product');
  assert.equal(child.SPECGATE_CONTROL_HOME, '/home/owner/.codex/specgate-control');
  assert.equal(child.SPECGATE_WORK_ITEM_ID, 'work-1');
  assert.equal(child.SPECGATE_CONTROL_MODE, '1');
  assert.equal(Object.hasOwn(child, 'SPECGATE_FEISHU_WEBHOOK_URL'), false);
  assert.equal(Object.hasOwn(child, 'SPECGATE_MFA_SECRET'), false);
  assert.equal(Object.hasOwn(child, 'CREDENTIAL_LOOKS_UNRELATED'), false);
});

test('control configuration exposes portable Codex command and home overrides', () => {
  const config = localControlEnvironment({
    SPECGATE_CODEX_COMMAND: '/opt/codex/bin/codex',
    SPECGATE_CODEX_HOME: '/var/lib/specgate-codex',
    SPECGATE_MANAGEMENT_PORT: '43121',
  });

  assert.equal(config.codexCommand, '/opt/codex/bin/codex');
  assert.equal(config.codexHome, '/var/lib/specgate-codex');
  assert.equal(config.managementPort, 43121);
});

test('remote management deployment requires an explicit HTTPS proxy boundary', () => {
  const config = localControlEnvironment({
    SPECGATE_MANAGEMENT_DEPLOYMENT_MODE: 'remote',
    SPECGATE_MANAGEMENT_PUBLIC_URL: 'https://control.example.test',
    SPECGATE_MANAGEMENT_ALLOWED_HOSTS: 'control.example.test',
    SPECGATE_MANAGEMENT_ALLOWED_ORIGINS: 'https://control.example.test',
    SPECGATE_MANAGEMENT_TRUSTED_PROXIES: '127.0.0.1,::1',
    SPECGATE_MYSQL_CONFIG: path.resolve('mysql-auth.json'),
    SPECGATE_AUTH_ENCRYPTION_KEY: 'a'.repeat(64),
    SPECGATE_AUTH_DEVICE_CONFIRMATION_CODE_HASH: 'b'.repeat(64),
  });

  assert.equal(config.managementDeploymentMode, 'remote');
  assert.deepEqual(config.managementAllowedHosts, ['control.example.test']);
  assert.deepEqual(config.managementAllowedOrigins, ['https://control.example.test']);
  assert.deepEqual(config.managementTrustedProxies, ['127.0.0.1', '::1']);
  assert.equal(validateManagementDeployment({ config, host: '127.0.0.1' }).ok, true);
  assert.equal(config.mysqlConfigPath, path.resolve('mysql-auth.json'));
  assert.equal(config.authEncryptionKey, 'a'.repeat(64));
  assert.equal(config.authDeviceConfirmationCodeHash, 'b'.repeat(64));

  const missingProxy = validateManagementDeployment({
    config: { ...config, managementTrustedProxies: [] },
    host: '127.0.0.1',
  });
  assert.equal(missingProxy.ok, false);
  assert.equal(missingProxy.code, 'REMOTE_MODE_CONFIG_INVALID');

  const publicBind = validateManagementDeployment({ config, host: '0.0.0.0' });
  assert.equal(publicBind.ok, false);
  assert.equal(publicBind.code, 'REMOTE_MODE_CONFIG_INVALID');

  const missingAuth = validateManagementDeployment({
    config: { ...config, authEncryptionKey: null },
    host: '127.0.0.1',
  });
  assert.equal(missingAuth.ok, false);
  assert.equal(missingAuth.code, 'REMOTE_AUTH_NOT_CONFIGURED');
});

test('management deployment mode fails closed on an unknown value', () => {
  assert.throws(
    () => localControlEnvironment({ SPECGATE_MANAGEMENT_DEPLOYMENT_MODE: 'internet' }),
    (error) => error?.code === 'MANAGEMENT_DEPLOYMENT_MODE_INVALID',
  );
});

test('device confirmation input is hashed before it enters deployment config', () => {
  const config = localControlEnvironment({
    SPECGATE_AUTH_DEVICE_CONFIRMATION_CODE: 'one-time-device-confirmation',
  });
  assert.equal(
    config.authDeviceConfirmationCodeHash,
    createHash('sha256').update('one-time-device-confirmation').digest('hex'),
  );
  assert.equal(Object.hasOwn(config, 'authDeviceConfirmationCode'), false);
});

test('control mode defaults to aggregate and fails closed on an invalid value', () => {
  assert.deepEqual(resolveControlMode({ env: {} }), { ok: true, mode: 'aggregate' });
  assert.deepEqual(resolveControlMode({ env: {}, mode: null }), { ok: true, mode: 'aggregate' });
  assert.deepEqual(resolveControlMode({ env: {}, mode: '' }), { ok: true, mode: 'aggregate' });
  assert.equal(resolveControlMode({ env: { [CONTROL_MODE_ENV]: 'isolated' } }).mode, 'isolated');
  assert.equal(resolveControlMode({ env: {}, mode: 'Aggregate' }).mode, 'aggregate');
  assert.equal(resolveControlMode({ env: {}, mode: 'isolated' }).mode, 'isolated');

  const invalidEnv = resolveControlMode({ env: { [CONTROL_MODE_ENV]: 'nope' } });
  assert.equal(invalidEnv.ok, false);
  assert.equal(invalidEnv.code, 'MODE_INVALID');
  assert.equal(resolveControlMode({ env: {}, mode: 'bogus' }).code, 'MODE_INVALID');
});

test('resolveControlEnvironment shares one home in aggregate and isolates per project', () => {
  const controlRoot = path.resolve('C:\\control');
  const projectRoot = path.resolve('C:\\work\\crm');
  const env = { SPECGATE_CONTROL_HOME: controlRoot };

  const aggregate = resolveControlEnvironment({ env, mode: 'aggregate', projectRoot });
  assert.equal(aggregate.ok, true);
  assert.equal(aggregate.mode, 'aggregate');
  assert.equal(aggregate.shared, true);
  assert.equal(aggregate.controlRoot, controlRoot);
  assert.equal(aggregate.managementPort, 43120);

  const isolated = resolveControlEnvironment({ env, mode: 'isolated', projectRoot });
  assert.equal(isolated.ok, true);
  assert.equal(isolated.shared, false);
  const projectId = `project-${hashValue({ root: projectRoot }).slice(0, 16)}`;
  assert.equal(isolated.projectId, projectId);
  assert.equal(isolated.controlRoot, path.join(controlRoot, 'projects', projectId));
  assert.notEqual(isolated.controlRoot, aggregate.controlRoot);
  assert.ok(isolated.managementPort > 43120 && isolated.managementPort <= 43120 + 999);
  assert.match(isolated.managementPublicUrl, new RegExp(`:${isolated.managementPort}$`));

  // Default mode is aggregate; isolated mode requires a project root; an invalid
  // mode never silently falls back.
  assert.equal(resolveControlEnvironment({ env, projectRoot }).mode, 'aggregate');
  assert.equal(resolveControlEnvironment({ env, mode: 'isolated' }).code, 'PROJECT_ROOT_INVALID');
  assert.equal(resolveControlEnvironment({ env, mode: 'bogus', projectRoot }).code, 'MODE_INVALID');
  assert.equal(resolveControlEnvironment({ env: {}, mode: 'aggregate', projectRoot }).ok, true);
});
