import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ensureIntegration,
  ensureTask,
  diffCheck,
  mergeIntoIntegration,
  headOf,
} from '../../src/v3/worktrees.js';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-wt-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n', 'utf8');
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'c1'), { recursive: true });
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

function writeAndCommit(worktree, relative, content) {
  const file = path.join(worktree, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  git(worktree, ['add', '-A']);
  git(worktree, ['commit', '-q', '-m', `add ${relative}`]);
  return git(worktree, ['rev-parse', 'HEAD']);
}

test('创建 integration 与 task worktree', () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  const integration = ensureIntegration(root, 'c1', base);
  assert.equal(integration.ok, true);
  assert.equal(fs.existsSync(integration.path), true);
  const task = ensureTask(root, 'c1', 'T-001', base);
  assert.equal(task.ok, true);
  assert.equal(fs.existsSync(task.path), true);
  assert.notEqual(task.path, integration.path);
});

test('implementer 可以改源码，不能改测试', () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  const task = ensureTask(root, 'c1', 'T-001', base);
  writeAndCommit(task.path, 'src/b.js', 'export const b = 2;\n');
  const allowed = diffCheck({
    root,
    branch: task.branch,
    baseCommit: base,
    role: 'implementer',
    change: 'c1',
    touched: {},
  });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.violations));

  writeAndCommit(task.path, 'tests/x.test.js', 'test\n');
  const denied = diffCheck({
    root,
    branch: task.branch,
    baseCommit: base,
    role: 'implementer',
    change: 'c1',
    touched: {},
  });
  assert.equal(denied.ok, false);
  assert.ok(denied.violations.some((item) => item.path === 'tests/x.test.js'));
});

test('tester 可以新增 automation，不能改源码', () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  const task = ensureTask(root, 'c1', 'T-001', base);
  writeAndCommit(task.path, 'openspec/changes/c1/tests/automation/a.test.js', 'test\n');
  const allowed = diffCheck({
    root,
    branch: task.branch,
    baseCommit: base,
    role: 'tester',
    change: 'c1',
    touched: { modify: [], delete: [], bootstrap: [] },
  });
  assert.equal(allowed.ok, true, JSON.stringify(allowed.violations));

  writeAndCommit(task.path, 'src/c.js', 'export const c = 3;\n');
  const denied = diffCheck({
    root,
    branch: task.branch,
    baseCommit: base,
    role: 'tester',
    change: 'c1',
    touched: { modify: [], delete: [], bootstrap: [] },
  });
  assert.equal(denied.ok, false);
  assert.ok(denied.violations.some((item) => item.path === 'src/c.js'));
});

test('tester 只能修改 touched 清单内的测试', () => {
  const root = initRepo();
  const automation = path.join(root, 'openspec', 'changes', 'c1', 'tests', 'automation');
  fs.mkdirSync(automation, { recursive: true });
  fs.writeFileSync(path.join(automation, 'keep.test.js'), 'v1\n', 'utf8');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'add existing test']);
  const base = git(root, ['rev-parse', 'HEAD']);
  const task = ensureTask(root, 'c1', 'T-001', base);
  writeAndCommit(task.path, 'openspec/changes/c1/tests/automation/keep.test.js', 'v2\n');
  const withoutList = diffCheck({
    root,
    branch: task.branch,
    baseCommit: base,
    role: 'tester',
    change: 'c1',
    touched: { modify: [], delete: [], bootstrap: [] },
  });
  assert.equal(withoutList.ok, false);

  const withList = diffCheck({
    root,
    branch: task.branch,
    baseCommit: base,
    role: 'tester',
    change: 'c1',
    touched: {
      modify: ['openspec/changes/c1/tests/automation/keep.test.js'],
      delete: [],
      bootstrap: [],
    },
  });
  assert.equal(withList.ok, true, JSON.stringify(withList.violations));
});

test('merge 把任务分支合入 integration', () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  const integration = ensureIntegration(root, 'c1', base);
  const task = ensureTask(root, 'c1', 'T-001', base);
  const commit = writeAndCommit(task.path, 'src/b.js', 'export const b = 2;\n');
  const merged = mergeIntoIntegration({
    integrationPath: integration.path,
    branch: task.branch,
    expectedCommit: commit,
    message: 'merge T-001',
  });
  assert.equal(merged.ok, true, merged.message);
  assert.equal(fs.existsSync(path.join(integration.path, 'src', 'b.js')), true);
  assert.equal(headOf(integration.path, 'HEAD'), merged.commit);
});

test('expectedCommit 不一致时拒绝合并', () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  const integration = ensureIntegration(root, 'c1', base);
  const task = ensureTask(root, 'c1', 'T-001', base);
  writeAndCommit(task.path, 'src/b.js', 'export const b = 2;\n');
  const result = mergeIntoIntegration({
    integrationPath: integration.path,
    branch: task.branch,
    expectedCommit: 'deadbeef',
    message: 'merge',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HEAD_MISMATCH');
});

test('rename 到 tests 被 implementer 拒绝', () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  const task = ensureTask(root, 'c1', 'T-001', base);
  fs.mkdirSync(path.join(task.path, 'tests'), { recursive: true });
  git(task.path, ['mv', 'src/a.js', 'tests/a.js']);
  git(task.path, ['commit', '-q', '-m', 'rename']);
  const result = diffCheck({
    root,
    branch: task.branch,
    baseCommit: base,
    role: 'implementer',
    change: 'c1',
    touched: {},
  });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((item) => item.path === 'tests/a.js'));
});
