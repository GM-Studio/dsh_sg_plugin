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
  // M5 起词表含 refactor（SNA-0501）。
  assert.deepEqual(canonical, ['feature', 'fix', 'modify', 'refactor', 'remove']);
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
  // M5 起 refactor 合法（SNA-0501），因此不在拒绝集合里。
  for (const type of ['chore', 'Feature', '', 42]) {
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

test('remove and refactor are both in the vocabulary from M5 on', async () => {
  const source = await import('../src/codex/core/change-types.js');
  const change = await import('../src/codex/core/change.js');
  // refactor 由 M5 / SNA-0501 引入（AC-19）：现在合法，但要求专有必填字段。
  assert.equal(source.isChangeType('refactor'), true, 'M5 起 refactor 合法');
  // normalizeChangeInput 只做规范化不做细节校验，因此空 details 通过；
  // 细节必填性由 validateChangeInput 强制（见下方 refactor 专测）。
  assert.equal(normalizeChangeInput({ request: 'x', type: 'refactor', details: {} }).ok, true);
  assert.equal(
    validateChangeInput({ type: 'refactor', request: 'x', details: {} }).code,
    'CHANGE_DETAILS_INVALID',
    'validateChangeInput 必须强制 refactor 的必填细节',
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

test('a refactor must declare internal structure, preserved behaviour and constraints', () => {
  // AC-19：重构可合法进入工作流，不必伪装成新增功能，也不要求人为制造全红。
  const details = {
    internalStructure: '把导出逻辑拆到 writer 模块',
    preservedBehavior: '导出的 CSV 字节与列序完全不变',
    constraints: '公开 API 与命令行参数不变',
  };
  assert.equal(
    validateChangeInput({ type: 'refactor', request: '重构导出模块', details }).ok,
    true,
  );
  for (const field of Object.keys(details)) {
    const incomplete = { ...details };
    delete incomplete[field];
    const result = validateChangeInput({ type: 'refactor', request: 'x', details: incomplete });
    assert.equal(result.ok, false, field);
    assert.equal(result.code, 'CHANGE_DETAILS_INVALID');
  }
});

test('a refactor may not also declare a behaviour change', () => {
  // 想改变对外行为就该用 modify，而不是让 refactor 承担双重语义。
  const result = validateChangeInput({
    type: 'refactor',
    request: 'x',
    details: {
      internalStructure: 'a',
      preservedBehavior: 'b',
      constraints: 'c',
      desiredBehavior: 'd',
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /must not declare desiredBehavior/);
});

test('a refactor does not require the fix or modify specific fields', () => {
  const base = { internalStructure: 'a', preservedBehavior: 'b', constraints: 'c' };
  // fix 需要 expectedBehavior/actualBehavior；modify 需要 existing/desired/compatibility。
  // refactor 两者都不需要。
  assert.equal(validateChangeInput({ type: 'refactor', request: 'x', details: base }).ok, true);
  assert.equal(
    validateChangeInput({ type: 'fix', request: 'x', details: base }).code,
    'CHANGE_DETAILS_INVALID',
  );
  assert.equal(
    validateChangeInput({ type: 'modify', request: 'x', details: base }).code,
    'CHANGE_DETAILS_INVALID',
  );
});
