import test from 'node:test';
import assert from 'node:assert/strict';
import { createIncrementalPlan, validateIncrementalPlan } from '../src/codex/incremental.js';

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
