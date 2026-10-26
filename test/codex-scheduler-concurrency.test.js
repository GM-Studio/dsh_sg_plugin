import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CONCURRENT_AGENTS,
  MAX_AGENT_RUNTIME_MS,
  availableSlots,
  detectConflicts,
  selectBatch,
  explainDecision,
} from '../src/codex/core/scheduler.js';

test('the D08 defaults are four agents and thirty minutes', () => {
  assert.equal(MAX_CONCURRENT_AGENTS, 4);
  assert.equal(MAX_AGENT_RUNTIME_MS, 30 * 60 * 1000);
});

test('an unprobed host is treated as one slot, never as four', () => {
  // AC-26：不伪造并发会话。
  const result = availableSlots({ hostCapacity: null });
  assert.equal(result.slots, 1);
  assert.equal(result.probed, false);
  assert.equal(result.reason, 'host-capacity-unprobed');
});

test('a host with fewer than four slots lowers concurrency', () => {
  const result = availableSlots({ hostCapacity: 2 });
  assert.equal(result.slots, 2);
  assert.equal(result.reason, 'host-capacity-limited');
});

test('host capacity above the limit is capped at four', () => {
  assert.equal(availableSlots({ hostCapacity: 16 }).slots, 4);
  assert.equal(availableSlots({ hostCapacity: 4 }).slots, 4);
});

test('a lower approved budget wins over the default', () => {
  assert.equal(availableSlots({ hostCapacity: 8, budget: 2 }).slots, 2);
});

test('two tasks writing the same files conflict', () => {
  // AC-27：文件权限冲突必须被识别。
  const result = detectConflicts({
    tasks: [
      { id: 'a', allowedFiles: ['src/orders/**'] },
      { id: 'b', allowedFiles: ['src/orders/service.js'] },
    ],
  });
  assert.equal(result.hasConflicts, true);
  assert.equal(result.conflicts[0].type, 'file-overlap');
  assert.deepEqual(result.conflicts[0].tasks, ['a', 'b']);
});

test('tasks on disjoint files do not conflict', () => {
  const result = detectConflicts({
    tasks: [
      { id: 'a', allowedFiles: ['src/orders/**'] },
      { id: 'b', allowedFiles: ['src/users/**'] },
    ],
  });
  assert.equal(result.hasConflicts, false);
});

test('a shared resource forces serialisation', () => {
  const result = detectConflicts({
    tasks: [
      { id: 'a', allowedFiles: ['src/a/**'], sharedResources: ['test-db'] },
      { id: 'b', allowedFiles: ['src/b/**'], sharedResources: ['test-db'] },
    ],
  });
  assert.equal(result.hasConflicts, true);
  assert.equal(result.conflicts[0].type, 'shared-resource');
});

test('an unstable shared interface makes the consumer wait', () => {
  const result = detectConflicts({
    tasks: [
      { id: 'contract', allowedFiles: ['src/c/**'], providesInterface: 'OrderApi', stable: false },
      { id: 'consumer', allowedFiles: ['src/d/**'], consumesInterfaces: ['OrderApi'] },
    ],
  });
  assert.equal(result.hasConflicts, true);
  assert.equal(result.conflicts[0].type, 'unstable-interface');
  assert.deepEqual(result.conflicts[0].tasks, ['contract', 'consumer']);
});

test('a stable interface does not block its consumer', () => {
  const result = detectConflicts({
    tasks: [
      { id: 'contract', allowedFiles: ['src/c/**'], providesInterface: 'OrderApi', stable: true },
      { id: 'consumer', allowedFiles: ['src/d/**'], consumesInterfaces: ['OrderApi'] },
    ],
  });
  assert.equal(result.hasConflicts, false);
});

test('a batch never exceeds the available slots', () => {
  const tasks = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
    id,
    deps: [],
    allowedFiles: ['src/' + id + '/**'],
  }));
  const result = selectBatch({ layers: [['a', 'b', 'c', 'd', 'e']], tasks, slots: 2 });
  assert.equal(result.selected.length, 2);
  assert.equal(result.actualConcurrency, 2);
  assert.ok(result.deferred.length >= 3);
});

test('conflicting tasks are deferred rather than run together', () => {
  const tasks = [
    { id: 'a', deps: [], allowedFiles: ['src/same/**'] },
    { id: 'b', deps: [], allowedFiles: ['src/same/file.js'] },
  ];
  const result = selectBatch({ layers: [['a', 'b']], tasks, slots: 4 });
  assert.equal(result.selected.length, 1, '冲突任务必须串行');
  assert.equal(result.deferred[0].reason, 'conflict');
});

test('tasks with unmet dependencies are not selected', () => {
  const tasks = [
    { id: 'a', deps: [], allowedFiles: ['src/a/**'] },
    { id: 'b', deps: ['a'], allowedFiles: ['src/b/**'] },
  ];
  const result = selectBatch({ layers: [['a'], ['b']], tasks, completed: [], slots: 4 });
  assert.deepEqual(result.selected, ['a']);
  // a 完成后 b 可被选中。
  const next = selectBatch({ layers: [['a'], ['b']], tasks, completed: ['a'], slots: 4 });
  assert.deepEqual(next.selected, ['b']);
});

test('already completed tasks are not selected again', () => {
  const tasks = [{ id: 'a', deps: [], allowedFiles: ['src/a/**'] }];
  const result = selectBatch({ layers: [['a']], tasks, completed: ['a'], slots: 4 });
  assert.deepEqual(result.selected, []);
});

test('concurrency does not scale with the number of tasks', () => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    id: 't' + index,
    deps: [],
    allowedFiles: ['src/t' + index + '/**'],
  }));
  const result = selectBatch({
    layers: [many.map((task) => task.id)],
    tasks: many,
    slots: availableSlots({ hostCapacity: 99 }).slots,
  });
  assert.equal(result.actualConcurrency, 4, '12 个独立任务也不得超过 4 并发');
});

test('the decision rationale is auditable', () => {
  const decision = explainDecision({ layer: ['a', 'b'], slots: 2, conflicts: [], hostCapacity: 8 });
  assert.equal(decision.slots, 2);
  assert.equal(decision.conflictCount, 0);
  assert.ok(decision.rationale.some((line) => line.includes('不随任务数等比例放大')));
});

test('invalid input is refused', () => {
  assert.equal(detectConflicts({ tasks: 'x' }).code, 'SCHEDULER_INPUT_INVALID');
  assert.equal(selectBatch({ layers: 'x' }).code, 'SCHEDULER_INPUT_INVALID');
});
