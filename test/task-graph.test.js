import assert from 'node:assert/strict';
import test from 'node:test';

import { buildWaves, parseTasks } from '../src/task-graph.js';

test('parseTasks reads checkbox, [P], depends, role and completion', () => {
  const tasks = parseTasks(`
- [ ] T1 实现登录接口 [P]
- [ ] T2 实现登录页面 [P] depends: T1
- [x] T3 已完成任务
- [ ] 无编号任务 role: reviewer
`);

  assert.equal(tasks.length, 4);
  assert.equal(tasks[0].id, 'T1');
  assert.equal(tasks[0].parallel, true);
  assert.equal(tasks[0].done, false);
  assert.equal(tasks[1].depends[0], 'T1');
  assert.equal(tasks[2].done, true);
  assert.equal(tasks[3].id, 'task-4');
  assert.equal(tasks[3].role, 'reviewer');
});

test('buildWaves is strictly serial without a [P] marker', () => {
  const tasks = parseTasks(`
- [ ] T1 first
- [ ] T2 second
- [ ] T3 third
`);
  const waves = buildWaves(tasks, 4);
  assert.deepEqual(waves.map((wave) => wave.map((task) => task.id)), [['T1'], ['T2'], ['T3']]);
});

test('buildWaves respects dependencies and parallel markers', () => {
  const tasks = parseTasks(`
- [ ] T1 a [P]
- [ ] T2 b [P]
- [ ] T3 c depends: T1,T2
- [ ] T4 d [P]
`);
  const waves = buildWaves(tasks, 4);
  assert.deepEqual(waves.map((wave) => wave.map((task) => task.id)), [
    ['T1', 'T2', 'T4'],
    ['T3'],
  ]);
});

test('buildWaves caps a parallel wave at maxConcurrency', () => {
  const tasks = parseTasks(`
- [ ] T1 a [P]
- [ ] T2 b [P]
- [ ] T3 c [P]
- [ ] T4 d [P]
- [ ] T5 e [P]
`);
  const waves = buildWaves(tasks, 2);
  assert.equal(waves.length, 3);
  assert.equal(waves[0].length, 2);
  assert.equal(waves[1].length, 2);
  assert.equal(waves[2].length, 1);
});

test('buildWaves fails loudly on an unsatisfied dependency', () => {
  const tasks = parseTasks(`
- [ ] T1 a depends: T2
- [ ] T2 b depends: T1
`);
  assert.throws(() => buildWaves(tasks, 4), /依赖无法满足/);
});
