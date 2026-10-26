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

test('every layer shares one change-type vocabulary', async () => {
  // D-01：此前 change-policy 只有 feature/modify/fix，而 state/change 已接受 remove。
  // 本断言要求四处导出的集合逐一相等，而不是靠人工列举维护。
  const source = await import('../src/codex/core/change-types.js');
  const state = await import('../src/codex/core/state.js');
  const policy = await import('../src/codex/change-policy.js');

  const canonical = [...source.CHANGE_TYPES].sort();
  assert.deepEqual(canonical, ['feature', 'fix', 'modify', 'remove']);
  assert.deepEqual([...state.CHANGE_TYPES].sort(), canonical, 'state.js 必须使用同一词表');

  // change-policy 通过 isChangeType 暴露同一集合的判定结果。
  for (const type of canonical) {
    assert.equal(source.isChangeType(type), true, type);
    assert.equal(
      policy.normalizeChangeInput({ request: 'x', type, details: {} }).ok,
      true,
      'change-policy must accept ' + type,
    );
  }
  for (const type of ['refactor', 'chore', 'Feature', '', 42]) {
    assert.equal(source.isChangeType(type), false, String(type));
    assert.equal(
      policy.normalizeChangeInput({ request: 'x', type, details: {} }).ok,
      false,
      'change-policy must reject ' + String(type),
    );
  }
  // null/undefined 按既有语义默认成 feature（这是原行为，不是放宽）。
  for (const type of [null, undefined]) {
    const result = policy.normalizeChangeInput({ request: 'x', type, details: {} });
    assert.equal(result.ok, true, String(type));
    assert.equal(result.type, 'feature', String(type));
  }
});

test('remove is accepted consistently and refactor is not legal yet', async () => {
  const source = await import('../src/codex/core/change-types.js');
  const change = await import('../src/codex/core/change.js');
  // refactor 由 M5 / SNA-0501 引入；M1 不得提前放行。
  assert.equal(source.isChangeType('refactor'), false, 'M1 不得引入 refactor');
  assert.equal(
    normalizeChangeInput({ request: 'x', type: 'refactor', details: {} }).code,
    'CHANGE_TYPE_INVALID',
  );
  // remove 在词表内，且 change.js 与 change-policy 判定一致。
  assert.equal(source.isChangeType('remove'), true);
  assert.equal(normalizeChangeInput({ request: 'x', type: 'remove', details: {} }).ok, true);
  assert.equal(typeof change.createChange, 'function');
});

test('the type vocabulary is not duplicated as inline literals in source', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  for (const [file, pattern] of [
    ['src/codex/change-policy.js', /feature',\s*'modify'|\['feature', 'modify', 'fix'\]/],
    ['src/codex/core/state.js', /\['feature', 'modify', 'fix', 'remove'\]/],
    ['src/codex/core/change.js', /\['feature', 'modify', 'fix', 'remove'\]/],
  ]) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.equal(pattern.test(text), false, file + ' 不得再内联维护词表');
  }
});
