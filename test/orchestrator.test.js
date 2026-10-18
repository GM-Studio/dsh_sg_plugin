import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initProject } from '../src/init.js';
import { createRequirementChange } from '../src/requirements.js';
import { applyChange } from '../src/orchestrator.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-orchestrator-'));
  initProject(root, { requirements: true, git: false });
  createRequirementChange(root, 'add-login');
  return root;
}

function writeTasks(root, text) {
  fs.writeFileSync(
    path.join(root, 'requirements', 'changes', 'add-login', 'tasks.md'),
    text,
  );
}

test('sg-apply plan stops on unresolved development roles', async () => {
  const root = makeProject();
  writeTasks(root, '- [ ] T1 处理一下\n');
  const plan = await applyChange({
    root,
    change: 'add-login',
    planOnly: true,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.planOnly, true);
  assert.deepEqual(plan.unresolved, ['T1']);
  assert.match(plan.text, /role: architect\|ddd\|developer/);
});

test('sg-apply plan reports inferred development roles', async () => {
  const root = makeProject();
  writeTasks(root, '- [ ] T1 实现登录页面 files: src/login.js\n');
  const plan = await applyChange({
    root,
    change: 'add-login',
    planOnly: true,
  });
  assert.equal(plan.unresolved.length, 0);
  assert.equal(plan.roles[0].role, 'developer');
  assert.equal(plan.stage, 'dev');
});
