import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOTSTRAP_REASONS,
  requiredNodeMajor,
  nodeMajor,
  diagnoseBootstrap,
  hostGuidance,
  userFacingStatus,
} from '../src/codex/core/bootstrap-diagnostics.js';

const engines = { node: '>=20.19.0' };
const healthy = { engines, nodeVersion: 'v22.1.0' };

test('the diagnosable reasons form a closed set', () => {
  assert.deepEqual([...BOOTSTRAP_REASONS].sort(), [
    'host-auth-missing',
    'host-config-invalid',
    'host-not-bound',
    'host-permission-denied',
    'host-runtime-unsupported',
    'ready',
  ]);
});

test('a healthy host reports ready', () => {
  const diagnosis = diagnoseBootstrap(healthy);
  assert.equal(diagnosis.reason, 'ready');
  assert.equal(diagnosis.ready, true);
  assert.equal(diagnosis.requiresHostGuidance, false);
});

test('an unsupported runtime, insufficient permission and missing auth are distinguishable', () => {
  const runtime = diagnoseBootstrap({ ...healthy, nodeVersion: 'v18.0.0' });
  const permission = diagnoseBootstrap({ ...healthy, canWriteRuntime: false });
  const auth = diagnoseBootstrap({ ...healthy, hasCredentials: false });
  const config = diagnoseBootstrap({ ...healthy, configValid: false });
  const reasons = [runtime.reason, permission.reason, auth.reason, config.reason];
  assert.equal(new Set(reasons).size, 4, '四类原因互不混淆：' + JSON.stringify(reasons));
  for (const diagnosis of [runtime, permission, auth, config]) {
    assert.equal(diagnosis.ready, false, 'AC-18：都不得声称就绪');
    assert.equal(diagnosis.requiresHostGuidance, true, '都需要宿主侧引导');
  }
});

test('an old Node version is reported with the required and actual major', () => {
  const diagnosis = diagnoseBootstrap({ engines, nodeVersion: 'v18.20.0' });
  assert.equal(diagnosis.reason, 'host-runtime-unsupported');
  assert.match(diagnosis.detail, /20/);
  assert.match(diagnosis.detail, /18.20.0/);
});

test('a host that cannot run MCP at all is reported as runtime-unsupported', () => {
  const diagnosis = diagnoseBootstrap({ ...healthy, hostSupportsMcp: false });
  assert.equal(diagnosis.reason, 'host-runtime-unsupported');
  assert.equal(diagnosis.selfRepairable, false, 'MCP 无法自修复启动前置条件');
  assert.equal(diagnosis.requiresHostGuidance, true);
});

test('an unbound project is distinguishable and self-repairable', () => {
  const diagnosis = diagnoseBootstrap({ ...healthy, projectBound: false });
  assert.equal(diagnosis.reason, 'host-not-bound');
  assert.equal(diagnosis.ready, false);
  assert.equal(diagnosis.selfRepairable, true, '绑定项目可由插件内工具完成');
  assert.equal(diagnosis.requiresHostGuidance, false);
});

test('no diagnosis except ready ever claims readiness', () => {
  const cases = [
    { ...healthy, hostSupportsMcp: false },
    { ...healthy, nodeVersion: 'v18.0.0' },
    { ...healthy, configValid: false },
    { ...healthy, canWriteRuntime: false },
    { ...healthy, hasCredentials: false },
    { ...healthy, projectBound: false },
  ];
  for (const input of cases) {
    const diagnosis = diagnoseBootstrap(input);
    assert.equal(diagnosis.ready, false, JSON.stringify(input));
    const guidance = hostGuidance(diagnosis);
    assert.equal(guidance.claimsReady, false, '引导文本也不得声称就绪');
  }
});

test('host guidance is actionable and states that MCP cannot self-repair', () => {
  const diagnosis = diagnoseBootstrap({ ...healthy, nodeVersion: 'v18.0.0' });
  const guidance = hostGuidance(diagnosis);
  assert.equal(guidance.ok, true);
  assert.ok(guidance.lines.length >= 2);
  assert.ok(guidance.lines.some((line) => /无法修复|无法启动|管理方式|宿主/.test(line)));
});

test('every reason has guidance text', () => {
  for (const reason of BOOTSTRAP_REASONS) {
    const guidance = hostGuidance({ reason, ready: reason === 'ready' });
    assert.equal(guidance.ok, true, reason);
    assert.ok(guidance.lines.length >= 1, reason);
  }
});

test('a user-facing status never renders blocked as ready', () => {
  const blocked = diagnoseBootstrap({ ...healthy, canWriteRuntime: false });
  assert.match(userFacingStatus(blocked), /^blocked: /);
  assert.notEqual(userFacingStatus(blocked), 'ready');
  assert.equal(userFacingStatus(diagnoseBootstrap(healthy)), 'ready');
  assert.equal(
    userFacingStatus(diagnoseBootstrap({ ...healthy, projectBound: false })),
    'not-bound',
  );
  assert.equal(userFacingStatus(null), 'unknown');
});

test('an unknown reason does not crash the guidance', () => {
  const guidance = hostGuidance({ reason: 'something-else' });
  assert.equal(guidance.ok, true);
  assert.equal(guidance.claimsReady, false);
  assert.match(guidance.lines[0], /未知启动状态/);
});

test('an invalid diagnosis is refused', () => {
  assert.equal(hostGuidance(null).ok, false);
  assert.equal(hostGuidance({}).code, 'BOOTSTRAP_DIAGNOSIS_INVALID');
});

test('version parsing handles engines and node_version shapes', () => {
  assert.equal(requiredNodeMajor({ node: '>=20.19.0' }), 20);
  assert.equal(requiredNodeMajor({ node: '>=v18' }), 18);
  assert.equal(requiredNodeMajor({}), null);
  assert.equal(requiredNodeMajor(null), null);
  assert.equal(nodeMajor('v22.1.0'), 22);
  assert.equal(nodeMajor('20.1.0'), 20);
  // 不传参数时回退到当前宿主 Node 版本，而不是 null。
  assert.equal(nodeMajor(undefined), Number(/^v?(\d+)/.exec(process.versions.node)[1]));
  assert.equal(nodeMajor(''), null);
});

test('a missing engines requirement never blocks on version', () => {
  const diagnosis = diagnoseBootstrap({ engines: {}, nodeVersion: 'v16.0.0' });
  assert.equal(diagnosis.reason, 'ready', '无声明就不按版本阻塞');
});
