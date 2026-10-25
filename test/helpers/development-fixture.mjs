import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApprovalAuthority } from '../../src/codex/approvals.js';
import { canonicalJson, hashValue } from '../../src/codex/events.js';
import { createPlanService, buildTaskGraph } from '../../src/codex/plan.js';
import { createStateStore } from '../../src/codex/state-machine.js';

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
    acIds: ['AC-1'],
    content: { endpoints: [{ method: 'GET', path: '/tasks', operation: 'query' }] },
  },
  model: {
    version: 1,
    acIds: ['AC-1'],
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

async function fixture({
  redPasses = false,
  dependencyChanges = [],
  backendFiles,
  frontendFiles,
} = {}) {
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
    requirements: requirements(),
    dependencyChanges,
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
        ...(backendFiles || frontendFiles
          ? {
              taskPolicies: Object.fromEntries(
                buildTaskGraph(snapshot)
                  .graph.tasks.filter(
                    (task) =>
                      (task.kind === 'backend' && backendFiles) ||
                      (task.kind === 'frontend' && frontendFiles),
                  )
                  .map((task) => [
                    task.id,
                    { allowedFiles: task.kind === 'backend' ? backendFiles : frontendFiles },
                  ]),
              ),
            }
          : {}),
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

export { fixture, roleProvider, git, commitAll };
