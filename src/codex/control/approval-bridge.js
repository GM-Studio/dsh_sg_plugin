import { hashValue } from '../events.js';

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 16000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const hash = (value) =>
  typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/i.test(value)
    ? value.replace(/^sha256:/, '').toLowerCase()
    : null;

function attentionType(gate) {
  return gate === 'H1' ? 'H1_APPROVAL' : gate === 'H3' ? 'H3_APPROVAL' : null;
}

function decisionRecord(decision, gate, scope, artifactHash) {
  const action =
    decision.action === 'request_changes'
      ? 'modify'
      : decision.action === 'cancel'
        ? 'cancel'
        : 'approve';
  return {
    gate,
    scope,
    artifactHash,
    actor: {
      kind: 'user',
      id: decision.actor.id,
      source: decision.actor.source,
    },
    authLevel: decision.authLevel,
    decision: action,
    comment: decision.payload?.comment || '',
    nonce: hashValue(decision),
    issuedAt: decision.createdAt,
    expiresAt: new Date(Date.parse(decision.createdAt) + 10 * 60 * 1000).toISOString(),
    consumedAt: action === 'approve' ? null : decision.consumedAt,
  };
}

export function createControlApprovalAuthority({ service, workItemId, clock = Date.now } = {}) {
  if (!service || typeof service.inspect !== 'function')
    throw new TypeError('A control service is required for control approvals');
  if (typeof workItemId !== 'string' || !workItemId)
    return {
      availability: () => ({
        available: false,
        reason: 'CONTROL_WORK_ITEM_UNAVAILABLE',
      }),
      requestApproval: async () =>
        failure('CONTROL_WORK_ITEM_UNAVAILABLE', 'A control WorkItem id is required'),
      consumeApproval: async () =>
        failure('CONTROL_WORK_ITEM_UNAVAILABLE', 'A control WorkItem id is required'),
      authorizeGate: async () =>
        failure('CONTROL_WORK_ITEM_UNAVAILABLE', 'A control WorkItem id is required'),
    };
  const handles = new WeakMap();

  function available() {
    return { available: true, source: 'control-store', workItemId };
  }

  async function findDecision({ gate, artifactHash, scope }) {
    const inspected = await service.inspect();
    if (!inspected.ok) return inspected;
    const state = inspected.state;
    const item = state.workItems[workItemId];
    if (!item) return failure('WORK_ITEM_NOT_FOUND', 'Control WorkItem does not exist');
    const candidates = Object.values(state.decisions)
      .filter((decision) => {
        const attention = state.attention[decision.attentionId];
        return (
          decision.workItemId === workItemId &&
          decision.status === 'CONSUMED' &&
          !decision.appliedAt &&
          decision.artifactHash === artifactHash &&
          attention?.type === attentionType(gate) &&
          attention?.scope === scope
        );
      })
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return { ok: true, state, item, decision: candidates[0] || null };
  }

  async function requestApproval(challenge) {
    if (
      !object(challenge) ||
      !['H1', 'H3'].includes(challenge.gate) ||
      !text(challenge.scope, 256) ||
      !hash(challenge.artifactHash) ||
      typeof challenge.readArtifactHash !== 'function' ||
      !text(challenge.summary, 64000) ||
      (challenge.documentPath !== undefined &&
        (typeof challenge.documentPath !== 'string' ||
          challenge.documentPath.length > 32768 ||
          challenge.documentPath.includes('..') ||
          !/^\.specgate\/codex\/changes\/[A-Za-z0-9][A-Za-z0-9._/-]*\.md$/.test(
            challenge.documentPath,
          )))
    )
      return failure('APPROVAL_CHALLENGE_INVALID', 'Approval challenge is invalid');
    const artifactHash = hash(challenge.artifactHash);
    let currentHash;
    try {
      currentHash = hash(await challenge.readArtifactHash());
    } catch {
      return failure('APPROVAL_ARTIFACT_UNREADABLE', 'Approval artifact cannot be read');
    }
    if (currentHash !== artifactHash)
      return failure('APPROVAL_ARTIFACT_CHANGED', 'Approval artifact changed');
    const found = await findDecision({
      gate: challenge.gate,
      artifactHash,
      scope: challenge.scope,
    });
    if (!found.ok) return found;
    if (found.decision) {
      const record = decisionRecord(found.decision, challenge.gate, challenge.scope, artifactHash);
      if (found.decision.action !== 'approve')
        return failure(
          found.decision.action === 'cancel' ? 'APPROVAL_CANCELLED' : 'APPROVAL_MODIFY_REQUESTED',
          'The user did not approve this artifact',
          { record },
        );
      const approval = Object.freeze(Object.create(null));
      handles.set(approval, {
        decision: found.decision,
        record,
        gate: challenge.gate,
        scope: challenge.scope,
        artifactHash,
        status: 'active',
      });
      return { ok: true, approval, record };
    }
    const currentAttention = found.item.currentAttentionId
      ? found.state.attention[found.item.currentAttentionId]
      : null;
    if (
      currentAttention &&
      currentAttention.status !== 'SUPERSEDED' &&
      currentAttention.artifactHash === artifactHash &&
      currentAttention.type === attentionType(challenge.gate) &&
      currentAttention.scope === challenge.scope
    )
      return failure('WAITING_FOR_USER', 'Approval is already waiting for the user', {
        attention: currentAttention,
      });
    const requested = await service.requestAttention({
      workItemId,
      expectedVersion: found.item.revision,
      type: attentionType(challenge.gate),
      reason:
        challenge.gate === 'H1'
          ? 'Requirements and acceptance criteria require confirmation.'
          : 'Verified delivery requires H3 release approval.',
      question:
        challenge.gate === 'H1'
          ? 'Approve the frozen requirements and acceptance criteria?'
          : 'Approve the fixed Commit and release package?',
      actions: ['approve', 'request_changes', 'cancel'],
      artifactHash,
      scope: challenge.scope,
      ...(challenge.documentPath ? { documentPath: challenge.documentPath } : {}),
      summary: challenge.summary
        .replace(/^需求文档：\[打开完整文档\]\([^)]*\)\s*$/gm, '')
        .trim()
        .slice(0, 16000),
      risks: [],
      evidence: [],
    });
    return requested.ok
      ? failure('WAITING_FOR_USER', 'Approval was sent to the attention queue', {
          attention: requested.attention,
          workItem: requested.workItem,
        })
      : requested;
  }

  async function consume(approval, binding, transactionAudit = null) {
    const entry = object(approval) ? handles.get(approval) : null;
    if (!entry) return failure('APPROVAL_UNKNOWN', 'No control approval was issued');
    if (entry.status !== 'active')
      return failure('APPROVAL_CONSUMED', 'Control approval was already consumed');
    if (
      binding.gate !== entry.gate ||
      binding.scope !== entry.scope ||
      hash(binding.artifactHash) !== entry.artifactHash
    )
      return failure('APPROVAL_BINDING_MISMATCH', 'Control approval binding does not match');
    const applied = await service.markDecisionApplied({
      decisionId: entry.decision.decisionId,
      workItemId,
      consumer: `native-${binding.gate.toLowerCase()}-gate`,
    });
    if (!applied.ok) return applied;
    entry.status = 'consumed';
    const record = {
      ...entry.record,
      consumedAt: new Date(clock()).toISOString(),
    };
    if (typeof transactionAudit === 'function')
      await transactionAudit({
        type: 'approval.consumed',
        record,
      });
    return { ok: true, record };
  }

  async function consumeApproval(challenge = {}) {
    return consume(challenge.approval, challenge);
  }

  async function authorizeGate({ gate, to, approval, audit: transactionAudit } = {}) {
    if ((gate === 'H1' && to !== 'REQ_FROZEN') || (gate === 'H3' && to !== 'ARCHIVING'))
      return failure('APPROVAL_BINDING_MISMATCH', 'Control approval cannot authorize this gate');
    const entry = object(approval) ? handles.get(approval) : null;
    if (!entry) return failure('APPROVAL_UNKNOWN', 'No control approval was issued');
    return consume(
      approval,
      { gate, scope: entry.scope, artifactHash: entry.artifactHash },
      transactionAudit,
    );
  }

  return Object.freeze({
    availability: available,
    requestApproval,
    consumeApproval,
    authorizeGate,
  });
}
