import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject, createChange } from '../../src/v3/change.js';
import { appendRun } from '../../src/v3/runs.js';
import {
  resolveRepoPath,
  loadProjectAt,
  renderStatusAt,
  statusJsonAt,
} from '../../src/v3/status-query.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v34-status-'));
}

test('resolveRepoPath 接受绝对、相对与正斜杠路径', () => {
  const root = tempRoot();
  initProject(root);
  createChange(root, { name: 'status-demo', type: 'feature' });

  assert.equal(resolveRepoPath(process.cwd(), root).ok, true);
  const relative = path.relative(process.cwd(), root);
  assert.equal(resolveRepoPath(process.cwd(), relative).ok, true);
  assert.equal(resolveRepoPath(process.cwd(), root.replace(/\\/g, '/')).ok, true);

  const missing = resolveRepoPath(process.cwd(), path.join(root, 'nope'));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'PATH_NOT_FOUND');
});

test('status --verbose 显示 runs 时间线，--json 带 runs', () => {
  const root = tempRoot();
  initProject(root);
  createChange(root, { name: 'status-demo', type: 'feature' });
  appendRun(root, {
    change: 'status-demo',
    task: 'T-001',
    role: 'implementer',
    commit: 'abcdef123456',
    durationMs: 1200,
    result: 'pass',
  });

  const loaded = loadProjectAt(root);
  assert.equal(loaded.ok, true);
  assert.match(renderStatusAt(loaded.project), /status-demo/);
  assert.match(renderStatusAt(loaded.project, { verbose: true }), /运行时间线/);
  assert.match(renderStatusAt(loaded.project, { verbose: true }), /implementer/);

  const data = statusJsonAt(loaded.project, { verbose: true });
  assert.equal(data.change, 'status-demo');
  assert.equal(data.runs.length, 1);
  assert.equal(data.runs[0].role, 'implementer');
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'runs', 'status-demo.jsonl')));
});
