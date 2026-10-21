import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startRequirementsInit } from '../../src/v3/init.js';
import { autoBuildBootstrap, maybeBuildBootstrap } from '../../src/v3/bootstrap.js';
import { bootstrapCodeFiles } from '../../src/v3/bootstrap-code.js';
import { load } from '../../src/v3/state.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v310-'));
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

async function seed(stack, extra = {}) {
  const root = tempRoot();
  const result = await startRequirementsInit({
    root,
    userQuestions: questions(),
    agent: null,
    signal: undefined,
    draft: draftFor(stack, extra),
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.phase, 'H1_PENDING');
  assert.equal(result.change, 'mvp-scaffold');
  return root;
}

function quality(ok = true) {
  return async () => ({
    ok,
    stages: [
      {
        name: 'test',
        status: ok ? 0 : 1,
        command: 'fake',
        durationMs: 1,
        stdout: ok ? 'ok' : '',
        stderr: ok ? '' : 'boom',
      },
    ],
    review: { skipped: true, reason: 'test' },
  });
}

test('v3.10：Java 生成 Item CRUD 代码、归档并回到 IDLE', async () => {
  const root = await seed('java', {
    buildTool: 'maven',
    jdk: '8',
    bootVersion: '2.7.x',
    modules: 'minimal',
  });
  const built = await autoBuildBootstrap({
    root,
    change: 'mvp-scaffold',
    stack: 'java',
    context: { packageName: 'com.example.demo' },
    qualityRunner: quality(true),
  });
  assert.equal(built.ok, true, built.message);
  assert.equal(built.archived, true);
  for (const file of [
    'src/main/java/com/example/demo/Item.java',
    'src/main/java/com/example/demo/ItemStore.java',
    'src/main/java/com/example/demo/ItemController.java',
    'src/test/java/com/example/demo/ItemControllerTest.java',
  ]) {
    assert.ok(fs.existsSync(path.join(root, file)), file);
  }
  const state = load(root).state;
  assert.equal(state.phase, 'IDLE');
  assert.equal(state.change, null);
  assert.ok(fs.existsSync(path.join(root, 'openspec', 'specs', 'mvp', 'spec.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'mvp-scaffold-report.md')));
  const archived = path.join(
    root,
    'openspec',
    'changes',
    'archive',
    new Date().toISOString().slice(0, 10) + '-mvp-scaffold',
  );
  assert.ok(fs.existsSync(archived), archived);
  const tasks = fs.readFileSync(path.join(archived, 'tasks.md'), 'utf8');
  assert.doesNotMatch(tasks, /- \[ \]/);
});

test('v3.10：Node / Python 生成对应代码并归档', async () => {
  for (const [stack, files] of [
    ['node', ['src/items.js', 'index.js', 'test/items.test.mjs']],
    ['python', ['items.py', 'app.py', 'tests/test_items.py']],
  ]) {
    const root = await seed(stack);
    const built = await autoBuildBootstrap({
      root,
      change: 'mvp-scaffold',
      stack,
      context: {},
      qualityRunner: quality(true),
    });
    assert.equal(built.ok, true, stack + ': ' + built.message);
    for (const file of files) assert.ok(fs.existsSync(path.join(root, file)), stack + ' ' + file);
    assert.equal(load(root).state.phase, 'IDLE', stack);
  }
});

test('v3.10：质量失败时中止、保留 H1 与报告', async () => {
  const root = await seed('node');
  const built = await autoBuildBootstrap({
    root,
    change: 'mvp-scaffold',
    stack: 'node',
    context: {},
    qualityRunner: quality(false),
  });
  assert.equal(built.ok, false);
  assert.equal(built.code, 'BOOTSTRAP_QUALITY_FAILED');
  assert.ok(fs.existsSync(path.join(root, 'docs', 'mvp-scaffold-report.md')));
  assert.ok(
    fs.existsSync(
      path.join(root, 'openspec', 'changes', 'mvp-scaffold', 'reviews', 'bootstrap-failure.md'),
    ),
  );
  const state = load(root).state;
  assert.equal(state.phase, 'H1_PENDING');
  assert.equal(state.change, 'mvp-scaffold');
});

test('v3.10：没有 subagents 时 maybeBuildBootstrap 跳过自动构建', async () => {
  const root = await seed('node');
  const result = {
    ok: true,
    phase: 'H1_PENDING',
    change: 'mvp-scaffold',
    mode: 'new',
  };
  const built = await maybeBuildBootstrap({
    root,
    result,
    runtime: { service: () => null },
    agent: {},
  });
  assert.equal(built.ok, true);
  assert.equal(built.skipped, true);
  assert.equal(load(root).state.phase, 'H1_PENDING');
});

test('v3.10：三栈代码模板包含 5 个 CRUD 接口', () => {
  const java = Object.values(bootstrapCodeFiles('java', { packageName: 'com.example.demo' })).join(
    '\n',
  );
  const node = Object.values(bootstrapCodeFiles('node')).join('\n');
  const python = Object.values(bootstrapCodeFiles('python')).join('\n');
  for (const text of [java, node, python]) {
    assert.match(text, /\/api\/items/);
    assert.match(text, /GET|get/);
    assert.match(text, /POST|post/);
    assert.match(text, /\/update/);
    assert.match(text, /\/delete/);
    assert.doesNotMatch(text, /@PutMapping|@DeleteMapping|method: "PUT"|method: "DELETE"/);
  }
});
