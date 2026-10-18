import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { classifyRequest } from '../src/classify.js';
import { computeStatus, clearStatusCache } from '../src/status.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.mkdirSync(path.join(root, 'openspec', 'changes'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'config.yaml'),
    'version: 1\nenabled: true\nenforcement: hybrid\nparadigm: null\nlanguage: "zh-CN"\n',
  );
  return root;
}

test('classifyRequest maps bug reports to L3 and product requests to L1', () => {
  assert.equal(classifyRequest('修复登录报错').paradigm, 'L3');
  assert.equal(classifyRequest('新增用户故事和验收标准').paradigm, 'L1');
  assert.equal(classifyRequest('重构支付模块架构').paradigm, 'L2');
  assert.equal(classifyRequest('随便改点东西').paradigm, 'L2');
});

test('proposal with Intent and Scope moves a change to specing', () => {
  const root = makeProject();
  const change = path.join(root, 'openspec', 'changes', 'add-login');
  fs.mkdirSync(change, { recursive: true });
  fs.writeFileSync(
    path.join(change, 'proposal.md'),
    '# add-login\n\n## Intent\n\nAdd login.\n\n## Scope\n\n- Login form.\n',
  );

  clearStatusCache();
  const status = computeStatus(root, { fresh: true });
  assert.equal(status.changes.length, 1);
  assert.equal(status.changes[0].artifacts.proposal, 'completed');
  assert.equal(status.changes[0].state, 'specing');
  assert.equal(status.projectState, 'planning');
});

test('tasks with all checkboxes mark a change as implementing', () => {
  const root = makeProject();
  const change = path.join(root, 'openspec', 'changes', 'fix-login');
  fs.mkdirSync(change, { recursive: true });
  fs.writeFileSync(path.join(change, 'proposal.md'), '## Intent\nx\n## Scope\ny\n');
  fs.writeFileSync(
    path.join(change, 'design.md'),
    '## Architecture\nx\n## Technical Approach\ny\n',
  );
  fs.mkdirSync(path.join(change, 'specs', 'login'), { recursive: true });
  fs.writeFileSync(
    path.join(change, 'specs', 'login', 'spec.md'),
    '## Requirements\n\nScenario: login\n',
  );
  fs.writeFileSync(path.join(change, 'tasks.md'), '- [x] one\n- [x] two\n');

  clearStatusCache();
  const status = computeStatus(root, { fresh: true });
  assert.equal(status.changes[0].tasks.total, 2);
  assert.equal(status.changes[0].tasks.done, 2);
  assert.equal(status.changes[0].state, 'implementing');
  assert.equal(status.projectState, 'developing');
});

test('status is disabled when config says enabled: false', () => {
  const root = makeProject();
  fs.writeFileSync(
    path.join(root, '.specgate', 'config.yaml'),
    'version: 1\nenabled: false\nenforcement: hybrid\nparadigm: null\n',
  );
  clearStatusCache();
  const status = computeStatus(root, { fresh: true });
  assert.equal(status.enabled, false);
});
