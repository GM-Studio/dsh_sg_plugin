import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDevelopmentService } from '../src/codex/development.js';
import { fixture, roleProvider, git, commitAll } from './helpers/development-fixture.mjs';

test('Git commit validation enforces a narrower frozen task whitelist even inside the role directory', async () => {
  const context = await fixture({ backendFiles: ['backend/src/Allowed.java'] });
  const service = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    redRunner: context.redRunner,
    roleProvider: roleProvider(),
  });
  assert.equal((await service.prepare({ expectedVersion: await context.version() })).ok, true);
  const run = await service.run({ expectedVersion: await context.version() });
  assert.equal(run.ok, false);
  const development = (await context.store.inspect()).state.context.development;
  const refused = development.rounds
    .flatMap((round) => round.results)
    .flatMap((result) => result.violations || []);
  assert.ok(
    refused.some(
      (entry) =>
        entry.path === 'backend/src/TaskApi.java' && entry.code === 'FILE_OUTSIDE_TASK_POLICY',
    ),
  );
  assert.notEqual((await context.store.inspect()).state.phase, 'TESTING');
});

test('dependency edits need the exact H1-approved file hash and AC binding', async () => {
  const content = '<project>approved dependency fixture</project>\n';
  const sha256 = createHash('sha256').update(content).digest('hex');
  for (const mode of ['missing', 'wrong-hash', 'approved']) {
    const dependencyChanges =
      mode === 'missing'
        ? []
        : [
            {
              path: 'backend/pom.xml',
              sha256: mode === 'approved' ? sha256 : 'a'.repeat(64),
              acIds: ['AC-1'],
              reason: 'Synthetic fixture dependency approval at H1.',
            },
          ];
    const context = await fixture({ dependencyChanges });
    const provider = roleProvider({
      backend: async (challenge) => {
        fs.writeFileSync(path.join(challenge.worktree, 'backend/pom.xml'), content);
        commitAll(challenge.worktree, 'backend dependency change');
        return { ok: true };
      },
    });
    const service = createDevelopmentService({
      projectRoot: context.root,
      store: context.store,
      planService: context.planService,
      redRunner: context.redRunner,
      roleProvider: provider,
    });
    assert.equal((await service.prepare({ expectedVersion: await context.version() })).ok, true);
    const result = await service.run({ expectedVersion: await context.version() });
    assert.equal(result.ok, mode === 'approved', JSON.stringify(result));
    if (mode !== 'approved') {
      const development = (await context.store.inspect()).state.context.development;
      assert.ok(
        development.rounds
          .flatMap((round) => round.results)
          .flatMap((result) => result.violations || [])
          .some(
            (entry) =>
              entry.code === 'DEPENDENCY_APPROVAL_REQUIRED' && entry.path === 'backend/pom.xml',
          ),
      );
    }
  }
});

test('red baseline requires a real failing command mapped to every frozen case before worktrees', async () => {
  const rejected = await fixture({ redPasses: true });
  const rejectedService = createDevelopmentService({
    projectRoot: rejected.root,
    store: rejected.store,
    planService: rejected.planService,
    redRunner: rejected.redRunner,
  });
  const failed = await rejectedService.prepare({ expectedVersion: await rejected.version() });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'RED_BASELINE_NOT_FAILING');
  assert.equal((await rejected.store.inspect()).state.phase, 'TEST_CASES_FROZEN');
  assert.equal(fs.existsSync(path.join(rejected.root, '.specgate/codex/worktrees/example')), false);

  const ready = await fixture();
  const service = createDevelopmentService({
    projectRoot: ready.root,
    store: ready.store,
    planService: ready.planService,
    redRunner: ready.redRunner,
  });
  const prepared = await service.prepare({ expectedVersion: await ready.version() });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal(prepared.state.phase, 'DEVELOPING');
  const roles = ['frontend', 'backend', 'integration', 'test', 'review', 'format'];
  assert.deepEqual(Object.keys(prepared.development.worktrees).sort(), roles.sort());
  for (const role of roles) {
    const worktree = prepared.development.worktrees[role];
    assert.equal(fs.existsSync(worktree.path), true);
    assert.equal(git(worktree.path, ['rev-parse', 'HEAD']), prepared.development.freezeCommit);
  }
});

test('a stale red report cannot turn a command that emitted no case observations into a baseline', async () => {
  const context = await fixture();
  fs.writeFileSync(
    path.join(context.root, '.specgate/red-report.json'),
    JSON.stringify({ cases: [{ id: 'CASE-AC-1', status: 'fail' }] }),
  );
  const service = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    redRunner: () => ({
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
      cwd: context.root,
      reportPath: '.specgate/red-report.json',
    }),
  });
  const result = await service.prepare({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RED_REPORT_INVALID');
  assert.equal((await context.store.inspect()).state.phase, 'TEST_CASES_FROZEN');
  assert.equal(
    fs.existsSync(path.join(context.root, '.specgate/codex/worktrees/example/frontend')),
    false,
  );
});

test('red commands cannot change frozen test content before implementation worktrees are created', async () => {
  const context = await fixture();
  const frozen = (await context.planService.inspect()).ref.tests.directory;
  const script =
    "const fs=require('node:fs');fs.appendFileSync(process.argv[1],'// altered\\n');fs.writeFileSync(process.argv[2],JSON.stringify({cases:[{id:'CASE-AC-1',status:'fail'}]}));process.exit(1)";
  const service = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    redRunner: () => ({
      command: process.execPath,
      args: [
        '-e',
        script,
        path.join(context.root, frozen, 'cases/ac-1.test.mjs'),
        path.join(context.root, '.specgate/red-report.json'),
      ],
      cwd: context.root,
      reportPath: '.specgate/red-report.json',
    }),
  });
  const result = await service.prepare({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PLAN_ARTIFACT_CHANGED');
  assert.equal((await context.store.inspect()).state.phase, 'TEST_CASES_FROZEN');
  assert.equal(
    fs.existsSync(path.join(context.root, '.specgate/codex/worktrees/example/frontend')),
    false,
  );
});

test('frontend and backend run serially in isolated worktrees and merge only through integration', async () => {
  const context = await fixture();
  fs.writeFileSync(
    path.join(context.root, '.specgate', 'monorepo.json'),
    JSON.stringify({
      stack: 'java-vue',
      backendPackage: 'com.acme.orders',
      frontendDefaultLocale: 'zh-CN',
      frontendLocales: ['zh-CN', 'en-US'],
    }),
  );
  let active = 0;
  let maximum = 0;
  const baseProvider = roleProvider();
  const provider = async (role, challenge) => {
    assert.equal(challenge.conventions.backendPackage, 'com.acme.orders');
    assert.equal(challenge.conventions.frontendDefaultLocale, 'zh-CN');
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 80));
    try {
      return await baseProvider(role, challenge);
    } finally {
      active -= 1;
    }
  };
  const service = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    redRunner: context.redRunner,
    roleProvider: provider,
  });
  const prepared = await service.prepare({ expectedVersion: await context.version() });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const completed = await service.run({ expectedVersion: prepared.state.version });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal(maximum, 1);
  assert.equal(completed.state.phase, 'TESTING');
  assert.equal(completed.development.merged.length, 2);
  const integration = completed.development.worktrees.integration.path;
  assert.match(
    fs.readFileSync(path.join(integration, 'backend/src/TaskApi.java'), 'utf8'),
    /integrated/,
  );
  assert.match(
    fs.readFileSync(path.join(integration, 'frontend/src/App.vue'), 'utf8'),
    /integrated/,
  );
  assert.equal(
    git(completed.development.worktrees.test.path, ['rev-parse', 'HEAD']),
    completed.development.freezeCommit,
  );
  assert.equal(
    git(completed.development.worktrees.review.path, ['rev-parse', 'HEAD']),
    completed.development.freezeCommit,
  );
  const integrationCommit = git(integration, ['rev-parse', 'HEAD']);
  git(completed.development.worktrees.test.path, ['checkout', '--detach', integrationCommit]);
  const inspected = await service.inspect();
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.equal(inspected.development.worktrees.test.head, integrationCommit);
  assert.equal(
    inspected.development.worktrees.test.branch,
    completed.development.worktrees.test.branch,
  );
});

test('server accepts native-role precompleted commits only when they descend from freeze', async () => {
  const context = await fixture();
  const service = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    redRunner: context.redRunner,
    roleProvider: async (role, challenge) => {
      const previous = challenge.previousCommit;
      const relative = role === 'frontend' ? 'frontend/src/App.vue' : 'backend/src/TaskApi.java';
      fs.writeFileSync(
        path.join(challenge.worktree, relative),
        role === 'frontend'
          ? '<template><p>native frontend</p></template>\n'
          : 'final class TaskApi { String title = "native backend"; }\n',
      );
      const commit = commitAll(challenge.worktree, `${role} precompleted`);
      assert.notEqual(commit, previous);
      return { ok: true, precompleted: true, summary: `${role} completed before orchestration` };
    },
  });
  const prepared = await service.prepare({ expectedVersion: await context.version() });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const completed = await service.run({ expectedVersion: prepared.state.version });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal(completed.state.phase, 'TESTING');
  assert.equal(completed.development.merged.length, 2);
});

test('cross-role or test-file changes fail closed, exhaust the shared retry ceiling and preserve branches', async () => {
  const context = await fixture();
  let calls = 0;
  const provider = roleProvider({
    frontend: async (challenge) => {
      calls += 1;
      fs.writeFileSync(
        path.join(challenge.worktree, 'backend', 'src', 'Leak.java'),
        `final class Leak { int attempt = ${calls}; }\n`,
      );
      commitAll(challenge.worktree, `frontend leak ${calls}`);
      return { ok: true, summary: 'attempted cross-role write' };
    },
  });
  const service = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    redRunner: context.redRunner,
    roleProvider: provider,
  });
  const prepared = await service.prepare({ expectedVersion: await context.version() });
  const failed = await service.run({ expectedVersion: prepared.state.version });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'WORKFLOW_BLOCKED');
  assert.equal(calls, 3);
  assert.equal(failed.state.phase, 'BLOCKED');
  assert.equal(
    fs.existsSync(
      path.join(failed.development.worktrees.frontend.path, 'backend', 'src', 'Leak.java'),
    ),
    true,
  );
  assert.equal(
    git(failed.development.worktrees.integration.path, ['rev-parse', 'HEAD']),
    failed.development.freezeCommit,
  );
});

test('merge conflicts return to the owning role with conflict paths before integration continues', async () => {
  const context = await fixture({
    backendFiles: ['backend/**', 'shared/config.json'],
    frontendFiles: ['frontend/**', 'shared/config.json'],
  });
  const resolveCalls = [];
  const sharedProvider = async (role, challenge) => {
    if (challenge.operation === 'resolve-conflict') {
      resolveCalls.push({ role, paths: challenge.conflictPaths });
      try {
        git(challenge.worktree, ['merge', '--no-edit', challenge.integrationBranch]);
      } catch {
        // The shared file intentionally conflicts and is resolved below.
      }
      fs.writeFileSync(
        path.join(challenge.worktree, 'shared', 'config.json'),
        '{"owner":"merged"}\n',
      );
      commitAll(challenge.worktree, 'resolve integration conflict');
      return { ok: true, summary: 'resolved conflict' };
    }
    fs.mkdirSync(path.join(challenge.worktree, 'shared'), { recursive: true });
    fs.writeFileSync(
      path.join(challenge.worktree, 'shared', 'config.json'),
      `{"owner":"${role}"}\n`,
    );
    commitAll(challenge.worktree, `${role} shared config`);
    return { ok: true, summary: `${role} changed shared config` };
  };
  const service = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    redRunner: context.redRunner,
    roleProvider: sharedProvider,
    rolePolicy: () => ({ ok: true }),
  });
  const prepared = await service.prepare({ expectedVersion: await context.version() });
  const completed = await service.run({ expectedVersion: prepared.state.version });
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal(completed.state.phase, 'TESTING');
  assert.equal(resolveCalls.length, 1);
  assert.deepEqual(resolveCalls[0].paths, ['shared/config.json']);
  assert.deepEqual(
    JSON.parse(
      fs.readFileSync(
        path.join(completed.development.worktrees.integration.path, 'shared', 'config.json'),
        'utf8',
      ),
    ),
    { owner: 'merged' },
  );
});
