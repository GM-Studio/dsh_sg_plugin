import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { load } from '../../src/v3/state.js';
import { startInitProject } from '../../src/v3/init.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-h0-'));
}

function makeCtx(services = {}) {
  const tools = new Map();
  return {
    get: (name) => services[name],
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    toolsMap: tools,
  };
}

function setup(root, services) {
  const ctx = makeCtx(services);
  const runtime = createRuntime(ctx, { root });
  registerTools(ctx, runtime);
  return { ctx, runtime };
}

async function callTool(ctx, name, args = {}) {
  return ctx.toolsMap.get(name).execute(args, { agent: null });
}

function fakeQuestions(stack = 'node', approval = '通过') {
  return {
    async ask({ questions }) {
      const question = questions[0];
      if (question.id === 'sg-init-stack') return { answers: [{ selected: [stack] }] };
      if (String(question.id).startsWith('sg-approve-')) {
        return { answers: [{ selected: [approval] }] };
      }
      return { answers: [{ selected: ['跳过'] }] };
    },
  };
}

async function h0Project(services) {
  const root = tempRoot();
  const { ctx } = setup(root, services);
  const started = await startInitProject({
    root,
    userQuestions: services.userQuestions,
    agent: null,
    signal: new AbortController().signal,
  });
  assert.equal(started.ok, true, started.message);
  assert.equal(started.phase, 'H0_PENDING');
  assert.equal(load(root).state.change, null);
  return { root, ctx };
}

test('sg_approve 的参数 schema 暴露 H0', () => {
  const { ctx } = setup(tempRoot());
  const tool = ctx.toolsMap.get('sg_approve');
  assert.deepEqual(tool.parameters.properties.gate.enum, ['H0', 'H1', 'H2', 'H3']);
});

test('H0：尚无 change 时也能批准，随后 sg_run 生成脚手架并进入 H1_PENDING', async () => {
  const services = { userQuestions: fakeQuestions() };
  const { root, ctx } = await h0Project(services);

  const approved = await callTool(ctx, 'sg_approve', { gate: 'H0' });
  assert.match(approved.text, /H0 已批准/);

  let state = load(root).state;
  assert.equal(state.phase, 'H0_PENDING');
  assert.equal(state.change, null);
  assert.equal(state.approvals.H0.artifactHash, state.h0.hash);

  const run = await callTool(ctx, 'sg_run');
  assert.match(run.text, /H0 已批准，已生成脚手架/);

  state = load(root).state;
  assert.equal(state.phase, 'H1_PENDING');
  assert.equal(state.change, 'add-version');
});

test('H0：用户拒绝时停在 H0_PENDING', async () => {
  const services = { userQuestions: fakeQuestions('node', '需要修改') };
  const { root, ctx } = await h0Project(services);

  const result = await callTool(ctx, 'sg_approve', { gate: 'H0' });
  assert.match(result.text, /未批准/);
  assert.equal(load(root).state.phase, 'H0_PENDING');
});

test('H0：不在 H0_PENDING 阶段时拒绝批准', async () => {
  const { ctx } = setup(tempRoot());
  await callTool(ctx, 'sg_init');
  const result = await callTool(ctx, 'sg_approve', { gate: 'H0' });
  assert.match(result.text, /不能批准 H0/);
});
