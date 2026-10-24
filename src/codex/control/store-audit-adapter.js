const failure = (code, message) => ({ ok: false, code, message });

const ACTION_BY_EVENT = Object.freeze({
  'project.registered': 'CREATE',
  'work_item.created': 'CREATE',
  'attention.opened': 'UPDATE',
  'attention.expired': 'EXPIRE',
  'decision.consumed': 'DECIDE',
  'decision.applied': 'APPLY',
  'run.claimed': 'UPDATE',
  'run.completed': 'UPDATE',
  'run.failed': 'UPDATE',
  'run.interrupted': 'CANCEL',
  'notification.enqueued': 'NOTIFY',
  'notification.sent': 'NOTIFY',
  'notification.failed': 'NOTIFY',
});

function objectForEvent(event) {
  const payload = event.payload || {};
  if (payload.decisionId) return { objectType: 'decision', objectId: payload.decisionId };
  if (payload.requestId) return { objectType: 'attention', objectId: payload.requestId };
  if (payload.runId) return { objectType: 'run', objectId: payload.runId };
  if (payload.workItemId) return { objectType: 'work_item', objectId: payload.workItemId };
  if (payload.projectId) return { objectType: 'project', objectId: payload.projectId };
  return { objectType: 'control_event', objectId: `event-${event.sequence}` };
}

function projectForEvent(event) {
  const payload = event.payload || {};
  if (typeof payload.projectId === 'string') return payload.projectId;
  if (typeof payload.workItemId === 'string') {
    const projectId = event.state?.workItems?.[payload.workItemId]?.projectId;
    if (projectId) return projectId;
  }
  if (typeof payload.requestId === 'string') {
    const projectId = event.state?.attention?.[payload.requestId]?.projectId;
    if (projectId) return projectId;
  }
  if (typeof payload.decisionId === 'string') {
    const decision = event.state?.decisions?.[payload.decisionId];
    const workItemId = decision?.workItemId;
    const projectId = workItemId ? event.state?.workItems?.[workItemId]?.projectId : null;
    if (projectId) return projectId;
  }
  return null;
}

function auditFromEvent(event) {
  const projectId = projectForEvent(event);
  if (!projectId) return null;
  const identity = objectForEvent(event);
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  return {
    auditId: `control-event-${event.sequence}`,
    sequence: event.sequence,
    projectId,
    actorType: 'system',
    actorId: 'control-store',
    action: ACTION_BY_EVENT[event.type] || 'UPDATE',
    objectType: identity.objectType,
    objectId: identity.objectId,
    detail: {
      eventType: String(event.type).slice(0, 128),
      action: typeof payload.action === 'string' ? payload.action.slice(0, 128) : null,
      workItemId: typeof payload.workItemId === 'string' ? payload.workItemId.slice(0, 128) : null,
      decisionId: typeof payload.decisionId === 'string' ? payload.decisionId.slice(0, 128) : null,
      attentionId: typeof payload.requestId === 'string' ? payload.requestId.slice(0, 128) : null,
    },
    createdAt: new Date(event.timestamp).toISOString(),
    previousHash: event.previousHash || null,
    entryHash: event.hash,
  };
}

export function createControlStoreAuditRepository({ store }) {
  if (!store || typeof store.inspectEvents !== 'function')
    throw new TypeError('A control store with inspectEvents is required');

  async function events() {
    const inspected = await store.inspectEvents();
    if (!inspected.ok) return inspected;
    if (!Array.isArray(inspected.events))
      return failure('AUDIT_CORRUPT', 'Control event history is invalid');
    return { ok: true, events: inspected.events, headHash: inspected.headHash };
  }

  return Object.freeze({
    async verifyAuditChain() {
      const inspected = await events();
      if (!inspected.ok) return inspected;
      return {
        ok: true,
        headHash: inspected.headHash,
        count: inspected.events.length,
      };
    },
    async listAudit(projectId) {
      const inspected = await events();
      if (!inspected.ok) return inspected;
      const audits = inspected.events
        .map(auditFromEvent)
        .filter((entry) => entry?.projectId === projectId);
      return { ok: true, audits };
    },
  });
}
