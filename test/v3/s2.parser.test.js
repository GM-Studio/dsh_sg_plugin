import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelta, parseSpec } from '../../src/v3/openspec/parser.js';

const VALID = `## ADDED Requirements

### Requirement: 登录接口 (REQ-012)

系统 SHALL 在校验凭证后签发会话。

#### Scenario: 正确凭证 (AC-034)

- **WHEN** 用户提交正确凭证
- **THEN** 返回 200

## MODIFIED Requirements

### Requirement: 会话过期 (REQ-003)

系统 SHALL 在 30 分钟后过期。

#### Scenario: 过期后拒绝 (AC-009)

- **WHEN** 会话过期
- **THEN** 返回 401

## REMOVED Requirements

### Requirement: 旧登录 (REQ-001)

理由：被 REQ-012 取代。
`;

test('parseDelta 解析三段与 REQ/AC', () => {
  const result = parseDelta(VALID);
  assert.deepEqual(result.errors, []);
  assert.equal(result.sections.ADDED.length, 1);
  assert.equal(result.sections.MODIFIED.length, 1);
  assert.equal(result.sections.REMOVED.length, 1);
  assert.equal(result.sections.ADDED[0].id, 'REQ-012');
  assert.equal(result.sections.ADDED[0].scenarios[0].id, 'AC-034');
  assert.match(result.sections.ADDED[0].body, /SHALL/);
});

test('parseDelta 报告缺少 REQ 编号', () => {
  const result = parseDelta('## ADDED Requirements\n\n### Requirement: 没有编号\n');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /REQ/);
});

test('parseDelta 报告缺少 AC 编号', () => {
  const text = `## ADDED Requirements

### Requirement: 登录 (REQ-001)

#### Scenario: 没有编号
`;
  const result = parseDelta(text);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /AC/);
});

test('parseDelta 报告段落外的 Requirement', () => {
  const result = parseDelta('### Requirement: 游离 (REQ-001)\n');
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /段内/);
});

test('parseDelta 报告游离的 Scenario', () => {
  const result = parseDelta('#### Scenario: 游离 (AC-001)\n');
  assert.equal(result.errors.length, 1);
});

test('parseSpec 解析不带段头的能力规格', () => {
  const result = parseSpec(`### Requirement: 登录 (REQ-001)

系统 SHALL 登录。

#### Scenario: 成功 (AC-001)

- **WHEN** 正确
- **THEN** 200
`);
  assert.deepEqual(result.errors, []);
  assert.equal(result.requirements.length, 1);
  assert.equal(result.requirements[0].id, 'REQ-001');
  assert.equal(result.requirements[0].scenarios[0].id, 'AC-001');
});
