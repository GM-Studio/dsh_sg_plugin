const clone = (value) => JSON.parse(JSON.stringify(value));
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

export const WORK_ITEM_STATES = Object.freeze([
  'QUEUED',
  'RUNNING',
  'WAITING_FOR_USER',
  'PAUSED',
  'BLOCKED',
  'FAILED',
  'DECIDED_PENDING_APPLY',
  'RESUMING',
  'DELIVERING',
  'COMPLETED',
  'CANCELLED',
]);

export const ATTENTION_STATES = Object.freeze([
  'OPEN',
  'DELIVERED',
  'REMINDED',
  'ESCALATED',
  'DECIDED',
  'RESOLVED',
  'EXPIRED',
  'SUPERSEDED',
  'CANCELLED',
]);

export const DECISION_STATES = Object.freeze([
  'RECORDED',
  'PENDING_APPLY',
  'APPLYING',
  'APPLIED',
  'STALE',
  'REJECTED',
]);

const WORK_ITEM_TRANSITIONS = Object.freeze({
  QUEUED: ['RUNNING', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  RUNNING: [
    'WAITING_FOR_USER',
    'PAUSED',
    'BLOCKED',
    'FAILED',
    'DELIVERING',
    'COMPLETED',
    'CANCELLED',
  ],
  WAITING_FOR_USER: ['DECIDED_PENDING_APPLY', 'PAUSED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  PAUSED: ['RESUMING', 'QUEUED', 'FAILED', 'CANCELLED'],
  BLOCKED: ['QUEUED', 'RUNNING', 'RESUMING', 'FAILED', 'CANCELLED'],
  FAILED: ['QUEUED', 'RESUMING', 'CANCELLED'],
  DECIDED_PENDING_APPLY: ['RESUMING', 'WAITING_FOR_USER', 'BLOCKED', 'FAILED', 'CANCELLED'],
  RESUMING: ['RUNNING', 'BLOCKED', 'FAILED', 'CANCELLED'],
  DELIVERING: ['COMPLETED', 'BLOCKED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
});

const ATTENTION_TRANSITIONS = Object.freeze({
  OPEN: ['DELIVERED', 'REMINDED', 'DECIDED', 'RESOLVED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED'],
  DELIVERED: ['REMINDED', 'ESCALATED', 'DECIDED', 'RESOLVED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED'],
  REMINDED: ['ESCALATED', 'DECIDED', 'RESOLVED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED'],
  ESCALATED: ['DECIDED', 'RESOLVED', 'EXPIRED', 'SUPERSEDED', 'CANCELLED'],
  DECIDED: [],
  RESOLVED: [],
  EXPIRED: [],
  SUPERSEDED: [],
  CANCELLED: [],
});

const DECISION_TRANSITIONS = Object.freeze({
  RECORDED: ['PENDING_APPLY', 'STALE', 'REJECTED'],
  PENDING_APPLY: ['APPLYING', 'STALE', 'REJECTED'],
  APPLYING: ['APPLIED', 'STALE', 'REJECTED'],
  APPLIED: [],
  STALE: [],
  REJECTED: [],
});

const transition = (kind, states, transitions, input = {}) => {
  const { from, to, actorId, source, at, reason, version, related = null } = input;
  if (!states.includes(from) || !states.includes(to))
    return failure('INVALID_TRANSITION', `${kind} state is unknown`, { from, to });
  if (!transitions[from].includes(to))
    return failure('INVALID_TRANSITION', `${kind} cannot transition from ${from} to ${to}`, {
      from,
      to,
    });
  if (
    typeof actorId !== 'string' ||
    actorId.trim().length === 0 ||
    actorId.length > 256 ||
    typeof source !== 'string' ||
    source.trim().length === 0 ||
    source.length > 32 ||
    typeof reason !== 'string' ||
    reason.trim().length === 0 ||
    reason.length > 4000 ||
    !Number.isSafeInteger(version) ||
    version < 0 ||
    !Number.isFinite(Date.parse(at))
  )
    return failure('TRANSITION_EVIDENCE_INVALID', `${kind} transition evidence is incomplete`);
  return {
    ok: true,
    transition: {
      from,
      to,
      actorId,
      source,
      at: new Date(at).toISOString(),
      reason,
      version,
      related: related === null ? null : clone(related),
    },
  };
};

export function transitionWorkItem(input) {
  return transition('WorkItem', WORK_ITEM_STATES, WORK_ITEM_TRANSITIONS, input);
}

export function transitionAttention(input) {
  return transition('Attention', ATTENTION_STATES, ATTENTION_TRANSITIONS, input);
}

export function transitionDecision(input) {
  return transition('Decision', DECISION_STATES, DECISION_TRANSITIONS, input);
}

export function applyDecisionToWorkItem({ workItem, decision, at, actorId } = {}) {
  if (!isObject(workItem) || !isObject(decision))
    return failure('DECISION_APPLY_INVALID', 'WorkItem and Decision are required');
  if (workItem.executionState === 'CANCELLED')
    return failure('INVALID_TRANSITION', 'Cancelled WorkItems cannot be resumed');
  const allowedSourceStates =
    decision.action === 'accept_delivery' ? ['DELIVERING'] : ['DECIDED_PENDING_APPLY'];
  if (!allowedSourceStates.includes(workItem.executionState))
    return failure('INVALID_TRANSITION', 'WorkItem is not waiting for this Decision application', {
      state: workItem.executionState,
      action: decision.action,
    });
  if (
    !Number.isSafeInteger(decision.expectedWorkItemVersion) ||
    decision.expectedWorkItemVersion !== workItem.revision
  )
    return failure('DECISION_STALE', 'Decision targets an old WorkItem revision', {
      expectedVersion: decision.expectedWorkItemVersion ?? null,
      actualVersion: workItem.revision,
    });
  if (decision.artifactHash !== workItem.artifactHash)
    return failure('DECISION_STALE', 'Decision targets a stale artifact', {
      expectedArtifactHash: decision.artifactHash ?? null,
      actualArtifactHash: workItem.artifactHash ?? null,
    });
  if (!['PENDING_APPLY', 'APPLYING'].includes(decision.status))
    return failure('DECISION_NOT_APPLICABLE', 'Decision is not pending application', {
      status: decision.status,
    });
  const targetState =
    {
      pause: 'PAUSED',
      cancel: 'CANCELLED',
      accept_delivery: 'COMPLETED',
    }[decision.action] || 'RESUMING';
  const checked = transitionWorkItem({
    from: workItem.executionState,
    to: targetState,
    actorId,
    source: decision.source || 'system',
    at,
    reason: `Apply ${decision.action} Decision ${decision.decisionId}`,
    version: workItem.revision,
    related: { decisionId: decision.decisionId, action: decision.action },
  });
  if (!checked.ok) return checked;
  return {
    ok: true,
    workItem: {
      ...clone(workItem),
      executionState: targetState,
      revision: workItem.revision + 1,
      updatedAt: new Date(at).toISOString(),
      lastTransition: checked.transition,
      ...(targetState === 'COMPLETED' || targetState === 'CANCELLED'
        ? { completedAt: new Date(at).toISOString() }
        : {}),
    },
    decision: {
      ...clone(decision),
      status: 'APPLIED',
      appliedAt: new Date(at).toISOString(),
      appliedBy: actorId,
    },
    transition: checked.transition,
  };
}
