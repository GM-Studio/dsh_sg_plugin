import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRequest } from '../src/classify.js';

test('classifyRequest recognizes explicit new-feature requests as L1', () => {
  const result = classifyRequest('新增用户登录功能');
  assert.equal(result.paradigm, 'L1');
  assert.equal(result.label, '需求驱动（全量流程）');
  assert.match(result.reason, /需求/);
});

test('classifyRequest keeps defect reports at L3 and generic work at L2', () => {
  assert.equal(classifyRequest('修复登录报错').paradigm, 'L3');
  assert.equal(classifyRequest('重构订单模块').paradigm, 'L2');
  assert.equal(classifyRequest('随便看看').paradigm, 'L2');
});

test('classifyRequest returns English labels when asked', () => {
  const result = classifyRequest('add a login feature', 'en');
  assert.equal(result.paradigm, 'L1');
  assert.match(result.label, /Requirement-driven/);
});
