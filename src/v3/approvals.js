import { nowIso } from './state.js';

export const APPROVAL_TTL_MS = 10 * 60 * 1000;

export function approvalOptions() {
  return [
    { label: '通过', description: '批准该断点产物，继续下一步' },
    { label: '需要修改', description: '拒绝当前产物，退回修改' },
  ];
}

export async function askApproval(
  runtime,
  { gate, change, artifactHash, agent, signal, summary = '', pages = null },
) {
  const userQuestions = runtime.service('userQuestions');
  if (!userQuestions || typeof userQuestions.ask !== 'function') {
    return {
      ok: false,
      code: 'NO_QUESTION_CHANNEL',
      message: '当前宿主不提供用户问答通道，批准被拒绝（fail-closed）',
      fix: '在支持 userQuestions 的 DSH 会话中重试',
    };
  }

  const shortHash = String(artifactHash || '')
    .replace(/^sha256:/, '')
    .slice(0, 12);
  const questions =
    Array.isArray(pages) && pages.length > 0
      ? pages.map((page, index) => ({
          id: `sg-approve-${gate}-${index}`,
          header: page.header,
          question: page.question,
          options:
            index === pages.length - 1
              ? approvalOptions()
              : [{ label: '已读', description: '继续下一页' }],
        }))
      : [
          {
            id: `sg-approve-${gate}`,
            header: `SpecGate ${gate} 批准`,
            question:
              summary || `change「${change}」的 ${gate} 产物指纹为 ${shortHash}…，是否批准？`,
            options: approvalOptions(),
          },
        ];
  let answer;
  try {
    answer = await userQuestions.ask({ questions, agent, signal });
  } catch (error) {
    return {
      ok: false,
      code: 'QUESTION_FAILED',
      message: `询问失败：${error instanceof Error ? error.message : String(error)}`,
      fix: '重试 /sg-approve，或检查宿主问答通道',
    };
  }

  const answers = Array.isArray(answer?.answers) ? answer.answers : [];
  const item = answers[answers.length - 1] || answers[0];
  const selected = Array.isArray(item?.selected) ? item.selected[0] : item?.selected;
  if (selected !== '通过') {
    return {
      ok: false,
      code: 'DECLINED',
      message: `用户未批准 ${gate}`,
      fix: '按反馈修改产物后重新申请批准',
    };
  }
  return { ok: true, at: nowIso() };
}

export function issueApproval(state, gate, artifactHash, at = nowIso()) {
  const issued = Date.parse(at);
  state.approvals[gate] = {
    artifactHash,
    issuedAt: at,
    expiresAt: new Date(issued + APPROVAL_TTL_MS).toISOString(),
    consumedAt: at,
  };
}

/** Approval is consumed at issue time (single use); later checks only compare fingerprints. */
export function checkApprovalHash(state, gate, artifactHash) {
  const record = state.approvals?.[gate];
  if (!record || !record.artifactHash) {
    return { ok: false, code: 'APPROVAL_MISSING', message: `${gate} 尚未批准` };
  }
  if (record.artifactHash !== artifactHash) {
    return {
      ok: false,
      code: 'APPROVAL_INVALIDATED',
      message: `${gate} 的产物在批准后发生变化，需要重新批准`,
    };
  }
  return { ok: true };
}
