import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRuntime } from '../../src/v3/runtime.js';
import { registerTools } from '../../src/v3/tools.js';
import { registerCommands, parseInitArgs } from '../../src/v3/commands.js';
import { load } from '../../src/v3/state.js';
import {
  parseRequirementsText,
  renderRequirementsDocument,
} from '../../src/v3/requirements-doc.js';

const DRAFT = {
  background: '需求澄清演示',
  functional: [{ title: '用户可注册登录', acceptance: '注册成功返回 201' }, { title: '健康检查' }],
  nonFunctional: [{ title: 'P95 < 300ms' }],
  constraints: ['兼容现有数据库'],
  context: { stack: 'node' },
  team: '1-3 人',
  steps: '1) health 2) 登录',
};

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v38-'));
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
  return ctx;
}

async function call(ctx, name, args = {}) {
  return ctx.toolsMap.get(name).execute(args, { agent: null });
}

function questions(answers = {}) {
  const asked = [];
  return {
    asked,
    async ask({ questions: list }) {
      const question = list[0];
      asked.push(question.id);
      if (question.id in answers) return { answers: [{ selected: [answers[question.id]] }] };
      const preferred = (question.options || [])[0];
      return { answers: [{ selected: [preferred ? preferred.label : ''] }] };
    },
  };
}

function snapshot(root) {
  const rows = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
        rows.push(path.relative(root, file).split(path.sep).join('/') + ':' + hash);
      }
    }
  };
  walk(root);
  return rows.sort().join('|');
}

test('AC-03：无问答通道时无参 sg_init 退回 CLARIFY 且零写', async () => {
  const root = tempRoot();
  const before = snapshot(root);
  const ctx = setup(root, {});
  const result = await call(ctx, 'sg_init');
  assert.match(result.text, /需求澄清（尚未写入任何文件）/);
  assert.equal(result.data.phase, 'CLARIFY');
  assert.deepEqual(result.data.writes, []);
  assert.ok(result.data.missing.includes('functional'));
  assert.equal(snapshot(root), before);
  assert.equal(load(root).state, undefined);
});

test('AC-03：有问答通道时无参 sg_init 主动打开需求对话框', async () => {
  const root = tempRoot();
  const userQuestions = questions({
    'sg-init-req-functional': '用户登录；健康检查',
    'sg-init-req-nonFunctional': 'P95 < 300ms',
    'sg-init-req-constraints': '兼容旧库',
    'sg-init-req-acceptance': '登录成功返回 200；health 返回 ok',
    'sg-init-stack': 'node',
    'sg-init-confirm': '确认',
  });
  const ctx = setup(root, { userQuestions });
  const result = await call(ctx, 'sg_init');
  assert.match(result.text, /初始化完成：H1_PENDING/);
  for (const id of [
    'sg-init-req-functional',
    'sg-init-req-nonFunctional',
    'sg-init-req-constraints',
    'sg-init-req-acceptance',
  ]) {
    assert.ok(userQuestions.asked.includes(id), '未打开 ' + id + ' 对话框');
  }
  const docs = fs.readFileSync(path.join(root, 'docs', 'requirements', 'REQ.md'), 'utf8');
  assert.match(docs, /### FR-001 MVP 框架与 Item CRUD 示例/);
  assert.match(docs, /### FR-002 用户登录/);
  assert.match(docs, /### FR-003 健康检查/);
});

test('AC-03：描述入口把种子作为“使用我的描述”选项并继续追问', async () => {
  const root = tempRoot();
  const userQuestions = questions({
    'sg-init-req-nonFunctional': 'P95 < 300ms',
    'sg-init-req-constraints': '兼容旧库',
    'sg-init-stack': 'node',
    'sg-init-confirm': '确认',
  });
  const ctx = setup(root, { userQuestions });
  const result = await call(ctx, 'sg_init', { description: '登录和健康检查' });
  assert.match(result.text, /初始化完成：H1_PENDING/);
  assert.ok(userQuestions.asked.includes('sg-init-req-functional'));
  const docs = fs.readFileSync(path.join(root, 'docs', 'requirements', 'REQ.md'), 'utf8');
  assert.match(docs, /### FR-002 登录和健康检查/);
});

test('AC-04：草稿缺功能需求返回 E_DRAFT_INCOMPLETE 且零写', async () => {
  const root = tempRoot();
  const before = snapshot(root);
  const ctx = setup(root, { userQuestions: questions() });
  const result = await call(ctx, 'sg_init', { draft: { background: '只有背景' } });
  assert.match(result.text, /E_DRAFT_INCOMPLETE/);
  assert.deepEqual(result.data.missing.includes('functional'), true);
  assert.equal(snapshot(root), before);
});

test('AC-04：缺非功能/约束时打开对话框补齐，确认留空也继续', async () => {
  const root = tempRoot();
  const userQuestions = questions({});
  const ctx = setup(root, { userQuestions });
  const result = await call(ctx, 'sg_init', {
    draft: { functional: [{ title: 'A' }], context: { stack: 'node' } },
  });
  assert.match(result.text, /初始化完成：H1_PENDING/);
  assert.ok(userQuestions.asked.includes('sg-init-req-nonFunctional'));
  assert.ok(userQuestions.asked.includes('sg-init-req-constraints'));

  const emptyRoot = tempRoot();
  const emptyCtx = setup(emptyRoot, { userQuestions: questions() });
  const empty = await call(emptyCtx, 'sg_init', {
    draft: {
      functional: [{ title: 'A' }],
      confirmedEmpty: ['nonFunctional', 'constraints'],
      context: { stack: 'node' },
    },
  });
  assert.match(empty.text, /初始化完成：H1_PENDING/);
});

test('AC-04：无问答通道且缺维度时返回 CLARIFY 且零写', async () => {
  const root = tempRoot();
  const before = snapshot(root);
  const ctx = setup(root, {});
  const result = await call(ctx, 'sg_init', {
    draft: { functional: [{ title: 'A' }], context: { stack: 'node' } },
  });
  assert.equal(result.data.phase, 'CLARIFY');
  assert.deepEqual(result.data.missing.sort(), ['constraints', 'nonFunctional'].sort());
  assert.equal(snapshot(root), before);
});

test('AC-05：确认页选取消后零写', async () => {
  const root = tempRoot();
  const before = snapshot(root);
  const ctx = setup(root, { userQuestions: questions({ 'sg-init-confirm': '取消' }) });
  const result = await call(ctx, 'sg_init', { draft: DRAFT });
  assert.match(result.text, /E_CONFIRM_CANCELLED/);
  assert.equal(snapshot(root), before);
});

test('AC-09：问答通道不可用时不自动确认、零写', async () => {
  const root = tempRoot();
  const before = snapshot(root);
  const ctx = setup(root, {});
  const result = await call(ctx, 'sg_init', { draft: DRAFT });
  assert.match(result.text, /E_QUESTIONS_UNAVAILABLE/);
  assert.equal(snapshot(root), before);
  assert.equal(fs.existsSync(path.join(root, '.specgate', 'init-result.json')), false);
});

test('AC-01/AC-06：-req 导入 Markdown，确认后写需求文档与基线', async () => {
  const root = tempRoot();
  const doc = [
    '# 需求',
    '',
    '## 3. 功能需求',
    '',
    '### FR-001 注册',
    '',
    '- 验收标准：注册成功',
    '',
    '### FR-002 登录',
    '',
    '## 4. 非功能需求',
    '',
    '- 性能：P95 < 300ms',
    '',
    '## 5. 验收标准',
    '',
    '### AC-001 注册成功',
    '',
    '- covers: FR-001',
    '',
    '## 6. 约束、假设与不做范围',
    '',
    '- 兼容旧库',
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(root, '需求 文档.md'), '\uFEFF' + doc, 'utf8');
  const ctx = setup(root, { userQuestions: questions({ 'sg-init-confirm': '确认' }) });
  const result = await call(ctx, 'sg_init', { req: '需求 文档.md' });
  assert.match(result.text, /初始化完成：H1_PENDING/);
  assert.equal(result.data.docsDoc, 'docs/requirements/REQ.md');
  assert.equal(result.data.requirementsSource.path, '需求 文档.md');
  const docs = fs.readFileSync(path.join(root, 'docs', 'requirements', 'REQ.md'), 'utf8');
  assert.match(docs, /source: "需求 文档\.md"/);
  assert.match(docs, /### FR-001 MVP 框架与 Item CRUD 示例/);
  assert.match(docs, /### FR-002 注册/);
  assert.match(docs, /### FR-003 登录/);
});

test('AC-02：-req 路径不存在/为空/无功能条目均失败且零写', async () => {
  const cases = [
    { name: 'missing', file: null, code: 'E_REQ_NOT_FOUND' },
    { name: 'empty', file: '   \n', code: 'E_REQ_EMPTY' },
    { name: 'nofunc', file: '## 非功能需求\n\n- P95 < 300ms\n', code: 'E_REQ_NO_FUNCTIONAL' },
  ];
  for (const item of cases) {
    const root = tempRoot();
    if (item.file !== null) fs.writeFileSync(path.join(root, 'req.md'), item.file, 'utf8');
    const before = snapshot(root);
    const ctx = setup(root, { userQuestions: questions() });
    const result = await call(ctx, 'sg_init', { req: 'req.md' });
    assert.match(result.text, new RegExp(item.code), item.name);
    assert.equal(snapshot(root), before, item.name + ' 不应写盘');
  }
});

test('AC-08：既有项目确认后不生成脚手架，进入 H1', async () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"legacy"}\n', 'utf8');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const x = 1;\n', 'utf8');
  const before = snapshot(root);
  const ctx = setup(root, { userQuestions: questions({ 'sg-init-confirm': '确认' }) });
  const result = await call(ctx, 'sg_init', { draft: DRAFT });
  assert.match(result.text, /既有项目：未生成脚手架/);
  assert.equal(result.data.mode, 'existing');
  assert.equal(fs.existsSync(path.join(root, 'index.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'openspec', 'changes', 'add-version')), false);
  assert.equal(fs.existsSync(path.join(root, 'openspec', 'changes', 'mvp-scaffold')), false);
  assert.equal(load(root).state.phase, 'H1_PENDING');
  assert.notEqual(snapshot(root), before);
});

test('AC-12：已初始化项目重复 sg_init 零写并返回幂等', async () => {
  const root = tempRoot();
  const ctx = setup(root, { userQuestions: questions({ 'sg-init-confirm': '确认' }) });
  await call(ctx, 'sg_init', { draft: DRAFT });
  const before = snapshot(root);
  const again = await call(ctx, 'sg_init', { draft: DRAFT });
  assert.match(again.text, /幂等跳过/);
  assert.equal(again.data.skipped, true);
  assert.equal(snapshot(root), before);
});

test('AC-13：重复编号与缺失 AC 的解析结果确定且带告警', () => {
  const text = [
    '## 功能需求',
    '',
    '### FR-001 注册',
    '',
    '### FR-001 登录',
    '',
    '## 验收标准',
    '',
    '### AC-001 注册成功',
    '',
    '- covers: FR-001',
    '',
  ].join('\n');
  const doc = parseRequirementsText(text);
  assert.deepEqual(
    doc.functional.map((entry) => entry.id),
    ['FR-001', 'FR-002'],
  );
  assert.ok(doc.warnings.some((warning) => warning.includes('重编')));
  assert.match(doc.functional[1].acceptanceText, /实现并通过自动化测试：登录/);
  const rendered = renderRequirementsDocument(doc, {
    source: 'req.md',
    sourceHash: 'sha256:abc',
    updatedAt: '2026-10-19T00:00:00.000Z',
    background: '演示',
  });
  assert.match(rendered, /### AC-001 注册成功/);
  assert.match(rendered, /- covers: FR-001/);
});

test('AC-13：Windows 中文/空格路径与 BOM/CRLF 可解析', async () => {
  const root = tempRoot();
  const file = path.join(root, 'docs', '我的 需求.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    '\uFEFF## 3. 功能需求\r\n\r\n### FR-001 注册\r\n\r\n- 验收标准：注册成功\r\n\r\n## 4. 非功能需求\r\n\r\n- 性能：P95 < 300ms\r\n\r\n## 6. 约束、假设与不做范围\r\n\r\n- 兼容旧库\r\n',
    'utf8',
  );
  const ctx = setup(root, { userQuestions: questions({ 'sg-init-confirm': '确认' }) });
  const result = await call(ctx, 'sg_init', { req: 'docs/我的 需求.md' });
  assert.match(result.text, /初始化完成：H1_PENDING/);
});

test('AC-07：确认页选“修改需求”会重新打开对话框并更新基线', async () => {
  const root = tempRoot();
  let confirmCount = 0;
  const asked = [];
  const userQuestions = {
    async ask({ questions }) {
      const question = questions[0];
      asked.push(question.id);
      if (question.id === 'sg-init-confirm') {
        confirmCount += 1;
        return { answers: [{ selected: [confirmCount === 1 ? '修改需求' : '确认'] }] };
      }
      if (question.id === 'sg-init-req-functional') {
        return { answers: [{ selected: [], custom: '登录；注册' }] };
      }
      if (question.id === 'sg-init-req-nonFunctional') {
        return { answers: [{ selected: [], custom: 'P95 < 300ms' }] };
      }
      if (question.id === 'sg-init-req-constraints') {
        return { answers: [{ selected: [], custom: '兼容旧库' }] };
      }
      if (question.id === 'sg-init-req-acceptance') {
        return { answers: [{ selected: [], custom: '登录成功' }] };
      }
      const first = (question.options || [])[0];
      return { answers: [{ selected: [first ? first.label : ''] }] };
    },
  };
  const ctx = setup(root, { userQuestions });
  const result = await call(ctx, 'sg_init', { draft: DRAFT });
  assert.match(result.text, /初始化完成：H1_PENDING/);
  assert.equal(asked.filter((id) => id === 'sg-init-confirm').length, 2);
  assert.ok(asked.includes('sg-init-req-functional'));
  const baseline = fs.readFileSync(path.join(root, 'openspec', 'REQ.md'), 'utf8');
  assert.match(baseline, /### REQ-001 MVP 框架与 Item CRUD 示例/);
  assert.match(baseline, /### REQ-002 登录/);
  assert.match(baseline, /### REQ-003 注册/);
});

test('v3.8：-req 与自由描述互斥', async () => {
  const parsed = parseInitArgs('-req a.md 我想做登录');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.code, 'E_ARGS_CONFLICT');
  const quoted = parseInitArgs('-req "my req.md"');
  assert.deepEqual(quoted, {
    ok: true,
    req: 'my req.md',
    v4: false,
    adopt: false,
    v3: false,
    path: null,
    backend: null,
    frontend: null,
    preset: null,
    description: '',
  });
});
