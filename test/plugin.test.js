import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { apply, inject } from '../index.js';
import { confirmGate } from '../src/gates.js';
import { initProject } from '../src/init.js';
import { loadProject } from '../src/project.js';

function makeContext() {
  const tools = [];
  const guards = [];
  const commands = [];
  const skills = [];
  const contexts = [];
  const listeners = [];
  const services = {
    tools: {
      register(definition) {
        tools.push(definition);
        return () => {};
      },
      guard(fn) {
        guards.push(fn);
        return () => {};
      },
    },
    commands: {
      register(definition) {
        commands.push(definition);
        return () => {};
      },
    },
    skills: {
      register(skill) {
        skills.push(skill);
        return () => {};
      },
    },
    systemPrompt: {
      context(context) {
        contexts.push(context);
        return () => {};
      },
    },
  };

  const ctx = {
    get(name) {
      return services[name];
    },
    effect(fn) {
      return fn();
    },
    on(event, handler) {
      listeners.push({ event, handler });
      return () => {};
    },
    tools: services.tools,
  };

  return { ctx, tools, guards, commands, skills, contexts, listeners };
}

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-plugin-'));
  execFileSync('git', ['init'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'SpecGate Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'specgate-test@example.com'], { cwd: root });
  initProject(root);
  return root;
}

test('plugin registers tools, commands, skills, prompt and guard', () => {
  const root = makeProject();
  const previous = process.cwd();
  process.chdir(root);
  try {
    const { ctx, tools, guards, commands, skills, contexts, listeners } = makeContext();
    apply(ctx, {});

    const toolNames = tools.map((tool) => tool.name);
    assert.deepEqual(
      [...toolNames].sort(),
      [
        'sg_archive',
        'sg_change',
        'sg_classify',
        'sg_commit',
        'sg_deviation',
        'sg_disable',
        'sg_doctor',
        'sg_enable',
        'sg_gate',
        'sg_init',
        'sg_migrate',
        'sg_next',
        'sg_propose',
        'sg_requirements_migrate',
        'sg_status',
        'sg_test',
      ],
      'the plugin must register exactly the documented 16 tools',
    );
    assert.ok(inject.includes('tools'));
    assert.ok(inject.includes('agents'), 'parallel dispatch needs the agents service');
    assert.ok(!toolNames.some((name) => name.startsWith('mcp_')), 'SpecGate does not ship MCP tools');
    assert.deepEqual(
      commands.map((command) => command.name).sort(),
      [
        'sg-apply',
        'sg-archive',
        'sg-change',
        'sg-classify',
        'sg-commit',
        'sg-deviation',
        'sg-disable',
        'sg-doctor',
        'sg-enable',
        'sg-explore',
        'sg-gate',
        'sg-init',
        'sg-migrate',
        'sg-next',
        'sg-propose',
        'sg-requirements-migrate',
        'sg-status',
        'sg-test',
      ],
      'the plugin must register exactly the documented 18 commands',
    );
    assert.ok(skills.every((skill) => skill.description && skill.description.length > 0));
    assert.equal(new Set(skills.map((skill) => skill.name)).size, 30);
    assert.equal(guards.length, 1);
    assert.equal(contexts.length, 1);
    assert.equal(listeners.length, 1);
    assert.ok(commands.some((command) => command.name === 'sg-status'));
    assert.ok(!commands.some((command) => command.name.includes(':')));
    assert.ok(!toolNames.includes('sg_selftest_append'));
    assert.ok(skills.every((skill) => skill.content.includes('SpecGate 适配')));
    assert.ok(
      skills.every(
        (skill) => typeof skill.source === 'string' && skill.source.length > 0,
      ),
      'every registered skill must carry a string source for DSH load validation',
    );
  } finally {
    process.chdir(previous);
  }
});

test('commands wait for a late-loaded commands service instead of being dropped', () => {
  const root = makeProject();
  const previous = process.cwd();
  process.chdir(root);
  try {
    const commands = [];
    const pending = [];
    const tools = {
      register() {
        return () => {};
      },
      guard() {
        return () => {};
      },
    };
    const ctx = {
      tools,
      get(name) {
        return name === 'tools' ? tools : undefined;
      },
      inject(services, callback) {
        pending.push(() => callback({
          commands: {
            register(definition) {
              commands.push(definition);
              return () => {};
            },
          },
        }));
        return { dispose() {} };
      },
      effect(fn) {
        return fn();
      },
      on() {
        return () => {};
      },
    };

    apply(ctx, {});
    assert.equal(commands.length, 0);
    for (const run of pending) run();
    assert.ok(commands.some((command) => command.name === 'sg-init'));
  } finally {
    process.chdir(previous);
  }
});

test('status tool executes against an initialized project', async () => {
  const root = makeProject();
  confirmGate(root, 'G1');
  const previous = process.cwd();
  process.chdir(root);
  try {
    const { ctx, tools } = makeContext();
    apply(ctx, {});
    const statusTool = tools.find((tool) => tool.name === 'sg_status');
    const result = await statusTool.execute({}, { agent: null, signal: new AbortController().signal });
    assert.match(result.text, /SpecGate 状态/);
    assert.match(result.text, /G1\s+需求理解确认：已确认/);
    assert.match(result.text, /Git：/);
  } finally {
    process.chdir(previous);
  }
});

test('gate status works without userQuestions; confirm fails closed', async () => {
  const root = makeProject();
  const previous = process.cwd();
  process.chdir(root);
  try {
    const { ctx, tools } = makeContext();
    apply(ctx, {});
    const gateTool = tools.find((tool) => tool.name === 'sg_gate');
    const exec = { agent: null, signal: new AbortController().signal };

    const status = await gateTool.execute({ gate: 'G1', action: 'status' }, exec);
    assert.match(status.text, /G1 需求理解确认：待确认/);

    const confirm = await gateTool.execute({ gate: 'G1', action: 'confirm' }, exec);
    assert.equal(confirm.data.ok, false);
    assert.match(confirm.text, /不支持结构化确认/);
  } finally {
    process.chdir(previous);
  }
});

test('classify tool returns a paradigm without applying G2', async () => {
  const root = makeProject();
  const previous = process.cwd();
  process.chdir(root);
  try {
    const { ctx, tools } = makeContext();
    apply(ctx, {});
    const classify = tools.find((tool) => tool.name === 'sg_classify');
    const result = await classify.execute(
      { description: '修复登录报错' },
      { agent: null, signal: new AbortController().signal },
    );
    assert.match(result.text, /L3/);
  } finally {
    process.chdir(previous);
  }
});

test('propose tool fails without gates and returns lossless JSON', async () => {
  const root = makeProject();
  const previous = process.cwd();
  process.chdir(root);
  try {
    const { ctx, tools } = makeContext();
    apply(ctx, {});
    const propose = tools.find((tool) => tool.name === 'sg_propose');
    const result = await propose.execute(
      { name: 'blocked-change' },
      { agent: null, signal: new AbortController().signal },
    );
    assert.match(result.text, /缺少门控/);
    assert.equal('data' in result, false);
    assert.doesNotThrow(() => JSON.stringify(result));
  } finally {
    process.chdir(previous);
  }
});

test('commit tool commits dirty changes and status becomes clean', async () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, 'note.txt'), 'x\n');
  const previous = process.cwd();
  process.chdir(root);
  try {
    const { ctx, tools } = makeContext();
    apply(ctx, {});
    const commitTool = tools.find((tool) => tool.name === 'sg_commit');
    const result = await commitTool.execute(
      { message: 'test: add note' },
      { agent: null, signal: new AbortController().signal },
    );
    assert.match(result.text, /已提交/);
    assert.equal(result.data.committed, true);

    const statusTool = tools.find((tool) => tool.name === 'sg_status');
    const status = await statusTool.execute(
      {},
      { agent: null, signal: new AbortController().signal },
    );
    assert.match(status.text, /clean/);
  } finally {
    process.chdir(previous);
  }
});

test('status reports an uninitialized project and points to /sg-init', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-uninit-'));
  const previous = process.cwd();
  process.chdir(root);
  try {
    const { ctx, tools } = makeContext();
    apply(ctx, {});
    const statusTool = tools.find((tool) => tool.name === 'sg_status');
    const result = await statusTool.execute(
      {},
      { agent: null, signal: new AbortController().signal },
    );
    assert.match(result.text, /未初始化/);
    assert.match(result.text, /\/sg-init/);
  } finally {
    process.chdir(previous);
  }
});

test('classify apply allows L3 without G1 but blocks L1 without G1', async () => {
  const root = makeProject();
  const previous = process.cwd();
  process.chdir(root);
  try {
    const { ctx, tools } = makeContext();
    apply(ctx, {});
    const classify = tools.find((tool) => tool.name === 'sg_classify');
    const exec = { agent: null, signal: new AbortController().signal };

    const l3 = await classify.execute(
      { description: '修复登录报错', apply: true },
      exec,
    );
    assert.match(l3.text, /L3/);
    assert.equal(loadProject(root).paradigm, 'L3');
  } finally {
    process.chdir(previous);
  }

  const root2 = makeProject();
  process.chdir(root2);
  try {
    const { ctx, tools } = makeContext();
    apply(ctx, {});
    const classify = tools.find((tool) => tool.name === 'sg_classify');
    const l1 = await classify.execute(
      { description: '新增用户故事和验收标准', apply: true },
      { agent: null, signal: new AbortController().signal },
    );
    assert.match(l1.text, /G1 需求确认尚未通过/);
  } finally {
    process.chdir(previous);
  }
});
