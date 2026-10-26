import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SCENARIOS,
  legacyProfile,
  scenarioProfile,
  policyFor,
  resolveProfile,
} from '../src/codex/core/validation-profile.js';

test('the four core scenarios each have their own policy', () => {
  const profile = scenarioProfile();
  const expectations = {
    feature: { redBaseline: 'target-only-red', regression: 'unchanged-cases-green' },
    modify: { redBaseline: 'target-only-red', regression: 'unchanged-cases-green' },
    fix: { redBaseline: 'reproduce-red', regression: 'unchanged-cases-green' },
    refactor: { redBaseline: 'none', regression: 'all-green' },
  };
  for (const scenario of SCENARIOS) {
    const policy = policyFor(profile, scenario);
    assert.equal(policy.ok, true, scenario);
    assert.equal(policy.redBaseline, expectations[scenario].redBaseline, scenario);
    assert.equal(policy.regression, expectations[scenario].regression, scenario);
  }
});

test('feature and modify do not require the existing regression to fail', () => {
  // AC-20：目标用例失败 + 既有回归通过时，不因回归没有失败而拒绝有效基线。
  const profile = scenarioProfile();
  for (const scenario of ['feature', 'modify']) {
    assert.notEqual(
      policyFor(profile, scenario).redBaseline,
      'all-frozen-cases-red',
      scenario + ' 不得要求全部冻结用例失败',
    );
  }
});

test('a fix reproduces the target fault rather than reddening everything', () => {
  const policy = policyFor(scenarioProfile(), 'fix');
  assert.equal(policy.redBaseline, 'reproduce-red');
});

test('a refactor neither demands red nor breaks working behaviour', () => {
  // AC-19：重构可合法进入工作流，不必伪装，也不为满足全红而人为破坏已正确行为。
  const policy = policyFor(scenarioProfile(), 'refactor');
  assert.equal(policy.redBaseline, 'none', '不得要求红基线');
  assert.equal(policy.regression, 'all-green', '但既有回归必须保持绿');
});

test('an old state with no profile keeps the exact legacy behaviour', () => {
  const resolved = resolveProfile({});
  assert.equal(resolved.source, 'legacy-default');
  for (const scenario of SCENARIOS)
    assert.equal(policyFor(resolved.profile, scenario).redBaseline, 'all-frozen-cases-red');
});

test('a stored scenario profile is honoured', () => {
  const resolved = resolveProfile({ validationProfile: scenarioProfile() });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.source, 'stored');
  assert.equal(policyFor(resolved.profile, 'refactor').redBaseline, 'none');
});

test('an unknown scenario is refused instead of silently defaulting', () => {
  const policy = policyFor(scenarioProfile(), 'chore');
  assert.equal(policy.ok, false);
  assert.equal(policy.code, 'VALIDATION_PROFILE_UNKNOWN');
  assert.deepEqual(policy.allowed, [...SCENARIOS]);
});

test('the legacy profile is self-consistent and unchanged', () => {
  const legacy = legacyProfile();
  assert.equal(legacy.requiresAllFrozenCasesRed, true);
  for (const scenario of SCENARIOS)
    assert.equal(policyFor(legacy, scenario).redBaseline, 'all-frozen-cases-red');
});

test('the development path resolves a policy per scenario before the red baseline', () => {
  // 结构断言：development.js 必须通过 resolveProfile/policyFor 取策略，
  // 而不是继续内联「每个冻结用例必须失败」。
  const source = fs.readFileSync(path.join(process.cwd(), 'src/codex/development.js'), 'utf8');
  assert.match(source, /resolveProfile/);
  assert.match(source, /policyFor/);
  assert.match(source, /redBaselinePolicy/);
  // 四种策略都必须被显式处理。
  for (const policy of ['all-frozen-cases-red', 'target-only-red', 'reproduce-red', 'none'])
    assert.ok(source.includes(policy), 'development.js 必须处理策略 ' + policy);
});

test('an unknown stored policy is rejected rather than treated as legacy', () => {
  const resolved = resolveProfile({ validationProfile: 'never-heard-of-it' });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, 'VALIDATION_PROFILE_UNKNOWN');
});
