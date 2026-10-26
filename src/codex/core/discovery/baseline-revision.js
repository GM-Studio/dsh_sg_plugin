// 候选基线的确认、纠正与拒绝（M2 / SNA-0205）。
//
// 目标（AC-06）：用户可以确认、纠正或拒绝推断；基线修订保留历史，不覆盖原始证据。
//
// 三条不变量：
// 1. 追加式修订：任何动作都产生新的 revision，旧 revision 完整可读；
// 2. 原始证据不可覆盖：确认只提升证据类别，原 static-observed 记录仍在 revision 历史中；
// 3. 确认动作一次性：同一动作重复消费被拒（复用 approvals 的 consume 语义）。

import { isEvidenceClass } from './candidates.js';

/** 允许的处置动作。 */
export const DISPOSITIONS = Object.freeze(['confirm', 'correct', 'reject']);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const text = (value, max = 16384) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/**
 * 应用一次处置。
 * 不修改传入的 revision —— 返回新对象，保证历史不可变。
 */
export function applyDisposition({
  revision,
  candidateId,
  action,
  text: note,
  actionId,
  consumedActions = [],
} = {}) {
  if (!object(revision) || !Array.isArray(revision.candidates))
    return failure('BASELINE_REVISION_INVALID', '需要一个基线修订');
  if (!DISPOSITIONS.includes(action))
    return failure('DISPOSITION_INVALID', '不支持的处置动作', { allowed: DISPOSITIONS });
  if (!text(actionId, 128))
    return failure('DISPOSITION_INVALID', '处置动作必须有稳定 actionId 以便一次性消费');
  if (consumedActions.includes(actionId))
    return failure('DISPOSITION_ALREADY_CONSUMED', '该确认动作已被消费，不能重复使用');
  const index = revision.candidates.findIndex((entry) => entry.id === candidateId);
  if (index === -1) return failure('CANDIDATE_NOT_FOUND', '候选需求不存在', { candidateId });
  const original = revision.candidates[index];

  const nextCandidates = revision.candidates.map((entry, position) =>
    position === index ? { ...entry } : { ...entry },
  );
  const target = nextCandidates[index];

  if (action === 'confirm') {
    // 确认：类别提升为用户确认，原始类别保留在 history 中。
    target.evidenceClass = 'user-confirmed';
    target.userConfirmed = true;
  } else if (action === 'correct') {
    if (!text(note)) return failure('DISPOSITION_INVALID', '纠正必须给出新的陈述');
    target.text = note;
    target.evidenceClass = 'user-confirmed';
    target.userConfirmed = true;
  } else {
    target.status = 'rejected';
  }

  const historyEntry = {
    actionId,
    action,
    candidateId,
    at: revision.revision + 1,
    // 原始证据在这里完整保留，不因后续动作被覆盖。
    original: {
      id: original.id,
      text: original.text,
      evidenceClass: original.evidenceClass,
      sourceRefs: Array.isArray(original.sourceRefs) ? [...original.sourceRefs] : [],
    },
    note: text(note) ? note : null,
  };

  return {
    ok: true,
    revision: {
      ...revision,
      revision: revision.revision + 1,
      candidates: nextCandidates,
      history: [...(Array.isArray(revision.history) ? revision.history : []), historyEntry],
    },
    consumed: [...consumedActions, actionId],
  };
}

/** 创建初始修订（不丢弃任何原始证据）。 */
export function createRevision({ candidates = [], snapshot = null, gaps = [] } = {}) {
  if (!Array.isArray(candidates))
    return failure('BASELINE_REVISION_INVALID', 'candidates 必须是数组');
  const ids = new Set();
  for (const candidate of candidates) {
    if (!object(candidate) || typeof candidate.id !== 'string')
      return failure('BASELINE_REVISION_INVALID', '候选需求缺少 id');
    if (ids.has(candidate.id))
      return failure('BASELINE_REVISION_INVALID', '候选需求 id 重复：' + candidate.id);
    ids.add(candidate.id);
    if (!isEvidenceClass(candidate.evidenceClass))
      return failure('BASELINE_REVISION_INVALID', '证据类别不合法：' + candidate.id);
  }
  return {
    ok: true,
    revision: {
      revision: 1,
      snapshot,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        sourceRefs: Array.isArray(candidate.sourceRefs) ? [...candidate.sourceRefs] : [],
      })),
      gaps: Array.isArray(gaps) ? [...gaps] : [],
      history: [],
      isExecutionBaseline: false,
      claimsExecutionPass: false,
    },
  };
}

/** 读取某条候选在全部历史中出现过的证据类别（审计用）。 */
export function evidenceTrail(revision, candidateId) {
  if (!object(revision)) return [];
  const trail = [];
  for (const entry of Array.isArray(revision.history) ? revision.history : [])
    if (entry.candidateId === candidateId) trail.push(entry);
  return trail;
}
