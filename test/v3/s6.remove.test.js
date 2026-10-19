import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { load } from '../../src/v3/state.js';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function commitAll(cwd, message) {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

const BASE_SPEC = `# greeting

### Requirement: 问候语 (REQ-001)

系统 SHALL 返回问候语。

#### Scenario: 已有问候 (AC-001)

- **WHEN** 调用 greeting()
- **THEN** 返回 hello
`;

const REPORTER = `import fs from 'node:fs';
fs.writeFileSync(process.env.SG_REPORT, JSON.stringify({ schemaVersion: 1, cases: [] }));
`;

function initFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-remove-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.mkdirSync(path.join(root, 'openspec', 'specs', 'greeting'), { recursive: true });
  fs.writeFileSync(path.join(root, 'openspec', 'specs', 'greeting', 'spec.md'), BASE_SPEC, 'utf8');
  fs.mkdirSync(path.join(root, 'tests', 'automation'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'tests', 'automation', 'legacy.test.mjs'),
    'export {};\n',
    'utf8',
  );
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'greeting.js'),
    "export const greeting = () => 'hello';\n",
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, type: 'module' }, null, 2),
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'reporter.mjs'), REPORTER, 'utf8');
  commitAll(root, 'init fixture');
  return root;
}

function makeCtx() {
  const tools = new Map();
  return {
    get: (name) =>
      name === 'userQuestions'
        ? {
            async ask() {
              return { answers: [{ selected: ['通过'] }] };
            },
          }
        : undefined,
    tools: {
      register(definition) {
        tools.set(definition.name, definition);
        return () => tools.delete(definition.name);
      },
    },
    toolsMap: tools,
  };
}

async function call(ctx, name, args = {}) {
  return ctx.toolsMap.get(name).execute(args, { agent: null });
}

const PROPOSAL = `# 提案

## 问题
问候能力不再需要。
## 目标
删除该能力与测试。
## 非目标
不删其他能力。
## 影响面
src/greeting.js、tests/automation/legacy.test.mjs
`;

const DELTA = `## REMOVED Requirements

### Requirement: 问候语 (REQ-001)

理由：能力下线。
`;

const DESIGN = `# 方案

## 目标与非目标
删除问候。
## 任务图
T-001。
## AC 到用例
已删除的 AC 不再有用例。
## 风险
无。
`;

const TASKS = `# 任务

## T-001 删除问候
<!-- sg:task {"id":"T-001","title":"删除问候","ac":[],"deps":[],"parallel":false} -->
- [ ] 删除实现与测试
`;

const CASES = `| 用例 | AC | 层次 | 描述 |
|---|---|---|---|
`;

function writePlan(root) {
  const dir = path.join(root, 'openspec', 'changes', 'remove-greeting');
  fs.writeFileSync(path.join(dir, 'design.md'), DESIGN, 'utf8');
  fs.writeFileSync(path.join(dir, 'tasks.md'), TASKS, 'utf8');
  fs.writeFileSync(path.join(dir, 'tests', 'cases.md'), CASES, 'utf8');
  fs.writeFileSync(
    path.join(dir, 'tests', 'mapping.json'),
    JSON.stringify(
      { schemaVersion: 1, change: 'remove-greeting', requirements: [], automation: [] },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'tests', 'touched.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        modify: [],
        delete: ['tests/automation/legacy.test.mjs'],
        bootstrap: [],
      },
      null,
      2,
    ),
    'utf8',
  );
}

function runner({ role, worktree }) {
  if (role === 'implementer') {
    fs.rmSync(path.join(worktree, 'src', 'greeting.js'), { force: true });
    commitAll(worktree, 'remove implementation');
    return { ok: true, text: 'removed' };
  }
  if (role === 'tester') {
    fs.rmSync(path.join(worktree, 'tests', 'automation', 'legacy.test.mjs'), { force: true });
    commitAll(worktree, 'remove legacy test');
    return { ok: true, text: 'test removed' };
  }
  if (role === 'reviewer') {
    return { ok: true, text: JSON.stringify({ verdict: 'pass', blocking: [], nonBlocking: [] }) };
  }
  return { ok: false, message: `unknown role ${role}` };
}

async function bootstrap(root) {
  const ctx = makeCtx();
  const runtime = createRuntime(ctx, { root, agentRunner: runner });
  registerTools(ctx, runtime);
  await call(ctx, 'sg_init');
  const config = path.join(root, '.specgate', 'config.yaml');
  fs.writeFileSync(
    config,
    fs
      .readFileSync(config, 'utf8')
      .replace(
        'command: []',
        `command: ["${process.execPath.replace(/\\/g, '/')}","reporter.mjs"]`,
      ),
    'utf8',
  );
  await call(ctx, 'sg_change', { name: 'remove-greeting', type: 'remove' });
  const dir = path.join(root, 'openspec', 'changes', 'remove-greeting');
  fs.writeFileSync(path.join(dir, 'proposal.md'), PROPOSAL, 'utf8');
  fs.mkdirSync(path.join(dir, 'specs', 'greeting'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'greeting', 'spec.md'), DELTA, 'utf8');
  await call(ctx, 'sg_approve', { gate: 'H1' });
  writePlan(root);
  await call(ctx, 'sg_run');
  await call(ctx, 'sg_approve', { gate: 'H2' });
  return ctx;
}

test('S6：remove 删除实现、测试并从 specs 移除需求', async () => {
  const root = initFixture();
  const ctx = await bootstrap(root);

  const task = await call(ctx, 'sg_run');
  assert.match(task.text, /已合并/);

  await call(ctx, 'sg_run');
  const integrated = await call(ctx, 'sg_run');
  assert.match(integrated.text, /验收报告已生成/);
  await call(ctx, 'sg_approve', { gate: 'H3' });
  const archived = await call(ctx, 'sg_run');
  assert.match(archived.text, /归档完成/);

  const spec = fs.readFileSync(path.join(root, 'openspec', 'specs', 'greeting', 'spec.md'), 'utf8');
  assert.doesNotMatch(spec, /REQ-001/);
  assert.equal(fs.existsSync(path.join(root, 'src', 'greeting.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'tests', 'automation', 'legacy.test.mjs')), false);

  const state = load(root).state;
  assert.equal(state.phase, 'DONE');
});
