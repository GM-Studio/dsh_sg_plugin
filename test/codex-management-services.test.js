import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlManagementServices } from '../src/codex/control/management-services.js';

function stubService() {
  const calls = [];
  const method = (name) => async (input) => {
    calls.push([name, input]);
    return { ok: true, name };
  };
  return {
    calls,
    service: {
      projection: {},
      decisions: {
        create: method('create'),
        pause: method('pause'),
        resume: method('resume'),
        retry: method('retry'),
        cancel: method('cancel'),
        requestChanges: method('requestChanges'),
      },
      async requeueNotification(input) {
        calls.push(['resend', input]);
        return { ok: true };
      },
    },
  };
}

test('management services derive auth level from server-owned step-up verification', async () => {
  const { calls, service } = stubService();
  const management = createControlManagementServices({
    service,
    verifyStepUp: (code) => (code === '123456' ? 'step-up' : null),
  });
  const result = await management.decisions.create({
    workItemId: 'work-1',
    attentionId: 'attention-1',
    attentionRevision: 1,
    expectedWorkItemVersion: 2,
    artifactHash: 'a'.repeat(64),
    action: 'approve',
    idempotencyKey: 'idem-1',
    actorId: 'owner',
    source: 'web',
    stepUpCode: '123456',
    projectRoot: '/untrusted/project',
  });
  assert.equal(result.ok, true);
  assert.equal(calls[0][1].authLevel, 'step-up');
  assert.equal(calls[0][1].actorId, 'owner');
});

test('cancel requires step-up while pause is a normal authenticated action', async () => {
  const { calls, service } = stubService();
  const management = createControlManagementServices({
    service,
    stepUp: { verify: (code) => (code === '654321' ? 'step-up' : null) },
  });
  assert.equal(
    (
      await management.decisions.cancel({
        workItemId: 'work-1',
        expectedWorkItemVersion: 2,
        actorId: 'owner',
      })
    ).code,
    'STEP_UP_REQUIRED',
  );
  const paused = await management.decisions.pause({
    workItemId: 'work-1',
    expectedWorkItemVersion: 2,
    actorId: 'owner',
  });
  assert.equal(paused.ok, true);
  assert.equal(calls.at(-1)[1].authLevel, 'session');
});

test('forged system source is rejected from the web management wrapper', async () => {
  const { service } = stubService();
  const management = createControlManagementServices({
    service,
    verifyStepUp: () => null,
  });
  assert.equal(
    (
      await management.decisions.pause({
        workItemId: 'work-1',
        expectedWorkItemVersion: 2,
        actorId: 'attacker',
        source: 'system',
      })
    ).code,
    'INVALID_ARGUMENT',
  );
});

test('customer acceptance writes the linked DeliveryRecord before consuming the Control Decision', async () => {
  const calls = [];
  const service = {
    projection: {},
    decisions: {
      async preview(input) {
        calls.push(['preview', input]);
        return {
          ok: true,
          workItem: {
            workItemId: input.workItemId,
            projectRoot: '/work/product',
            outcome: {
              delivery: {
                deliveryId: 'delivery-1',
                recordHash: 'b'.repeat(64),
              },
            },
          },
          attention: { type: 'COMPLETION', status: 'DELIVERED' },
        };
      },
      async create(input) {
        calls.push(['create', input]);
        return {
          ok: true,
          workItem: { workItemId: input.workItemId, executionState: 'COMPLETED' },
          attention: { requestId: input.attentionId, status: 'DECIDED' },
          decision: { decisionId: 'decision-1' },
        };
      },
    },
  };
  const management = createControlManagementServices({
    service,
    verifyStepUp: (code) => (code === '123456' ? 'step-up' : null),
    acceptDelivery: async (input) => {
      calls.push(['accept', input]);
      return {
        ok: true,
        acceptanceHash: 'c'.repeat(64),
        acceptance: { baseRecordHash: 'b'.repeat(64) },
        delivery: { deliveryId: input.deliveryId, releaseState: 'customer-accepted' },
      };
    },
  });

  const result = await management.deliveries.accept({
    workItemId: 'work-1',
    attentionId: 'attention-1',
    attentionRevision: 2,
    expectedWorkItemVersion: 4,
    artifactHash: 'a'.repeat(64),
    action: 'accept_delivery',
    idempotencyKey: 'accept-1',
    actorId: 'owner',
    source: 'web',
    stepUpCode: '123456',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map(([name]) => name),
    ['preview', 'accept', 'create'],
  );
  assert.equal(calls[1][1].deliveryId, 'delivery-1');
  assert.equal(calls[1][1].expectedRecordHash, 'b'.repeat(64));
  assert.equal(calls[1][1].projectRoot, '/work/product');
  assert.equal(calls[2][1].payload.deliveryId, 'delivery-1');
  assert.equal(calls[2][1].payload.acceptanceHash, 'c'.repeat(64));
});

test('customer acceptance refuses a missing or changed DeliveryRecord before writing', async () => {
  let deliveryWrites = 0;
  const service = {
    projection: {},
    decisions: {
      async preview() {
        return {
          ok: true,
          workItem: { projectRoot: '/work/product', outcome: { delivery: null } },
          attention: { type: 'COMPLETION' },
        };
      },
      async create() {
        throw new Error('must not consume without a delivery');
      },
    },
  };
  const management = createControlManagementServices({
    service,
    verifyStepUp: () => 'step-up',
    acceptDelivery: async () => {
      deliveryWrites += 1;
      return { ok: true };
    },
  });

  const result = await management.deliveries.accept({
    workItemId: 'work-1',
    attentionId: 'attention-1',
    attentionRevision: 2,
    expectedWorkItemVersion: 4,
    artifactHash: 'a'.repeat(64),
    action: 'accept_delivery',
    idempotencyKey: 'accept-1',
    actorId: 'owner',
    stepUpCode: '123456',
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'DELIVERY_NOT_LINKED');
  assert.equal(deliveryWrites, 0);
});

test('generic Decision API cannot bypass the DeliveryRecord acceptance endpoint', async () => {
  const management = createControlManagementServices({
    service: {
      projection: {},
      decisions: {
        async create() {
          throw new Error('must not be called');
        },
      },
    },
    verifyStepUp: () => 'step-up',
  });
  const result = await management.decisions.create({
    action: 'accept_delivery',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
  });
  assert.equal(result.code, 'DELIVERY_ACCEPTANCE_ENDPOINT_REQUIRED');
});

test('changed DeliveryRecord hash refuses acceptance before Control Decision consumption', async () => {
  let controlWrites = 0;
  const management = createControlManagementServices({
    service: {
      projection: {},
      decisions: {
        async preview() {
          return {
            ok: true,
            workItem: {
              projectId: 'project-1',
              projectRoot: '/work/product',
              outcome: {
                delivery: {
                  deliveryId: 'delivery-1',
                  projectId: 'project-1',
                  recordHash: 'b'.repeat(64),
                },
              },
            },
            attention: { type: 'COMPLETION' },
          };
        },
        async create() {
          controlWrites += 1;
          return { ok: true };
        },
      },
    },
    verifyStepUp: () => 'step-up',
    acceptDelivery: async () => ({
      ok: true,
      acceptanceHash: 'c'.repeat(64),
      acceptance: { baseRecordHash: 'd'.repeat(64) },
      delivery: { deliveryId: 'delivery-1' },
    }),
  });
  const result = await management.deliveries.accept({
    workItemId: 'work-1',
    attentionId: 'attention-1',
    attentionRevision: 2,
    expectedWorkItemVersion: 4,
    artifactHash: 'a'.repeat(64),
    idempotencyKey: 'changed-delivery',
    actorId: 'owner',
    stepUpCode: '123456',
  });
  assert.equal(result.code, 'DELIVERY_ARTIFACT_CHANGED');
  assert.equal(controlWrites, 0);
});

test('Web WorkItem creation cannot select an arbitrary local project path', async () => {
  let observed;
  const management = createControlManagementServices({
    service: {
      projection: {},
      decisions: {},
      async createWorkItem(input) {
        observed = input;
        return { ok: true, workItem: { workItemId: 'work-1' } };
      },
    },
    verifyStepUp: () => null,
    defaultProjectRoot: '/srv/specgate/project',
  });
  const result = await management.workItems.create({
    title: 'Task',
    request: 'Do work',
    projectRoot: '/etc',
  });
  assert.equal(result.ok, true);
  assert.equal(observed.projectRoot, '/srv/specgate/project');
});
