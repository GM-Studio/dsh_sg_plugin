import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { initProject, createChange } from '../../src/v3/change.js';
import { load, patchState } from '../../src/v3/state.js';
import { acquire, release, lockPath } from '../../src/v3/lock.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-s9-'));
}

function makeCtx() {
  const tools = new Map();
  return {
    get: () => undefined,
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    toolsMap: tools,
  };
}

function setup(root) {
  const ctx = makeCtx();
  const runtime = createRuntime(ctx, { root });
  registerTools(ctx, runtime);
  return ctx;
}

async function call(ctx, name, args = {}) {
  return ctx.toolsMap.get(name).execute(args, { agent: null });
}

function bootstrap() {
  const root = tempRoot();
  initProject(root);
  createChange(root, { name: 's9-change', type: 'feature' });
  return root;
}

test('S9：其他运行占用锁时 sg_run 被拒', async () => {
  const root = bootstrap();
  const ctx = setup(root);
  const held = acquire(root);
  assert.equal(held.ok, true);

  const result = await call(ctx, 'sg_run');
  assert.match(result.text, /已有运行中的进程/);

  release(root);
  const after = await call(ctx, 'sg_run');
  assert.doesNotMatch(after.text, /已有运行中的进程/);
});

test('S9：--force 可以越过锁', async () => {
  const root = bootstrap();
  const ctx = setup(root);
  acquire(root);
  const result = await call(ctx, 'sg_run', { force: true });
  assert.doesNotMatch(result.text, /已有运行中的进程/);
  assert.equal(fs.existsSync(lockPath(root)), false);
});

test('S9：BLOCKED --retry 恢复任务并清零 attempts', async () => {
  const root = bootstrap();
  const ctx = setup(root);
  patchState(root, (draft) => {
    draft.phase = 'BLOCKED';
    draft.resumePhase = 'EXECUTING';
    draft.blockedReason = '测试失败';
    draft.tasks = {
      'T-001': {
        id: 'T-001',
        title: 'x',
        ac: ['AC-001'],
        deps: [],
        parallel: false,
        status: 'blocked',
        attempts: 3,
        commit: null,
      },
    };
  });

  const result = await call(ctx, 'sg_run', { retry: true });
  assert.match(result.text, /恢复到 EXECUTING/);
  const state = load(root).state;
  assert.equal(state.phase, 'EXECUTING');
  assert.equal(state.tasks['T-001'].status, 'pending');
  assert.equal(state.tasks['T-001'].attempts, 0);
});

test('S9：重复 sg_run 不产生重复合并', async () => {
  const root = bootstrap();
  const ctx = setup(root);
  await call(ctx, 'sg_run');
  await call(ctx, 'sg_run');
  const state = load(root).state;
  assert.equal(state.phase, 'H1_PENDING');
  assert.equal(fs.existsSync(lockPath(root)), false);
});
