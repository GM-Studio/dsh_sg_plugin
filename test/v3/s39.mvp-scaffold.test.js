import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { load } from '../../src/v3/state.js';
import { readConfig } from '../../src/v3/change.js';
import { checkM1, checkM2 } from '../../src/v3/phase.js';
import { parseReqBaseline, reqDocPath } from '../../src/v3/requirements.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v39-'));
}

function setup(root, services = {}) {
  const tools = new Map();
  const ctx = {
    get: (name) => services[name],
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    toolsMap: tools,
  };
  const runtime = createRuntime(ctx, { root });
  registerTools(ctx, runtime);
  return ctx;
}

function questions() {
  return {
    async ask({ questions }) {
      const question = questions[0];
      const first = (question.options || [])[0];
      return {
        answers: [
          { selected: [question.id === 'sg-init-confirm' ? '确认' : first ? first.label : ''] },
        ],
      };
    },
  };
}

function draftFor(stack, extra = {}) {
  return {
    background: '演示',
    functional: [{ title: '文件上传与下载' }],
    nonFunctional: [{ title: 'P95 < 300ms' }],
    constraints: ['不引入数据库'],
    context: { stack, ...extra },
    team: '1-3 人',
    steps: '1) 框架 2) 业务',
  };
}

async function init(stack, extra = {}) {
  const root = tempRoot();
  const ctx = setup(root, { userQuestions: questions() });
  const result = await ctx.toolsMap
    .get('sg_init')
    .execute({ draft: draftFor(stack, extra) }, { agent: null });
  return { root, result };
}

test('v3.9：Java 新项目第一变更为 mvp-scaffold，REQ-001 是框架需求', async () => {
  const { root, result } = await init('java', {
    buildTool: 'maven',
    jdk: '8',
    bootVersion: '2.7.x',
    modules: 'minimal',
  });
  assert.match(result.text, /初始化完成：H1_PENDING/);
  assert.match(result.text, /首个 change：mvp-scaffold/);
  const state = load(root).state;
  assert.equal(state.change, 'mvp-scaffold');
  assert.equal(state.requirements.functional[0], 'MVP 框架与 Item CRUD 示例（框架基线）');
  assert.equal(state.requirements.functional[1], '文件上传与下载');

  const baseline = fs.readFileSync(reqDocPath(root), 'utf8');
  const { reqs, acs } = parseReqBaseline(baseline);
  assert.equal(reqs[0].id, 'REQ-001');
  assert.match(reqs[0].title, /MVP 框架与 Item CRUD 示例/);
  assert.match(baseline, /REQ-002 文件上传与下载/);
  assert.ok(acs.length >= 4, '基线应包含框架/业务/非功能/约束的 AC');

  const dir = path.join(root, 'openspec', 'changes', 'mvp-scaffold');
  assert.match(fs.readFileSync(path.join(dir, 'proposal.md'), 'utf8'), /MVP框架搭建/);
  const spec = fs.readFileSync(path.join(dir, 'specs', 'mvp', 'spec.md'), 'utf8');
  assert.match(spec, /REQ-001/);
  assert.equal(new Set(spec.match(/AC-\d{3}/g) || []).size, 10, '示例 change 应有 10 条 AC');
  const tasks = fs.readFileSync(path.join(dir, 'tasks.md'), 'utf8');
  assert.match(tasks, /T-001/);
  assert.match(tasks, /T-002/);
  assert.match(tasks, /T-003/);
  const mapping = JSON.parse(fs.readFileSync(path.join(dir, 'tests', 'mapping.json'), 'utf8'));
  assert.equal(mapping.requirements.length, 10);
  assert.ok(mapping.requirements.every((entry) => entry.covers.includes('REQ-001')));
  const touched = JSON.parse(fs.readFileSync(path.join(dir, 'tests', 'touched.json'), 'utf8'));
  assert.ok(touched.bootstrap.some((file) => file.endsWith('ItemController.java')));
  assert.ok(touched.bootstrap.some((file) => file.endsWith('ItemControllerTest.java')));

  assert.equal(checkM1({ root, state }).ok, true, JSON.stringify(checkM1({ root, state }).errors));
});

test('v3.9：Node / Python 生成对应的 CRUD 任务与测试文件', async () => {
  for (const [stack, testFile, suite] of [
    ['node', 'test/items.test.mjs', 'api'],
    ['python', 'tests/test_items.py', 'api'],
  ]) {
    const { root, result } = await init(stack);
    assert.match(result.text, /首个 change：mvp-scaffold/, stack);
    const dir = path.join(root, 'openspec', 'changes', 'mvp-scaffold');
    const touched = JSON.parse(fs.readFileSync(path.join(dir, 'tests', 'touched.json'), 'utf8'));
    assert.ok(
      [...touched.bootstrap, ...touched.modify].includes(testFile),
      stack + ' 缺少 ' + testFile,
    );
    const mapping = JSON.parse(fs.readFileSync(path.join(dir, 'tests', 'mapping.json'), 'utf8'));
    assert.ok(
      mapping.requirements.every((entry) => entry.suite === suite),
      stack,
    );
    const state = load(root).state;
    const m1 = checkM1({ root, state });
    assert.equal(m1.ok, true, stack + ' M1: ' + JSON.stringify(m1.errors));
    const m2 = checkM2({ root, state, config: readConfig(root) });
    assert.equal(m2.ok, true, stack + ' M2: ' + JSON.stringify(m2.errors));
  }
});

test('v3.9：非后端栈保持 add-version，且不注入框架需求', async () => {
  const { root, result } = await init('vue');
  assert.match(result.text, /首个 change：add-version/);
  const state = load(root).state;
  assert.equal(state.change, 'add-version');
  assert.equal(state.requirements.functional[0], '文件上传与下载');
  assert.equal(fs.existsSync(path.join(root, 'openspec', 'changes', 'mvp-scaffold')), false);
});

test('v3.9：既有项目不注入框架需求、不生成 mvp-scaffold', async () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"legacy"}\n', 'utf8');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const x = 1;\n', 'utf8');
  const ctx = setup(root, { userQuestions: questions() });
  const result = await ctx.toolsMap.get('sg_init').execute(
    {
      draft: {
        background: 'legacy',
        functional: [{ title: '既有功能' }],
        nonFunctional: [],
        constraints: [],
        confirmedEmpty: ['nonFunctional', 'constraints'],
        context: { stack: 'node' },
      },
    },
    { agent: null },
  );
  assert.match(result.text, /既有项目：未生成脚手架/);
  assert.equal(load(root).state.change, null);
  assert.equal(fs.existsSync(path.join(root, 'openspec', 'changes', 'mvp-scaffold')), false);
  assert.equal(
    load(root).state.requirements.functional.includes('MVP 框架与 Item CRUD 示例（框架基线）'),
    false,
  );
});
