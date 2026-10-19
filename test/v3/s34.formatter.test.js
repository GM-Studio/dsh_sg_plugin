import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject, configPath } from '../../src/v3/change.js';
import { runFormatter, formatterCommand } from '../../src/v3/formatter.js';

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v34-fmt-'));
  initProject(root);
  return root;
}

test('未配置 formatter 时跳过并写报告', () => {
  const root = tempRoot();
  assert.deepEqual(formatterCommand(root), []);
  const result = runFormatter({ root, worktree: root, change: 'fmt', task: { id: 'T-001' } });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.ok(fs.existsSync(result.report));
  assert.match(fs.readFileSync(result.report, 'utf8'), /not-configured/);
});

test('formatter 退出码非 0 时阻断', () => {
  const root = tempRoot();
  const config = fs.readFileSync(configPath(root), 'utf8');
  fs.writeFileSync(
    configPath(root),
    `${config}\nformatter:\n  command: ["node", "-e", "process.exit(1)"]\n`,
    'utf8',
  );
  assert.deepEqual(formatterCommand(root), ['node', '-e', 'process.exit(1)']);
  const result = runFormatter({ root, worktree: root, change: 'fmt', task: { id: 'T-001' } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FORMAT_FAILED');
  assert.ok(fs.existsSync(result.report));
});
