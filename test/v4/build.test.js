import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createWorkspaceLayout, resolveSelection } from '../../src/v4/workspace.js';
import { buildWorkspace } from '../../src/v4/build.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v4-build-'));
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
        stderr: ok ? '' : 'boom',
      },
    ],
  });
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('v4 Phase 2：Node 后端生成 CRUD、质量、提交链与 no-ff 合并', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ backend: 'node', frontend: 'none' });
  createWorkspaceLayout({ root, selection });
  const built = await buildWorkspace({ root, selection, qualityRunner: quality(true) });
  assert.equal(built.ok, true);
  const side = path.join(root, 'api');
  for (const file of [
    'src/items.ts',
    'src/app.ts',
    'src/server.ts',
    'test/items.test.ts',
    'docs/mvp-scaffold-report.md',
    'openspec/specs/mvp/spec.md',
  ]) {
    assert.ok(fs.existsSync(path.join(side, file)), file);
  }
  const log = git(side, ['log', '--oneline', '--decorate', '--graph', '-5']);
  assert.match(log, /merge bootstrap/);
  assert.match(log, /feat\(mvp\): 搭建 node/);
  assert.match(log, /chore\(bootstrap\): 归档/);
  assert.equal(git(side, ['tag']).split(/\r?\n/).includes('mvp-bootstrap'), true);
  assert.equal(git(side, ['branch', '--show-current']), 'main');
});

test('v4 Phase 2：Java / Python 生成对应后端文件', async () => {
  for (const [backend, file] of [
    ['java', 'src/main/java/com/example/demo/ItemController.java'],
    ['python', 'app/items.py'],
  ]) {
    const root = tempRoot();
    const selection = resolveSelection({ backend, frontend: 'none' });
    createWorkspaceLayout({ root, selection });
    const built = await buildWorkspace({ root, selection, qualityRunner: quality(true) });
    assert.equal(built.ok, true, backend);
    assert.ok(fs.existsSync(path.join(root, 'api', file)), backend + ' ' + file);
  }
});

test('v4 Phase 2：质量失败降级提交、保留报告', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ backend: 'node', frontend: 'none' });
  createWorkspaceLayout({ root, selection });
  const built = await buildWorkspace({ root, selection, qualityRunner: quality(false) });
  assert.equal(built.ok, true);
  assert.equal(built.results[0].degraded, true);
  assert.equal(built.results[0].qualityStatus, 'degraded');
  const side = path.join(root, 'api');
  assert.ok(fs.existsSync(path.join(side, 'docs', 'mvp-scaffold-report.md')));
  const report = fs.readFileSync(path.join(side, '.specgate', 'init-report.json'), 'utf8');
  assert.match(report, /"degraded": true/);
  const log = git(side, ['log', '--oneline']);
  assert.match(log, /merge bootstrap/);
  assert.match(log, /\[degraded\]/);
  assert.equal(git(side, ['tag']).split(/\r?\n/).includes('mvp-bootstrap'), true);
});

test('v4 Phase 2：重复构建幂等', async () => {
  const root = tempRoot();
  const selection = resolveSelection({ backend: 'node', frontend: 'none' });
  createWorkspaceLayout({ root, selection });
  await buildWorkspace({ root, selection, qualityRunner: quality(true) });
  const second = await buildWorkspace({ root, selection, qualityRunner: quality(true) });
  assert.equal(second.ok, true);
  assert.equal(second.results[0].skipped, true);
});
