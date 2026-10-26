// 基础设施错误与业务故障的区分（M5 / SNA-0503）。
//
// 目标（AC-21）：超时、缺依赖、进程异常或未运行不能冒充已观察到的业务缺陷。
//
// 意义：业务红灯是「实现缺失导致目标行为失败」的证据；
// 基础设施故障是「环境或进程出了问题」。两者混同会造成两种伤害：
// 1. 把环境故障当业务红灯 → 实现方去修复一个并不存在的缺陷；
// 2. 把业务红灯当环境故障 → 真实缺陷被登记为可重试的偶发问题。

/** 统一的结果分类。 */
export const OUTCOMES = Object.freeze([
  /** 真实业务断言失败：唯一可以充当红基线的结果。 */
  'business-failure',
  /** 业务断言通过。 */
  'business-pass',
  /** 超时。 */
  'timeout',
  /** 缺依赖、命令不存在、模块未找到。 */
  'missing-dependency',
  /** 进程崩溃、信号终止、非零退出但没有可读报告。 */
  'process-error',
  /** 被跳过或未执行。 */
  'not-run',
]);

/** 这些结果属于基础设施问题，绝不能充当业务红灯。 */
export const INFRASTRUCTURE_OUTCOMES = Object.freeze([
  'timeout',
  'missing-dependency',
  'process-error',
  'not-run',
]);

const asText = (value) => (typeof value === 'string' ? value : '');

/** 由错误信息推断基础设施原因；无法判定时返回 null。 */
export function classifyErrorText(value) {
  const raw = asText(value);
  if (!raw) return null;
  if (/\bETIMEDOUT\b|timed?\s*out|超时/i.test(raw)) return 'timeout';
  if (
    /ENOENT|command not found|not recognized as an internal|Cannot find module|MODULE_NOT_FOUND|missing dependency|未找到模块/i.test(
      raw,
    )
  )
    return 'missing-dependency';
  if (/EPERM|EACCES|permission denied|权限/i.test(raw)) return 'process-error';
  if (/SIGKILL|SIGTERM|signal|segmentation fault|out of memory|ENOMEM/i.test(raw))
    return 'process-error';
  return null;
}

/**
 * 分类一次用例结果。
 * 判定顺序很重要：基础设施信号优先于业务信号，
 * 否则一个「缺依赖导致的断言失败」会被误判成业务红灯。
 */
export function classifyCaseResult({ status, error, exitCode, reportAvailable = true } = {}) {
  const reason = classifyErrorText(error);
  if (status === 'skip' || status === 'skipped' || status === 'not-run')
    return { outcome: 'not-run', reason: 'case-not-executed', business: false };
  if (reason !== null)
    return { outcome: reason, reason, business: false, detail: asText(error).slice(0, 512) };
  if (!reportAvailable)
    return { outcome: 'process-error', reason: 'no-readable-report', business: false };
  if (status === 'pass') return { outcome: 'business-pass', reason: null, business: true };
  if (status === 'fail') return { outcome: 'business-failure', reason: null, business: true };
  return { outcome: 'not-run', reason: 'unknown-status', business: false };
}

/**
 * 汇总一批用例结果，并回答「这份报告能否充当红基线」。
 * 规则：只有业务失败才可充当红基线；出现任何基础设施问题即不可用。
 */
export function summarizeOutcomes({ cases = [] } = {}) {
  if (!Array.isArray(cases))
    return { ok: false, code: 'OUTCOME_INPUT_INVALID', message: 'cases 必须是数组' };
  const results = cases.map((entry) => classifyCaseResult(entry));
  const infrastructure = results.filter((entry) => INFRASTRUCTURE_OUTCOMES.includes(entry.outcome));
  const businessFailures = results.filter((entry) => entry.outcome === 'business-failure');
  const businessPasses = results.filter((entry) => entry.outcome === 'business-pass');
  return {
    ok: true,
    results,
    infrastructure,
    businessFailures,
    businessPasses,
    usableAsBusinessEvidence: infrastructure.length === 0,
    usableAsRedBaseline: infrastructure.length === 0 && businessFailures.length > 0,
    counts: {
      businessFailures: businessFailures.length,
      businessPasses: businessPasses.length,
      infrastructure: infrastructure.length,
      total: results.length,
    },
  };
}

/**
 * 阶段级分类：把质量门阶段的失败归到基础设施还是实现责任。
 */
export function classifyStage({ name, exitCode, failureKind, error } = {}) {
  if (failureKind === 'infrastructure')
    return {
      stage: name ?? null,
      outcome: 'process-error',
      business: false,
      reason: 'stage-declared-infrastructure',
    };
  const reason = classifyErrorText(error);
  if (reason !== null && reason !== 'timeout')
    return { stage: name ?? null, outcome: reason, business: false, reason };
  if (exitCode === 0)
    return { stage: name ?? null, outcome: 'business-pass', business: true, reason: null };
  return { stage: name ?? null, outcome: 'business-failure', business: true, reason: null };
}
