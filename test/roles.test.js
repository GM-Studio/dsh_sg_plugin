import assert from 'node:assert/strict';
import test from 'node:test';

import { inferTaskRole, inferTaskRoles } from '../src/roles.js';
import { parseTasks } from '../src/task-graph.js';

test('parseTasks reads role and files markers', () => {
  const tasks = parseTasks(
    '- [ ] T1 实现登录页面 [P] files: src/login.js, src/ui.js role: developer\n',
  );
  assert.equal(tasks[0].role, 'developer');
  assert.deepEqual(tasks[0].files, ['src/login.js', 'src/ui.js']);
});

test('explicit role always wins over inference', () => {
  const result = inferTaskRole({
    id: 'T1',
    title: '设计登录架构',
    files: ['src/login.js'],
    role: 'developer',
  });
  assert.equal(result.role, 'developer');
  assert.equal(result.explicit, true);
});

test('inference chooses architect, ddd or developer from keywords and files', () => {
  assert.equal(
    inferTaskRole({ id: 'T1', title: '设计系统架构', files: ['docs/arch.md'] }).role,
    'architect',
  );
  assert.equal(
    inferTaskRole({ id: 'T2', title: '建立订单领域聚合', files: ['domain/order.js'] }).role,
    'ddd',
  );
  assert.equal(
    inferTaskRole({ id: 'T3', title: '实现登录页面', files: ['src/login.js'] }).role,
    'developer',
  );
});

test('low-confidence tasks stop instead of guessing', () => {
  const result = inferTaskRole({ id: 'T1', title: '处理一下', files: [] });
  assert.equal(result.role, null);
  assert.ok(result.candidates.length >= 3);
});

test('inferTaskRoles reports unresolved open tasks only', () => {
  const tasks = [
    { id: 'T1', title: '处理一下', files: [] },
    { id: 'T2', title: '实现登录', files: ['src/login.js'], done: false },
    { id: 'T3', title: '处理旧事项', files: [], done: true },
  ];
  const result = inferTaskRoles(tasks);
  assert.deepEqual(result.unresolved.map((item) => item.task.id), ['T1']);
});
