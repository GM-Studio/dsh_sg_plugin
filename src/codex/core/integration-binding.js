// 集成结果绑定（M6 / SNA-0606）。
//
// 目标（AC-29）：集成结果绑定具体任务、输入版本、agent 会话与提交；
// 最终验证不得拼接不同提交的通过结果。
//
// 这是「一个提交一次验收」在数据层的落地：任何跨提交的拼接都会被拒绝。

const COMMIT = /^[a-f0-9]{40,64}$/i;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const text = (value, max = 1024) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/**
 * 记录一次集成结果。
 * 四要素缺一不可：任务、输入版本、agent 会话、提交。
 */
export function recordIntegration({
  taskId,
  inputVersion,
  agentSession,
  commit,
  branch = null,
  isolatedWorktree = null,
} = {}) {
  if (!text(taskId, 128)) return failure('INTEGRATION_BINDING_INVALID', '缺少任务 id');
  if (!text(inputVersion, 256)) return failure('INTEGRATION_BINDING_INVALID', '缺少输入版本');
  if (!text(agentSession, 256)) return failure('INTEGRATION_BINDING_INVALID', '缺少 agent 会话');
  if (typeof commit !== 'string' || !COMMIT.test(commit))
    return failure('INTEGRATION_BINDING_INVALID', '缺少合法提交哈希');
  return {
    ok: true,
    binding: {
      taskId,
      inputVersion,
      agentSession,
      commit,
      branch: text(branch, 255) ? branch : null,
      // 并发任务必须各有隔离工作区，否则结果不可追溯。
      isolatedWorktree: text(isolatedWorktree, 4096) ? isolatedWorktree : null,
    },
  };
}

/**
 * 汇总一次集成的最终验证证据。
 * 所有证据必须指向同一个提交；混用即拒绝（AC-29）。
 */
export function bindFinalVerification({ commit, bindings = [], evidence = [] } = {}) {
  if (typeof commit !== 'string' || !COMMIT.test(commit))
    return failure('INTEGRATION_BINDING_INVALID', '最终验证必须绑定合法提交');
  if (!Array.isArray(bindings) || bindings.length === 0)
    return failure('INTEGRATION_BINDING_INVALID', '最终验证必须绑定至少一个任务');
  if (!Array.isArray(evidence))
    return failure('INTEGRATION_BINDING_INVALID', 'evidence 必须是数组');

  // 1. 任务绑定必须都已提交且一致。
  const mismatched = bindings.filter((entry) => !object(entry) || entry.commit !== commit);
  if (mismatched.length > 0)
    return failure(
      'INTEGRATION_COMMIT_MISMATCH',
      '存在绑定到其他提交的任务，不得拼接不同提交的通过结果',
      { commit, mismatchedCommits: [...new Set(mismatched.map((entry) => entry?.commit ?? null))] },
    );

  // 2. 证据也必须指向同一提交。
  const foreignEvidence = evidence.filter(
    (entry) => object(entry) && typeof entry.commit === 'string' && entry.commit !== commit,
  );
  if (foreignEvidence.length > 0)
    return failure('INTEGRATION_EVIDENCE_MISMATCH', '存在来自其他提交的证据', {
      commit,
      foreignCommits: [...new Set(foreignEvidence.map((entry) => entry.commit))],
    });

  return {
    ok: true,
    commit,
    tasks: bindings.map((entry) => entry.taskId),
    agentSessions: [...new Set(bindings.map((entry) => entry.agentSession))],
    evidenceCount: evidence.length,
    // 明确：一份验证结果只对一个提交有效（AC-35 的前置）。
    validForCommitOnly: commit,
    reusableForOtherCommits: false,
  };
}

/**
 * 并发任务隔离检查。
 * 同一工作区上并行两个任务会产生互相覆盖的结果。
 */
export function checkIsolation({ bindings = [] } = {}) {
  if (!Array.isArray(bindings))
    return failure('INTEGRATION_BINDING_INVALID', 'bindings 必须是数组');
  const worktrees = bindings
    .filter((entry) => object(entry) && text(entry.isolatedWorktree, 4096))
    .map((entry) => entry.isolatedWorktree);
  const duplicated = worktrees.filter((value, index) => worktrees.indexOf(value) !== index);
  const missing = bindings.filter((entry) => !object(entry) || !text(entry.isolatedWorktree, 4096));
  return {
    ok: duplicated.length === 0 && missing.length === 0,
    code:
      duplicated.length > 0
        ? 'WORKTREE_NOT_ISOLATED'
        : missing.length > 0
          ? 'WORKTREE_MISSING'
          : undefined,
    duplicated: [...new Set(duplicated)],
    missing: missing.map((entry) => entry?.taskId ?? null),
  };
}

/**
 * 集成冲突处理：回到具体任务，不静默丢弃分支结果。
 */
export function recordConflict({ taskId, paths = [], resolution = null } = {}) {
  if (!text(taskId, 128)) return failure('INTEGRATION_BINDING_INVALID', '冲突必须归属到具体任务');
  return {
    ok: true,
    conflict: {
      taskId,
      paths: Array.isArray(paths) ? [...paths] : [],
      resolution: text(resolution, 1024) ? resolution : 'pending',
      // 冲突必须显式回退到任务，不能被当作「已解决」跳过。
      requiresRework: resolution === null || resolution === 'pending',
    },
  };
}
