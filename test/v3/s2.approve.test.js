import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { load } from '../../src/v3/state.js';
import { computeArtifactHash } from '../../src/v3/phase.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-s2-'));
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

现有系统没有问候语。

## 目标

新增问候语能力。

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

function writeArtifacts(root, change) {
  const dir = path.join(root, 'openspec', 'changes', change);
  fs.writeFileSync(path.join(dir, 'proposal.md'), PROPOSAL, 'utf8');
  fs.mkdirSync(path.join(dir, 'specs', 'greeting'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', 'greeting', 'spec.md'), DELTA, 'utf8');
}

async function bootstrap(root, services) {
  const { ctx } = setup(root, services);
  await callTool(ctx, 'sg_init');
  await callTool(ctx, 'sg_change', { name: 'add-greeting', type: 'feature' });
  writeArtifacts(root, 'add-greeting');
  return ctx;
}

test('M1 通过后提示审批', async () => {
  const root = tempRoot();
  const ctx = await bootstrap(root);
  const result = await callTool(ctx, 'sg_run');
  assert.match(result.text, /M1 通过/);
});

test('proposal 缺小节时 M1 失败', async () => {
  const root = tempRoot();
  const ctx = await bootstrap(root);
  const proposal = path.join(root, 'openspec', 'changes', 'add-greeting', 'proposal.md');
  fs.writeFileSync(proposal, '# 提案\n\n## 问题\n\n只有问题。\n', 'utf8');
  const result = await callTool(ctx, 'sg_run');
  assert.match(result.text, /M1 未通过/);
  assert.match(result.text, /目标/);
});

test('用户批准 H1 后进入 PLAN 并记录指纹', async () => {
  const root = tempRoot();
  const services = {
    userQuestions: {
      async ask() {
        return { answers: [{ selected: ['通过'] }] };
      },
    },
  };
  const ctx = await bootstrap(root, services);
  const result = await callTool(ctx, 'sg_approve', { gate: 'H1' });
  assert.match(result.text, /H1 已批准/);
  const state = load(root).state;
  assert.equal(state.phase, 'PLAN');
  assert.match(state.approvals.H1.artifactHash, /^sha256:/);
  assert.equal(state.baseline.specsBase, 'no-commit');
});

test('用户拒绝时保持 H1_PENDING', async () => {
  const root = tempRoot();
  const services = {
    userQuestions: {
      async ask() {
        return { answers: [{ selected: ['需要修改'] }] };
      },
    },
  };
  const ctx = await bootstrap(root, services);
  const result = await callTool(ctx, 'sg_approve', { gate: 'H1' });
  assert.match(result.text, /未批准/);
  assert.equal(load(root).state.phase, 'H1_PENDING');
});

test('宿主无问答通道时 fail-closed', async () => {
  const root = tempRoot();
  const ctx = await bootstrap(root);
  const result = await callTool(ctx, 'sg_approve', { gate: 'H1' });
  assert.match(result.text, /不提供用户问答通道/);
  assert.equal(load(root).state.phase, 'H1_PENDING');
});

test('M1 未通过时不允许批准', async () => {
  const root = tempRoot();
  const services = {
    userQuestions: {
      asked: 0,
      async ask() {
        this.asked += 1;
        return { answers: [{ selected: ['通过'] }] };
      },
    },
  };
  const ctx = await bootstrap(root, services);
  fs.rmSync(path.join(root, 'openspec', 'changes', 'add-greeting', 'specs'), {
    recursive: true,
    force: true,
  });
  const result = await callTool(ctx, 'sg_approve', { gate: 'H1' });
  assert.match(result.text, /M1 未通过/);
  assert.equal(services.userQuestions.asked, 0);
});

test('artifactHash 对换行不敏感、对内容敏感', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'c', 'specs', 'cap'), { recursive: true });
  const delta = '## ADDED Requirements\n\n### Requirement: 甲 (REQ-001)\n\n#### Scenario: 乙 (AC-001)\n';
  fs.writeFileSync(path.join(root, 'openspec', 'changes', 'c', 'proposal.md'), PROPOSAL, 'utf8');
  fs.writeFileSync(path.join(root, 'openspec', 'changes', 'c', 'specs', 'cap', 'spec.md'), delta, 'utf8');
  const first = computeArtifactHash({ root, change: 'c', specsBase: 'base' });
  fs.writeFileSync(
    path.join(root, 'openspec', 'changes', 'c', 'specs', 'cap', 'spec.md'),
    delta.replace(/\n/g, '\r\n'),
    'utf8',
  );
  const second = computeArtifactHash({ root, change: 'c', specsBase: 'base' });
  assert.equal(first, second);
  fs.appendFileSync(path.join(root, 'openspec', 'changes', 'c', 'proposal.md'), '\n补充。\n');
  const third = computeArtifactHash({ root, change: 'c', specsBase: 'base' });
  assert.notEqual(first, third);
});
