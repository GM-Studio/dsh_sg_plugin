import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureIntegration, headOf } from '../../src/v3/worktrees.js';
import { revertWave } from '../../src/v3/executor.js';
import { verifyEvidence } from '../../src/v3/evidence.js';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function initRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-revert-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'export const a = 1;\n', 'utf8');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

test('S7：revertWave 回退 integration 并标记任务', () => {
  const root = initRepo();
  const base = git(root, ['rev-parse', 'HEAD']);
  const integration = ensureIntegration(root, 'c', base);

  fs.writeFileSync(path.join(integration.path, 'src', 'b.js'), 'export const b = 2;\n', 'utf8');
  git(integration.path, ['add', '-A']);
  git(integration.path, ['commit', '-q', '-m', 'task commit']);
  assert.notEqual(headOf(integration.path, 'HEAD'), base);

  const state = {
    change: 'c',
    integration: { base },
    tasks: {
      'T-001': { status: 'merged' },
      'T-002': { status: 'pending' },
    },
  };
  const result = revertWave({ root, state, waveStart: base });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.reverted, ['T-001']);
  assert.equal(headOf(integration.path, 'HEAD'), base);
  assert.equal(fs.existsSync(path.join(integration.path, 'src', 'b.js')), false);
  assert.equal(verifyEvidence(root, 'c').ok, true);
});
