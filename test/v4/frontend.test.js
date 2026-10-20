import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorkspaceLayout, resolveSelection } from '../../src/v4/workspace.js';
import { buildWorkspace } from '../../src/v4/build.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v4-web-'));
}

function quality(ok = true) {
  return async () => ({
    ok,
    stages: [
      {
        name: 'test',
        status: ok ? 0 : 1,
        command: 'fake',
        durationMs: 1,
        stdout: ok ? 'ok' : '',
        stderr: '',
      },
    ],
  });
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('v4 Phase 3：React 前端生成页面、mock API 与测试', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ backend: 'none', frontend: 'react' });
  createWorkspaceLayout({ root, selection });
  const built = await buildWorkspace({ root, selection, qualityRunner: quality(true) });
  assert.equal(built.ok, true);
  const side = path.join(root, 'web');
  for (const file of [
    'package.json',
    'src/App.jsx',
    'src/api.js',
    'src/api.test.js',
    'vite.config.js',
  ]) {
    assert.ok(fs.existsSync(path.join(side, file)), file);
  }
  const log = git(side, ['log', '--oneline', '--decorate', '-5']);
  assert.match(log, /merge bootstrap/);
  assert.match(log, /feat\(mvp\): 搭建 react 前端/);
  assert.ok(git(side, ['tag']).includes('mvp-bootstrap'));
});

test('v4 Phase 3：Vue 前端生成页面与测试', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ backend: 'none', frontend: 'vue' });
  createWorkspaceLayout({ root, selection });
  const built = await buildWorkspace({ root, selection, qualityRunner: quality(true) });
  assert.equal(built.ok, true);
  const side = path.join(root, 'web');
  for (const file of ['src/App.vue', 'src/api.js', 'src/api.test.js']) {
    assert.ok(fs.existsSync(path.join(side, file)), file);
  }
});

test('v4 Phase 3：node 全栈同时生成 api 与 web', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ preset: 'node-fullstack' });
  createWorkspaceLayout({ root, selection });
  const built = await buildWorkspace({ root, selection, qualityRunner: quality(true) });
  assert.equal(built.ok, true);
  assert.equal(built.results.length, 2);
  assert.ok(fs.existsSync(path.join(root, 'api', 'src', 'items.ts')));
  assert.ok(fs.existsSync(path.join(root, 'web', 'src', 'App.jsx')));
  assert.ok(fs.existsSync(path.join(root, 'contracts', 'openapi.yaml')));
});
