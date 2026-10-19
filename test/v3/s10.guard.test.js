import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../../src/v3/runtime.js';
import { checkWrite } from '../../src/v3/guards.js';
import { initProject, createChange } from '../../src/v3/change.js';
import { patchState } from '../../src/v3/state.js';
import { apply } from '../../index.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-guard-'));
}

function execWrite(filePath) {
  return { name: 'write', arguments: { file_path: filePath }, agent: null };
}

test('H1 前禁止写 design/tasks/源码/测试', () => {
  const root = tempRoot();
  initProject(root);
  createChange(root, { name: 'guard-demo', type: 'feature' });
  const runtime = createRuntime({ get: () => undefined }, { root });

  for (const file of [
    'openspec/changes/guard-demo/design.md',
    'openspec/changes/guard-demo/tasks.md',
    'src/app.js',
    'tests/app.test.js',
  ]) {
    const message = checkWrite(runtime, execWrite(file));
    assert.match(String(message), /H1 尚未批准/, file);
  }

  assert.equal(checkWrite(runtime, execWrite('openspec/changes/guard-demo/proposal.md')), undefined);
  assert.equal(
    checkWrite(runtime, execWrite('openspec/changes/guard-demo/specs/app/spec.md')),
    undefined,
  );
});

test('H1 批准后放行 design', () => {
  const root = tempRoot();
  initProject(root);
  createChange(root, { name: 'guard-demo', type: 'feature' });
  patchState(root, (draft) => {
    draft.phase = 'PLAN';
  });
  const runtime = createRuntime({ get: () => undefined }, { root });
  assert.equal(checkWrite(runtime, execWrite('openspec/changes/guard-demo/design.md')), undefined);
});

test('specs 与 acceptance 永远禁止 agent 写入', () => {
  const root = tempRoot();
  initProject(root);
  const runtime = createRuntime({ get: () => undefined }, { root });
  assert.match(String(checkWrite(runtime, execWrite('openspec/specs/x/spec.md'))), /归档事务/);
  assert.match(
    String(checkWrite(runtime, execWrite('openspec/changes/c/acceptance.md'))),
    /编排器生成/,
  );
});

test('index.js 注册 v3 工具与守卫', () => {
  const root = tempRoot();
  const names = [];
  let guard = null;
  const ctx = {
    get: () => undefined,
    effect(fn) {
      return fn();
    },
    inject: (services, cb) => cb(ctx),
    tools: {
      register(definition) {
        names.push(definition.name);
        return () => {};
      },
      guard(fn) {
        guard = fn;
        return () => {};
      },
    },
  };
  apply(ctx, { root });
  assert.ok(names.includes('sg_init'));
  assert.ok(names.includes('sg_run'));
  assert.ok(names.includes('sg_skill'));
  assert.equal(typeof guard, 'function');
});
