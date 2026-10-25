import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
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
  assert.match(prompt, /Change only files permitted by the frozen task whitelist/);
  assert.match(prompt, /frontend-1/);
  assert.match(prompt, /git|commit/i);
  assert.match(prompt, /Only change frontend files/);
});

test('native Implementer stdin carries concrete repair evidence and the frozen task whitelist', () => {
  const prompt = buildNativeRolePrompt({
    projectRoot: path.resolve('project'),
    role: 'backend',
    agentConfig: {
      agent: { name: 'specgate_backend', title: 'SpecGate Implementer' },
      instructions: 'Obey frozen task boundaries.',
    },
    challenge: {
      operation: 'repair',
      changeId: 'change-1',
      worktree: path.resolve('project/worktree'),
      branch: 'sg/change-1/backend',
      allowedFiles: ['src/orders/**'],
      forbiddenFiles: ['tests/**'],
      graph: {
        tasks: [
          {
            id: 'backend-1',
            kind: 'backend',
            allowedFiles: ['src/orders/**'],
            forbiddenFiles: ['tests/**'],
          },
        ],
      },
      repairContext: {
        source: 'quality',
        command: { command: 'node', args: ['tests.mjs'], exitCode: 1 },
        findings: [
          {
            id: 'FAIL-1',
            file: 'src/orders/order.js',
            line: 12,
            acIds: ['AC-1'],
            evidence: 'Expected total 3, observed 2.',
            suggestion: 'Include the final item.',
          },
        ],
        cases: [{ id: 'CASE-1', expected: '3', actual: '2' }],
        logSummary: 'Assertion failed: 2 !== 3',
      },
    },
  });
  const assignment = JSON.parse(
    prompt.split('<specgate_assignment>\n')[1].split('\n</specgate_assignment>')[0],
  );
  assert.equal(assignment.repairContext.findings[0].id, 'FAIL-1');
  assert.equal(assignment.repairContext.command.exitCode, 1);
  assert.equal(assignment.repairContext.cases[0].expected, '3');
  assert.deepEqual(assignment.allowedFiles, ['src/orders/**']);
  assert.deepEqual(assignment.forbiddenFiles, ['tests/**']);
  assert.doesNotMatch(prompt, /Change only files below backend\//);
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
