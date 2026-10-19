import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureIntegration, ensureTask, mergeIntoIntegration } from '../../src/v3/worktrees.js';
import { discoverCommand } from '../../src/v3/plan.js';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-inject-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 0;\n', 'utf8');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

function edit(worktree, value, message) {
  fs.writeFileSync(path.join(worktree, 'src', 'a.js'), `export const a = ${value};\n`, 'utf8');
  git(worktree, ['add', '-A']);
  git(worktree, ['commit', '-q', '-m', message]);
  return git(worktree, ['rev-parse', 'HEAD']);
}

test('注入：找不到 test:json 时报告 TEST_COMMAND_MISSING', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-nojson-'));
  const result = discoverCommand(root, null);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TEST_COMMAND_MISSING');
});

test('注入：两个任务改同一文件时第二次合并冲突且不回滚第一次', () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  const integration = ensureIntegration(root, 'c', base);
  const first = ensureTask(root, 'c', 'T-001', base);
  const second = ensureTask(root, 'c', 'T-002', base);

  const commitA = edit(first.path, 1, 'task 1');
  const commitB = edit(second.path, 2, 'task 2');

  const mergedA = mergeIntoIntegration({
    integrationPath: integration.path,
    branch: first.branch,
    expectedCommit: commitA,
    message: 'merge 1',
  });
  assert.equal(mergedA.ok, true, mergedA.message);

  const mergedB = mergeIntoIntegration({
    integrationPath: integration.path,
    branch: second.branch,
    expectedCommit: commitB,
    message: 'merge 2',
  });
  assert.equal(mergedB.ok, false);
  assert.equal(mergedB.code, 'MERGE_CONFLICT');

  const content = fs.readFileSync(path.join(integration.path, 'src', 'a.js'), 'utf8');
  assert.match(content, /a = 1/);
});
