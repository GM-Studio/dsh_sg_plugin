import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENARIOS,
  RED_POLICIES,
  LEGACY_PROFILE_ID,
  legacyProfile,
  scenarioProfile,
  validateValidationProfile,
  resolveProfile,
  policyFor,
} from '../src/codex/core/validation-profile.js';
import { emptyState, validateState } from '../src/codex/core/state.js';

test('a profile without a version field is rejected', () => {
  const profile = legacyProfile();
  delete profile.profileVersion;
  const result = validateValidationProfile(profile);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_PROFILE_INVALID');
});

test('a non-integer or wrong profileVersion is rejected', () => {
  for (const value of [0, 2, '1', 1.5, null]) {
    const profile = { ...legacyProfile(), profileVersion: value };
    assert.equal(validateValidationProfile(profile).ok, false, String(value));
  }
});

test('legacy profile keeps the current all-frozen-cases-red behaviour', () => {
  const profile = legacyProfile();
  assert.equal(validateValidationProfile(profile).ok, true);
  assert.equal(profile.requiresAllFrozenCasesRed, true);
  assert.equal(profile.profileId, LEGACY_PROFILE_ID);
  for (const name of SCENARIOS) {
    const policy = policyFor(profile, name);
    assert.equal(policy.ok, true, name);
    assert.equal(policy.redBaseline, 'all-frozen-cases-red', name);
    assert.equal(policy.regression, 'all-green', name);
  }
});

test('a non-legacy profile may differ per scenario', () => {
  const profile = scenarioProfile();
  assert.equal(validateValidationProfile(profile).ok, true);
  assert.equal(profile.requiresAllFrozenCasesRed, false);
  assert.equal(policyFor(profile, 'feature').redBaseline, 'target-only-red');
  assert.equal(policyFor(profile, 'fix').redBaseline, 'reproduce-red');
  assert.equal(policyFor(profile, 'refactor').redBaseline, 'none');
  assert.equal(policyFor(profile, 'refactor').regression, 'all-green');
});

test('an unknown scenario id is rejected with the legal set', () => {
  const profile = legacyProfile();
  profile.scenarios.unknownScene = { redBaseline: 'none', regression: 'all-green' };
  const result = validateValidationProfile(profile);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_PROFILE_INVALID');
  assert.deepEqual(result.allowed, [...SCENARIOS]);
  assert.deepEqual(result.unknown, ['unknownScene']);
});

test('policyFor refuses an unknown scenario and lists allowed ids', () => {
  const policy = policyFor(legacyProfile(), 'not-a-scenario');
  assert.equal(policy.ok, false);
  assert.equal(policy.code, 'VALIDATION_PROFILE_UNKNOWN');
  assert.deepEqual(policy.allowed, [...SCENARIOS]);
});

test('an invalid red or regression policy is rejected', () => {
  for (const mutate of [
    (profile) => {
      profile.scenarios.feature.redBaseline = 'sometimes-red';
    },
    (profile) => {
      profile.scenarios.feature.regression = 'whatever';
    },
    (profile) => {
      profile.scenarios.feature.extra = true;
    },
    (profile) => {
      profile.scenarios.feature = {};
    },
  ]) {
    const profile = legacyProfile();
    mutate(profile);
    const result = validateValidationProfile(profile);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'VALIDATION_PROFILE_INVALID');
  }
});

test('declaring all frozen cases red while a scenario differs is self-contradictory', () => {
  const profile = legacyProfile();
  profile.scenarios.refactor = { redBaseline: 'none', regression: 'all-green' };
  const result = validateValidationProfile(profile);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_PROFILE_INVALID');
});

test('declaring no global red requirement while every scenario is all-red is self-contradictory', () => {
  const profile = legacyProfile();
  profile.requiresAllFrozenCasesRed = false;
  const result = validateValidationProfile(profile);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VALIDATION_PROFILE_INVALID');
});

test('an unknown extra profile field is rejected', () => {
  const profile = { ...legacyProfile(), unexpected: true };
  const result = validateValidationProfile(profile);
  assert.equal(result.ok, false);
  assert.deepEqual(result.unknown, ['unexpected']);
});

test('every declared red policy is accepted at least once', () => {
  for (const policy of RED_POLICIES) {
    const profile = legacyProfile();
    profile.requiresAllFrozenCasesRed = false;
    profile.scenarios.feature = { redBaseline: policy, regression: 'all-green' };
    if (policy !== 'all-frozen-cases-red') {
      assert.equal(validateValidationProfile(profile).ok, true, policy);
    }
  }
});

test('an old state without a profile resolves to the legacy interpretation', () => {
  const state = emptyState();
  delete state.validationProfile;
  const resolved = resolveProfile(state);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.source, 'legacy-default');
  assert.equal(resolved.profile.requiresAllFrozenCasesRed, true);
  // 旧状态仍然必须通过既有状态校验（本任务不改变 schemaVersion）。
  assert.equal(validateState(state).ok, true);
});

test('a stored profile id or object is resolved and marked as stored', () => {
  const byId = resolveProfile({ validationProfile: LEGACY_PROFILE_ID });
  assert.equal(byId.ok, true);
  assert.equal(byId.source, 'stored');
  assert.equal(byId.profile.profileId, LEGACY_PROFILE_ID);

  const byObject = resolveProfile({ validationProfile: scenarioProfile() });
  assert.equal(byObject.ok, true);
  assert.equal(byObject.source, 'stored');
  assert.equal(byObject.profile.requiresAllFrozenCasesRed, false);
});

test('an unknown stored profile id is rejected rather than silently defaulted', () => {
  const resolved = resolveProfile({ validationProfile: 'does-not-exist' });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, 'VALIDATION_PROFILE_UNKNOWN');
});

test('a corrupt stored profile object is rejected', () => {
  const resolved = resolveProfile({ validationProfile: { profileVersion: 1 } });
  assert.equal(resolved.ok, false);
  assert.equal(resolved.code, 'VALIDATION_PROFILE_INVALID');
});

test('the profile is wired into development only, and only from M5 on', async () => {
  // M1 的守卫断言（「development/quality 都不得引用档案」）已在 M5 / SNA-0502
  // 按设计解除：development.js 现在按场景解析策略。
  // 但 quality.js 仍不得引用——质量门不在本次接线范围。
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const development = fs.readFileSync(path.join(root, 'src/codex/development.js'), 'utf8');
  assert.equal(
    development.includes('validation-profile'),
    true,
    'M5 起 development.js 必须按档案解析验证策略',
  );
  const quality = fs.readFileSync(path.join(root, 'src/codex/quality.js'), 'utf8');
  assert.equal(
    quality.includes('validation-profile'),
    false,
    'quality.js 不在 SNA-0502 的接线范围',
  );
});
