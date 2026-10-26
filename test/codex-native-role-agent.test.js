import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildNativeRolePrompt,
  createNativeCodexRoleProvider,
} from '../src/codex/native-role-agent.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-native-role-'));
  const worktree = path.join(root, '.specgate', 'codex', 'worktrees', 'change-1', 'test-design');
  fs.mkdirSync(path.join(root, '.codex', 'agents'), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  for (const name of ['specgate_test_designer', 'specgate_frontend', 'specgate_backend']) {
    fs.writeFileSync(
      path.join(root, '.codex', 'agents', `${name}.toml`),
      `name = "${name}"\ndeveloper_instructions = "Work only in the assigned worktree and commit."\n`,
    );
  }
  return { root, worktree };
}

function fakeSpawn({
  lines = [{ type: 'thread.started', thread_id: 'thread-1' }],
  exitCode = 0,
} = {}) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.end = (value) => {
      calls.at(-1).prompt = value;
      queueMicrotask(() => {
        for (const line of lines) child.stdout.emit('data', `${JSON.stringify(line)}\n`);
        child.emit('close', exitCode, null);
      });
      return true;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    calls.push({ command, args, options });
    return child;
  };
  return { calls, spawnImpl };
}

test('native role provider reuses an explicitly configured host Codex executable', async () => {
  const { root, worktree } = fixture();
  const fake = fakeSpawn();
  const selected = path.join(root, 'host-cli', 'codex.exe');
  const provider = createNativeCodexRoleProvider({
    projectRoot: root,
    env: { ...process.env, SPECGATE_CODEX_COMMAND: selected },
    spawnImpl: fake.spawnImpl,
  });
  await provider('test-designer', {
    operation: 'design-executable-tests',
    changeId: 'change-1',
    worktree,
    branch: 'test-design',
  });
  assert.equal(fake.calls[0].command, selected);
});

test('native writer grants only the registered project Git metadata and Reviewer grants none', async () => {
  const { root, worktree } = fixture();
  const git = (cwd, args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'base']);
  git(root, ['worktree', 'add', '-b', 'test-design', worktree]);
  const fake = fakeSpawn();
  const provider = createNativeCodexRoleProvider({ projectRoot: root, spawnImpl: fake.spawnImpl });
  const result = await provider('test-designer', {
    operation: 'design-executable-tests',
    changeId: 'change-1',
    worktree,
    branch: 'test-design',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const args = fake.calls[0].args;
  assert.equal(args[args.indexOf('--add-dir') + 1], fs.realpathSync(path.join(root, '.git')));
  assert.equal(args.includes('danger-full-access'), false);
  await provider('review', { operation: 'review', changeId: 'change-1', worktree });
  assert.equal(fake.calls[1].args.includes('--add-dir'), false);

  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-native-foreign-git-'));
  git(foreign, ['init', '-q']);
  git(foreign, ['config', 'user.name', 'test']);
  git(foreign, ['config', 'user.email', 'test@example.com']);
  git(foreign, ['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'foreign']);
  const foreignWorktree = path.join(root, 'foreign-worktree');
  git(foreign, ['worktree', 'add', '-b', 'foreign', foreignWorktree]);
  const rejected = await provider('test-designer', {
    operation: 'design-executable-tests',
    changeId: 'change-1',
    worktree: foreignWorktree,
    branch: 'foreign',
  });
  assert.equal(rejected.code, 'ROLE_WORKTREE_GIT_INVALID');
  assert.equal(fake.calls.length, 2);
});

test('native role assignment is delivered through stdin with the complete worktree task', async () => {
  const { root, worktree } = fixture();
  const fake = fakeSpawn({
    lines: [
      { type: 'thread.started', thread_id: 'role-thread' },
      {
        type: 'item.completed',
        item: { type: 'agent_message', text: 'Implementation committed.' },
      },
    ],
  });
  const provider = createNativeCodexRoleProvider({
    projectRoot: root,
    command: 'codex-test',
    spawnImpl: fake.spawnImpl,
  });
  const result = await provider('test-designer', {
    operation: 'design-executable-tests',
    changeId: 'change-1',
    worktree,
    branch: 'sg/codex/change-1/test-design',
    baseCommit: 'a'.repeat(40),
    requirements: { acs: [{ id: 'AC-1' }], tasks: [] },
    contract: { content: { path: '/api/example' } },
    model: { content: { entities: ['Example'] } },
    manifest: 'specgate-tests.json',
    testRoot: 'specgate-tests/',
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.agent, 'specgate_test_designer');
  assert.equal(result.sessionId, 'role-thread');
  assert.equal(result.summary, 'Implementation committed.');
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].options.cwd, worktree);
  assert.deepEqual(fake.calls[0].args.slice(0, 4), ['exec', '--json', '--color', 'never']);
  assert.equal(fake.calls[0].args.at(-1), '-');
  assert.equal(fake.calls[0].args.includes(worktree), true);
  assert.equal(fake.calls[0].options.env.SPECGATE_ROLE_AGENT, 'specgate_test_designer');
  assert.match(fake.calls[0].prompt, /design-executable-tests/);
  assert.match(fake.calls[0].prompt, /sg\/codex\/change-1\/test-design/);
  assert.match(fake.calls[0].prompt, /AC-1/);
  assert.match(fake.calls[0].prompt, /Only specgate-tests\.json and files under specgate-tests/);
  assert.match(fake.calls[0].prompt, /A completion without a new commit will be rejected/);
  assert.match(fake.calls[0].prompt, /status must be exactly pass, fail or skip/);
  assert.match(
    fake.calls[0].prompt,
    /Changed executable configuration files also require coverage evidence/,
  );
});

test('native role prompt carries role boundaries without relying on undocumented subagent summaries', () => {
  const prompt = buildNativeRolePrompt({
    projectRoot: path.resolve('project'),
    role: 'frontend',
    challenge: {
      operation: 'implement',
      changeId: 'change-1',
      worktree: path.resolve('project/.specgate/codex/worktrees/change-1/frontend'),
      branch: 'sg/codex/change-1/frontend',
      freezeCommit: 'b'.repeat(40),
      graph: { tasks: [{ id: 'frontend-1', role: 'frontend' }] },
      contract: { content: { path: '/api/tasks' } },
      model: { content: { entities: ['Task'] } },
      tests: { cases: [{ id: 'CASE-AC-1' }] },
      conventions: { frontendFramework: 'vue' },
      filePolicy: [{ allowedFiles: ['src/client/**'], forbiddenFiles: ['tests/**'] }],
      findings: [{ id: 'F-REPAIR-1', expected: 'new payload', actual: 'old payload' }],
    },
    agentConfig: {
      agent: {
        name: 'specgate_frontend',
        title: 'SpecGate Frontend Agent',
      },
      instructions: 'Only change frontend files.',
    },
  });
  assert.match(prompt, /You are the assigned SpecGate Frontend Agent/);
  assert.match(prompt, /frozen filePolicy/);
  assert.match(prompt, /src\/client\/\*\*/);
  assert.match(prompt, /forbiddenFiles/);
  assert.match(prompt, /F-REPAIR-1/);
  assert.match(prompt, /git|commit/i);
  assert.match(prompt, /Only change frontend files/);
});

test('native Reviewer prompt names the exact finding JSON fields', () => {
  const prompt = buildNativeRolePrompt({
    projectRoot: path.resolve('project'),
    role: 'review',
    challenge: {
      operation: 'review',
      changeId: 'change-1',
      worktree: path.resolve('project/.specgate/codex/worktrees/change-1/review'),
      mode: 'strict',
      integrationCommit: 'b'.repeat(40),
      qualityHash: 'sha256:' + 'c'.repeat(64),
      quality: { status: 'passed' },
      diff: { text: '', files: [] },
      requirements: [{ id: 'AC-1' }],
    },
    agentConfig: {
      agent: {
        name: 'specgate_reviewer',
        title: 'SpecGate Reviewer',
      },
      instructions: 'Return one report.',
    },
  });
  assert.match(prompt, /changedLine/);
  assert.match(prompt, /evidence/);
  assert.match(prompt, /P0, P1, P2 or P3/);
  assert.match(prompt, /\.specgate\/codex\/\*\*/);
  assert.doesNotMatch(prompt, /changed line/);
  assert.doesNotMatch(prompt, /concrete evidence/);
});

test('native role provider fails closed when the process produces no machine events', async () => {
  const { root, worktree } = fixture();
  const fake = fakeSpawn({ lines: [], exitCode: 0 });
  const provider = createNativeCodexRoleProvider({
    projectRoot: root,
    command: 'codex-test',
    spawnImpl: fake.spawnImpl,
  });
  const result = await provider('frontend', {
    operation: 'implement',
    changeId: 'change-1',
    worktree,
    branch: 'sg/codex/change-1/frontend',
    freezeCommit: 'c'.repeat(40),
    graph: { tasks: [] },
    contract: {},
    model: {},
    tests: { cases: [] },
    conventions: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ROLE_AGENT_EXECUTION_FAILED');
});

test('native Reviewer runs read only and must return a structured machine report', async () => {
  const { root, worktree } = fixture();
  const report = {
    mode: 'strict',
    reviewedCommit: 'a'.repeat(40),
    qualityHash: 'sha256:' + 'b'.repeat(64),
    summary: 'Reviewed the fixed diff.',
    verdict: 'pass',
    findings: [],
  };
  const fake = fakeSpawn({
    lines: [
      { type: 'thread.started', thread_id: 'review-thread' },
      { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(report) } },
    ],
  });
  const provider = createNativeCodexRoleProvider({
    projectRoot: root,
    command: 'codex-test',
    spawnImpl: fake.spawnImpl,
  });
  const result = await provider('review', {
    operation: 'review',
    changeId: 'change-1',
    worktree,
    integrationCommit: report.reviewedCommit,
    qualityHash: report.qualityHash,
    mode: report.mode,
    quality: { status: 'passed' },
    diff: { text: '+safe code' },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.sessionId, 'review-thread');
  assert.equal(result.verdict, 'pass');
  assert.equal(fake.calls[0].args[fake.calls[0].args.indexOf('--sandbox') + 1], 'read-only');
  assert.match(fake.calls[0].prompt, /qualityHash/);
  assert.match(fake.calls[0].prompt, /parseable structured report/);
});
