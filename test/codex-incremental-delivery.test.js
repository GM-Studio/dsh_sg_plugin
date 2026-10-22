import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncrementalPlan, validateIncrementalPlan } from '../src/codex/incremental.js';
import { CHANGE_TOOLS, callChangeTool } from '../src/codex/change-tools.js';

const parent = {
  deliveryId: 'delivery-1',
  projectId: 'project-1',
  deliveryCommit: 'a'.repeat(40),
  acceptance: ['AC-1', 'AC-2'],
  state: 'delivery-accepted',
};

const contract = {
  changeId: 'change-2',
  parentDeliveryId: 'delivery-1',
  acceptance: ['AC-2', 'AC-3'],
};

test('incremental plans are bound to the accepted parent delivery', () => {
  const result = createIncrementalPlan({
    projectId: 'project-1',
    parent,
    contract,
    impact: {
      affectedAcIds: ['AC-2', 'AC-3'],
      reusedAcIds: ['AC-2'],
      invalidatedTestIds: ['CASE-AC-1'],
      regressionCommands: ['npm test -- task-filter'],
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.plan.parentDeliveryId, 'delivery-1');
  assert.equal(result.plan.baselineCommit, parent.deliveryCommit);
  assert.deepEqual(validateIncrementalPlan(result.plan), { ok: true });
});

test('cross-project, unaccepted, unknown AC and missing parent references fail', () => {
  assert.equal(
    createIncrementalPlan({
      projectId: 'project-2',
      parent,
      contract,
      impact: {
        affectedAcIds: ['AC-2'],
        reusedAcIds: [],
        invalidatedTestIds: [],
        regressionCommands: [],
      },
    }).code,
    'PARENT_DELIVERY_PROJECT_MISMATCH',
  );
  assert.equal(
    createIncrementalPlan({
      projectId: 'project-1',
      parent: { ...parent, state: 'pushed' },
      contract,
      impact: {
        affectedAcIds: ['AC-2'],
        reusedAcIds: [],
        invalidatedTestIds: [],
        regressionCommands: [],
      },
    }).code,
    'PARENT_DELIVERY_NOT_ACCEPTED',
  );
  assert.equal(
    createIncrementalPlan({
      projectId: 'project-1',
      parent,
      contract,
      impact: {
        affectedAcIds: ['AC-99'],
        reusedAcIds: [],
        invalidatedTestIds: [],
        regressionCommands: [],
      },
    }).code,
    'INCREMENT_AC_UNKNOWN',
  );
  assert.equal(
    createIncrementalPlan({
      projectId: 'project-1',
      parent,
      contract: { ...contract, parentDeliveryId: 'delivery-9' },
      impact: {
        affectedAcIds: ['AC-2'],
        reusedAcIds: [],
        invalidatedTestIds: [],
        regressionCommands: [],
      },
    }).code,
    'PARENT_DELIVERY_MISMATCH',
  );
});

test('reused and affected AC sets must remain consistent', () => {
  const result = createIncrementalPlan({
    projectId: 'project-1',
    parent,
    contract,
    impact: {
      affectedAcIds: ['AC-2'],
      reusedAcIds: ['AC-3'],
      invalidatedTestIds: [],
      regressionCommands: [],
    },
  });
  assert.equal(result.code, 'INCREMENT_AC_INCONSISTENT');
});

test('sg_change wires an optional impact object with strict nested fields', () => {
  const tool = CHANGE_TOOLS.find((entry) => entry.name === 'sg_change');
  assert.ok(tool, 'sg_change tool is registered');
  const impact = tool.inputSchema.properties.impact;
  assert.ok(impact, 'sg_change exposes an impact property');
  assert.equal(impact.type, 'object');
  assert.equal(impact.additionalProperties, false);
  assert.deepEqual(impact.required, ['affectedAcIds']);
  assert.equal(impact.properties.affectedAcIds.type, 'array');
  assert.equal(impact.properties.affectedAcIds.minItems, 1);
  assert.equal(impact.properties.reusedAcIds.type, 'array');
  assert.equal(tool.inputSchema.required.includes('impact'), false);
  const alias = CHANGE_TOOLS.find((entry) => entry.name === 'sg_change_add');
  assert.equal(alias.inputSchema.properties.impact, undefined);
});

test('callChangeTool dispatches impact to sg_change and still refuses it for the sg_change_add alias', async () => {
  let received = null;
  const dispatched = await callChangeTool(
    { startTyped: async (args) => ((received = args), { ok: true }) },
    'sg_change',
    {
      expectedVersion: 0,
      request: 'Customer feedback for an accepted delivery.',
      type: 'feature',
      impact: { affectedAcIds: ['AC-2'], reusedAcIds: [] },
    },
  );
  assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
  assert.deepEqual(received.impact, { affectedAcIds: ['AC-2'], reusedAcIds: [] });

  const aliased = await callChangeTool({ start: async () => ({ ok: true }) }, 'sg_change_add', {
    expectedVersion: 0,
    request: 'Customer feedback.',
    impact: { affectedAcIds: ['AC-2'] },
  });
  assert.equal(aliased.code, 'INVALID_ARGUMENT');
});
