import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { load } from '../../src/v3/state.js';
import { checkFrozenH2 } from '../../src/v3/phase.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-s3-'));
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

const PROPOSAL = `# 提案

## 问题
没有问候语。
## 目标
新增问候。
## 非目标
不做多语言。
## 影响面
src/greeting.js
`;

const DELTA = `## ADDED Requirements

### Requirement: 问候语 (REQ-001)

系统 SHALL 返回问候语。

#### Scenario: 默认问候 (AC-001)

- **WHEN** 调用 greeting()
- **THEN** 返回 hello
`;

const DESIGN = `# 方案

## 目标与非目标
新增 greeting()。
## 任务图
T-001 单独执行。
## AC 到用例
AC-001 -> TC-001。
## 风险
无。
`;

const TASKS = `# 任务

## T-001 实现问候
<!-- sg:task {"id":"T-001","title":"实现问候","ac":["AC-001"],"deps":[],"parallel":false} -->
- [ ] 实现
`;

const CASES = `# 用例

| 用例 | AC | 层次 | 描述 |
|---|---|---|---|
| TC-001 | AC-001 | unit | 默认问候 |
`;

const MAPPING = {
  schemaVersion: 1,
  change: 'add-greeting',
  requirements: [
    { ac: 'AC-001', covers: ['REQ-001'], tasks: ['T-001'], cases: ['TC-001'] },
  ],
  automation: [],
};

const TOUCHED = { schemaVersion: 1, modify: [], delete: [], bootstrap: [] };

function baseDir(root) {
  return path.join(root, 'openspec', 'changes', 'add-greeting');
}

function writePlan(root, overrides = {}) {
  const dir = baseDir(root);
  fs.writeFileSync(path.join(dir, 'design.md'), overrides.design ?? DESIGN, 'utf8');
  fs.writeFileSync(path.join(dir, 'tasks.md'), overrides.tasks ?? TASKS, 'utf8');
  fs.writeFileSync(path.join(dir, 'tests', 'cases.md'), overrides.cases ?? CASES, 'utf8');
  fs.writeFileSync(
    path.join(dir, 'tests', 'mapping.json'),
    JSON.stringify(overrides.mapping ?? MAPPING, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'tests', 'touched.json'),
    JSON.stringify(overrides.touched ?? TOUCHED, null, 2),
    'utf8',
  );
}

function configureTestCommand(root) {
  const file = path.join(root, '.specgate', 'config.yaml');
  const text = fs.readFileSync(file, 'utf8').replace('command: []', 'command: ["node", "--test"]');
  fs.writeFileSync(file, text, 'utf8');
}

async function bootstrap(root) {
  const services = {
    userQuestions: {
      async ask() {
        return { answers: [{ selected: ['通过'] }] };
      },
    },
  };
  const { ctx } = setup(root, services);
  await callTool(ctx, 'sg_init');
  configureTestCommand(root);
  await callTool(ctx, 'sg_change', { name: 'add-greeting', type: 'feature' });
  const dir = baseDir(root);
  fs.writeFileSync(path.join(dir, 'proposal.md'), PROPOSAL, 'utf8');
  fs.mkdirSync(path.join(dir, 'specs', 'greeting'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'greeting', 'spec.md'), DELTA, 'utf8');
  await callTool(ctx, 'sg_approve', { gate: 'H1' });
  writePlan(root);
  return ctx;
}

test('M2 通过后冻结计划并进入 H2_PENDING', async () => {
  const root = tempRoot();
  const ctx = await bootstrap(root);
  const result = await callTool(ctx, 'sg_run');
  assert.match(result.text, /M2 通过/);
  const state = load(root).state;
  assert.equal(state.phase, 'H2_PENDING');
  assert.match(state.plan.planHash, /^sha256:/);
  assert.deepEqual(state.plan.argv, ['node', '--test']);
});

test('H2 批准后进入 EXECUTING 并记录计划指纹', async () => {
  const root = tempRoot();
  const ctx = await bootstrap(root);
  await callTool(ctx, 'sg_run');
  const result = await callTool(ctx, 'sg_approve', { gate: 'H2' });
  assert.match(result.text, /H2 已批准/);
  const state = load(root).state;
  assert.equal(state.phase, 'EXECUTING');
  assert.match(state.approvals.H2.artifactHash, /^sha256:/);
});

test('mapping 漏掉 AC 时 M2 失败', async () => {
  const root = tempRoot();
  const ctx = await bootstrap(root);
  writePlan(root, { mapping: { ...MAPPING, requirements: [] } });
  const result = await callTool(ctx, 'sg_run');
  assert.match(result.text, /M2 未通过/);
  assert.match(result.text, /mapping 未覆盖 AC-001/);
});

test('任务依赖成环时 M2 失败', async () => {
  const root = tempRoot();
  const ctx = await bootstrap(root);
  const tasks = `# 任务

## T-001
<!-- sg:task {"id":"T-001","title":"甲","ac":["AC-001"],"deps":["T-002"],"parallel":false} -->
- [ ] 甲

## T-002
<!-- sg:task {"id":"T-002","title":"乙","ac":["AC-001"],"deps":["T-001"],"parallel":false} -->
- [ ] 乙
`;
  writePlan(root, { tasks });
  const result = await callTool(ctx, 'sg_run');
  assert.match(result.text, /M2 未通过/);
  assert.match(result.text, /成环/);
});

test('cases 引用不存在的 AC 时 M2 失败', async () => {
  const root = tempRoot();
  const ctx = await bootstrap(root);
  writePlan(root, {
    cases: '| 用例 | AC | 层次 | 描述 |\n|---|---|---|---|\n| TC-001 | AC-999 | unit | x |\n',
  });
  const result = await callTool(ctx, 'sg_run');
  assert.match(result.text, /M2 未通过/);
  assert.match(result.text, /AC-999/);
});

test('H2 后修改 cases 使冻结失效', async () => {
  const root = tempRoot();
  const ctx = await bootstrap(root);
  await callTool(ctx, 'sg_run');
  const casesFile = path.join(baseDir(root), 'tests', 'cases.md');
  fs.appendFileSync(casesFile, '\n| TC-002 | AC-001 | unit | 追加 |\n');
  const state = load(root).state;
  const frozen = checkFrozenH2({ root, state });
  assert.equal(frozen.ok, false);
  assert.equal(frozen.gate, 'H2');
});

test('H2 后修改 design 使冻结失效', async () => {
  const root = tempRoot();
  const ctx = await bootstrap(root);
  await callTool(ctx, 'sg_run');
  fs.appendFileSync(path.join(baseDir(root), 'design.md'), '\n追加说明。\n');
  const state = load(root).state;
  assert.equal(checkFrozenH2({ root, state }).ok, false);
});
