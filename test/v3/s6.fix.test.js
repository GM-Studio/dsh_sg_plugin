import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { load } from '../../src/v3/state.js';
import { initProject } from '../../src/v3/change.js';

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
- **THEN** 返回非空字符串
`;

const REPORTER = `import fs from 'node:fs';
const src = fs.readFileSync('src/greeting.js', 'utf8');
const ok = src.includes("'hello'");
const file = 'openspec/changes/fix-greeting/tests/automation/repro.test.mjs';
fs.writeFileSync(process.env.SG_REPORT, JSON.stringify({
  schemaVersion: 1,
  cases: [
    { id: 'TC-001', ac: ['AC-001'], status: 'pass', file },
    { id: 'TC-002', ac: ['AC-002'], status: ok ? 'pass' : 'fail', file },
  ],
}));
process.exit(ok ? 0 : 1);
`;

function initFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-fix-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.mkdirSync(path.join(root, 'openspec', 'specs', 'greeting'), { recursive: true });
  fs.writeFileSync(path.join(root, 'openspec', 'specs', 'greeting', 'spec.md'), BASE_SPEC, 'utf8');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, type: 'module' }, null, 2),
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'reporter.mjs'), REPORTER, 'utf8');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'greeting.js'),
    "export const greeting = () => 'hi';\n",
    'utf8',
  );
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
greeting 返回 hi，期望 hello。
## 目标
返回 hello。
## 非目标
不改接口。
## 影响面
src/greeting.js
`;

const DELTA = `## MODIFIED Requirements

### Requirement: 问候语 (REQ-001)

系统 SHALL 返回 hello。

#### Scenario: 已有问候 (AC-001)

- **WHEN** 调用 greeting()
- **THEN** 返回非空字符串

#### Scenario: 修复后返回 hello (AC-002)

- **WHEN** 调用 greeting()
- **THEN** 返回 hello
`;

const DESIGN = `# 方案

## 目标与非目标
修 greeting。
## 任务图
T-001。
## AC 到用例
AC-001 -> TC-001，AC-002 -> TC-002。
## 风险
无。
`;

const TASKS = `# 任务

## T-001 修复问候
<!-- sg:task {"id":"T-001","title":"修复问候","ac":["AC-001","AC-002"],"deps":[],"parallel":false} -->
- [ ] 修复
`;

const CASES = `| 用例 | AC | 层次 | 描述 |
|---|---|---|---|
| TC-001 | AC-001 | unit | 已有问候 |
| TC-002 | AC-002 | unit | 返回 hello |
`;

const MAPPING = {
  schemaVersion: 1,
  change: 'fix-greeting',
  requirements: [
    { ac: 'AC-001', covers: ['REQ-001'], tasks: ['T-001'], cases: ['TC-001'] },
    { ac: 'AC-002', covers: ['REQ-001'], tasks: ['T-001'], cases: ['TC-002'] },
  ],
  automation: [],
};

function writePlan(root) {
  const dir = path.join(root, 'openspec', 'changes', 'fix-greeting');
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

function runner({ role, worktree }) {
  if (role === 'tester') {
    const file = path.join(
      worktree,
      'openspec',
      'changes',
      'fix-greeting',
      'tests',
      'automation',
      'repro.test.mjs',
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'export const ok = true;\n', 'utf8');
    commitAll(worktree, 'add repro');
    return { ok: true, text: 'repro added' };
  }
  if (role === 'implementer') {
    fs.writeFileSync(
      path.join(worktree, 'src', 'greeting.js'),
      "export const greeting = () => 'hello';\n",
      'utf8',
    );
    commitAll(worktree, 'fix greeting');
    return { ok: true, text: 'fixed' };
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
  initProject(root);
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
  await call(ctx, 'sg_change', { name: 'fix-greeting', type: 'fix' });
  const dir = path.join(root, 'openspec', 'changes', 'fix-greeting');
  fs.writeFileSync(path.join(dir, 'proposal.md'), PROPOSAL, 'utf8');
  fs.mkdirSync(path.join(dir, 'specs', 'greeting'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'greeting', 'spec.md'), DELTA, 'utf8');
  await call(ctx, 'sg_approve', { gate: 'H1' });
  writePlan(root);
  await call(ctx, 'sg_run');
  await call(ctx, 'sg_approve', { gate: 'H2' });
  return ctx;
}

test('S6：fix 先红后绿并归档更新 specs', async () => {
  const root = initFixture();
  const ctx = await bootstrap(root);

  const task = await call(ctx, 'sg_run');
  assert.match(task.text, /已合并/);
  const state = load(root).state;
  assert.equal(state.tasks['T-001'].status, 'merged');

  await call(ctx, 'sg_run');
  const integrated = await call(ctx, 'sg_run');
  assert.match(integrated.text, /验收报告已生成/);
  await call(ctx, 'sg_approve', { gate: 'H3' });
  const archived = await call(ctx, 'sg_run');
  assert.match(archived.text, /归档完成/);

  const spec = fs.readFileSync(path.join(root, 'openspec', 'specs', 'greeting', 'spec.md'), 'utf8');
  assert.match(spec, /AC-002/);
  assert.match(spec, /返回 hello/);
});
