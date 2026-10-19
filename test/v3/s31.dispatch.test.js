import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject, configPath } from '../../src/v3/change.js';
import { createDispatcher } from '../../src/v3/dispatch.js';
import { poolDisposeAll } from '../../src/v3/pool.js';

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-dispatch-'));
  initProject(root);
  fs.appendFileSync(configPath(root), 'pool:\n  enabled: true\n', 'utf8');
  return root;
}

function fakeRuntime({ agentRunner = null, subagentsEnabled = true } = {}) {
  const sessions = new Map();
  const messages = [];
  const subagents = {
    started: 0,
    disposed: 0,
    messages,
    list: () => ['in-process'],
    async startActivation({ request }) {
      this.started += 1;
      const id = `child-${this.started}`;
      const session = {
        last: `done ${id}`,
        deriveMessages: () => [
          { role: 'assistant', content: [{ type: 'text', text: session.last }] },
        ],
      };
      sessions.set(id, session);
      messages.push(request.prompt[0].text);
      return {
        childId: id,
        result: Promise.resolve({ output: [{ type: 'text', text: `done ${id}` }] }),
        dispose: async () => {
          this.disposed += 1;
        },
      };
    },
    async sendMessage(parent, id, content) {
      messages.push(content[0].text);
      sessions.get(id).last = `reply ${id}`;
    },
    async waitForChildren() {},
  };
  const runtime = {
    agentRunner: () => agentRunner,
    project: () => ({ root: tempRoot(), state: null }),
    service(name) {
      if (!subagentsEnabled) return undefined;
      if (name === 'subagents') return subagents;
      if (name === 'agents') return { get: (id) => ({ id, whenIdle: async () => {} }) };
      if (name === 'sessions') return { get: (id) => sessions.get(id) };
      if (name === 'workingDirectory') return { set: async () => {} };
      return undefined;
    },
  };
  return { runtime, subagents };
}

test.afterEach(async () => {
  await poolDisposeAll();
});

test('dispatcher 通过 subagents 复用 implementer', async () => {
  const root = tempRoot();
  const { runtime, subagents } = fakeRuntime();
  const dispatch = createDispatcher(runtime);
  const base = { role: 'implementer', root, change: 'c1', worktree: root, skills: [] };

  const first = await dispatch({ ...base, prompt: 'a', task: { id: 'T-001' } });
  const second = await dispatch({ ...base, prompt: 'b', task: { id: 'T-002' } });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(subagents.started, 1);
  assert.match(second.text, /reply child-1/);
});

test('dispatcher 对 reviewer 每次新建', async () => {
  const root = tempRoot();
  const { runtime, subagents } = fakeRuntime();
  const dispatch = createDispatcher(runtime);
  const base = { role: 'reviewer', root, change: 'c1', worktree: root, skills: [] };
  await dispatch({ ...base, prompt: 'r1', task: { id: 'T-001' } });
  await dispatch({ ...base, prompt: 'r2', task: { id: 'T-002' } });
  assert.equal(subagents.started, 2);
  assert.equal(subagents.disposed, 2);
});

test('缺少 subagents 服务时明确失败', async () => {
  const root = tempRoot();
  const { runtime } = fakeRuntime({ subagentsEnabled: false });
  const dispatch = createDispatcher(runtime);
  const result = await dispatch({
    role: 'implementer',
    root,
    change: 'c1',
    worktree: root,
    prompt: 'x',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SUBAGENTS_UNAVAILABLE');
});

test('脚本化 agentRunner 仍然绕过池', async () => {
  const root = tempRoot();
  const { runtime } = fakeRuntime({
    agentRunner: async ({ prompt }) => ({ ok: true, text: `scripted:${prompt}` }),
    subagentsEnabled: false,
  });
  const dispatch = createDispatcher(runtime);
  const result = await dispatch({
    role: 'implementer',
    root,
    change: 'c1',
    worktree: root,
    prompt: 'x',
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, 'scripted:x');
});
