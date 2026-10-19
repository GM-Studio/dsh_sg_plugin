import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWaves, readyBatch } from '../../src/v3/scheduler.js';

const tasks = [
  { id: 'T-001', deps: [], parallel: false, status: 'pending', attempts: 0 },
  { id: 'T-002', deps: [], parallel: true, status: 'pending', attempts: 0 },
  { id: 'T-003', deps: [], parallel: true, status: 'pending', attempts: 0 },
  { id: 'T-004', deps: ['T-001'], parallel: false, status: 'pending', attempts: 0 },
];

function stateOf(list) {
  return { tasks: Object.fromEntries(list.map((task) => [task.id, task])) };
}

test('buildWaves 按依赖分层', () => {
  const waves = buildWaves(tasks);
  assert.deepEqual(waves[0], ['T-001', 'T-002', 'T-003']);
  assert.deepEqual(waves[1], ['T-004']);
});

test('readyBatch 优先选择可并行任务', () => {
  const info = readyBatch(stateOf(tasks), 2);
  assert.equal(info.done, false);
  assert.deepEqual(info.batch, ['T-002', 'T-003']);
});

test('没有并行任务时只取一个', () => {
  const serial = tasks.filter((task) => !task.parallel);
  const info = readyBatch(stateOf(serial), 2);
  assert.deepEqual(info.batch, ['T-001']);
});

test('依赖未满足时不进入批次', () => {
  const list = tasks.map((task) =>
    task.id === 'T-001' ? { ...task, status: 'merged' } : { ...task },
  );
  const info = readyBatch(stateOf(list), 2);
  assert.equal(info.waveIndex, 0);
  assert.ok(info.batch.includes('T-002'));
  assert.equal(info.batch.includes('T-004'), false);
});

test('全部合并后 done', () => {
  const list = tasks.map((task) => ({ ...task, status: 'merged' }));
  const info = readyBatch(stateOf(list), 2);
  assert.equal(info.done, true);
});
