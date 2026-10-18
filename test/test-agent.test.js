import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initProject } from '../src/init.js';
import {
  createRequirementChange,
  testPaths,
  validateTestPlan,
  validateTestReport,
} from '../src/requirements.js';
import { runTestAgent } from '../src/dispatch.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-tester-'));
  execFileSync('git', ['init'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'SpecGate Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'specgate-test@example.com'], { cwd: root });
  initProject(root, { requirements: true });
  createRequirementChange(root, 'add-login');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test: add change'], { cwd: root });
  return root;
}

function writePlan(cwd) {
  const change = path.join(cwd, 'requirements', 'changes', 'add-login');
  fs.writeFileSync(
    path.join(change, 'tests', 'cases.md'),
    '# Test Plan\n\n### TC-001\n\n- Requirement: FR-001\n- Priority: P0\n',
  );
  fs.writeFileSync(
    path.join(change, 'tests', 'matrix.md'),
    '| Requirement | Case |\n|---|---|\n| FR-001 | TC-001 |\n',
  );
  fs.mkdirSync(path.join(cwd, 'tests', 'specgate', 'add-login'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'tests', 'specgate', 'add-login', 'tc-001.test.js'), '// test\n');
}

test('tester plan runs in an independent worktree and merges test artifacts', async () => {
  const root = makeProject();
  let cwdSeen;
  const result = await runTestAgent({
    root,
    change: 'add-login',
    parent: null,
    action: 'plan',
    language: 'zh',
    runner: async ({ cwd }) => {
      cwdSeen = cwd;
      writePlan(cwd);
      return { ok: true, text: 'plan ready' };
    },
  });

  assert.equal(result.ok, true);
  assert.notEqual(cwdSeen, root);
  assert.match(cwdSeen, /worktrees/);
  assert.equal(validateTestPlan(root, 'add-login').ok, true);
  assert.equal(fs.existsSync(path.join(root, 'tests', 'specgate', 'add-login')), true);
});

test('tester run copies the report back and validates coverage', async () => {
  const root = makeProject();
  writePlan(root);
  const paths = testPaths(root, 'add-login');

  const result = await runTestAgent({
    root,
    change: 'add-login',
    parent: null,
    action: 'run',
    language: 'zh',
    runner: async ({ cwd }) => {
      fs.writeFileSync(
        path.join(cwd, 'requirements', 'changes', 'add-login', 'test-report.md'),
        'verdict: pass\nline: 85\nbranch: 75\n',
      );
      return { ok: true, text: 'tests passed' };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(paths.report), true);
  assert.equal(validateTestReport(root, 'add-login').ok, true);
});
