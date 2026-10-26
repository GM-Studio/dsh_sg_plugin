import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recordIntegration,
  bindFinalVerification,
  checkIsolation,
  recordConflict,
} from '../src/codex/core/integration-binding.js';

const C1 = 'a'.repeat(40);
const C2 = 'b'.repeat(40);

const binding = (overrides = {}) => ({
  taskId: 'task-a',
  inputVersion: 'plan-v1',
  agentSession: 'session-1',
  commit: C1,
  branch: 'sg/task-a',
  isolatedWorktree: '/wt/task-a',
  ...overrides,
});

test('an integration binding records all four required elements', () => {
  // AC-29：任务、输入版本、agent 会话、提交。
  const result = recordIntegration(binding());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.binding, binding());
});

test('a binding missing any required element is refused', () => {
  for (const field of ['taskId', 'inputVersion', 'agentSession', 'commit']) {
    const incomplete = binding();
    delete incomplete[field];
    const result = recordIntegration(incomplete);
    assert.equal(result.ok, false, field);
    assert.equal(result.code, 'INTEGRATION_BINDING_INVALID');
  }
});

test('an invalid commit hash is refused', () => {
  for (const commit of ['', 'abc', 'z'.repeat(40), null]) {
    assert.equal(recordIntegration(binding({ commit })).ok, false, String(commit));
  }
});

test('final verification binds to exactly one commit', () => {
  const result = bindFinalVerification({
    commit: C1,
    bindings: [
      binding(),
      binding({ taskId: 'task-b', agentSession: 'session-2', isolatedWorktree: '/wt/task-b' }),
    ],
    evidence: [{ commit: C1, path: 'reports/verify.json' }],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.commit, C1);
  assert.deepEqual(result.tasks.sort(), ['task-a', 'task-b']);
  assert.deepEqual(result.agentSessions.sort(), ['session-1', 'session-2']);
  assert.equal(result.reusableForOtherCommits, false);
});

test('mixing tasks from different commits is refused', () => {
  // AC-29 的核心：不得拼接不同提交的通过结果。
  const result = bindFinalVerification({
    commit: C1,
    bindings: [binding(), binding({ taskId: 'task-b', commit: C2 })],
    evidence: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTEGRATION_COMMIT_MISMATCH');
  assert.deepEqual(result.mismatchedCommits, [C2]);
});

test('evidence from another commit is refused', () => {
  const result = bindFinalVerification({
    commit: C1,
    bindings: [binding()],
    evidence: [{ commit: C1 }, { commit: C2 }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTEGRATION_EVIDENCE_MISMATCH');
  assert.deepEqual(result.foreignCommits, [C2]);
});

test('final verification requires at least one binding and a valid commit', () => {
  assert.equal(
    bindFinalVerification({ commit: C1, bindings: [] }).code,
    'INTEGRATION_BINDING_INVALID',
  );
  assert.equal(
    bindFinalVerification({ commit: 'nope', bindings: [binding()] }).code,
    'INTEGRATION_BINDING_INVALID',
  );
});

test('concurrent tasks must each have their own worktree', () => {
  const shared = checkIsolation({
    bindings: [binding({ taskId: 'a' }), binding({ taskId: 'b', isolatedWorktree: '/wt/task-a' })],
  });
  assert.equal(shared.ok, false);
  assert.equal(shared.code, 'WORKTREE_NOT_ISOLATED');
});

test('a binding without a worktree is reported as missing', () => {
  const missing = checkIsolation({ bindings: [binding({ isolatedWorktree: null })] });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'WORKTREE_MISSING');
  assert.deepEqual(missing.missing, ['task-a']);
});

test('properly isolated bindings pass', () => {
  const result = checkIsolation({
    bindings: [
      binding({ taskId: 'a', isolatedWorktree: '/wt/a' }),
      binding({ taskId: 'b', isolatedWorktree: '/wt/b' }),
    ],
  });
  assert.equal(result.ok, true);
});

test('a conflict returns to its owning task and requires rework', () => {
  const result = recordConflict({ taskId: 'task-a', paths: ['src/a.js', 'src/b.js'] });
  assert.equal(result.ok, true);
  assert.equal(result.conflict.taskId, 'task-a');
  assert.equal(result.conflict.requiresRework, true, '未解决冲突必须回到任务');
  assert.deepEqual(result.conflict.paths, ['src/a.js', 'src/b.js']);
  // 显式解决后不再要求返工。
  const resolved = recordConflict({
    taskId: 'task-a',
    paths: ['src/a.js'],
    resolution: '手工合并并复跑',
  });
  assert.equal(resolved.conflict.requiresRework, false);
});

test('a conflict without an owning task is refused', () => {
  assert.equal(recordConflict({ paths: ['x'] }).code, 'INTEGRATION_BINDING_INVALID');
});

test('invalid input is refused', () => {
  assert.equal(bindFinalVerification({}).code, 'INTEGRATION_BINDING_INVALID');
  assert.equal(checkIsolation({ bindings: 'x' }).code, 'INTEGRATION_BINDING_INVALID');
});
