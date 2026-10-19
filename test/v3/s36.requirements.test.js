import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { registerCommands } from '../../src/v3/commands.js';
import { load } from '../../src/v3/state.js';
import { initProject, patchConfigRequirements, readConfig } from '../../src/v3/change.js';
import {
  historyReqPath,
  isRequirementsFrozen,
  parseReqBaseline,
  reqDocPath,
} from '../../src/v3/requirements.js';
import { checkWrite } from '../../src/v3/guards.js';

const REQ_KEYS = ['functional', 'nonFunctional', 'constraints', 'acceptance'];
const REQ_ANSWERS = {
  functional: '用户可注册并登录',
  nonFunctional: '接口 P95 响应时间小于 300ms',
  constraints: '不引入付费第三方服务',
  acceptance: '登录成功返回 200',
};

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-req-'));
}

function makeCtx(services = {}) {
  const tools = new Map();
  const commands = new Map();
  return {
    get: (name) => services[name],
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

function setup(root, services = {}) {
  const ctx = makeCtx(services);
  const runtime = createRuntime(ctx, { root });
  registerTools(ctx, runtime);
  registerCommands(ctx, runtime);
  return { ctx, runtime };
}

async function callTool(ctx, name, args = {}) {
  const definition = ctx.toolsMap.get(name);
  assert.ok(definition, 'tool ' + name + ' not registered');
  return definition.execute(args, { agent: null });
}

function fakeQuestions({ stack = 'node', approval = '通过' } = {}) {
  const asked = [];
  const calls = [];
  return {
    asked,
    calls,
    async ask({ questions }) {
      // 审批页可能一次给多页：最后一页才是真正的“通过/需要修改”。
      const answers = questions.map((question, index) => {
        asked.push(question.id);
        calls.push({
          id: question.id,
          text: question.question,
          options: question.options || [],
        });
        if (question.id.startsWith('sg-init-req-')) {
          const key = question.id.slice('sg-init-req-'.length);
          return { selected: [REQ_ANSWERS[key] || '跳过'] };
        }
        if (question.id === 'sg-init-h0') return { selected: ['确认'] };
        if (question.id === 'sg-init-stack') return { selected: [stack] };
        if (question.id.startsWith('sg-approve-')) {
          const isLast = index === questions.length - 1;
          return { selected: [isLast ? approval : '已读'] };
        }
        const preferred = (question.options || []).find((option) => option.label !== '跳过');
        return { selected: [preferred ? preferred.label : '跳过'] };
      });
      return { answers };
    },
  };
}

function git(cwd, args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=SpecGate', '-c', 'user.email=specgate@local', ...args],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function legacyRoot() {
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, 'package.json'),
    '{"name":"legacy-app","version":"1.0.0"}\n',
    'utf8',
  );
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'index.js'),
    "export function hello() {\n  return 'hello';\n}\n",
    'utf8',
  );
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'chore: 初始提交']);
  return root;
}

test('REQ-001/REQ-002：需求盘问严格先于技术栈，四个维度齐全', async () => {
  const root = tempRoot();
  const userQuestions = fakeQuestions();
  const { ctx } = setup(root, { userQuestions });
  const result = await callTool(ctx, 'sg_init');
  assert.match(result.text, /H0_PENDING/);

  const reqIds = userQuestions.asked.filter((id) => id.startsWith('sg-init-req-'));
  assert.deepEqual(
    reqIds,
    REQ_KEYS.map((key) => 'sg-init-req-' + key),
    '四个需求维度必须按顺序各问一次',
  );

  const boundary = userQuestions.asked.findIndex(
    (id) => id === 'sg-init-background' || id === 'sg-init-stack',
  );
  assert.ok(boundary > 0, '应当先问需求、再问技术栈');
  for (const id of reqIds) {
    assert.ok(userQuestions.asked.indexOf(id) < boundary, id + ' 必须在技术栈问题之前');
  }
  assert.equal(
    userQuestions.asked[userQuestions.asked.length - 1],
    'sg-init-h0',
    '确认页应在所有盘问之后',
  );

  const state = load(root).state;
  assert.equal(state.phase, 'H0_PENDING');
  for (const key of REQ_KEYS) {
    assert.ok(Array.isArray(state.requirements[key]), key + ' 维度缺失');
    assert.ok(state.requirements[key].length > 0, key + ' 维度为空');
  }
  assert.equal(state.context.stack, 'node');
});

test('REQ-003/REQ-006：确认前不写需求文件，需求与技术栈共用一次确认', async () => {
  const root = tempRoot();
  const userQuestions = fakeQuestions();
  const { ctx } = setup(root, { userQuestions });
  const result = await callTool(ctx, 'sg_init');
  assert.match(result.text, /H0_PENDING/);

  assert.equal(fs.existsSync(reqDocPath(root)), false, '确认前不应生成 openspec/REQ.md');
  assert.equal(
    fs.existsSync(path.join(root, 'openspec', 'history')),
    false,
    '确认前不应生成只读快照',
  );

  const h0 = userQuestions.calls.filter((call) => call.id === 'sg-init-h0');
  assert.equal(h0.length, 1, '需求与技术栈应合成一次确认');
  assert.match(h0[0].text, /需求草案/);
  assert.match(h0[0].text, /技术栈/);
});

test('REQ-004/REQ-005：REQ 与 AC 顺序编号，每个 AC 声明合法 covers，快照只读一致', async () => {
  const root = tempRoot();
  const { ctx } = setup(root, { userQuestions: fakeQuestions() });
  await callTool(ctx, 'sg_init');
  await callTool(ctx, 'sg_approve', { gate: 'H0' });
  const run = await callTool(ctx, 'sg_run');
  assert.match(run.text, /已生成脚手架/);

  const text = fs.readFileSync(reqDocPath(root), 'utf8');
  const { reqs, acs } = parseReqBaseline(text);
  assert.ok(reqs.length >= 3, '需求条数不足：' + reqs.length);
  assert.deepEqual(
    reqs.map((req) => req.id),
    reqs.map((_, index) => 'REQ-' + String(index + 1).padStart(3, '0')),
  );
  assert.ok(acs.length >= 3, '验收标准条数不足：' + acs.length);
  assert.deepEqual(
    acs.map((ac) => ac.id),
    acs.map((_, index) => 'AC-' + String(index + 1).padStart(3, '0')),
  );
  for (const ac of acs) {
    assert.ok(ac.covers.length > 0, ac.id + ' 缺少 covers');
    for (const covered of ac.covers) {
      assert.ok(
        reqs.some((req) => req.id === covered),
        ac.id + ' 引用了不存在的 ' + covered,
      );
    }
  }
  for (const heading of ['## 功能需求', '## 非功能需求', '## 约束与依赖', '## 验收标准']) {
    assert.ok(text.includes(heading), '缺少小节：' + heading);
  }

  const snapshot = fs.readFileSync(historyReqPath(root), 'utf8');
  assert.equal(snapshot.trim(), text.trim(), '只读快照必须与 REQ.md 一致');
  assert.deepEqual(isRequirementsFrozen(root), { ok: true });

  const config = readConfig(root);
  assert.equal(config.requirements.enabled, true);
  assert.equal(config.requirements.version, 'v1.0');
});

test('REQ-008：缺少需求基线时 sg-change 被拒绝', async () => {
  const root = tempRoot();
  initProject(root);
  patchConfigRequirements(root, { enabled: true, version: 'v1.0' });
  const { ctx } = setup(root);
  const result = await callTool(ctx, 'sg_change', {
    name: 'add-login',
    type: 'feature',
  });
  assert.match(result.text, /缺少 openspec\/REQ\.md/);
  assert.equal(load(root).state.change, null);
});

test('REQ-008：proposal 引用不存在的 REQ 时 M1 失败', async () => {
  const root = tempRoot();
  const { ctx } = setup(root, { userQuestions: fakeQuestions() });
  await callTool(ctx, 'sg_init');
  await callTool(ctx, 'sg_approve', { gate: 'H0' });
  await callTool(ctx, 'sg_run');
  const pass = await callTool(ctx, 'sg_run');
  assert.match(pass.text, /M1 通过/);

  const proposal = path.join(root, 'openspec', 'changes', 'add-version', 'proposal.md');
  const original = fs.readFileSync(proposal, 'utf8');
  assert.ok(original.includes('REQ-001'), '脚手架提案应引用 REQ-001');
  fs.writeFileSync(proposal, original.replace('REQ-001', 'REQ-999'), 'utf8');
  const bad = await callTool(ctx, 'sg_run');
  assert.match(bad.text, /M1 未通过/);
  assert.match(bad.text, /REQ-999/);
});

test('REQ-009：只含命令事件的新会话追加 notice，非空会话不追加', async () => {
  const root = tempRoot();
  const { ctx } = setup(root);
  const appended = [];
  const session = {
    append(message, options) {
      appended.push({ message, options });
    },
    deriveMessages() {
      return appended.map((entry) => entry.message);
    },
  };
  const init = await ctx.commandsMap.get('sg-init').handler({ rawInput: '', agent: null, session });
  assert.equal(init.kind, 'success');
  assert.equal(appended.length, 1);
  assert.equal(appended[0].message.role, 'user');
  assert.equal(appended[0].message.source.form, 'notice');
  assert.equal(appended[0].message.source.kind, 'specgate');
  assert.equal(appended[0].options.surfaceOp, 'append');

  const status = await ctx.commandsMap
    .get('sg-status')
    .handler({ rawInput: '', agent: null, session });
  assert.equal(status.kind, 'success');
  assert.equal(appended.length, 1, '非空会话不应重复追加 notice');
});

test('REQ-011：写守卫不拦截 openspec/REQ.md 与只读快照', async () => {
  const root = tempRoot();
  initProject(root);
  const { runtime } = setup(root);
  const write = (filePath) =>
    checkWrite(runtime, {
      name: 'write',
      arguments: { file_path: filePath },
      agent: null,
    });
  assert.equal(write('openspec/REQ.md'), undefined);
  assert.equal(write('openspec/history/v1.0/REQ.md'), undefined);
  assert.match(write('.specgate/config.yaml'), /\.specgate\//);
  assert.match(write('openspec/specs/app/spec.md'), /归档事务/);
});

test('老项目：/sg-init 只反推需求不生成脚手架，H0 批准后写入基线并保持幂等', async () => {
  const root = legacyRoot();
  const userQuestions = fakeQuestions();
  const { ctx } = setup(root, { userQuestions });

  const init = await callTool(ctx, 'sg_init');
  assert.match(init.text, /已扫描现有项目/);
  let state = load(root).state;
  assert.equal(state.phase, 'H0_PENDING');
  assert.equal(state.mode, 'existing');
  assert.equal(fs.existsSync(reqDocPath(root)), false);
  assert.equal(fs.existsSync(historyReqPath(root)), false);
  assert.equal(fs.existsSync(path.join(root, 'docs', 'requirements-scan.md')), true);
  assert.equal(fs.existsSync(path.join(root, '.specgate', 'requirements-scan.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'index.js')), false, '老项目不应生成脚手架');
  assert.equal(fs.existsSync(path.join(root, 'openspec', 'changes', 'add-version')), false);
  assert.equal(git(root, ['status', '--porcelain']), '', '接入后工作树应保持干净');

  const approved = await callTool(ctx, 'sg_approve', { gate: 'H0' });
  assert.match(approved.text, /H0 已批准/);
  assert.doesNotMatch(approved.text, /\[object Object\]/);
  state = load(root).state;
  assert.equal(state.phase, 'H1_PENDING');
  assert.equal(state.mode, 'existing');
  assert.equal(fs.existsSync(reqDocPath(root)), true);
  assert.equal(readConfig(root).requirements.enabled, true);
  assert.equal(git(root, ['status', '--porcelain']), '', '批准后应只提交自身生成的基线资产');

  const change = await callTool(ctx, 'sg_change', {
    name: 'add-login',
    type: 'feature',
  });
  assert.match(change.text, /H1_PENDING/);
  const run = await callTool(ctx, 'sg_run');
  assert.match(run.text, /M1 未通过/);
  assert.match(run.text, /必须至少引用一个 REQ-xxx/);

  const baseline = fs.readFileSync(reqDocPath(root), 'utf8');
  const first = parseReqBaseline(baseline).reqs[0];
  assert.ok(first, '反推需求基线应至少包含一条 REQ');
  const changeDir = path.join(root, 'openspec', 'changes', 'add-login');
  fs.writeFileSync(
    path.join(changeDir, 'proposal.md'),
    [
      '# 变更提案：add-login',
      '',
      '- 类型：feature',
      '- 关联需求：' + first.id,
      '',
      '## 问题',
      '',
      '缺少登录。',
      '',
      '## 目标',
      '',
      '新增登录接口。',
      '',
      '## 非目标',
      '',
      '不做注册。',
      '',
      '## 影响面',
      '',
      'src/index.js',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.mkdirSync(path.join(changeDir, 'specs', 'auth'), { recursive: true });
  fs.writeFileSync(
    path.join(changeDir, 'specs', 'auth', 'spec.md'),
    [
      '## ADDED Requirements',
      '',
      '### Requirement: 登录 (' + first.id + ')',
      '',
      '系统 SHALL 允许用户登录。',
      '',
      '#### Scenario: 登录成功 (AC-001)',
      '',
      '- **WHEN** 提交正确凭证',
      '- **THEN** 返回 200',
      '',
    ].join('\n'),
    'utf8',
  );
  const fixed = await callTool(ctx, 'sg_run');
  assert.match(fixed.text, /M1 通过/);

  const again = await callTool(ctx, 'sg_init');
  assert.match(again.text, /幂等跳过/);
  assert.equal(
    fs.readFileSync(reqDocPath(root), 'utf8'),
    baseline,
    '重复 /sg-init 不得覆盖需求基线',
  );
  state = load(root).state;
  assert.equal(state.phase, 'H1_PENDING');
  assert.equal(state.change, 'add-login');
});
