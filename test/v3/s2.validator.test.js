import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeltaFiles } from '../../src/v3/openspec/validator.js';

function delta(capability, text) {
  return [{ capability, path: `openspec/changes/c/specs/${capability}/spec.md`, text }];
}

const SPECS = new Map([
  [
    'login',
    [
      {
        id: 'REQ-001',
        title: '登录',
        scenarios: [{ id: 'AC-001' }],
      },
    ],
  ],
]);

const ADDED_NEW = `## ADDED Requirements

### Requirement: 注册 (REQ-002)

#### Scenario: 注册成功 (AC-002)
`;

const ADDED_EXISTING = `## ADDED Requirements

### Requirement: 登录 (REQ-001)

#### Scenario: 登录成功 (AC-001)
`;

const MODIFIED_MISSING = `## MODIFIED Requirements

### Requirement: 不存在 (REQ-999)

#### Scenario: 场景 (AC-999)
`;

const MODIFIED_EXISTING = `## MODIFIED Requirements

### Requirement: 登录 (REQ-001)

#### Scenario: 登录成功 (AC-001)
`;

test('合法 feature delta 通过', () => {
  const result = validateDeltaFiles({
    files: delta('login', ADDED_NEW),
    specs: SPECS,
    type: 'feature',
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.counts.ADDED, 1);
});

test('ADDED 已存在的 REQ 被拒', () => {
  const result = validateDeltaFiles({
    files: delta('login', ADDED_EXISTING),
    specs: SPECS,
    type: 'feature',
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /已存在于 specs/);
});

test('MODIFIED 不存在的 REQ 被拒', () => {
  const result = validateDeltaFiles({
    files: delta('login', MODIFIED_MISSING),
    specs: SPECS,
    type: 'modify',
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /不存在/);
});

test('MODIFIED 已存在的 REQ 通过', () => {
  const result = validateDeltaFiles({
    files: delta('login', MODIFIED_EXISTING),
    specs: SPECS,
    type: 'modify',
  });
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('feature 缺 ADDED 被拒', () => {
  const result = validateDeltaFiles({
    files: delta('login', MODIFIED_EXISTING),
    specs: SPECS,
    type: 'feature',
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /至少需要一条 ADDED/);
});

test('remove 缺 REMOVED 被拒', () => {
  const result = validateDeltaFiles({
    files: delta('login', ADDED_NEW),
    specs: SPECS,
    type: 'remove',
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /至少需要一条 REMOVED/);
});

test('重复 REQ 编号被拒', () => {
  const text = `## ADDED Requirements

### Requirement: 甲 (REQ-002)

#### Scenario: 场景一 (AC-002)

### Requirement: 乙 (REQ-002)

#### Scenario: 场景二 (AC-003)
`;
  const result = validateDeltaFiles({ files: delta('login', text), specs: SPECS, type: 'feature' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /REQ 编号重复/);
});

test('ADDED 缺 Scenario 被拒', () => {
  const text = `## ADDED Requirements

### Requirement: 空需求 (REQ-002)
`;
  const result = validateDeltaFiles({ files: delta('login', text), specs: SPECS, type: 'feature' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /至少需要一个 Scenario/);
});

test('空 delta 被拒', () => {
  const result = validateDeltaFiles({ files: [], specs: SPECS, type: 'feature' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /delta 为空/);
});
