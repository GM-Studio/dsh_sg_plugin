import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initProject } from '../src/init.js';
import { createRequirementChange, testPaths } from '../src/requirements.js';
import { writeProjectConfig } from '../src/project.js';
import { confirmGate } from '../src/gates.js';
import { applyChange } from '../src/orchestrator.js';
import { formatReportPath, reviewReportPath } from '../src/format.js';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function commit(root, message) {
  git(root, ['add', '-A']);
  const status = git(root, ['status', '--porcelain']);
  if (status.trim()) git(root, ['commit', '-m', message]);
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-stages-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'SpecGate Test']);
  git(root, ['config', 'user.email', 'specgate-test@example.com']);
  initProject(root, { requirements: true });
  createRequirementChange(root, 'add-login');
  writeProjectConfig(root, {
    formatCommand: 'node -e "" {files}',
    lintCommand: 'node -e "" {files}',
  });
  fs.writeFileSync(
    path.join(root, 'requirements', 'changes', 'add-login', 'tasks.md'),
    '- [x] T1 实现登录 files: src/login.js\n',
  );
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'login.js'), 'export const login = 1;\n');
  commit(root, 'test: setup');
  for (const gate of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']) confirmGate(root, gate);
  commit(root, 'test: gates');
  return root;
}

function runnerFor(change) {
  return async ({ cwd, role }) => {
    if (role === 'formatter') {
      fs.writeFileSync(formatReportPath(cwd, change), 'verdict: pass\nlint: pass\n');
    }
    if (role === 'tester') {
      fs.writeFileSync(
        testPaths(cwd, change).report,
        'verdict: pass\nP0: 100\nP1: 100\nP2: 100\nline: 90\nbranch: 80\n',
      );
    }
    if (role === 'reviewer') {
      fs.writeFileSync(reviewReportPath(cwd, change), 'verdict: pass\nblocking: []\nnon_blocking: []\n');
    }
    return { ok: true, text: role };
  };
}

test('sg-apply advances exactly one quality stage per call', async () => {
  const root = makeProject();
  const runner = runnerFor('add-login');
  const base = { root, change: 'add-login', parent: null, runner };

  const format = await applyChange(base);
  assert.equal(format.stage, 'format');
  assert.equal(format.ok, true);
  assert.equal(format.nextGate, 'G7.5');

  confirmGate(root, 'G7.5');
  commit(root, 'test: G7.5');
  const testStage = await applyChange(base);
  assert.equal(testStage.stage, 'test');
  assert.equal(testStage.nextGate, 'G8');

  confirmGate(root, 'G8');
  commit(root, 'test: G8');
  const review = await applyChange(base);
  assert.equal(review.stage, 'review');
  assert.equal(review.nextGate, 'G9');

  confirmGate(root, 'G9');
  commit(root, 'test: G9');
  const done = await applyChange(base);
  assert.equal(done.stage, 'done');
});
