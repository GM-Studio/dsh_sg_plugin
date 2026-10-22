import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChangeContract,
  normalizeChangeInput,
  validateChangeInput,
} from '../src/codex/change-policy.js';

test('normalizes a feature alias and validates feature input', () => {
  const result = normalizeChangeInput({
    legacyFeature: true,
    request: 'Add task export.',
    details: { scope: ['Task export'], nonGoals: ['Do not change filters'] },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.type, 'feature');
  assert.deepEqual(validateChangeInput(result), { ok: true });
});

test('fix requires observed and expected behavior while retaining optional evidence', () => {
  assert.equal(
    validateChangeInput({
      type: 'fix',
      request: 'Filter returns the wrong tasks.',
      details: {
        expectedBehavior: 'Only completed tasks are returned.',
        actualBehavior: 'Open tasks are returned.',
        reproduction: 'Open filters and choose completed.',
        logs: 'synthetic log',
        environment: 'local',
        severity: 'medium',
      },
    }).ok,
    true,
  );
  assert.equal(
    validateChangeInput({
      type: 'fix',
      request: 'Filter is wrong.',
      details: { actualBehavior: 'Open tasks are returned.' },
    }).code,
    'CHANGE_DETAILS_INVALID',
  );
});

test('modify requires the current behavior, target change and compatibility statement', () => {
  assert.equal(
    validateChangeInput({
      type: 'modify',
      request: 'Change pagination.',
      details: {
        existingBehavior: 'Page size is fixed.',
        desiredBehavior: 'Page size is selectable.',
        compatibility: 'Existing requests continue to default to 20.',
      },
    }).ok,
    true,
  );
  assert.equal(
    validateChangeInput({
      type: 'modify',
      request: 'Change pagination.',
      details: { desiredBehavior: 'Page size is selectable.' },
    }).ok,
    false,
  );
});

test('unsupported types, unknown fields and apparent credentials fail closed', () => {
  assert.equal(
    validateChangeInput({ type: 'delete', request: 'Remove export.', details: {} }).code,
    'CHANGE_TYPE_INVALID',
  );
  assert.equal(
    validateChangeInput({
      type: 'feature',
      request: 'Add export.',
      details: { scope: ['export'], token: 'secret-value' },
    }).code,
    'CHANGE_DETAILS_INVALID',
  );
  assert.equal(
    validateChangeInput({
      type: 'feature',
      request: 'Use password=abcdefghijklmnop to connect.',
      details: { scope: ['connection'] },
    }).code,
    'SENSITIVE_CHANGE_INPUT',
  );
});

test('builds a contract from confirmed requirement acceptance IDs', () => {
  const result = buildChangeContract({
    changeId: 'change-1',
    parentDeliveryId: null,
    type: 'modify',
    request: 'Change pagination.',
    details: {
      existingBehavior: 'Page size is fixed.',
      desiredBehavior: 'Page size is selectable.',
      compatibility: 'Existing requests continue to default to 20.',
      scope: ['Pagination controls'],
      nonGoals: ['Do not change ordering'],
    },
    requirements: [
      {
        id: 'REQ-1',
        acceptanceCriteria: [{ id: 'AC-1', text: 'The user can select page size.' }],
      },
    ],
    baselineId: 'baseline-1',
    status: 'H1_PENDING',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.contract.acceptance, ['AC-1']);
  assert.deepEqual(result.contract.nonGoals, ['Do not change ordering']);
  assert.equal(result.contract.type, 'modify');
});
