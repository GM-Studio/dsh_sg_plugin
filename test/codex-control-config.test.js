import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  CONTROL_MODE_ENV,
  controlExecutionEnvironment,
  localControlEnvironment,
  resolveControlEnvironment,
  resolveControlMode,
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
