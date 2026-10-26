// 预算边界与断点恢复（M6 / SNA-0605）。
//
// 目标（AC-28、NFR-06、NFR-09）：
// - 达到获批时限或预算边界时保存进度、停止启动新任务并请求调整；
// - 不通过反复重启隐性突破预算（已消耗预算必须跨会话保留）；
// - 费用无法可靠获取时记录可获取用量并标 unknown，不声称满足金额上限；
// - 记录扫描/准备/排队/执行/集成/返工六段耗时。

/** 耗时阶段（NFR-09）。 */
export const TIME_PHASES = Object.freeze([
  'scan',
  'prepare',
  'queue',
  'execute',
  'integrate',
  'rework',
]);

/** 预算耗尽后可采取的动作。 */
export const BUDGET_ACTIONS = Object.freeze(['continue', 'save-and-stop']);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/** 空预算账本。 */
export function emptyBudget({ limits = {} } = {}) {
  return {
    limits: {
      maxMilliseconds: Number.isSafeInteger(limits.maxMilliseconds) ? limits.maxMilliseconds : null,
      maxTasks: Number.isSafeInteger(limits.maxTasks) ? limits.maxTasks : null,
      maxCost: Number.isFinite(limits.maxCost) ? limits.maxCost : null,
    },
    consumed: { milliseconds: 0, tasks: 0 },
    // 费用无法可靠获取时保持 unknown，绝不填 0 冒充「未花钱」。
    cost: { amount: null, currency: null, known: false },
    phases: Object.fromEntries(TIME_PHASES.map((phase) => [phase, 0])),
    stopped: false,
    stopReason: null,
  };
}

/**
 * 记入一次消耗。
 * 账本是累计的：调用方不得通过新建账本来「重置」预算。
 */
export function consume(budget, { milliseconds = 0, tasks = 0, phase = null } = {}) {
  if (!object(budget) || !object(budget.consumed))
    return failure('BUDGET_INVALID', '需要一份预算账本');
  if (!Number.isFinite(milliseconds) || milliseconds < 0)
    return failure('BUDGET_INVALID', 'milliseconds 必须是非负数');
  if (!Number.isSafeInteger(tasks) || tasks < 0)
    return failure('BUDGET_INVALID', 'tasks 必须是非负整数');
  const next = {
    ...budget,
    consumed: {
      milliseconds: budget.consumed.milliseconds + milliseconds,
      tasks: budget.consumed.tasks + tasks,
    },
    phases: { ...budget.phases },
  };
  if (phase !== null) {
    if (!TIME_PHASES.includes(phase))
      return failure('BUDGET_INVALID', '未知耗时阶段', { allowed: TIME_PHASES });
    next.phases[phase] = (next.phases[phase] ?? 0) + milliseconds;
  }
  return { ok: true, budget: next };
}

/**
 * 检查是否触及边界。
 * 触及即返回 save-and-stop，并要求请求调整（AC-28）。
 */
export function checkBoundary(budget) {
  if (!object(budget) || !object(budget.consumed))
    return failure('BUDGET_INVALID', '需要一份预算账本');
  const reasons = [];
  const limits = budget.limits ?? {};
  if (
    Number.isSafeInteger(limits.maxMilliseconds) &&
    budget.consumed.milliseconds >= limits.maxMilliseconds
  )
    reasons.push('time-limit-reached');
  if (Number.isSafeInteger(limits.maxTasks) && budget.consumed.tasks >= limits.maxTasks)
    reasons.push('task-limit-reached');
  if (
    Number.isFinite(limits.maxCost) &&
    budget.cost?.known === true &&
    budget.cost.amount >= limits.maxCost
  )
    reasons.push('cost-limit-reached');

  return {
    ok: true,
    action: reasons.length > 0 ? 'save-and-stop' : 'continue',
    reasons,
    // 触及边界时明确要求重新申请，而不是静默继续。
    requiresBudgetAdjustment: reasons.length > 0,
    // 费用未知时明确标注，不声称满足金额上限。
    costAccountingKnown: budget.cost?.known === true,
  };
}

/**
 * 停止启动新任务时的落点：保存进度。
 * 已完成任务保留，未开始任务回到待排队。
 */
export function saveProgress({ budget, completed = [], pending = [] } = {}) {
  const checked = checkBoundary(budget);
  if (!checked.ok) return checked;
  return {
    ok: true,
    budget: { ...budget, stopped: true, stopReason: checked.reasons[0] ?? null },
    completed: Array.isArray(completed) ? [...completed] : [],
    pending: Array.isArray(pending) ? [...pending] : [],
    // 恢复时从这里继续，已消耗预算不因停止而清零。
    resumable: true,
    consumedAtStop: { ...budget.consumed },
  };
}

/**
 * 恢复：必须沿用已保存的消耗，不能重建预算。
 * 这是「反复重启隐性突破预算」的直接防线。
 */
export function resumeProgress({ saved, additionalLimits = null } = {}) {
  if (!object(saved) || !object(saved.consumedAtStop))
    return failure('BUDGET_INVALID', '需要一份已保存的进度');
  const resumed = {
    ...saved.budget,
    consumed: { ...saved.consumedAtStop },
    stopped: false,
    stopReason: null,
    limits: additionalLimits
      ? { ...saved.budget.limits, ...additionalLimits }
      : { ...saved.budget.limits },
  };
  return { ok: true, budget: resumed, resumedFrom: 'saved-progress' };
}

/** 费用不可得时的记录方式：保留可获取用量并标 unknown。 */
export function recordCost(budget, { amount = null, currency = null } = {}) {
  if (!object(budget)) return failure('BUDGET_INVALID', '需要一份预算账本');
  const known = Number.isFinite(amount) && typeof currency === 'string' && currency.length > 0;
  return {
    ok: true,
    budget: {
      ...budget,
      cost: { amount: known ? amount : null, currency: known ? currency : null, known },
    },
    // 明确：未知时不声称满足任何金额上限。
    claimsWithinCostLimit: known,
  };
}

/** 六段耗时汇总（NFR-09）。 */
export function timeReport(budget) {
  if (!object(budget) || !object(budget.phases))
    return failure('BUDGET_INVALID', '需要一份预算账本');
  const total = Object.values(budget.phases).reduce((sum, value) => sum + value, 0);
  return {
    ok: true,
    phases: { ...budget.phases },
    total,
    // 未记录任何阶段时如实说明，而不是显示 0 当作「很快」。
    recorded: total > 0,
  };
}
