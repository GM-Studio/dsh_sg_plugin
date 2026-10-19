import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject, createChange, configPath } from '../../src/v3/change.js';
import { load, patchState } from '../../src/v3/state.js';
import { git } from '../../src/v3/worktrees.js';
import { renderGateSummary } from '../../src/v3/gate-summary.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-gate-'));
}

function setupChange() {
  const root = tempRoot();
  initProject(root);
  createChange(root, { name: 'gate-demo', type: 'feature' });
  const dir = path.join(root, 'openspec', 'changes', 'gate-demo');
  fs.writeFileSync(
    path.join(dir, 'proposal.md'),
    '# 提案\n\n## 问题\n\n首页没有状态标识。\n\n## 目标\n\n增加状态与版本。\n',
    'utf8',
  );
  fs.mkdirSync(path.join(dir, 'specs', 'ops'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'specs', 'ops', 'spec.md'),
    '## ADDED Requirements\n\n### Requirement: 状态标识 (REQ-001)\n\n#### Scenario: 可见 (AC-001)\n',
    'utf8',
  );
  return { root, dir };
}

test('H1 摘要包含 proposal、REQ/AC 与 capability', () => {
  const { root } = setupChange();
  const state = load(root).state;
  const { text } = renderGateSummary({ gate: 'H1', root, state });
  assert.match(text, /H1 需求审阅：gate-demo/);
  assert.match(text, /首页没有状态标识/);
  assert.match(text, /REQ-001 状态标识/);
  assert.match(text, /AC-001 可见/);
  assert.match(text, /- ops/);
});

test('H2 摘要包含任务、文件行数、套件与计划指纹', () => {
  const { root } = setupChange();
  fs.writeFileSync(path.join(root, 'index.js'), '1\n2\n3\n4\n5\n', 'utf8');
  fs.writeFileSync(path.join(root, 'old.js'), 'x\n', 'utf8');
  patchState(root, (draft) => {
    draft.tasks = {
      'T-001': { id: 'T-001', title: '加状态', ac: ['AC-001'], deps: [], parallel: false },
    };
    draft.touched = { modify: ['index.js'], delete: ['old.js'], bootstrap: ['spec/new.spec.js'] };
    draft.plan = {
      ...draft.plan,
      planHash: 'sha256:1234567890abcdef',
      suites: [{ id: 'api', kind: 'node-test', argv: ['node', 'sg-test.mjs'], cwd: '.' }],
    };
  });
  const state = load(root).state;
  const { text } = renderGateSummary({ gate: 'H2', root, state });
  assert.match(text, /\| T-001 \| 加状态 \| AC-001 \| - \|/);
  assert.match(text, /M index\.js（6 行）/);
  assert.match(text, /D old\.js（删除）/);
  assert.match(text, /A spec\/new\.spec\.js（新增）/);
  assert.match(text, /node sg-test\.mjs/);
  assert.match(text, /1234567890ab/);
});

test('H3 摘要包含验收、统计、diff 统计、关键 hunk 与脱敏', () => {
  const { root, dir } = setupChange();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\n', 'utf8');
  fs.writeFileSync(path.join(root, 'c.txt'), 'remove me\n', 'utf8');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);

  fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\nthree\npassword = "hunter2"\n', 'utf8');
  fs.writeFileSync(path.join(root, 'b.txt'), 'new file\n', 'utf8');
  fs.rmSync(path.join(root, 'c.txt'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'change']);

  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'gate-demo'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'acceptance.md'),
    [
      '# 验收报告：gate-demo',
      '',
      '- 测试：total=3 pass=3 fail=0 skip=0',
      '',
      '| AC | 结果 | 用例文件 | exitCode | commit |',
      '|---|---|---|---|---|',
      '| AC-001 | pass | spec/a.spec.js | 0 | abc |',
    ].join('\n'),
    'utf8',
  );

  const state = load(root).state;
  state.type = 'feature';
  state.acceptanceHash = 'sha256:abcdef1234567890';
  const { text } = renderGateSummary({
    gate: 'H3',
    root,
    state,
    integration: { path: root, base },
  });
  assert.match(text, /H3 验收审阅：gate-demo/);
  assert.match(text, /\| AC-001 \| pass \| spec\/a\.spec\.js \|/);
  assert.match(text, /total=3 pass=3 fail=0 skip=0/);
  assert.match(text, /\| a\.txt \| \+2 \| -0 \|/);
  assert.match(text, /\[REDACTED\]/);
  assert.doesNotMatch(text, /hunter2/);
  assert.match(text, /abcdef123456/);
});
