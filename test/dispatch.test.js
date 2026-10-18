import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAgentRunner, dispatchChange, runDoctorParallel } from '../src/dispatch.js';
import { initProject } from '../src/init.js';

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function makeGitProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-dispatch-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'SpecGate Test']);
  git(root, ['config', 'user.email', 'specgate-test@example.com']);
  initProject(root);
  return root;
}

function writeTasks(root, tasks) {
  const change = path.join(root, 'openspec', 'changes', 'demo');
  fs.mkdirSync(change, { recursive: true });
  fs.writeFileSync(path.join(change, 'tasks.md'), `${tasks.join('\n')}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-m', 'test: add demo tasks']);
}

function committingRunner(prefix = '') {
  return async ({ task, cwd }) => {
    fs.writeFileSync(path.join(cwd, `${prefix}${task.id}.txt`), task.id);
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '-m', `specgate(demo): ${task.id} ${task.title}`]);
    return { ok: true, text: `done ${task.id}` };
  };
}

test('parallel dispatch uses worktrees, merges waves, and skips completed tasks on rerun', async () => {
  const root = makeGitProject();
  writeTasks(root, [
    '- [ ] T1 写 A [P]',
    '- [ ] T2 写 B [P]',
    '- [ ] T3 写 C depends: T1,T2',
  ]);

  const report = await dispatchChange({
    root,
    change: 'demo',
    parent: null,
    runner: committingRunner(),
    maxConcurrency: 2,
  });

  assert.equal(report.ok, true);
  assert.equal(report.downgraded, false);
  assert.deepEqual(report.waves.map((wave) => wave.map((task) => task.id)), [
    ['T1', 'T2'],
    ['T3'],
  ]);
  for (const id of ['T1', 'T2', 'T3']) {
    assert.equal(fs.readFileSync(path.join(root, `${id}.txt`), 'utf8'), id);
    assert.equal(fs.existsSync(path.join(root, '.specgate', 'worktrees', 'demo', id)), false);
  }
  assert.match(git(root, ['branch', '--list', 'specgate/demo/T1-dev']), /specgate\/demo\/T1-dev/);
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'state', 'dispatch.json')));
  const tasksText = fs.readFileSync(path.join(root, 'openspec', 'changes', 'demo', 'tasks.md'), 'utf8');
  assert.equal((tasksText.match(/\[x\]/g) || []).length, 3);

  let reruns = 0;
  const rerun = await dispatchChange({
    root,
    change: 'demo',
    parent: null,
    runner: async () => {
      reruns += 1;
      return { ok: true, text: 'should not run' };
    },
    maxConcurrency: 2,
  });
  assert.equal(rerun.ok, true);
  assert.equal(reruns, 0);
  assert.match(rerun.text, /所有 tasks 已完成/);
  assert.equal(rerun.results.length, 0);
});

test('a merge conflict stops the dispatch and preserves the conflicting worktree and branch', async () => {
  const root = makeGitProject();
  writeTasks(root, [
    '- [ ] T1 写共享文件 [P]',
    '- [ ] T2 写共享文件 [P]',
  ]);

  const runner = async ({ task, cwd }) => {
    fs.writeFileSync(path.join(cwd, 'shared.txt'), `${task.id}\n`);
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '-m', `specgate(demo): ${task.id}`]);
    return { ok: true, text: `done ${task.id}` };
  };

  const report = await dispatchChange({
    root,
    change: 'demo',
    parent: null,
    runner,
    maxConcurrency: 2,
  });

  assert.equal(report.ok, false);
  assert.equal(report.conflicts.length, 1);
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'worktrees', 'demo', report.conflicts[0].task)));
  assert.match(git(root, ['branch', '--list', report.conflicts[0].branch]), new RegExp(report.conflicts[0].branch.replace(/\//g, '\\/')));
});

test('non-git projects downgrade to one serial writer', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-serial-'));
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'demo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'openspec', 'changes', 'demo', 'tasks.md'),
    '- [ ] T1 写文件\n- [ ] T2 写文件\n',
  );

  const report = await dispatchChange({
    root,
    change: 'demo',
    parent: null,
    runner: async ({ task, cwd }) => {
      fs.writeFileSync(path.join(cwd, `${task.id}.txt`), task.id);
      return { ok: true, text: `done ${task.id}` };
    },
    maxConcurrency: 4,
  });

  assert.equal(report.downgraded, true);
  assert.match(report.downgradeReason, /不是 Git 仓库/);
  assert.equal(report.results.length, 2);
  assert.ok(report.results.every((item) => item.serial === true));
  assert.equal(fs.existsSync(path.join(root, '.specgate', 'worktrees')), false);
});

test('parallel doctor merges structured results from independent agents', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-doctor-parallel-'));
  initProject(root, { git: false });

  const result = await runDoctorParallel({
    root,
    parent: null,
    runner: async () => ({
      ok: true,
      text: JSON.stringify({
        checks: [{ name: 'agent-check', ok: true, detail: 'ok' }],
        issues: [],
      }),
    }),
    maxConcurrency: 2,
  });

  assert.equal(result.parallel, true);
  assert.equal(result.ok, true);
  assert.ok(result.checks.length >= 4);
  assert.ok(result.checks.some((check) => check.name === 'agent-check'));
});

test('agent runner inherits the parent model route and reads the child answer', async () => {
  const root = makeGitProject();
  let created;
  const agents = {
    async create(options) {
      created = options;
      return {
        agent: {
          followup() {},
          async whenIdle() {},
          session: {
            deriveMessages() {
              return [
                {
                  role: 'assistant',
                  content: [{ type: 'text', text: 'review result' }],
                },
              ];
            },
          },
        },
        async dispose() {},
      };
    },
  };
  const ctx = {
    get(name) {
      return name === 'agents' ? agents : undefined;
    },
  };
  const runner = createAgentRunner(ctx);
  const result = await runner({
    prompt: 'check',
    cwd: root,
    role: 'reviewer',
    parent: {
      options: { provider: 'deepseek', model: 'deepseek-flash', subagentDepth: 0 },
      session: {
        requestHeader() {
          return { config: { provider: 'deepseek', model: 'deepseek-flash' } };
        },
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, 'review result');
  assert.equal(created.agentOptions.provider, 'deepseek');
  assert.equal(created.agentOptions.model, 'deepseek-flash');
  assert.equal(created.agentOptions.subagentDepth, 1);
});
