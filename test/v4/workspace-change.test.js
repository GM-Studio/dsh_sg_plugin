import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorkspaceLayout, resolveSelection } from '../../src/v4/workspace.js';
import { buildWorkspace } from '../../src/v4/build.js';
import { startWorkspaceChange, wireSubmodules } from '../../src/v4/workspace-change.js';
import { load } from '../../src/v3/state.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v4-ch-'));
}

function quality() {
  return async () => ({ ok: true, stages: [] });
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('v4 Phase 4b：接入 submodule 并创建 workspace change', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ preset: 'node-fullstack' });
  createWorkspaceLayout({ root, selection });
  const built = await buildWorkspace({ root, selection, qualityRunner: quality() });
  assert.equal(built.ok, true);

  const wired = wireSubmodules({ root, sides: selection.sides });
  assert.equal(wired.ok, true);
  assert.ok(fs.existsSync(path.join(root, '.gitmodules')));
  assert.match(fs.readFileSync(path.join(root, '.gitmodules'), 'utf8'), /path = api/);
  assert.match(git(root, ['log', '--oneline']), /接入 api\/web 子模块/);

  const change = startWorkspaceChange({ root, name: 'add-login', type: 'feature' });
  assert.equal(change.ok, true, change.message);
  assert.deepEqual(change.sides.sort(), ['api', 'web']);
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'changes', 'add-login.json')));
  for (const side of ['api', 'web']) {
    assert.ok(
      fs.existsSync(path.join(root, side, 'openspec', 'changes', 'add-login', 'proposal.md')),
      side,
    );
    assert.equal(load(path.join(root, side)).state.phase, 'H1_PENDING', side);
  }
  const rootState = JSON.parse(fs.readFileSync(path.join(root, '.specgate', 'state.json'), 'utf8'));
  assert.equal(rootState.change, 'add-login');
});

test('v4 Phase 4b：submodule 接入幂等', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ backend: 'node', frontend: 'none' });
  createWorkspaceLayout({ root, selection });
  await buildWorkspace({ root, selection, qualityRunner: quality() });
  assert.equal(wireSubmodules({ root, sides: selection.sides }).ok, true);
  const again = wireSubmodules({ root, sides: selection.sides });
  assert.equal(again.skipped, true);
});
