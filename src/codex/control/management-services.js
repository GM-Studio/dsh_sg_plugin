import { recordCustomerAcceptance } from '../delivery.js';

const failure = (code, message) => ({ ok: false, code, message });
const text = (value, maximum = 256) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;

export function createControlManagementServices({
  service,
  stepUp = { verify: () => null },
  verifyStepUp = null,
  acceptDelivery = recordCustomerAcceptance,
  defaultProjectRoot = null,
  clock = Date.now,
} = {}) {
  if (!service || !service.projection || !service.decisions)
    throw new TypeError('A control service is required');
  if (typeof stepUp.verify !== 'function' && typeof verifyStepUp !== 'function')
    throw new TypeError('A step-up verifier is required');
  const verify = verifyStepUp || ((code) => stepUp.verify(code));

  function actor(input, allowSystem = false) {
    const actorId = input?.actorId;
    const source = input?.source || 'web';
    if (!text(actorId) || !['web', 'feishu', 'cli', 'api', 'system'].includes(source)) return null;
    if (source === 'system' && !allowSystem) return null;
    return { actorId, source };
  }

  function auth(input) {
    if (input?.authLevel === 'step-up') return 'step-up';
    return input?.stepUpCode && verify(input.stepUpCode) === 'step-up' ? 'step-up' : 'session';
  }

  function verifyStepUpCode(code) {
    return verify(code) === 'step-up';
  }

  async function create(input = {}) {
    const identity = actor(input);
    if (!identity) return failure('INVALID_ARGUMENT', 'A trusted management actor is required');
    if (input.action === 'accept_delivery')
      return failure(
        'DELIVERY_ACCEPTANCE_ENDPOINT_REQUIRED',
        'Customer acceptance must use the delivery acceptance endpoint',
      );
    return service.decisions.create({
      workItemId: input.workItemId,
      attentionId: input.attentionId,
      attentionRevision: input.attentionRevision,
      expectedWorkItemVersion: input.expectedWorkItemVersion,
      artifactHash: input.artifactHash,
      action: input.action,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      actorId: identity.actorId,
      source: identity.source,
      authLevel: auth(input),
    });
  }

  async function simple(actionName, input = {}, requireStepUp = false) {
    const identity = actor(input);
    if (!identity) return failure('INVALID_ARGUMENT', 'A trusted management actor is required');
    const methods = {
      pause: service.decisions.pause,
      resume: service.decisions.resume,
      retry: service.decisions.retry,
      cancel: service.decisions.cancel,
      requestChanges: service.decisions.requestChanges,
    };
    const method = methods[actionName];
    if (typeof method !== 'function')
      return failure('UNKNOWN_ACTION', 'Management action is unavailable');
    const level = auth(input);
    if (requireStepUp && level !== 'step-up')
      return failure('STEP_UP_REQUIRED', 'This action requires step-up authentication');
    return method({
      workItemId: input.workItemId,
      expectedVersion: input.expectedWorkItemVersion ?? input.expectedVersion,
      payload: input.payload,
      actorId: identity.actorId,
      source: identity.source,
      authLevel: level,
      idempotencyKey: input.idempotencyKey,
    });
  }

  return Object.freeze({
    projection: service.projection,
    verifyStepUp: verifyStepUpCode,
    workItems: Object.freeze({
      async create(input = {}) {
        const projectRoot = defaultProjectRoot;
        if (!text(projectRoot, 32768))
          return failure('PROJECT_ROOT_REQUIRED', 'A management project root is required');
        return service.createWorkItem({
          title: input.title,
          request: input.request,
          priority: input.priority,
          budget: input.budget,
          projectRoot,
        });
      },
    }),
    deliveries: Object.freeze({
      async accept(input = {}) {
        const identity = actor(input);
        if (!identity) return failure('INVALID_ARGUMENT', 'A trusted management actor is required');
        if (auth(input) !== 'step-up')
          return failure('STEP_UP_REQUIRED', 'Customer acceptance requires step-up authentication');
        if (typeof service.decisions.preview !== 'function')
          return failure('NOT_AVAILABLE', 'Decision preview is not configured');
        const decisionInput = {
          workItemId: input.workItemId,
          attentionId: input.attentionId,
          attentionRevision: input.attentionRevision,
          expectedWorkItemVersion: input.expectedWorkItemVersion,
          artifactHash: input.artifactHash,
          action: 'accept_delivery',
          idempotencyKey: input.idempotencyKey,
          actorId: identity.actorId,
          source: identity.source,
          authLevel: 'step-up',
          payload: input.payload,
        };
        const preview = await service.decisions.preview(decisionInput);
        if (!preview.ok) return preview;
        const linked = preview.workItem?.outcome?.delivery;
        if (!linked?.deliveryId || !linked?.recordHash)
          return failure(
            'DELIVERY_NOT_LINKED',
            'The WorkItem is not linked to an immutable DeliveryRecord',
          );
        if (linked.projectId && linked.projectId !== preview.workItem.projectId)
          return failure(
            'DELIVERY_PROJECT_MISMATCH',
            'The DeliveryRecord belongs to another project',
          );
        const projectRoot = preview.workItem.projectRoot || defaultProjectRoot;
        if (!text(projectRoot, 32768))
          return failure('PROJECT_ROOT_REQUIRED', 'A management project root is required');
        const evidence =
          input.evidence || `control-decision:${String(input.idempotencyKey || '').slice(0, 220)}`;
        const accepted = await acceptDelivery({
          projectRoot,
          deliveryId: linked.deliveryId,
          expectedRecordHash: linked.recordHash,
          actorId: identity.actorId,
          source: identity.source,
          authLevel: 'step-up',
          evidence,
          at: input.at || new Date(clock()).toISOString(),
        });
        if (!accepted.ok) return accepted;
        if (accepted.acceptance?.baseRecordHash !== linked.recordHash)
          return failure(
            'DELIVERY_ARTIFACT_CHANGED',
            'The DeliveryRecord changed after completion',
          );
        const decided = await service.decisions.create({
          ...decisionInput,
          payload: {
            ...(input.payload || {}),
            deliveryId: linked.deliveryId,
            recordHash: linked.recordHash,
            acceptanceHash: accepted.acceptanceHash,
            evidence,
          },
        });
        if (!decided.ok)
          return {
            ...decided,
            deliveryAccepted: true,
            deliveryId: linked.deliveryId,
            acceptanceHash: accepted.acceptanceHash,
            nextAction:
              'The DeliveryRecord acceptance is durable; retry the same request to finish Control state.',
          };
        return {
          ...decided,
          delivery: accepted.delivery,
          acceptance: accepted.acceptance,
          deliveryAccepted: true,
        };
      },
    }),
    decisions: Object.freeze({
      create,
      pause: (input) => simple('pause', input, false),
      resume: (input) => simple('resume', input, false),
      retry: (input) => simple('retry', input, false),
      cancel: (input) => simple('cancel', input, true),
      requestChanges: (input) => simple('requestChanges', input, false),
      resendNotification: async (input = {}) => {
        const identity = actor(input);
        if (!identity) return failure('INVALID_ARGUMENT', 'A trusted management actor is required');
        return service.requeueNotification({
          notificationId: input.notificationId,
          actorId: identity.actorId,
        });
      },
    }),
  });
}
