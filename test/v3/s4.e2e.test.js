import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { load } from '../../src/v3/state.js';
import { verifyEvidence } from '../../src/v3/evidence.js';

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

const REPORTER = `import fs from 'node:fs';
const file = 'openspec/changes/add-greeting/tests/automation/greeting.test.mjs';
fs.writeFileSync(process.env.SG_REPORT, JSON.stringify({
  schemaVersion: 1,
  cases: [{ id: 'TC-001', ac: ['AC-001'], status: 'pass', file }],
}));
`;

function initFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-e2e-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, type: 'module' }, null, 2),
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'reporter.mjs'), REPORTER, 'utf8');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'placeholder.js'), 'export const x = 0;\n', 'utf8');
  commitAll(root, 'init fixture');
  return root;
}

function makeRunner() {
  return async ({ role, worktree }) => {
    if (role === 'implementer') {
      fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(worktree, 'src', 'greeting.js'),
        "export const greeting = () => 'hello';\n",
        'utf8',
      );
      commitAll(worktree, 'implement greeting');
      return { ok: true, text: 'implemented', commit: git(worktree, ['rev-parse', 'HEAD']) };
    }
    if (role === 'tester') {
      const file = path.join(
        worktree,
        'openspec',
        'changes',
        'add-greeting',
        'tests',
        'automation',
        'greeting.test.mjs',
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'export const ok = true;\n', 'utf8');
      commitAll(worktree, 'add automation');
      return { ok: true, text: 'test added' };
    }
    if (role === 'reviewer') {
      return {
        ok: true,
        text: JSON.stringify({ verdict: 'pass', blocking: [], nonBlocking: [] }),
      };
    }
    return { ok: false, message: `unknown role ${role}` };
  };
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
T-001。
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

const CASES = `| 用例 | AC | 层次 | 描述 |
|---|---|---|---|
| TC-001 | AC-001 | unit | 默认问候 |
`;

const MAPPING = {
  schemaVersion: 1,
  change: 'add-greeting',
  requirements: [{ ac: 'AC-001', covers: ['REQ-001'], tasks: ['T-001'], cases: ['TC-001'] }],
  automation: [],
};

function writePlan(root) {
  const dir = path.join(root, 'openspec', 'changes', 'add-greeting');
  fs.writeFileSync(path.join(dir, 'design.md'), DESIGN, 'utf8');
  fs.writeFileSync(path.join(dir, 'tasks.md'), TASKS, 'utf8');
  fs.writeFileSync(path.join(dir, 'tests', 'cases.md'), CASES, 'utf8');
  fs.writeFileSync(
    path.join(dir, 'tests', 'mapping.json'),
    JSON.stringify(MAPPING, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'tests', 'touched.json'),
    JSON.stringify({ schemaVersion: 1, modify: [], delete: [], bootstrap: [] }, null, 2),
    'utf8',
  );
}

async function bootstrap(root) {
  const ctx = makeCtx();
  const runtime = createRuntime(ctx, { root, agentRunner: makeRunner() });
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
  await call(ctx, 'sg_change', { name: 'add-greeting', type: 'feature' });
  const dir = path.join(root, 'openspec', 'changes', 'add-greeting');
  fs.writeFileSync(path.join(dir, 'proposal.md'), PROPOSAL, 'utf8');
  fs.mkdirSync(path.join(dir, 'specs', 'greeting'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'greeting', 'spec.md'), DELTA, 'utf8');
  await call(ctx, 'sg_approve', { gate: 'H1' });
  writePlan(root);
  await call(ctx, 'sg_run');
  await call(ctx, 'sg_approve', { gate: 'H2' });
  return ctx;
}

test('S4：feature 单任务从实现到合并并写 [x]', async () => {
  const root = initFixture();
  const ctx = await bootstrap(root);
  const result = await call(ctx, 'sg_run');
  assert.match(result.text, /已合并/);

  const state = load(root).state;
  assert.equal(state.tasks['T-001'].status, 'merged');
  assert.equal(state.phase, 'EXECUTING');

  const integrationTasks = path.join(
    root,
    '.specgate',
    'worktrees',
    'add-greeting',
    'integration',
    'openspec',
    'changes',
    'add-greeting',
    'tasks.md',
  );
  assert.match(fs.readFileSync(integrationTasks, 'utf8'), /- \[x\]/);

  const evidence = verifyEvidence(root, 'add-greeting');
  assert.equal(evidence.ok, true);
  assert.ok(evidence.count >= 1);

  const integrationSrc = path.join(
    root,
    '.specgate',
    'worktrees',
    'add-greeting',
    'integration',
    'src',
    'greeting.js',
  );
  assert.equal(fs.existsSync(integrationSrc), true);
});

test('S4：测试失败时不合并、不勾选', async () => {
  const root = initFixture();
  const ctx = makeCtx();
  const failingRunner = async ({ role, worktree }) => {
    if (role === 'implementer') {
      fs.writeFileSync(path.join(worktree, 'src', 'greeting.js'), 'export const x = 1;\n', 'utf8');
      commitAll(worktree, 'impl');
      return { ok: true, text: 'done' };
    }
    if (role === 'tester') {
      const file = path.join(
        worktree,
        'openspec',
        'changes',
        'add-greeting',
        'tests',
        'automation',
        'greeting.test.mjs',
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'export const ok = false;\n', 'utf8');
      commitAll(worktree, 'test');
      return { ok: true, text: 'done' };
    }
    return { ok: true, text: '{"verdict":"pass","blocking":[]}' };
  };
  const runtime = createRuntime(ctx, { root, agentRunner: failingRunner });
  registerTools(ctx, runtime);
  await call(ctx, 'sg_init');
  const config = path.join(root, '.specgate', 'config.yaml');
  fs.writeFileSync(
    config,
    fs
      .readFileSync(config, 'utf8')
      .replace(
        'command: []',
        `command: ["${process.execPath.replace(/\\/g, '/')}","-e","process.exit(1)"]`,
      ),
    'utf8',
  );
  await call(ctx, 'sg_change', { name: 'add-greeting', type: 'feature' });
  const dir = path.join(root, 'openspec', 'changes', 'add-greeting');
  fs.writeFileSync(path.join(dir, 'proposal.md'), PROPOSAL, 'utf8');
  fs.mkdirSync(path.join(dir, 'specs', 'greeting'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'greeting', 'spec.md'), DELTA, 'utf8');
  await call(ctx, 'sg_approve', { gate: 'H1' });
  writePlan(root);
  await call(ctx, 'sg_run');
  await call(ctx, 'sg_approve', { gate: 'H2' });
  const result = await call(ctx, 'sg_run');
  assert.match(result.text, /失败/);
  const state = load(root).state;
  assert.equal(state.tasks['T-001'].status, 'failed');
  assert.equal(state.tasks['T-001'].commit, null);
});

test('S5：集成回归、H3 与归档', async () => {
  const root = initFixture();
  const ctx = await bootstrap(root);

  const task = await call(ctx, 'sg_run');
  assert.match(task.text, /已合并/);

  const transition = await call(ctx, 'sg_run');
  assert.match(transition.text, /进入 INTEGRATING/);

  const integrated = await call(ctx, 'sg_run');
  assert.match(integrated.text, /验收报告已生成/);
  let state = load(root).state;
  assert.equal(state.phase, 'H3_PENDING');

  const approved = await call(ctx, 'sg_approve', { gate: 'H3' });
  assert.match(approved.text, /H3 已批准/);

  const archived = await call(ctx, 'sg_run');
  assert.match(archived.text, /归档完成/);

  state = load(root).state;
  assert.equal(state.phase, 'DONE');

  const tags = git(root, ['tag', '-l', 'sg-v0.*']).split('\n').filter(Boolean);
  assert.deepEqual(tags, ['sg-v0.1']);

  const spec = fs.readFileSync(path.join(root, 'openspec', 'specs', 'greeting', 'spec.md'), 'utf8');
  assert.match(spec, /REQ-001/);

  const archiveRoot = path.join(root, 'openspec', 'changes', 'archive');
  const entries = fs.readdirSync(archiveRoot);
  assert.ok(entries.some((name) => name.endsWith('-add-greeting')));
});
