import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INSTALL_PLAN_FIELDS,
  LOCATION_SCOPES,
  PRIVILEGE_LEVELS,
  validateInstallPlan,
  requiresFreshApproval,
  planFingerprint,
  createInstallApproval,
  approveBatch,
  authorizeExecution,
} from '../src/codex/core/env/install-plan.js';

const at = '2026-10-26T00:00:00.000Z';

const plan = (overrides = {}) => ({
  purpose: '运行 maven 测试需要 JDK',
  component: 'jdk',
  version: '17.0.18',
  source: 'domestic',
  verification: 'sha256:abc',
  location: '~/.specgate/toolchains/jdk17',
  locationScope: 'user',
  configChanges: ['PATH 前置该目录'],
  privilege: 'user',
  ...overrides,
});

test('a plan must declare every required field', () => {
  for (const field of INSTALL_PLAN_FIELDS) {
    const incomplete = plan();
    delete incomplete[field];
    const result = validateInstallPlan(incomplete);
    assert.equal(result.ok, false, field);
    assert.deepEqual(result.missing, [field]);
  }
  assert.equal(validateInstallPlan(plan()).ok, true);
});

test('all eight reviewable fields are required, matching D07', () => {
  assert.deepEqual(
    [...INSTALL_PLAN_FIELDS].sort(),
    [
      'component',
      'configChanges',
      'location',
      'locationScope',
      'privilege',
      'purpose',
      'source',
      'verification',
      'version',
    ].sort(),
  );
  assert.equal(INSTALL_PLAN_FIELDS.length, 9);
});

test('an unknown field in a plan is refused rather than ignored', () => {
  const result = validateInstallPlan({ ...plan(), extra: 'x' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unknown, ['extra']);
});

test('location scope and privilege are restricted enumerations', () => {
  assert.deepEqual([...LOCATION_SCOPES].sort(), ['project', 'system', 'user']);
  assert.deepEqual([...PRIVILEGE_LEVELS].sort(), ['elevated', 'user']);
  assert.equal(validateInstallPlan(plan({ locationScope: 'anywhere' })).ok, false);
  assert.equal(validateInstallPlan(plan({ privilege: 'root' })).ok, false);
});

test('nothing may happen before a matching approval exists', () => {
  // AC-12：无批准时不得下载/安装/写配置。
  assert.equal(authorizeExecution({ plan: plan() }).code, 'INSTALL_NOT_APPROVED');
  assert.equal(authorizeExecution({ plan: plan(), approval: null }).code, 'INSTALL_NOT_APPROVED');
});

test('a changed component, version, source, location or privilege invalidates the approval', () => {
  const approval = createInstallApproval({ planId: 'p1', plan: plan(), approvedAt: at }).approval;
  const mutations = [
    { version: '21.0.1' },
    { source: 'official' },
    { location: '/opt/jdk' },
    { locationScope: 'project' },
    { privilege: 'elevated' },
    { component: 'gradle' },
  ];
  for (const mutation of mutations) {
    const result = authorizeExecution({ plan: plan(mutation), approval });
    assert.equal(result.ok, false, JSON.stringify(mutation));
    assert.equal(result.code, 'INSTALL_APPROVAL_STALE', JSON.stringify(mutation));
  }
});

test('the unchanged plan still authorizes normally', () => {
  const approval = createInstallApproval({ planId: 'p1', plan: plan(), approvedAt: at }).approval;
  const result = authorizeExecution({ plan: plan(), approval });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.coversInstallation, true);
});

test('an install approval never covers build or delivery', () => {
  const approval = createInstallApproval({ planId: 'p1', plan: plan(), approvedAt: at }).approval;
  const result = authorizeExecution({ plan: plan(), approval });
  assert.equal(result.coversProjectBuild, false, 'AC-36：安装批准不代替构建批准');
  assert.equal(result.coversDelivery, false, 'AC-36：安装批准不代替交付批准');
});

test('system-level or elevated installs always require a fresh approval', () => {
  assert.equal(requiresFreshApproval(plan()), false);
  assert.equal(requiresFreshApproval(plan({ locationScope: 'system' })), true);
  assert.equal(requiresFreshApproval(plan({ privilege: 'elevated' })), true);

  const systemPlan = plan({ locationScope: 'system', privilege: 'elevated' });
  const approval = createInstallApproval({
    planId: 'p2',
    plan: systemPlan,
    approvedAt: at,
  }).approval;
  assert.equal(approval.requiresFreshApproval, true);
  const result = authorizeExecution({ plan: systemPlan, approval });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INSTALL_FRESH_APPROVAL_REQUIRED');
});

test('a consumed approval cannot be reused', () => {
  const approval = createInstallApproval({ planId: 'p1', plan: plan(), approvedAt: at }).approval;
  const first = authorizeExecution({ plan: plan(), approval });
  assert.equal(first.ok, true);
  const second = authorizeExecution({ plan: plan(), approval, consumedPlanIds: first.consumed });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'INSTALL_APPROVAL_CONSUMED');
});

test('a batch approval consumes each plan independently', () => {
  const batch = approveBatch({
    plans: [
      { planId: 'a', plan: plan({ component: 'jdk' }) },
      { planId: 'b', plan: plan({ component: 'maven', location: '~/.specgate/toolchains/maven' }) },
    ],
    approvedAt: at,
  });
  assert.equal(batch.ok, true, JSON.stringify(batch));
  assert.equal(batch.approvals.length, 2);
  const seen = [];
  for (const approval of batch.approvals) {
    const current =
      approval.planId === 'a'
        ? plan({ component: 'jdk' })
        : plan({ component: 'maven', location: '~/.specgate/toolchains/maven' });
    const result = authorizeExecution({ plan: current, approval, consumedPlanIds: seen });
    assert.equal(result.ok, true, approval.planId);
    // consumed 已包含本次 planId，直接采用以避免重复记账。
    seen.length = 0;
    seen.push(...result.consumed);
  }
  assert.deepEqual(seen.sort(), ['a', 'b']);
});

test('a batch containing an invalid plan is rejected as a whole', () => {
  const batch = approveBatch({
    plans: [
      { planId: 'a', plan: plan() },
      { planId: 'b', plan: { component: 'maven' } },
    ],
    approvedAt: at,
  });
  assert.equal(batch.ok, false, '不给「部分批准」的模糊状态');
  assert.equal(batch.code, 'INSTALL_BATCH_REJECTED');
  assert.equal(batch.rejected[0].planId, 'b');
});

test('approval creation requires a bounded plan id and a real timestamp', () => {
  assert.equal(
    createInstallApproval({ planId: '', plan: plan(), approvedAt: at }).code,
    'INSTALL_PLAN_INVALID',
  );
  assert.equal(
    createInstallApproval({ planId: 'p', plan: plan(), approvedAt: 'not-a-date' }).code,
    'INSTALL_PLAN_INVALID',
  );
  assert.equal(
    createInstallApproval({ planId: 'p', plan: { component: 'x' }, approvedAt: at }).ok,
    false,
  );
});

test('the fingerprint covers exactly the approval-relevant elements', () => {
  const first = planFingerprint(plan());
  assert.equal(first, planFingerprint(plan()), '同样要素 → 同样指纹');
  assert.notEqual(first, planFingerprint(plan({ version: '21.0.1' })));
  assert.notEqual(first, planFingerprint(plan({ source: 'official' })));
  // purpose 不参与指纹：用途说明变化不应使已批准的技术要素失效。
  assert.equal(first, planFingerprint(plan({ purpose: '另一处说明' })));
  assert.equal(planFingerprint(null), null);
});

test('config changes are bounded text and must be an array', () => {
  assert.equal(validateInstallPlan(plan({ configChanges: 'PATH' })).ok, false);
  assert.equal(validateInstallPlan(plan({ configChanges: [''] })).ok, false);
  assert.equal(validateInstallPlan(plan({ configChanges: [] })).ok, true);
});

test('an empty batch is refused', () => {
  for (const plans of [[], null, undefined]) {
    const result = approveBatch({ plans, approvedAt: at });
    assert.equal(result.ok, false, JSON.stringify(plans));
  }
});
