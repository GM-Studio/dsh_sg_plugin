import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject, createChange } from '../../src/v3/change.js';
import { load, patchState } from '../../src/v3/state.js';
import { renderGateCard } from '../../src/v3/gate-card.js';
import { startInitProject, finishInitProject } from '../../src/v3/init.js';
import { issueApproval } from '../../src/v3/approvals.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-card-'));
}

function questions(stack = 'node') {
  return {
    async ask({ questions: list }) {
      const question = list[0];
      if (question.id === 'sg-init-stack') return { answers: [{ selected: [stack] }] };
      return { answers: [{ selected: ['跳过'] }] };
    },
  };
}

test('H1 卡片为纯文本且 ≤1200 字符，并写详情文件', () => {
  const root = tempRoot();
  initProject(root);
  createChange(root, { name: 'card-demo', type: 'feature' });
  const dir = path.join(root, 'openspec', 'changes', 'card-demo');
  fs.writeFileSync(path.join(dir, 'proposal.md'), '## 问题\n\n太乱。\n\n## 目标\n\n清晰。\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'specs', 'ops'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'specs', 'ops', 'spec.md'),
    '## ADDED Requirements\n\n### Requirement: 展示 (REQ-001)\n\n#### Scenario: 可见 (AC-001)\n',
    'utf8',
  );
  const state = load(root).state;
  const { text } = renderGateCard({ gate: 'H1', root, state });
  assert.ok(text.length <= 1200);
  assert.ok(!/^#/m.test(text));
  assert.ok(!text.includes('|'));
  assert.ok(!text.includes('```'));
  assert.match(text, /SpecGate H1 审批/);
  assert.match(text, /AC-001/);
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'gates', 'H1.txt')));
});

test('H0 卡片显示上下文与哈希', () => {
  const root = tempRoot();
  const state = {
    change: null,
    h0: { hash: 'sha256:abcdef1234567890' },
    context: {
      background: '一个演示项目',
      stack: 'node',
      acceptance: 'health 返回 200',
      team: '两人',
      steps: '先 health',
    },
  };
  const { text } = renderGateCard({ gate: 'H0', root, state });
  assert.match(text, /一个演示项目/);
  assert.match(text, /health 返回 200/);
  assert.match(text, /abcdef123456/);
  assert.ok(text.length <= 1200);
});

test('H0_PENDING → 批准 → finish → H1_PENDING', async () => {
  const root = tempRoot();
  const started = await startInitProject({
    root,
    userQuestions: questions('node'),
    agent: null,
    signal: new AbortController().signal,
  });
  assert.equal(started.ok, true, started.message);
  assert.equal(started.phase, 'H0_PENDING');
  assert.equal(fs.existsSync(path.join(root, 'index.js')), false);

  patchState(root, (draft) => {
    issueApproval(draft, 'H0', draft.h0.hash);
    draft.h0.approvedAt = new Date().toISOString();
  });
  const finished = await finishInitProject({ root, state: load(root).state });
  assert.equal(finished.ok, true, finished.message);
  assert.equal(finished.phase, 'H1_PENDING');
  assert.ok(fs.existsSync(path.join(root, 'index.js')));
  assert.ok(fs.existsSync(path.join(root, 'openspec', 'changes', 'add-version', 'proposal.md')));
});
