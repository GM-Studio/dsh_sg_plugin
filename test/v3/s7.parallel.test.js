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

const REPORTER = `import fs from 'node:fs';
const dir = 'openspec/changes/par-change/tests/automation';
const file = dir + '/' + fs.readdirSync(dir)[0];
fs.writeFileSync(process.env.SG_REPORT, JSON.stringify({
  schemaVersion: 1,
  cases: [
    { id: 'TC-001', ac: ['AC-001'], status: 'pass', file },
    { id: 'TC-002', ac: ['AC-002'], status: 'pass', file },
  ],
}));
`;

function initFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-par-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'base.js'), 'export const base = 0;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'reporter.mjs'), REPORTER, 'utf8');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true, type: 'module' }, null, 2),
    'utf8',
  );
  commitAll(root, 'init');
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
缺两个小能力。
## 目标
新增 a 与 b。
## 非目标
不做 c。
## 影响面
src/a.js、src/b.js
`;

const DELTA = `## ADDED Requirements

### Requirement: 能力集 (REQ-001)

系统 SHALL 提供 a 与 b。

#### Scenario: a 可用 (AC-001)

- **WHEN** 调用 a
- **THEN** 返回 1

#### Scenario: b 可用 (AC-002)

- **WHEN** 调用 b
- **THEN** 返回 2
`;

const DESIGN = `# 方案

## 目标与非目标
新增 a 与 b。
## 任务图
T-001 与 T-002 并行。
## AC 到用例
AC-001 -> TC-001，AC-002 -> TC-002。
## 风险
无。
`;

const TASKS = `# 任务

## T-001 实现 a
<!-- sg:task {"id":"T-001","title":"实现 a","ac":["AC-001"],"deps":[],"parallel":true} -->
- [ ] 实现 a

## T-002 实现 b
<!-- sg:task {"id":"T-002","title":"实现 b","ac":["AC-002"],"deps":[],"parallel":true} -->
- [ ] 实现 b
`;

const CASES = `| 用例 | AC | 层次 | 描述 |
|---|---|---|---|
| TC-001 | AC-001 | unit | a |
| TC-002 | AC-002 | unit | b |
`;

function writePlan(root) {
  const dir = path.join(root, 'openspec', 'changes', 'par-change');
  fs.writeFileSync(path.join(dir, 'design.md'), DESIGN, 'utf8');
  fs.writeFileSync(path.join(dir, 'tasks.md'), TASKS, 'utf8');
  fs.writeFileSync(path.join(dir, 'tests', 'cases.md'), CASES, 'utf8');
  fs.writeFileSync(
    path.join(dir, 'tests', 'mapping.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        change: 'par-change',
        requirements: [
          { ac: 'AC-001', covers: ['REQ-001'], tasks: ['T-001'], cases: ['TC-001'] },
          { ac: 'AC-002', covers: ['REQ-001'], tasks: ['T-002'], cases: ['TC-002'] },
        ],
        automation: [],
      },
      null,
      2,
    ),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'tests', 'touched.json'),
    JSON.stringify({ schemaVersion: 1, modify: [], delete: [], bootstrap: [] }, null, 2),
    'utf8',
  );
}

async function bootstrap(root, runner) {
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
  await call(ctx, 'sg_change', { name: 'par-change', type: 'feature' });
  const dir = path.join(root, 'openspec', 'changes', 'par-change');
  fs.writeFileSync(path.join(dir, 'proposal.md'), PROPOSAL, 'utf8');
  fs.mkdirSync(path.join(dir, 'specs', 'cap'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'cap', 'spec.md'), DELTA, 'utf8');
  await call(ctx, 'sg_approve', { gate: 'H1' });
  writePlan(root);
  await call(ctx, 'sg_run');
  await call(ctx, 'sg_approve', { gate: 'H2' });
  return ctx;
}

test('S7：两个 [P] 任务并行执行并各自合并', async () => {
  const root = initFixture();
  let active = 0;
  let maxActive = 0;
  const seenSkills = {};
  const runner = async ({ role, task, worktree, skills }) => {
    seenSkills[role] = (skills || []).map((item) => item.id);
    if (role === 'implementer') {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 80));
      fs.writeFileSync(
        path.join(worktree, 'src', `${task.id}.js`),
        'export const x = 1;\n',
        'utf8',
      );
      commitAll(worktree, `impl ${task.id}`);
      active -= 1;
      return { ok: true, text: 'done' };
    }
    if (role === 'tester') {
      const file = path.join(
        worktree,
        'openspec',
        'changes',
        'par-change',
        'tests',
        'automation',
        `${task.id}.test.mjs`,
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'export {};\n', 'utf8');
      commitAll(worktree, `test ${task.id}`);
      return { ok: true, text: 'done' };
    }
    return { ok: true, text: JSON.stringify({ verdict: 'pass', blocking: [] }) };
  };

  const ctx = await bootstrap(root, runner);
  const result = await call(ctx, 'sg_run');
  assert.equal(result.data?.results?.length, 2, result.text);

  const state = load(root).state;
  assert.equal(state.tasks['T-001'].status, 'merged');
  assert.equal(state.tasks['T-002'].status, 'merged');
  assert.ok(maxActive >= 2, `并行度不足：${maxActive}`);
  assert.ok(seenSkills.implementer?.includes('sg-skill-test-driven-development'));
  assert.ok(seenSkills.reviewer?.includes('sg-skill-code-review'));
});
