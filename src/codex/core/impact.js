// 影响分析与验证集合选择（M7 / SNA-0701、SNA-0702、SNA-0703）。
//
// 目标：
// - AC-30 常规变更不无条件附加完整业务金丝雀，但必须展示验证选择及其依据；
// - AC-31 达到关键版本或内核变化触发条件时，缺真实闭环证据不得宣称通过；
// - AC-32 已经成立的运行约束不被错误要求先变成业务失败。

/** 内核模块：其变更触发真实完整闭环（OI-06 未定，先用保守默认）。 */
export const KERNEL_PATHS = Object.freeze([
  'src/codex/state-machine.js',
  'src/codex/approvals.js',
  'src/codex/core/state.js',
  'src/codex/core/validation-profile.js',
  'src/codex/core/change-types.js',
  'src/codex/development.js',
  'src/codex/quality.js',
  'src/codex/plan.js',
  'src/codex/core/outcome-classification.js',
]);

/** AC 建模的三种性质：混淆它们正是历史缺陷的根源（AC-32）。 */
export const ACCEPTANCE_NATURES = Object.freeze([
  'business-goal',
  'regression-guard',
  'runtime-constraint',
]);

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * 判定一次变更是否命中内核变化（AC-31）。
 * 命中即要求真实完整闭环，不能只跑影响范围内的检查。
 */
export function isKernelChange({ changedFiles = [] } = {}) {
  if (!Array.isArray(changedFiles))
    return failure('IMPACT_INPUT_INVALID', 'changedFiles 必须是数组');
  const normalized = changedFiles
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.split('\\').join('/'));
  const hits = normalized.filter((file) => KERNEL_PATHS.includes(file));
  return {
    ok: true,
    isKernel: hits.length > 0,
    kernelFiles: hits,
    // 说明依据，而不是给一个布尔值。
    rationale:
      hits.length > 0
        ? '命中工作流内核文件：' + hits.join(', ') + '，必须执行真实完整闭环'
        : '未命中工作流内核文件',
  };
}

/**
 * 选择验证集合并给出依据（AC-30）。
 * 不无条件附加完整业务金丝雀，但必须说明「为什么这些」与「哪些没覆盖」。
 */
export function selectVerification({
  changedFiles = [],
  affectedModules = [],
  availableChecks = [],
  criticalVersion = false,
} = {}) {
  const kernel = isKernelChange({ changedFiles });
  if (!kernel.ok) return kernel;

  const checks = Array.isArray(availableChecks) ? availableChecks : [];
  const selected = [];
  const skipped = [];

  for (const check of checks) {
    if (typeof check !== 'string') continue;
    // 全量金丝雀只在关键版本或内核变化时附加。
    if (check === 'business-canary') {
      if (criticalVersion === true || kernel.isKernel) selected.push(check);
      else skipped.push({ check, reason: 'not-a-critical-or-kernel-change' });
      continue;
    }
    selected.push(check);
  }

  const requiresFullClosure = criticalVersion === true || kernel.isKernel;
  return {
    ok: true,
    selected,
    skipped,
    requiresFullClosure,
    // 必须显式说明依据与未覆盖范围。
    rationale: [
      kernel.rationale,
      criticalVersion === true ? '关键版本：附加真实完整闭环' : '非关键版本',
      '受影响模块：' +
        (Array.isArray(affectedModules) && affectedModules.length
          ? affectedModules.join(', ')
          : '未声明'),
    ],
    uncovered: Array.isArray(affectedModules) ? [...affectedModules] : [],
    // 无依据的「全覆盖」声明必须给出为什么确认为空。
    coverageJustification:
      Array.isArray(affectedModules) && affectedModules.length === 0
        ? '未识别到受影响模块；依据为本次变更未触及源码或配置'
        : null,
  };
}

/**
 * 校验 AC 建模是否把运行约束误当成业务目标（AC-32）。
 * 工具链自检、历史保留这类「已经成立」的约束不得要求先变红。
 */
export function validateAcceptanceNature({ criteria = [] } = {}) {
  if (!Array.isArray(criteria)) return failure('IMPACT_INPUT_INVALID', 'criteria 必须是数组');
  const problems = [];
  for (const criterion of criteria) {
    if (typeof criterion?.id !== 'string') continue;
    if (!ACCEPTANCE_NATURES.includes(criterion.nature))
      problems.push({ id: criterion.id, code: 'NATURE_UNKNOWN', nature: criterion.nature ?? null });
    // 运行约束不得被标为需要在实现前失败。
    if (criterion.nature === 'runtime-constraint' && criterion.requiresRedBaseline === true)
      problems.push({ id: criterion.id, code: 'CONSTRAINT_REQUIRES_RED' });
  }
  return {
    ok: problems.length === 0,
    code: problems.length === 0 ? undefined : 'ACCEPTANCE_MODELLING_INVALID',
    problems,
    counts: {
      businessGoals: criteria.filter((entry) => entry?.nature === 'business-goal').length,
      regressionGuards: criteria.filter((entry) => entry?.nature === 'regression-guard').length,
      runtimeConstraints: criteria.filter((entry) => entry?.nature === 'runtime-constraint').length,
    },
  };
}
