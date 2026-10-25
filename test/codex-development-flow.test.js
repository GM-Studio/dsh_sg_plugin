import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApprovalAuthority } from '../src/codex/approvals.js';
import { createDevelopmentService } from '../src/codex/development.js';
import { canonicalJson, hashValue } from '../src/codex/events.js';
import { createPlanService } from '../src/codex/plan.js';
import { createStateStore } from '../src/codex/state-machine.js';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();
}

function commitAll(cwd, message) {
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', message]);
  return git(cwd, ['rev-parse', 'HEAD']);
}

function requirements() {
  return [
    {
      id: 'REQ-1',
      category: 'functional',
      text: 'Show and persist the task title.',
      acceptanceCriteria: [{ id: 'AC-1', text: 'The UI displays the persisted title.' }],
    },
  ];
}

const contracts = {
  contract: {
    version: 1,
    content: { endpoints: [{ method: 'GET', path: '/tasks', operation: 'query' }] },
  },
  model: {
    version: 1,
    content: { entities: [{ name: 'Task', fields: { id: 'string', title: 'string' } }] },
  },
};

const assets = () => ({
  role: 'test',
  cases: [
    {
      id: 'CASE-AC-1',
      acIds: ['AC-1'],
      description: 'The persisted title is displayed.',
      codeFiles: ['cases/ac-1.test.mjs'],
    },
  ],
  code: {
    'cases/ac-1.test.mjs':
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('title', () => assert.fail('implementation missing'));\n",
  },
  fixtures: { 'fixtures/task.json': '{"id":"fixture-task","title":"Fixture"}\n' },
  coverage: { lines: 80, branches: 70 },
});

async function fixture({ redPasses = false, filePolicies, dependencyChanges } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-development-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(root, '.gitignore'), '.specgate/\n');
  fs.mkdirSync(path.join(root, 'backend', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend', 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backend', 'src', 'TaskApi.java'),
    'final class TaskApi { String title = "base"; }\n',
  );
  fs.writeFileSync(
    path.join(root, 'frontend', 'src', 'App.vue'),
    '<template><p>base</p></template>\n',
  );
  commitAll(root, 'initial product');

  const relative = '.specgate/codex/changes/example/requirements/revision-1-fixture.json';
  const snapshot = {
    schemaVersion: 1,
    changeId: 'example',
    revision: 1,
    requirements: requirements().map((req) =>
      dependencyChanges ? { ...req, dependencyChanges } : req,
    ),
    fixture: 'synthetic-unit-test-not-runtime',
  };
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), canonicalJson(snapshot));
  const requirementsHash = 'sha256:' + hashValue(snapshot);
  let store;
  const authority = createApprovalAuthority({
    request: async () => ({
      action: 'accept',
      content: {
        decision: 'approve',
        comment: 'Synthetic unit fixture, not native runtime evidence.',
      },
    }),
    trustedPeerIdentity: {
      id: 'test-user',
      kind: 'user',
      source: 'synthetic-unit-test-not-runtime',
    },
    audit: async (entry) => {
      const current = await store.inspect();
      const result = await store.recordEvent({
        expectedVersion: current.state.version,
        type: entry.type,
        payload: entry,
      });
      if (!result.ok) throw Error(result.code);
    },
  });
  store = createStateStore({ projectRoot: root, authorizeGate: authority.authorizeGate });
  await store.create({
    expectedVersion: 0,
    changeId: 'example',
    context: {
      artifacts: { requirements: { hash: requirementsHash, revision: 1 } },
      changeAdd: {
        frozen: {
          path: relative,
          hash: requirementsHash,
          revision: 1,
          authority: 'REQ_FROZEN-gate-transition',
        },
      },
    },
  });
  for (const to of ['REQ_CLARIFYING', 'REQ_CRITIQUE', 'H1_PENDING']) {
    const current = await store.inspect();
    assert.equal((await store.transition({ expectedVersion: current.state.version, to })).ok, true);
  }
  const issued = await authority.requestApproval({
    gate: 'H1',
    scope: 'example',
    artifactHash: requirementsHash,
    readArtifactHash: async () => requirementsHash,
    summary: 'Synthetic requirements snapshot.',
  });
  assert.equal(
    (
      await store.transition({
        expectedVersion: (await store.inspect()).state.version,
        to: 'REQ_FROZEN',
        approval: issued.approval,
      })
    ).ok,
    true,
  );

  const planService = createPlanService({
    projectRoot: root,
    store,
    roleProvider: async () => assets(),
  });
  assert.equal(
    (
      await planService.generate({
        expectedVersion: (await store.inspect()).state.version,
        filePolicies,
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await planService.freezeContracts({
        expectedVersion: (await store.inspect()).state.version,
        ...contracts,
      })
    ).ok,
    true,
  );
  assert.equal(
    (await planService.freezeTests({ expectedVersion: (await store.inspect()).state.version })).ok,
    true,
  );

  const runnerPath = path.join(root, '.specgate', 'red-runner.mjs');
  const reportPath = '.specgate/red-report.json';
  fs.writeFileSync(
    runnerPath,
    [
      "import fs from 'node:fs';",
      'const report = process.argv[2];',
      "fs.writeFileSync(report, JSON.stringify({ cases: [{ id: 'CASE-AC-1', status: process.env.RED_STATUS }] }));",
      "process.exit(process.env.RED_EXIT === '0' ? 0 : 1);",
      '',
    ].join('\n'),
  );
  const redRunner = () => ({
    command: process.execPath,
    args: [runnerPath, path.join(root, reportPath)],
    cwd: root,
    reportPath,
    env: {
      RED_EXIT: redPasses ? '0' : '1',
      RED_STATUS: redPasses ? 'pass' : 'fail',
    },
  });
  return {
    root,
    store,
    planService,
    redRunner,
    version: async () => (await store.inspect()).state.version,
  };
}

function roleProvider(overrides = {}) {
  return async (role, challenge) => {
    if (overrides[role]) return overrides[role](challenge);
    const relative = role === 'frontend' ? 'frontend/src/App.vue' : 'backend/src/TaskApi.java';
    const content =
      role === 'frontend'
        ? '<template><p>integrated title</p></template>\n'
        : 'final class TaskApi { String title = "integrated title"; }\n';
    const file = path.join(challenge.worktree, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    commitAll(challenge.worktree, `${role} implementation`);
    return { ok: true, summary: `${role} implemented AC-1` };
  };
}

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
    filePolicies: Object.fromEntries(
      ['frontend', 'backend'].map((role) => [
        role,
        { allowedFiles: [`${role}/**`, 'shared/**'], forbiddenFiles: [] },
      ]),
    ),
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

test('same-role changes outside task allowlists and inside forbiddenFiles are blocked', async () => {
  for (const forbidden of [false, true]) {
    const context = await fixture({
      filePolicies: {
        backend: {
          allowedFiles: [forbidden ? 'backend/**' : 'backend/src/Allowed.java'],
          forbiddenFiles: forbidden ? ['backend/src/TaskApi.java'] : [],
        },
      },
    });
    let attempt = 0;
    const service = createDevelopmentService({
      projectRoot: context.root,
      store: context.store,
      planService: context.planService,
      redRunner: context.redRunner,
      roleProvider: roleProvider({
        backend: async (challenge) => {
          fs.writeFileSync(
            path.join(challenge.worktree, 'backend/src/TaskApi.java'),
            'final class TaskApi { int n=' + ++attempt + '; }\n',
          );
          commitAll(challenge.worktree, 'outside policy');
          return { ok: true };
        },
      }),
    });
    const prepared = await service.prepare({ expectedVersion: await context.version() });
    const result = await service.run({ expectedVersion: prepared.state.version });
    assert.equal(result.code, 'WORKFLOW_BLOCKED');
    assert.equal(result.errors.backend.code, 'ROLE_POLICY_VIOLATION');
    assert.equal(result.errors.backend.violations[0].path, 'backend/src/TaskApi.java');
  }
});

test('dependency manifests require the exact H1-approved content hash and AC', async () => {
  const content = '<project>approved dependency</project>\n';
  const hash = 'sha256:' + createHash('sha256').update(content).digest('hex');
  const context = await fixture({
    dependencyChanges: [{ file: 'backend/pom.xml', hash, acIds: ['AC-1'] }],
  });
  const service = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    redRunner: context.redRunner,
    roleProvider: roleProvider({
      backend: async (challenge) => {
        fs.writeFileSync(path.join(challenge.worktree, 'backend/pom.xml'), content);
        commitAll(challenge.worktree, 'approved dependency');
        return { ok: true };
      },
    }),
  });
  const prepared = await service.prepare({ expectedVersion: await context.version() });
  assert.equal((await service.run({ expectedVersion: prepared.state.version })).ok, true);
  const denied = await fixture();
  let attempt = 0;
  const unapproved = createDevelopmentService({
    projectRoot: denied.root,
    store: denied.store,
    planService: denied.planService,
    redRunner: denied.redRunner,
    roleProvider: roleProvider({
      backend: async (challenge) => {
        fs.writeFileSync(
          path.join(challenge.worktree, 'backend/package-lock.json'),
          JSON.stringify({ version: ++attempt }),
        );
        commitAll(challenge.worktree, 'unapproved lock change');
        return { ok: true };
      },
    }),
  });
  const ready = await unapproved.prepare({ expectedVersion: await denied.version() });
  const result = await unapproved.run({ expectedVersion: ready.state.version });
  assert.equal(result.code, 'WORKFLOW_BLOCKED');
  assert.equal(result.errors.backend.code, 'DEPENDENCY_APPROVAL_REQUIRED');
  assert.deepEqual(result.errors.backend.pendingDependencies, ['backend/package-lock.json']);
});
