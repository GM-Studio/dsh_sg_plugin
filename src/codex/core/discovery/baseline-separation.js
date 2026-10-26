// 需求基线与执行基线的分离（M2 / SNA-0206）。
//
// 目标（AC-07、AC-15 前置、NFR-05）：
// - 生成候选需求基线**不**产生任何执行通过结论；
// - 执行基线缺失时，候选基线仍可存在，但状态明确为「执行基线未建立」；
// - 两类基线各有独立标识与时间戳，互不冒充；
// - 以生成文档冒充执行通过 → 拒绝（AC-34 前置）。
//
// 这是「初始化生成 ≠ 验证」在数据层的落地。

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/** 执行基线的合法状态（沿用 adopted-verification 的 RESULT_STATES 口径）。 */
export const EXECUTION_STATES = Object.freeze([
  'passed',
  'failed',
  'skipped',
  'not-run',
  'timeout',
  'cancelled',
]);

/** 这些状态可以被称为「执行通过」。只有 passed 算。 */
export function isExecutionPass(state) {
  return state === 'passed';
}

/**
 * 组装一份「双基线」报告。
 * 需求基线与执行基线各自独立；任一方不得填充另一方。
 */
export function buildBaselineReport({ requirement = null, execution = null } = {}) {
  const issues = [];

  let requirementBlock = null;
  if (object(requirement)) {
    // 需求基线必须自报身份，且不得携带执行结论。
    if (requirement.isExecutionBaseline === true)
      issues.push({
        code: 'REQUIREMENT_CLAIMS_EXECUTION',
        detail: '需求基线不得声明自己是执行基线',
      });
    if (requirement.claimsExecutionPass === true)
      issues.push({ code: 'REQUIREMENT_CLAIMS_PASS', detail: '需求基线不得声明执行通过' });
    requirementBlock = {
      kind: 'requirement-baseline',
      id: requirement.snapshot?.snapshotId ?? requirement.id ?? null,
      revision: requirement.revision ?? null,
      createdAt: requirement.createdAt ?? null,
      candidateCount: Array.isArray(requirement.candidates) ? requirement.candidates.length : 0,
      gaps: Array.isArray(requirement.gaps) ? requirement.gaps.length : 0,
    };
  }

  let executionBlock = null;
  if (object(execution)) {
    const state = execution.state;
    if (!EXECUTION_STATES.includes(state))
      issues.push({
        code: 'EXECUTION_STATE_INVALID',
        detail: '执行基线状态不合法：' + String(state),
      });
    executionBlock = {
      kind: 'execution-baseline',
      id: execution.baselineId ?? null,
      state,
      createdAt: execution.createdAt ?? null,
      // 只有真实 passed 才算通过；未运行/跳过/超时都不是。
      passed: isExecutionPass(state),
      evidenceRefs: Array.isArray(execution.evidence) ? [...execution.evidence] : [],
    };
  }

  const established = executionBlock !== null;
  return {
    ok: issues.length === 0,
    issues,
    requirement: requirementBlock,
    execution: executionBlock,
    // 显式状态字符串：缺执行基线时不得含糊。
    executionStatus: established ? executionBlock.state : 'execution-baseline-not-established',
    established,
  };
}

/**
 * 断言「仅生成文档」不能产生执行通过结论。
 * 用于渲染层与测试：任何来自文档生成的结论都必须被拒绝。
 */
export function assertDocumentIsNotExecution({ source } = {}) {
  if (!object(source)) return failure('DOCUMENT_EVIDENCE_INVALID', '证据来源必须是对象');
  const documentLike =
    source.kind === 'requirement-baseline' ||
    source.kind === 'generated-document' ||
    source.generatedByDocument === true;
  if (documentLike)
    return failure(
      'DOCUMENT_CANNOT_PROVE_EXECUTION',
      '生成的需求文档或报告模板不能作为执行通过的证据',
      { kind: source.kind ?? null },
    );
  if (source.generatedByDocument === true)
    return failure('DOCUMENT_CANNOT_PROVE_EXECUTION', '文档生成不得产生执行结论');
  if (!isExecutionPass(source.state))
    return failure('EXECUTION_NOT_PASSED', '该证据状态不是通过', { state: source.state ?? null });
  if (!Array.isArray(source.evidence) || source.evidence.length === 0)
    return failure('EXECUTION_EVIDENCE_MISSING', '通过必须有可引用的执行证据');
  return { ok: true };
}
