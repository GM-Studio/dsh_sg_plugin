import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { registerCommands, parseChangeArgs } from '../../src/v3/commands.js';
import { load } from '../../src/v3/state.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-s1-'));
}

function makeCtx() {
  const tools = new Map();
  const commands = new Map();
  return {
    get: () => undefined,
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    commands: {
      register(definition) {
        commands.set(definition.name, definition);
        return () => commands.delete(definition.name);
      },
    },
    toolsMap: tools,
    commandsMap: commands,
  };
}

function setup(root) {
  const ctx = makeCtx();
  const runtime = createRuntime(ctx, { root });
  registerTools(ctx, runtime);
  registerCommands(ctx, runtime);
  return { ctx, runtime };
}

async function callTool(ctx, name, args = {}) {
  const definition = ctx.toolsMap.get(name);
  assert.ok(definition, `tool ${name} not registered`);
  return definition.execute(args, { agent: null });
}

test('注册 6 个工具与 4 个命令', () => {
  const root = tempRoot();
  const { ctx } = setup(root);
  assert.deepEqual(
    [...ctx.toolsMap.keys()].sort(),
    ['sg_approve', 'sg_change', 'sg_init', 'sg_run', 'sg_skill', 'sg_status'],
  );
  assert.deepEqual(
    [...ctx.commandsMap.keys()].sort(),
    ['sg-change', 'sg-init', 'sg-skill', 'sg-status'],
  );
});

test('未初始化时 sg_status 显示未初始化', async () => {
  const root = tempRoot();
  const { ctx } = setup(root);
  const result = await callTool(ctx, 'sg_status');
  assert.match(result.text, /未初始化/);
  assert.equal(result.data.initialized, false);
});

test('sg_init 后 sg_status 显示 IDLE', async () => {
  const root = tempRoot();
  const { ctx } = setup(root);
  const init = await callTool(ctx, 'sg_init');
  assert.match(init.text, /已初始化/);
  const status = await callTool(ctx, 'sg_status');
  assert.match(status.text, /阶段：IDLE/);
  assert.equal(load(root).state.phase, 'IDLE');
});

test('sg_change 创建 change 并进入 H1_PENDING', async () => {
  const root = tempRoot();
  const { ctx } = setup(root);
  await callTool(ctx, 'sg_init');
  const result = await callTool(ctx, 'sg_change', { name: 'add-login', type: 'fix' });
  assert.match(result.text, /H1_PENDING/);
  const status = await callTool(ctx, 'sg_status');
  assert.match(status.text, /Change：add-login（fix）/);
  assert.equal(load(root).state.phase, 'H1_PENDING');
});

test('未初始化时 sg_change 被拒', async () => {
  const root = tempRoot();
  const { ctx } = setup(root);
  const result = await callTool(ctx, 'sg_change', { name: 'add-login' });
  assert.match(result.text, /未初始化/);
});

test('workflowVersion<3 时 sg_change 被拒', async () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(path.join(root, '.specgate', 'config.yaml'), 'workflowVersion: 2\n', 'utf8');
  const { ctx } = setup(root);
  const result = await callTool(ctx, 'sg_change', { name: 'add-login' });
  assert.match(result.text, /workflowVersion=2/);
  assert.equal(fs.existsSync(path.join(root, 'openspec')), false);
});

test('命令 /sg-init 与 /sg-change 可用', async () => {
  const root = tempRoot();
  const { ctx } = setup(root);
  const init = await ctx.commandsMap.get('sg-init').handler({ rawInput: '', agent: null });
  assert.equal(init.kind, 'success');
  const change = await ctx.commandsMap
    .get('sg-change')
    .handler({ rawInput: 'add-login --type modify', agent: null });
  assert.equal(change.kind, 'success');
  assert.match(change.text, /H1_PENDING/);
  assert.equal(load(root).state.type, 'modify');
});

test('parseChangeArgs 支持 --type、--link 与位置参数', () => {
  assert.deepEqual(parseChangeArgs('add-login --type fix'), {
    name: 'add-login',
    type: 'fix',
    link: null,
  });
  assert.deepEqual(parseChangeArgs('--type remove clean-up'), {
    name: 'clean-up',
    type: 'remove',
    link: null,
  });
  assert.deepEqual(parseChangeArgs('add-login --link checkout-2026-10'), {
    name: 'add-login',
    type: 'feature',
    link: 'checkout-2026-10',
  });
  assert.deepEqual(parseChangeArgs(''), { name: '', type: 'feature', link: null });
});
