import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceLayout, resolveSelection } from '../../src/v4/workspace.js';
import { renderWorkspaceStatus, workspaceStatusData } from '../../src/v4/status.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v4-status-'));
}

test('v4.4 状态：workspace 根可直接读 phase/sides/nextAction', () => {
  const root = tempRoot();
  createWorkspaceLayout({
    root,
    selection: resolveSelection({ backend: 'java', frontend: 'none' }),
    profile: 'minimal',
  });
  const data = workspaceStatusData(root);
  assert.equal(data.initialized, true);
  assert.equal(data.kind, 'v4');
  assert.equal(data.profile, 'minimal');
  assert.equal(data.phase, 'IDLE');
  assert.equal(data.change, null);
  assert.equal(data.sides.length, 1);
  assert.equal(data.sides[0].path, 'api');
  assert.equal(data.sides[0].phase, 'IDLE');
  assert.match(data.nextAction, /sg_change/);

  const text = renderWorkspaceStatus(data);
  assert.match(text, /SpecGate v4 workspace/);
  assert.match(text, /模式：minimal/);
  assert.match(text, /api（java）：IDLE/);
});

test('v4.4 状态：非 workspace 返回未初始化而不是抛错', () => {
  const root = tempRoot();
  const data = workspaceStatusData(root);
  assert.equal(data.initialized, false);
  assert.equal(data.code, 'NOT_WORKSPACE');
});
