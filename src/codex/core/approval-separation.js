// 五类审批分离（M7 / SNA-0706、SNA-0707）。
//
// 目标（AC-36）：写入需求文档、批准需求、批准实施计划、批准安装、批准交付
// 分别表达，不相互代替授权。

/** 五类审批（唯一合法集合）。 */
export const APPROVAL_KINDS = Object.freeze([
  'write-requirement-document',
  'approve-requirement',
  'approve-plan',
  'approve-installation',
  'approve-delivery',
]);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const text = (value, max = 1024) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const HASH = /^(?:sha256:)?[a-f0-9]{64}$/i;

/** 创建一条审批记录；必须绑定被批准对象的哈希。 */
export function createApproval({ kind, artifactHash, grantedAt, grantedBy } = {}) {
  if (!APPROVAL_KINDS.includes(kind))
    return failure('APPROVAL_INVALID', '未知的审批类型', { allowed: APPROVAL_KINDS });
  if (!HASH.test(String(artifactHash || '')))
    return failure('APPROVAL_INVALID', '审批必须绑定被批准对象的哈希');
  if (typeof grantedAt !== 'string' || !Number.isFinite(Date.parse(grantedAt)))
    return failure('APPROVAL_INVALID', '审批必须记录时间');
  if (!text(grantedBy, 256)) return failure('APPROVAL_INVALID', '审批必须记录授权者');
  return {
    ok: true,
    approval: {
      kind,
      artifactHash,
      grantedAt,
      grantedBy,
      consumedAt: null,
    },
  };
}

/** 校验一份审批集合。 */
export function validateApprovalSet({ approvals = [] } = {}) {
  if (!Array.isArray(approvals)) return failure('APPROVAL_INVALID', 'approvals 必须是数组');
  const problems = [];
  const byKind = new Map();
  for (const entry of approvals) {
    if (!object(entry) || !APPROVAL_KINDS.includes(entry.kind)) {
      problems.push({ code: 'UNKNOWN_KIND', kind: entry?.kind ?? null });
      continue;
    }
    if (byKind.has(entry.kind)) problems.push({ code: 'DUPLICATE_KIND', kind: entry.kind });
    byKind.set(entry.kind, entry);
  }
  return {
    ok: problems.length === 0,
    code: problems.length === 0 ? undefined : 'APPROVAL_INVALID',
    problems,
    present: [...byKind.keys()].sort(),
    missing: APPROVAL_KINDS.filter((kind) => !byKind.has(kind)).sort(),
  };
}

/**
 * 判定某项操作是否被授权（AC-36）。
 * 每种操作只认自己那一类审批，不接受任何替代。
 */
export function authorize({ operation, approvals = [], artifactHash = null } = {}) {
  if (!APPROVAL_KINDS.includes(operation))
    return failure('APPROVAL_INVALID', '未知的操作类型', { allowed: APPROVAL_KINDS });
  if (!Array.isArray(approvals)) return failure('APPROVAL_INVALID', 'approvals 必须是数组');

  const match = approvals.find((entry) => object(entry) && entry.kind === operation);
  if (!match)
    return failure('APPROVAL_MISSING', '缺少该操作所需的审批', {
      operation,
      present: approvals
        .filter((entry) => APPROVAL_KINDS.includes(entry?.kind))
        .map((entry) => entry.kind)
        .sort(),
    });

  if (match.consumedAt)
    return failure('APPROVAL_ALREADY_CONSUMED', '该审批已被消费', { operation });

  if (artifactHash !== null && match.artifactHash !== artifactHash)
    return failure('APPROVAL_STALE', '被批准内容已变化，必须重新审批', {
      operation,
      approved: match.artifactHash,
      current: artifactHash,
    });

  return {
    ok: true,
    operation,
    grantedBy: match.grantedBy,
    grantedAt: match.grantedAt,
    scope: [operation],
  };
}

/** 两两独立性矩阵：C(5,2) = 10 组互不替代。 */
export function independenceMatrix() {
  const pairs = [];
  for (let i = 0; i < APPROVAL_KINDS.length; i += 1) {
    for (let j = i + 1; j < APPROVAL_KINDS.length; j += 1)
      pairs.push([APPROVAL_KINDS[i], APPROVAL_KINDS[j]]);
  }
  return { ok: true, pairs, count: pairs.length };
}
