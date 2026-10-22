import test from 'node:test';
import assert from 'node:assert/strict';
import {
  controlExecutionEnvironment,
  localControlEnvironment,
} from '../src/codex/control/config.js';

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
