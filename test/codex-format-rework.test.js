import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  createDevelopmentService,
  createPrecompletedRoleProvider,
} from '../src/codex/development.js';
import { createFormatService } from '../src/codex/format.js';
import { createStateStore } from '../src/codex/state-machine.js';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function commit(cwd, message) {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

async function fixture({ through = 'FORMATTING' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-format-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(root, '.gitignore'), '.specgate/\n');
  fs.mkdirSync(path.join(root, 'backend/src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend/src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend/src/App.java'), 'final class App{int n=1;}\n');
  fs.writeFileSync(path.join(root, 'frontend/src/App.ts'), 'export const n = 1;\n');
  const freezeCommit = commit(root, 'baseline');
  const integrationPath = path.join(root, '.specgate/codex/worktrees/example/integration');
  git(root, [
    'worktree',
    'add',
    '-b',
    'sg/codex/example/integration',
    integrationPath,
    freezeCommit,
  ]);
  fs.writeFileSync(
    path.join(integrationPath, 'backend/src/App.java'),
    'final class App { int n = 2; }\n',
  );
  const featureCommit = commit(integrationPath, 'feature');
  const formatPath = path.join(root, '.specgate/codex/worktrees/example/format');
  git(root, ['worktree', 'add', '-b', 'sg/codex/example/format', formatPath, freezeCommit]);
  const testPath = path.join(root, '.specgate/codex/worktrees/example/test');
  const reviewPath = path.join(root, '.specgate/codex/worktrees/example/review');
  git(root, ['worktree', 'add', '--detach', testPath, featureCommit]);
  git(root, ['worktree', 'add', '--detach', reviewPath, featureCommit]);
  const store = createStateStore({
    projectRoot: root,
    authorizeGate: async () => ({
      ok: true,
      record: {
        gate: 'H1',
        scope: 'example',
        decision: 'approve',
        consumedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        nonce: 'a'.repeat(64),
        actor: { kind: 'user', id: 'fixture', source: 'format-fixture' },
      },
    }),
  });
  await store.create({
    expectedVersion: 0,
    changeId: 'example',
    context: {
      development: {
        schemaVersion: 1,
        changeId: 'example',
        freezeCommit,
        merged: [{ role: 'backend', integrationCommit: featureCommit }],
        rounds: [],
        conflicts: [],
        worktrees: {
          integration: { path: integrationPath, branch: 'sg/codex/example/integration' },
          format: { path: formatPath, branch: 'sg/codex/example/format' },
          test: { path: testPath, branch: 'test' },
          review: { path: reviewPath, branch: 'review' },
        },
      },
    },
  });
  const phases = [
    'REQ_CLARIFYING',
    'REQ_CRITIQUE',
    'H1_PENDING',
    'REQ_FROZEN',
    'PLANNING',
    'TEST_DESIGN',
    'TEST_CASES_FROZEN',
    'DEVELOPING',
    'INTEGRATING',
    'TESTING',
  ];
  if (through === 'FORMATTING') phases.push('FORMATTING');
  for (const phase of phases) {
    const current = await store.inspect();
    const moved = await store.transition({ expectedVersion: current.state.version, to: phase });
    assert.equal(moved.ok, true, JSON.stringify(moved));
  }
  const planService = {
    inspect: async () => {
      fs.mkdirSync(path.join(root, '.specgate/tests'), { recursive: true });
      fs.writeFileSync(path.join(root, '.specgate/contract.json'), '{}\n');
      fs.writeFileSync(path.join(root, '.specgate/model.json'), '{}\n');
      fs.writeFileSync(
        path.join(root, '.specgate/tests/manifest.json'),
        JSON.stringify({ cases: [{ id: 'CASE-AC-1', acIds: ['AC-1'] }] }),
      );
      return {
        ok: true,
        state: (await store.inspect()).state,
        plan: { graph: { acs: [] } },
        ref: {
          contract: { path: '.specgate/contract.json', hash: 'sha256:' + '1'.repeat(64) },
          model: { path: '.specgate/model.json', hash: 'sha256:' + '2'.repeat(64) },
          tests: {
            path: '.specgate/tests/manifest.json',
            directory: '.specgate/tests',
            hash: 'sha256:' + '3'.repeat(64),
          },
        },
      };
    },
  };
  return {
    root,
    store,
    planService,
    freezeCommit,
    featureCommit,
    integrationPath,
    formatPath,
    version: async () => (await store.inspect()).state.version,
  };
}

test('failed quality returns defects to a new development round', async () => {
  const context = await fixture({ through: 'TESTING' });
  const current = await context.store.inspect();
  await context.store.update({
    expectedVersion: current.state.version,
    patch: {
      context: {
        quality: {
          status: 'failed',
          code: 'VERIFY_FAILED',
          defects: [
            {
              id: 'QUALITY-1',
              severity: 'P1',
              stage: 'verification',
              message: 'Legacy frontend test expects the old payload.',
              owners: ['frontend'],
            },
          ],
        },
      },
    },
  });
  const development = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
  });
  const repaired = await development.prepareRepair({
    expectedVersion: await context.version(),
  });
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  assert.equal(repaired.state.phase, 'DEVELOPING');
  assert.equal(repaired.repair.findings[0].id, 'QUALITY-1');
  assert.match(repaired.repair.worktrees.frontend.path.replace(/\\/g, '/'), /round-1\/frontend/);
  fs.writeFileSync(
    path.join(repaired.repair.worktrees.frontend.path, 'frontend/src/App.ts'),
    'export const n = 2;\n',
  );
  commit(repaired.repair.worktrees.frontend.path, 'repair frontend');
  const repairedDevelopment = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: createPrecompletedRoleProvider(),
  });
  const advanced = await repairedDevelopment.run({
    expectedVersion: repaired.state.version,
  });
  assert.equal(advanced.ok, true, JSON.stringify(advanced));
  assert.equal(advanced.state.phase, 'TESTING');
});

test('Formatter runs only after tests, commits in its worktree and merges before Review', async () => {
  const context = await fixture();
  const service = createFormatService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    formatter: async ({ worktree }) => {
      fs.writeFileSync(
        path.join(worktree, 'backend/src/App.java'),
        'final class App {\n int n = 2;\n}\n',
      );
      return { ok: true, commands: [{ command: 'fixture-formatter' }] };
    },
  });
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.phase, 'REVIEWING');
  assert.equal(result.format.changedFiles[0], 'backend/src/App.java');
  assert.match(
    fs.readFileSync(path.join(context.integrationPath, 'backend/src/App.java'), 'utf8'),
    /\n int n/,
  );
  assert.equal((await service.inspect()).ok, true);
});

test('Formatter cannot modify tests or files outside the development delta', async () => {
  const context = await fixture();
  const service = createFormatService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    formatter: async ({ worktree }) => {
      fs.writeFileSync(path.join(worktree, 'backend/src/App.java'), 'final class App {}\n');
      fs.mkdirSync(path.join(worktree, 'backend/src/test'), { recursive: true });
      fs.writeFileSync(path.join(worktree, 'backend/src/test/Leak.java'), 'final class Leak {}\n');
      return { ok: true, commands: [] };
    },
  });
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.code, 'FORMAT_ROLE_POLICY_VIOLATION');
  assert.equal((await context.store.inspect()).state.phase, 'FORMATTING');
  assert.equal(git(context.integrationPath, ['rev-parse', 'HEAD']), context.featureCommit);
});

test('blocking Review starts a new round with fresh frontend/backend/format worktrees', async () => {
  const context = await fixture();
  const formatting = createFormatService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    formatter: async ({ worktree }) => {
      fs.writeFileSync(
        path.join(worktree, 'backend/src/App.java'),
        'final class App {\n int n = 2;\n}\n',
      );
      return { ok: true, commands: [] };
    },
  });
  const formatted = await formatting.run({ expectedVersion: await context.version() });
  assert.equal(formatted.ok, true, JSON.stringify(formatted));
  const current = await context.store.inspect();
  await context.store.update({
    expectedVersion: current.state.version,
    patch: {
      context: {
        review: {
          status: 'failed',
          reportPath: '.specgate/review.json',
          blocking: [
            {
              id: 'F-1',
              severity: 'P1',
              file: 'backend/src/App.java',
              line: 1,
              recommendation: 'Fix data loss.',
            },
          ],
        },
      },
    },
  });
  const development = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
  });
  const rework = await development.prepareRework({
    expectedVersion: await context.version(),
  });
  assert.equal(rework.ok, true, JSON.stringify(rework));
  assert.equal(rework.state.phase, 'DEVELOPING');
  assert.equal(rework.rework.round, 1);
  for (const role of ['frontend', 'backend', 'format'])
    assert.match(rework.rework.worktrees[role].path, /round-1/);
});
