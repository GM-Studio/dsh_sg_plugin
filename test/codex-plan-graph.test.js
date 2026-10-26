import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleLayers,
  canDispatch,
  validateSubtask,
  traceTasks,
} from '../src/codex/core/plan/graph.js';

const task = (id, deps = []) => ({
  id,
  deps,
  acIds: ['AC-1'],
  allowedFiles: ['src/**'],
  acceptance: ['a'],
});

test('independent tasks land in the same layer and can run in parallel', () => {
  // AC-23：独立模块能够产生可并行任务。
  const result = scheduleLayers({ tasks: [task('a'), task('b'), task('c')] });
  assert.equal(result.ok, true);
  assert.equal(result.layers.length, 1);
  assert.deepEqual(result.layers[0], ['a', 'b', 'c']);
  assert.equal(result.maxWidth, 3);
});

test('a dependent task waits for its prerequisite', () => {
  const result = scheduleLayers({ tasks: [task('a'), task('b', ['a'])] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.layers, [['a'], ['b']]);
  assert.equal(result.depth, 2);
});

test('a cycle is rejected instead of partially scheduled', () => {
  // AC-24：循环依赖不被派发。
  const result = scheduleLayers({ tasks: [task('a', ['b']), task('b', ['a'])] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_GRAPH_CYCLE');
  assert.deepEqual(result.remaining.sort(), ['a', 'b']);
});

test('a dangling dependency is reported explicitly', () => {
  const result = scheduleLayers({ tasks: [task('a', ['ghost'])] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_GRAPH_DANGLING');
  assert.deepEqual(result.dangling, [{ task: 'a', dependency: 'ghost' }]);
});

test('duplicate task ids are refused', () => {
  const result = scheduleLayers({ tasks: [task('a'), task('a')] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_GRAPH_INVALID');
});

test('a task missing an AC mapping is not dispatchable', () => {
  // AC-24：缺少必要输入的任务不被派发。
  const missingAc = { ...task('a'), acIds: [] };
  const result = canDispatch({ task: missingAc });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('missing-ac-mapping'));
});

test('a task missing its file boundary is not dispatchable', () => {
  const missingFiles = { ...task('a'), allowedFiles: [] };
  const result = canDispatch({ task: missingFiles });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('missing-file-boundary'));
});

test('a task with pending dependencies is not dispatchable', () => {
  const result = canDispatch({ task: task('b', ['a']), completed: [] });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('dependencies-pending'));
  assert.deepEqual(result.pending, ['a']);
  // 前置完成后即可派发。
  assert.equal(canDispatch({ task: task('b', ['a']), completed: ['a'] }).ok, true);
});

test('a well-formed task with met dependencies is dispatchable', () => {
  assert.equal(canDispatch({ task: task('a') }).ok, true);
});

test('a subtask may not widen the parent file scope', () => {
  // AC-25：自动细分不能扩大父任务权限。
  const parent = { id: 'p', allowedFiles: ['src/a/**'], acIds: ['AC-1'], acceptance: ['x'] };
  const child = {
    id: 'c',
    allowedFiles: ['src/a/**', 'src/b/**'],
    acIds: ['AC-1'],
    acceptance: ['x'],
  };
  const result = validateSubtask({ parent, child });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SUBTASK_OUT_OF_BOUNDS');
  assert.deepEqual(result.problems[0].files, ['src/b/**']);
});

test('a subtask may not widen the AC set', () => {
  const parent = { id: 'p', allowedFiles: ['src/a/**'], acIds: ['AC-1'], acceptance: ['x'] };
  const child = {
    id: 'c',
    allowedFiles: ['src/a/**'],
    acIds: ['AC-1', 'AC-2'],
    acceptance: ['x', 'y'],
  };
  const result = validateSubtask({ parent, child });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((entry) => entry.code === 'AC_SCOPE_WIDENED'));
});

test('a subtask may not relax acceptance', () => {
  const parent = { id: 'p', allowedFiles: ['src/a/**'], acIds: ['AC-1'], acceptance: ['x', 'y'] };
  const child = { id: 'c', allowedFiles: ['src/a/**'], acIds: ['AC-1'], acceptance: ['x'] };
  const result = validateSubtask({ parent, child });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((entry) => entry.code === 'ACCEPTANCE_RELAXED'));
});

test('a narrower subtask within bounds is allowed', () => {
  const parent = {
    id: 'p',
    allowedFiles: ['src/a/**', 'src/b/**'],
    acIds: ['AC-1'],
    acceptance: ['x'],
  };
  const child = { id: 'c', allowedFiles: ['src/a/**'], acIds: ['AC-1'], acceptance: ['x'] };
  assert.equal(validateSubtask({ parent, child }).ok, true);
});

test('every task traces back to an approved AC and plan version', () => {
  const result = traceTasks({
    tasks: [task('a'), task('b', ['a'])],
    approvedAcs: ['AC-1'],
    planVersion: 'plan-v1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.traces.length, 2);
  assert.deepEqual(result.traces[0], { task: 'a', acs: ['AC-1'], planVersion: 'plan-v1' });
});

test('a task pointing at an unapproved AC is untraceable', () => {
  const result = traceTasks({
    tasks: [{ ...task('a'), acIds: ['AC-9'] }],
    approvedAcs: ['AC-1'],
    planVersion: 'plan-v1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TRACE_INCOMPLETE');
  assert.equal(result.untraceable[0].reason, 'ac-not-approved');
});

test('a missing plan version breaks traceability rather than being ignored', () => {
  const result = traceTasks({ tasks: [task('a')], approvedAcs: ['AC-1'], planVersion: null });
  assert.equal(result.ok, false);
  assert.equal(result.untraceable[0].reason, 'no-plan-version');
});

test('invalid input is refused', () => {
  assert.equal(scheduleLayers({ tasks: 'x' }).code, 'PLAN_GRAPH_INVALID');
  assert.equal(canDispatch({ task: null }).code, 'TASK_NOT_DISPATCHABLE');
  assert.equal(validateSubtask({ parent: null }).code, 'SUBTASK_INVALID');
  assert.equal(traceTasks({ tasks: 'x' }).code, 'TRACE_INVALID');
});
