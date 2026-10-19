import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject, configPath } from '../../src/v3/change.js';
import {
  poolDispatch,
  poolDisposeAll,
  poolDisposeChange,
  poolSnapshot,
} from '../../src/v3/pool.js';
import { load } from '../../src/v3/state.js';
import { renderStatus } from '../../src/v3/status.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-pool-'));
}

function setupRoot(poolYaml = '') {
  const root = tempRoot();
  initProject(root);
  if (poolYaml) fs.appendFileSync(configPath(root), `${poolYaml}\n`, 'utf8');
  return root;
}

function fakeRuntime({ failAt = Infinity, delayMs = 0 } = {}) {
  const handles = [];
  const agents = {
    created: 0,
    disposed: 0,
    handles,
    async create() {
      this.created += 1;
      const index = this.created;
      const agent = {
        id: `agent-${index}`,
        last: '',
        disposed: false,
        followup(message) {
          agent.last = message.content[0].text;
        },
        async whenIdle() {
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
          if (index >= failAt) throw new Error(`agent ${index} failed`);
        },
        session: {
          deriveMessages: () => [
            { role: 'assistant', content: [{ type: 'text', text: `done ${index}` }] },
          ],
        },
      };
      const handle = {
        agent,
        dispose: async () => {
          agent.disposed = true;
          agents.disposed += 1;
        },
      };
      handles.push(handle);
      return handle;
    },
  };
  const cwdCalls = [];
  const runtime = {
    service(name) {
      if (name === 'agents') return agents;
      if (name === 'workingDirectory') {
        return {
          set: async (agent, directory) => {
            cwdCalls.push([agent.id, directory]);
            return directory;
          },
        };
      }
      return undefined;
    },
  };
  return { runtime, agents, cwdCalls };
}

test.afterEach(async () => {
  await poolDisposeAll();
});

test('同一仓同一角色跨任务复用 agent，并注入上一任务摘要', async () => {
  const root = setupRoot('pool:\n  enabled: true\n  reuseTasks: 3');
  const { runtime, agents } = fakeRuntime();
  const base = { runtime, role: 'implementer', root, change: 'c1', worktree: root, skills: [] };

  const first = await poolDispatch({ ...base, prompt: 'task-one', task: { id: 'T-001', ac: ['AC-001'] } });
  assert.equal(first.ok, true);
  const second = await poolDispatch({ ...base, prompt: 'task-two', task: { id: 'T-002', ac: ['AC-002'] } });
  assert.equal(second.ok, true);

  assert.equal(agents.created, 1);
  assert.match(second.text, /done 1/);
  assert.match(agents.handles[0].agent.last, /上一个任务摘要/);
  assert.match(agents.handles[0].agent.last, /task=T-001/);
  const snapshot = poolSnapshot(root);
  assert.equal(snapshot.roles.implementer.size, 1);
  assert.equal(snapshot.stats.reused >= 1, true);
});

test('连续 3 个任务后销毁重建', async () => {
  const root = setupRoot('pool:\n  enabled: true\n  reuseTasks: 3');
  const { runtime, agents } = fakeRuntime();
  const base = { runtime, role: 'tester', root, change: 'c1', worktree: root, skills: [] };
  for (let index = 1; index <= 3; index += 1) {
    const result = await poolDispatch({ ...base, prompt: `t${index}`, task: { id: `T-00${index}` } });
    assert.equal(result.ok, true);
  }
  assert.equal(agents.created, 1);
  await poolDispatch({ ...base, prompt: 't4', task: { id: 'T-004' } });
  assert.equal(agents.created, 2);
  assert.equal(agents.disposed, 1);
});

test('reviewer 每次新建，不进入池', async () => {
  const root = setupRoot('pool:\n  enabled: true');
  const { runtime, agents } = fakeRuntime();
  const base = { runtime, role: 'reviewer', root, change: 'c1', worktree: root, skills: [] };
  await poolDispatch({ ...base, prompt: 'review-1', task: { id: 'T-001' } });
  await poolDispatch({ ...base, prompt: 'review-2', task: { id: 'T-002' } });
  assert.equal(agents.created, 2);
  assert.equal(agents.disposed, 2);
  assert.equal(poolSnapshot(root).roles.reviewer, undefined);
});

test('失败换新，连续两次失败后熔断', async () => {
  const root = setupRoot('pool:\n  enabled: true\n  breakerFailures: 2');
  const { runtime, agents } = fakeRuntime({ failAt: 1 });
  const base = { runtime, role: 'implementer', root, change: 'c1', worktree: root, skills: [] };

  const first = await poolDispatch({ ...base, prompt: 'fail-1', task: { id: 'T-001' } });
  assert.equal(first.ok, false);
  assert.equal(first.code, 'DISPATCH_FAILED');
  assert.equal(agents.created, 1);
  assert.equal(agents.disposed, 1);

  const second = await poolDispatch({ ...base, prompt: 'fail-2', task: { id: 'T-002' } });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'AGENT_BREAKER_OPEN');

  const third = await poolDispatch({ ...base, prompt: 'fail-3', task: { id: 'T-003' } });
  assert.equal(third.code, 'AGENT_BREAKER_OPEN');
  assert.equal(agents.created, 2);
});

test('归档只销毁本 change 用过的空闲 agent', async () => {
  const root = setupRoot('pool:\n  enabled: true');
  const { runtime, agents } = fakeRuntime();
  await poolDispatch({
    runtime,
    role: 'implementer',
    root,
    change: 'c-archive',
    worktree: root,
    prompt: 'x',
    task: { id: 'T-001' },
  });
  assert.equal(poolSnapshot(root).roles.implementer.size, 1);
  await poolDisposeChange(root, 'c-archive');
  assert.equal(poolSnapshot(root).roles.implementer.size, 0);
  assert.equal(agents.disposed, 1);
});

test('pool.enabled=false 时退回每次新建', async () => {
  const root = setupRoot('pool:\n  enabled: false');
  const { runtime, agents } = fakeRuntime();
  const base = { runtime, role: 'implementer', root, change: 'c1', worktree: root, skills: [] };
  await poolDispatch({ ...base, prompt: 'a', task: { id: 'T-001' } });
  await poolDispatch({ ...base, prompt: 'b', task: { id: 'T-002' } });
  assert.equal(agents.created, 2);
  assert.equal(poolSnapshot(root).roles.implementer, undefined);
});

test('上下文达到阈值时提前重建', async () => {
  const root = setupRoot(
    'pool:\n  enabled: true\n  reuseTasks: 99\n  contextTokens: 10\n  contextThreshold: 0.7',
  );
  const { runtime, agents } = fakeRuntime();
  const base = { runtime, role: 'implementer', root, change: 'c1', worktree: root, skills: [] };
  await poolDispatch({ ...base, prompt: 'a', task: { id: 'T-001' } });
  await poolDispatch({ ...base, prompt: 'b', task: { id: 'T-002' } });
  assert.equal(agents.created, 2);
});

test('并发受单 change 上限约束并复用，且每次切换工作目录', async () => {
  const root = setupRoot('pool:\n  enabled: true\n  poolSize: 2\n  maxLeasedPerChange: 2');
  const { runtime, agents, cwdCalls } = fakeRuntime({ delayMs: 25 });
  const base = { runtime, role: 'implementer', root, change: 'c1', skills: [] };
  const results = await Promise.all([
    poolDispatch({ ...base, worktree: path.join(root, 'a'), prompt: 'a', task: { id: 'T-001' } }),
    poolDispatch({ ...base, worktree: path.join(root, 'b'), prompt: 'b', task: { id: 'T-002' } }),
    poolDispatch({ ...base, worktree: path.join(root, 'c'), prompt: 'c', task: { id: 'T-003' } }),
  ]);
  assert.equal(results.every((item) => item.ok), true);
  assert.equal(agents.created, 2);
  assert.equal(cwdCalls.length, 3);
  assert.deepEqual(
    cwdCalls.map((item) => item[1]).sort(),
    [path.join(root, 'a'), path.join(root, 'b'), path.join(root, 'c')].sort(),
  );
});

test('status 显示池统计', async () => {
  const root = setupRoot('pool:\n  enabled: true');
  const { runtime } = fakeRuntime();
  await poolDispatch({
    runtime,
    role: 'implementer',
    root,
    change: 'c1',
    worktree: root,
    prompt: 'x',
    task: { id: 'T-001' },
  });
  const state = load(root).state;
  const text = renderStatus({ root, state, config: { workflowVersion: 3 } });
  assert.match(text, /Agent 池：创建 1/);
  assert.match(text, /池 implementer：size=1/);
});
