// 版本化的验证策略档案（M1 / SNA-0101）。
//
// 需求 §8 指出「所有冻结 case 必须全红」与 D03/D06 冲突，必须正式重基线化，
// 不能通过临时绕过校验实现。本模块只定义档案数据与纯校验，不接线到执行路径
// （接线在 M5 / SNA-0502），因此既有行为在 M1 之后保持不变。
//
// 旧状态没有档案字段时按 legacy 档案解释，其语义与当前实现完全一致。

/** 场景标识：与 FR-06 四类核心变更一一对应。 */
export const SCENARIOS = Object.freeze(['feature', 'modify', 'fix', 'refactor']);

/**
 * 红基线策略：
 * - all-frozen-cases-red：每个冻结用例在实现前都必须真实失败（既有行为）
 * - target-only-red：只有目标用例需要真实失败，既有回归保持绿（D03 要求）
 * - reproduce-red：只有复现目标故障的用例需要真实失败
 * - none：不要求红基线，改为重构前后行为保持证据
 */
export const RED_POLICIES = Object.freeze([
  'all-frozen-cases-red',
  'target-only-red',
  'reproduce-red',
  'none',
]);

/** 回归策略：既有用例的最低要求。 */
export const REGRESSION_POLICIES = Object.freeze(['all-green', 'unchanged-cases-green']);

export const PROFILE_VERSION = 1;

/** 当前生效档案标识：legacy 下与既有实现等价。 */
export const LEGACY_PROFILE_ID = 'legacy';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

function scenarioEntry(value) {
  return (
    object(value) &&
    Object.keys(value).length === 2 &&
    RED_POLICIES.includes(value.redBaseline) &&
    REGRESSION_POLICIES.includes(value.regression)
  );
}

/**
 * 校验一份验证策略档案。
 * 返回值只表达「档案本身是否自洽」，不代表任何场景已被执行。
 */
export function validateValidationProfile(value) {
  if (!object(value)) return failure('VALIDATION_PROFILE_INVALID', '验证策略档案必须是对象');
  const keys = ['profileVersion', 'profileId', 'requiresAllFrozenCasesRed', 'scenarios'];
  if (Object.keys(value).some((key) => !keys.includes(key)))
    return failure('VALIDATION_PROFILE_INVALID', '验证策略档案包含未知字段', {
      unknown: Object.keys(value).filter((key) => !keys.includes(key)),
    });
  if (!Number.isInteger(value.profileVersion) || value.profileVersion !== PROFILE_VERSION)
    return failure('VALIDATION_PROFILE_INVALID', '验证策略档案缺少合法 profileVersion');
  if (typeof value.profileId !== 'string' || value.profileId.length === 0)
    return failure('VALIDATION_PROFILE_INVALID', '验证策略档案缺少 profileId');
  if (typeof value.requiresAllFrozenCasesRed !== 'boolean')
    return failure('VALIDATION_PROFILE_INVALID', 'requiresAllFrozenCasesRed 必须是布尔值');
  if (!object(value.scenarios))
    return failure('VALIDATION_PROFILE_INVALID', '验证策略档案缺少 scenarios 映射');
  const names = Object.keys(value.scenarios);
  if (names.length === 0) return failure('VALIDATION_PROFILE_INVALID', 'scenarios 不能为空');
  const unknown = names.filter((name) => !SCENARIOS.includes(name));
  if (unknown.length > 0)
    return failure('VALIDATION_PROFILE_INVALID', '存在未知场景 ID', {
      unknown,
      allowed: SCENARIOS,
    });
  const invalid = names.filter((name) => !scenarioEntry(value.scenarios[name]));
  if (invalid.length > 0)
    return failure('VALIDATION_PROFILE_INVALID', '场景条目缺少合法 redBaseline 或 regression', {
      invalid,
      allowedRed: RED_POLICIES,
      allowedRegression: REGRESSION_POLICIES,
    });
  if (
    value.requiresAllFrozenCasesRed === true &&
    names.some((name) => value.scenarios[name].redBaseline !== 'all-frozen-cases-red')
  )
    return failure(
      'VALIDATION_PROFILE_INVALID',
      'requiresAllFrozenCasesRed 为真时所有场景都必须是 all-frozen-cases-red',
    );
  if (
    value.requiresAllFrozenCasesRed === false &&
    names.every((name) => value.scenarios[name].redBaseline === 'all-frozen-cases-red')
  )
    return failure(
      'VALIDATION_PROFILE_INVALID',
      'requiresAllFrozenCasesRed 为假时至少一个场景不得使用 all-frozen-cases-red',
    );
  return { ok: true };
}

/** legacy 档案：与当前实现行为完全等价（M1 不改变任何执行路径）。 */
export function legacyProfile() {
  const scenarios = {};
  for (const name of SCENARIOS)
    scenarios[name] = { redBaseline: 'all-frozen-cases-red', regression: 'all-green' };
  return {
    profileVersion: PROFILE_VERSION,
    profileId: LEGACY_PROFILE_ID,
    requiresAllFrozenCasesRed: true,
    scenarios,
  };
}

/** 场景化档案（D03）：M5 接线后才会改变行为。 */
export function scenarioProfile(profileId = 'scenario-v1') {
  return {
    profileVersion: PROFILE_VERSION,
    profileId,
    requiresAllFrozenCasesRed: false,
    scenarios: {
      feature: { redBaseline: 'target-only-red', regression: 'unchanged-cases-green' },
      modify: { redBaseline: 'target-only-red', regression: 'unchanged-cases-green' },
      fix: { redBaseline: 'reproduce-red', regression: 'unchanged-cases-green' },
      refactor: { redBaseline: 'none', regression: 'all-green' },
    },
  };
}

/**
 * 解析状态里记录的档案引用。
 * 状态没有档案字段（旧状态）时返回 legacy 解释并标记来源，供审计区分。
 */
export function resolveProfile(state) {
  const stored = object(state) ? state.validationProfile : undefined;
  if (stored === undefined || stored === null) {
    const profile = legacyProfile();
    return { ok: true, profile, source: 'legacy-default' };
  }
  if (typeof stored === 'string') {
    if (stored === LEGACY_PROFILE_ID)
      return { ok: true, profile: legacyProfile(), source: 'stored' };
    if (stored === 'scenario-v1')
      return { ok: true, profile: scenarioProfile(stored), source: 'stored' };
    return failure('VALIDATION_PROFILE_UNKNOWN', '状态引用了未知的验证策略档案', { stored });
  }
  const checked = validateValidationProfile(stored);
  if (!checked.ok) return checked;
  return { ok: true, profile: stored, source: 'stored' };
}

/** 读取某场景的验证要求；未知场景显式拒绝并给出合法集合。 */
export function policyFor(profile, scenario) {
  if (!object(profile) || !object(profile.scenarios))
    return failure('VALIDATION_PROFILE_INVALID', '验证策略档案缺少 scenarios');
  const entry = profile.scenarios[scenario];
  if (!entry)
    return failure('VALIDATION_PROFILE_UNKNOWN', '未知场景', { scenario, allowed: SCENARIOS });
  return { ok: true, redBaseline: entry.redBaseline, regression: entry.regression };
}
