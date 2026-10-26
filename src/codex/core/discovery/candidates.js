// 候选需求基线与证据类别（M2 / SNA-0204）。
//
// 目标（AC-04、AC-05、AC-07、NFR-04）：
// - 每条候选需求可追溯来源与证据类别；
// - 模型推断不得显示为用户确认；
// - 仅静态读取测试文件时，该行为不得被标为「运行验证通过」；
// - 需求基线与执行基线分别表达，不以生成文档冒充执行基线。
//
// 证据类别是本模块的核心不变量：它是枚举，不可被自由文本覆盖。

import { createHash } from 'node:crypto';

/**
 * 证据类别（唯一合法集合）。
 * - static-observed：静态读到实现/测试/配置的事实
 * - inferred-intent：由静态事实推测的业务意图（模型推断）
 */
export const EVIDENCE_CLASSES = Object.freeze([
  'static-observed',
  'inferred-intent',
  /** 真实执行产生的证据；只能由执行链路写入，静态分析不得使用。 */
  'runtime-verified',
  /** 用户显式确认；只能由确认动作写入。 */
  'user-confirmed',
]);

/** 静态分析阶段允许产生的类别：明确排除 runtime-verified 与 user-confirmed。 */
export const STATIC_ONLY_CLASSES = Object.freeze(['static-observed', 'inferred-intent']);

const CLASS_SET = new Set(EVIDENCE_CLASSES);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const text = (value, max = 16384) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

export function isEvidenceClass(value) {
  return typeof value === 'string' && CLASS_SET.has(value);
}

/** 证据是否可被渲染为「用户已确认」。 */
export function isUserConfirmed(evidenceClass) {
  return evidenceClass === 'user-confirmed';
}

/** 证据是否来自真实执行（静态分析不得产出）。 */
export function isRuntimeVerified(evidenceClass) {
  return evidenceClass === 'runtime-verified';
}

/** 创建一条候选需求；静态阶段拒绝越权类别。 */
export function candidateRequirement({
  id,
  text: statement,
  evidenceClass,
  sourceRefs,
  stage = 'static',
} = {}) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(id || '')))
    return failure('CANDIDATE_INVALID', '候选需求必须有合法 id');
  if (!text(statement)) return failure('CANDIDATE_INVALID', '候选需求必须有无歧义的陈述');
  if (!isEvidenceClass(evidenceClass))
    return failure('CANDIDATE_INVALID', '证据类别不合法', { allowed: EVIDENCE_CLASSES });
  if (stage === 'static' && !STATIC_ONLY_CLASSES.includes(evidenceClass))
    return failure('CANDIDATE_EVIDENCE_ESCALATION', '静态分析阶段不得产出该证据类别', {
      evidenceClass,
      allowed: STATIC_ONLY_CLASSES,
    });
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0)
    return failure('CANDIDATE_INVALID', '候选需求必须可追溯到来源');
  if (!sourceRefs.every((entry) => text(entry, 1024)))
    return failure('CANDIDATE_INVALID', '来源引用必须是有限长度的非空文本');
  return {
    ok: true,
    candidate: {
      id,
      text: statement,
      evidenceClass,
      sourceRefs: [...sourceRefs],
      userConfirmed: isUserConfirmed(evidenceClass),
      runtimeVerified: isRuntimeVerified(evidenceClass),
    },
  };
}

/**
 * 由静态观察生成候选需求。
 * 这些候选永远不是 user-confirmed，也不可能是 runtime-verified。
 */
export function candidatesFromObservations(observations = []) {
  if (!Array.isArray(observations)) return failure('CANDIDATE_INVALID', 'observations 必须是数组');
  const candidates = [];
  const rejected = [];
  for (const observation of observations) {
    if (!object(observation)) continue;
    const built = candidateRequirement({
      id: observation.id,
      text: observation.text,
      // 静态观察本身是 static-observed；对外部事实的推测才用 inferred-intent。
      evidenceClass: observation.inferred === true ? 'inferred-intent' : 'static-observed',
      sourceRefs: Array.isArray(observation.sourceRefs) ? observation.sourceRefs : [],
      stage: 'static',
    });
    if (built.ok) candidates.push(built.candidate);
    else rejected.push({ id: observation.id, code: built.code, message: built.message });
  }
  return { ok: true, candidates, rejected };
}

/** 从模块与能力推导「哪些验证类别尚无证据」——缺口必须显式。 */
export function evidenceGaps({ capabilities = [], observedEvidence = [] } = {}) {
  const observed = new Set(
    (Array.isArray(observedEvidence) ? observedEvidence : []).map((entry) => entry.kind),
  );
  const gaps = [];
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    if (!object(capability) || typeof capability.kind !== 'string') continue;
    if (observed.has(capability.kind)) continue;
    gaps.push({
      capability: capability.id,
      kind: capability.kind,
      // 能力声明本身不是证据：只说明「存在这个构建/测试能力」，不代表已运行。
      reason: 'capability-declared-but-not-executed',
    });
  }
  return gaps;
}

/** 内容快照标识：无 Git 的仓库也能得到稳定标识（NFR-04）。 */
export function snapshotId({ files = [], gitCommit = null } = {}) {
  const normalized = (Array.isArray(files) ? files : [])
    .filter((entry) => object(entry) && typeof entry.path === 'string')
    .map(
      (entry) =>
        entry.path + ':' + String(entry.bytes ?? '') + ':' + String(entry.redacted === true),
    )
    .sort();
  const hash = createHash('sha256').update(normalized.join('\n')).digest('hex');
  return {
    snapshotId: 'sha256:' + hash,
    fileCount: normalized.length,
    gitCommit:
      typeof gitCommit === 'string' && /^[a-f0-9]{40,64}$/i.test(gitCommit) ? gitCommit : null,
    // 明确区分：快照标识不是执行基线。
    representsExecutionBaseline: false,
  };
}

/**
 * 组装需求基线。
 * 该产物**不是**执行基线，也不产生任何「通过」结论（AC-07）。
 */
export function buildRequirementBaseline({
  candidates = [],
  snapshot = null,
  gaps = [],
  revision = 1,
  previous = null,
} = {}) {
  if (!Array.isArray(candidates)) return failure('BASELINE_INVALID', 'candidates 必须是数组');
  const ids = new Set();
  for (const candidate of candidates) {
    if (!object(candidate) || typeof candidate.id !== 'string')
      return failure('BASELINE_INVALID', '候选需求缺少 id');
    if (ids.has(candidate.id))
      return failure('BASELINE_INVALID', '候选需求 id 重复：' + candidate.id);
    ids.add(candidate.id);
    if (!isEvidenceClass(candidate.evidenceClass))
      return failure('BASELINE_INVALID', '候选需求证据类别不合法：' + candidate.id);
    if (!Array.isArray(candidate.sourceRefs) || candidate.sourceRefs.length === 0)
      return failure('BASELINE_INVALID', '候选需求缺少来源：' + candidate.id);
  }
  return {
    ok: true,
    baseline: {
      kind: 'requirement-baseline',
      revision,
      snapshot,
      candidates: candidates.map((candidate) => ({ ...candidate })),
      gaps: Array.isArray(gaps) ? [...gaps] : [],
      // 与执行基线分离，且不携带任何通过结论。
      isExecutionBaseline: false,
      claimsExecutionPass: false,
      previousRevision: object(previous)
        ? { revision: previous.revision, snapshot: previous.snapshot }
        : null,
    },
  };
}

/**
 * 渲染候选需求。
 * 强制显示证据类别；推断绝不可渲染为用户确认（AC-04）。
 */
export function renderCandidate(candidate) {
  if (!object(candidate)) return '';
  const label = {
    'static-observed': '静态观察',
    'inferred-intent': '模型推断（未经用户确认）',
    'runtime-verified': '运行验证',
    'user-confirmed': '用户已确认',
  }[candidate.evidenceClass];
  const evidence = Array.isArray(candidate.sourceRefs) ? candidate.sourceRefs.join(', ') : '';
  return '- [' + label + '] ' + candidate.text + '（来源：' + evidence + '）';
}
