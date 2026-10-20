import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { registerCommands } from '../../src/v3/commands.js';
import { load } from '../../src/v3/state.js';
import { initProject, readConfig } from '../../src/v3/change.js';
import {
  historyReqPath,
  isRequirementsFrozen,
  parseReqBaseline,
  reqDocPath,
} from '../../src/v3/requirements.js';
import { checkWrite } from '../../src/v3/guards.js';
import { withNotice } from '../../src/v3/notice.js';
import { summarizeInitResult } from '../../src/v3/init.js';

const DRAFT = {
  background: '一个最小可运行的全栈应用',
  functional: [
    { title: '用户可注册并登录', acceptance: '登录成功返回 200' },
    { title: '用户可查看健康检查状态' },
  ],
  nonFunctional: [{ title: '接口 P95 响应时间小于 300ms' }],
  constraints: ['不引入付费第三方服务'],
  context: { stack: 'node' },
  team: '1-3 人小团队',
  steps: '1) 跑通 health 2) 补版本接口',
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

function fakeQuestions({ confirm = '确认' } = {}) {
  const asked = [];
  return {
    asked,
    async ask({ questions }) {
      const question = questions[0];
      asked.push(question.id);
      if (question.id === 'sg-init-confirm') {
        return { answers: [{ selected: [confirm] }] };
      }
      const preferred = (question.options || []).find((option) => option.label !== '跳过');
      return { answers: [{ selected: [preferred ? preferred.label : '跳过'] }] };
    },
  };
}

test('v3.8：确认后生成需求文档与基线，REQ/AC 连续编号且 covers 合法', async () => {
  const root = tempRoot();
  const userQuestions = fakeQuestions();
  const { ctx } = setup(root, { userQuestions });

  const result = await callTool(ctx, 'sg_init', { draft: DRAFT });
  assert.match(result.text, /初始化完成：H1_PENDING/);
  assert.equal(fs.existsSync(path.join(root, 'docs', 'requirements', 'REQ.md')), true);
  assert.equal(fs.existsSync(reqDocPath(root)), true);

  const state = load(root).state;
  assert.equal(state.phase, 'H1_PENDING');
  assert.equal(state.change, 'mvp-scaffold');
  assert.equal(state.requirementsSource.doc, 'docs/requirements/REQ.md');
  assert.ok(state.h0.hash);
  assert.ok(state.h0.approvedAt);

  const text = fs.readFileSync(reqDocPath(root), 'utf8');
  const { reqs, acs } = parseReqBaseline(text);
  assert.deepEqual(
    reqs.map((req) => req.id),
    reqs.map((_, index) => 'REQ-' + String(index + 1).padStart(3, '0')),
  );
  assert.deepEqual(
    acs.map((ac) => ac.id),
    acs.map((_, index) => 'AC-' + String(index + 1).padStart(3, '0')),
  );
  assert.ok(reqs.length >= 4, '需求条数不足：' + reqs.length);
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
  assert.match(text, /派生自：docs\/requirements\/REQ\.md/);

  const snapshot = fs.readFileSync(historyReqPath(root), 'utf8');
  assert.equal(snapshot.trim(), text.trim(), '只读快照必须与 REQ.md 一致');
  assert.deepEqual(isRequirementsFrozen(root), { ok: true });

  const config = readConfig(root);
  assert.equal(config.requirements.enabled, true);
  assert.equal(config.requirements.version, 'v1.0');

  const docs = fs.readFileSync(path.join(root, 'docs', 'requirements', 'REQ.md'), 'utf8');
  assert.match(docs, /### FR-001 /);
  assert.match(docs, /### NFR-001 /);
  assert.match(docs, /- covers: FR-001/);
  assert.match(docs, /source_sha256: "sha256:/);

  const audit = JSON.parse(
    fs.readFileSync(path.join(root, '.specgate', 'init-result.json'), 'utf8'),
  );
  assert.equal(audit.autoConfirmed, false);
  assert.equal(audit.phase, 'H1_PENDING');
});

test('v3.8：确认页只问一次确认', async () => {
  const root = tempRoot();
  const userQuestions = fakeQuestions();
  const { ctx } = setup(root, { userQuestions });
  await callTool(ctx, 'sg_init', { draft: DRAFT });

  const confirmCalls = userQuestions.asked.filter((id) => id === 'sg-init-confirm');
  assert.equal(confirmCalls.length, 1, '只应有一次确认');
});

test('M1：proposal 引用不存在的 REQ 时失败', async () => {
  const root = tempRoot();
  const { ctx } = setup(root, { userQuestions: fakeQuestions() });
  await callTool(ctx, 'sg_init', { draft: DRAFT });

  const pass = await callTool(ctx, 'sg_run');
  assert.match(pass.text, /M1 通过/);

  const proposal = path.join(root, 'openspec', 'changes', 'mvp-scaffold', 'proposal.md');
  const original = fs.readFileSync(proposal, 'utf8');
  assert.ok(original.includes('REQ-001'), '脚手架提案应引用 REQ-001');
  fs.writeFileSync(proposal, original.replace('REQ-001', 'REQ-999'), 'utf8');
  const bad = await callTool(ctx, 'sg_run');
  assert.match(bad.text, /M1 未通过/);
  assert.match(bad.text, /REQ-999/);
});

test('v3.8：写守卫不拦截 openspec/REQ.md 与只读快照', async () => {
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

test('v3.8：只含命令事件的新会话追加 notice，非空会话不追加', async () => {
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

test('v3.8：命令结果通过 session notice 进入历史，不调用 followup', async () => {
  const appended = [];
  let followups = 0;
  const agent = {
    status: 'idle',
    followup() {
      followups += 1;
    },
  };
  const session = {
    append(message, options) {
      appended.push({ message, options });
    },
    deriveMessages() {
      return appended.map((entry) => entry.message);
    },
  };
  const wrapped = withNotice(async () => ({ kind: 'success', text: '脚手架已生成：pom.xml' }));
  const result = await wrapped({ agent, session });
  assert.equal(result.text, '脚手架已生成：pom.xml');
  assert.equal(followups, 0);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].message.content[0].text, '脚手架已生成：pom.xml');
  assert.equal(appended[0].message.source.kind, 'specgate');
});

test('v3.8：初始化结果摘要列出脚手架文件与下一步', () => {
  const text = summarizeInitResult({
    ok: true,
    phase: 'H1_PENDING',
    docsDoc: 'docs/requirements/REQ.md',
    requirementsDoc: 'openspec/REQ.md',
    requirementsVersion: 'v1.0',
    change: 'mvp-scaffold',
    scaffold: { written: ['pom.xml', 'mvnw'], skipped: ['.gitignore'] },
  });
  assert.match(text, /脚手架：已生成 2 个文件/);
  assert.match(text, /首个 change：mvp-scaffold/);
  assert.match(text, /\/sg-run/);
  assert.match(text, /CRUD/);

  const noChange = summarizeInitResult({
    ok: true,
    phase: 'H1_PENDING',
    docsDoc: 'docs/requirements/REQ.md',
    requirementsDoc: 'openspec/REQ.md',
    requirementsVersion: 'v1.0',
    change: null,
    scaffold: { written: [], skipped: [] },
  });
  assert.match(noChange, /\/sg-change/);
});
