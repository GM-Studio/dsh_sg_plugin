import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createWorkspaceLayout,
  readWorkspace,
  resolveSelection,
  scanWorkspace,
  workspaceSummary,
} from '../../src/v4/workspace.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v4-ws-'));
}

test('v4：预设与校验', () => {
  assert.deepEqual(resolveSelection({ preset: 'node-fullstack' }), {
    ok: true,
    backend: 'node',
    frontend: 'react',
    preset: 'node-fullstack',
    sides: [
      { id: 'api', path: 'api', stack: 'node', role: 'backend' },
      { id: 'web', path: 'web', stack: 'react', role: 'frontend' },
    ],
  });
  assert.equal(resolveSelection({ backend: 'none', frontend: 'none' }).code, 'EMPTY_SELECTION');
  assert.equal(resolveSelection({ backend: 'go', frontend: 'react' }).code, 'INVALID_BACKEND');
  assert.equal(resolveSelection({ backend: 'java', frontend: 'angular' }).code, 'INVALID_FRONTEND');
});

test('v4：创建 monorepo 布局、默认 REQ 与幂等', () => {
  const root = tempRoot();
  const selection = resolveSelection({ backend: 'java', frontend: 'react' });
  const first = createWorkspaceLayout({ root, selection });
  assert.equal(first.ok, true);
  assert.equal(first.skipped, false);
  assert.deepEqual(first.sides, ['api', 'web']);
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'workspace.yaml')));
  assert.ok(fs.existsSync(path.join(root, 'contracts')));
  for (const side of ['api', 'web']) {
    assert.ok(fs.existsSync(path.join(root, side, '.specgate', 'config.yaml')), side);
    const req = fs.readFileSync(path.join(root, side, 'openspec', 'REQ.md'), 'utf8');
    assert.match(req, /REQ-001 搭建框架/, side);
    assert.ok(fs.existsSync(path.join(root, side, 'openspec', 'history', 'v1.0', 'REQ.md')), side);
  }
  const workspace = readWorkspace(root);
  assert.equal(workspace.version, 4);
  assert.equal(workspace.backend, 'java');
  assert.equal(workspace.frontend, 'react');

  const second = createWorkspaceLayout({ root, selection });
  assert.equal(second.skipped, true);
});

test('v4：仅后端 / 仅前端生成单个 submodule', () => {
  for (const [input, sides] of [
    [{ backend: 'python', frontend: 'none' }, ['api']],
    [{ backend: 'none', frontend: 'vue' }, ['web']],
  ]) {
    const root = tempRoot();
    const result = createWorkspaceLayout({ root, selection: resolveSelection(input) });
    assert.deepEqual(result.sides, sides);
  }
});

test('v4：scan 识别空目录、v4 与存量仓库', () => {
  const empty = tempRoot();
  assert.equal(scanWorkspace(empty).kind, 'empty');

  const v4 = tempRoot();
  createWorkspaceLayout({
    root: v4,
    selection: resolveSelection({ backend: 'node', frontend: 'none' }),
  });
  assert.equal(scanWorkspace(v4).kind, 'v4');
  assert.match(workspaceSummary(v4), /v4 workspace/);

  const existing = tempRoot();
  fs.writeFileSync(path.join(existing, 'package.json'), '{"name":"legacy"}\n', 'utf8');
  assert.equal(scanWorkspace(existing).kind, 'existing');
});
