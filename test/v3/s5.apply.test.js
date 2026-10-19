import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDeltaToText } from '../../src/v3/openspec/apply.js';

const ADDED = `## ADDED Requirements

### Requirement: 问候 (REQ-001)

系统 SHALL 问候。

#### Scenario: 默认 (AC-001)

- **WHEN** 调用
- **THEN** hello
`;

const SPEC_V1 = `# greeting

### Requirement: 问候 (REQ-001)

旧行为。

#### Scenario: 默认 (AC-001)

- **WHEN** 调用
- **THEN** hi
`;

test('ADDED 在空 specs 上创建需求', () => {
  const result = applyDeltaToText('', ADDED);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.match(result.text, /REQ-001/);
  assert.match(result.text, /AC-001/);
});

test('ADDED 已存在的需求报错', () => {
  const result = applyDeltaToText(SPEC_V1, ADDED);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /已存在/);
});

test('MODIFIED 替换整段需求', () => {
  const modified = `## MODIFIED Requirements

### Requirement: 问候 (REQ-001)

新行为。

#### Scenario: 默认 (AC-001)

- **WHEN** 调用
- **THEN** hello
`;
  const result = applyDeltaToText(SPEC_V1, modified);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.match(result.text, /新行为/);
  assert.doesNotMatch(result.text, /旧行为/);
  assert.doesNotMatch(result.text, /THEN\*\* hi/);
});

test('REMOVED 删除需求', () => {
  const removed = `## REMOVED Requirements

### Requirement: 问候 (REQ-001)

理由：不再需要。
`;
  const result = applyDeltaToText(SPEC_V1, removed);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.doesNotMatch(result.text, /REQ-001/);
  assert.match(result.text, /# greeting/);
});

test('REMOVED 不存在的需求报错', () => {
  const removed = `## REMOVED Requirements

### Requirement: 不存在 (REQ-999)

理由：无。
`;
  const result = applyDeltaToText(SPEC_V1, removed);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /不存在/);
});
