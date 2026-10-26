import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VERIFY_STATES,
  chooseInstallLocation,
  verifyAfterInstall,
  summarizeInstallAttempt,
  failurePolicy,
} from '../src/codex/core/env/post-install-verify.js';

const probe = (overrides = {}) => ({
  path: '/tool/bin/tool',
  version: '17.0.9',
  exitCode: 0,
  ...overrides,
});

test('three verify states plus not-run exist and only verified passes', () => {
  assert.deepEqual([...VERIFY_STATES].sort(), ['failed', 'not-run', 'timeout', 'verified']);
});

test('project isolation is preferred over user and system locations', () => {
  const project = chooseInstallLocation({ root: '/repo', component: 'jdk', scope: 'project' });
  assert.equal(project.ok, true);
  assert.equal(project.scope, 'project');
  // 平台无关的路径分段比较（Windows 用反斜杠，Linux 用斜杠）。
  assert.deepEqual(project.path.split(/[\\/]/).slice(-3), ['.specgate', 'toolchains', 'jdk']);
  assert.equal(project.requiresElevation, false);

  const user = chooseInstallLocation({ component: 'jdk', scope: 'user' });
  assert.equal(user.scope, 'user');
  assert.equal(user.requiresElevation, false);
});

test('a system location needs its own approval', () => {
  assert.equal(
    chooseInstallLocation({ component: 'jdk', scope: 'system' }).code,
    'INSTALL_SYSTEM_APPROVAL_REQUIRED',
  );
  const approved = chooseInstallLocation({
    component: 'jdk',
    scope: 'system',
    systemApproved: true,
  });
  assert.equal(approved.ok, true);
  assert.equal(approved.requiresElevation, true, '系统级安装必须标注需要提权');
});

test('invalid location input is refused', () => {
  assert.equal(chooseInstallLocation({ component: '', scope: 'project', root: '/r' }).ok, false);
  assert.equal(chooseInstallLocation({ component: 'jdk', scope: 'everywhere' }).ok, false);
  assert.equal(
    chooseInstallLocation({ component: 'jdk', scope: 'project' }).ok,
    false,
    '项目隔离必须有项目根',
  );
});

test('an install command that exited 0 but failed verification does not pass', () => {
  // AC-14 的核心断言。
  const verification = verifyAfterInstall({
    capabilities: [{ id: 'jdk', kind: 'build' }],
    probes: { jdk: probe({ exitCode: 1, stderr: 'java: not found' }) },
  });
  assert.equal(verification.environmentReady, false);
  assert.equal(verification.results[0].state, 'failed');

  const summary = summarizeInstallAttempt({
    plan: { component: 'jdk' },
    install: { exitCode: 0, completed: ['download', 'extract'] },
    verification,
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.outcome.installSucceeded, true, '安装命令确实成功了');
  assert.equal(summary.outcome.environmentReady, false, '但环境不得通过');
  assert.equal(summary.outcome.blockedReason, 'verification-failed');
});

test('verification is evaluated per capability, not all-or-nothing on one probe', () => {
  const verification = verifyAfterInstall({
    capabilities: [
      { id: 'jdk', kind: 'build' },
      { id: 'maven', kind: 'build' },
    ],
    probes: { jdk: probe(), maven: probe({ path: undefined }) },
  });
  assert.equal(verification.verified.length, 1);
  assert.equal(verification.failed.length, 1);
  assert.equal(verification.results.find((entry) => entry.id === 'jdk').state, 'verified');
  assert.equal(verification.environmentReady, false, '一项通过不得标记全部通过');
});

test('a missing probe is not-run, which is never a pass', () => {
  const verification = verifyAfterInstall({
    capabilities: [{ id: 'jdk', kind: 'build' }],
    probes: {},
  });
  assert.equal(verification.results[0].state, 'not-run');
  assert.equal(verification.environmentReady, false);
});

test('a verification timeout is recorded and does not pass', () => {
  const verification = verifyAfterInstall({
    capabilities: [{ id: 'jdk', kind: 'build' }],
    probes: { jdk: probe({ timedOut: true }) },
  });
  assert.equal(verification.results[0].state, 'timeout');
  assert.equal(verification.environmentReady, false);
});

test('environment readiness never implies build, test or review success', () => {
  const verification = verifyAfterInstall({
    capabilities: [{ id: 'jdk', kind: 'build' }],
    probes: { jdk: probe() },
  });
  assert.equal(verification.environmentReady, true);
  assert.equal(verification.projectBuildPassed, false, 'AC-15');
  assert.equal(verification.projectTestsPassed, false);
  assert.equal(verification.reviewPassed, false);
  assert.equal(verification.workflowVerification, 'not-run');
});

test('an install without verification evidence cannot pass', () => {
  const summary = summarizeInstallAttempt({
    plan: { component: 'jdk' },
    install: { exitCode: 0, completed: ['download'] },
    verification: null,
  });
  assert.equal(summary.outcome.environmentReady, false);
  assert.equal(summary.outcome.blockedReason, 'verification-missing');
  assert.deepEqual(summary.outcome.completed, ['download'], '已完成部分必须保留');
});

test('a failed install keeps completed work and records the reason', () => {
  for (const [install, expected] of [
    [{ exitCode: 1, stderr: 'checksum mismatch', completed: ['download'] }, 'install-failed'],
    [{ exitCode: null, timedOut: true, completed: ['download'] }, 'install-timeout'],
  ]) {
    const summary = summarizeInstallAttempt({
      plan: { component: 'jdk' },
      install,
      verification: null,
    });
    assert.equal(summary.outcome.installSucceeded, false);
    assert.equal(summary.outcome.blockedReason, expected);
    assert.deepEqual(summary.outcome.completed, ['download'], '失败不得丢弃已完成结果');
  }
});

test('no failure reason ever silently relaxes source, privilege or verification', () => {
  for (const reason of [
    'install-failed',
    'install-timeout',
    'verification-failed',
    'verification-missing',
    'checksum-failed',
    'permission-denied',
    'network-failed',
    'something-else',
  ]) {
    const result = failurePolicy({ reason });
    assert.equal(result.ok, true);
    assert.equal(result.policy.retryWithDifferentSource, false, reason + ' 不得自动换源');
    assert.equal(result.policy.retryWithElevation, false, reason + ' 不得自动提权');
    assert.equal(result.policy.skipVerification, false, reason + ' 不得跳过复验');
    assert.equal(result.requiresNewApproval, true, reason + ' 必须重新申请');
  }
});

test('invalid verification input is refused', () => {
  assert.equal(verifyAfterInstall({ capabilities: 'x' }).code, 'INSTALL_VERIFY_INVALID');
  assert.equal(
    verifyAfterInstall({ capabilities: [], probes: null }).code,
    'INSTALL_VERIFY_INVALID',
  );
  assert.equal(summarizeInstallAttempt({ install: {} }).code, 'INSTALL_ATTEMPT_INVALID');
  assert.equal(
    summarizeInstallAttempt({ plan: {}, install: null }).code,
    'INSTALL_ATTEMPT_INVALID',
  );
});
