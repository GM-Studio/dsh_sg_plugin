import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createStateStore } from '../src/codex/state-machine.js';
import { createApprovalAuthority } from '../src/codex/approvals.js';
import { canonicalJson, hashValue } from '../src/codex/events.js';
import { buildTaskGraph, validateTaskGraph, createPlanService } from '../src/codex/plan.js';

function requirements(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    id: `REQ-${index + 1}`,
    category: 'functional',
    text: `Requirement ${index + 1}`,
    acceptanceCriteria: [{ id: `AC-${index + 1}`, text: `Observable condition ${index + 1}` }],
  }));
}

async function fixture({
  count = 1,
  forged = false,
  roleProvider,
  testDesignerRunner,
  dependencyChanges = [],
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-plan-'));
  const relative = '.specgate/codex/changes/example/requirements/revision-1-fixture.json';
  const snapshot = {
    schemaVersion: 1,
    changeId: 'example',
    revision: 1,
    requirements: requirements(count),
    dependencyChanges,
    fixture: 'synthetic-unit-test-not-runtime',
  };
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), canonicalJson(snapshot));
  const hash = 'sha256:' + hashValue(snapshot);
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
  store = createStateStore({
    projectRoot: root,
    authorizeGate: forged ? () => ({ ok: true, record: {} }) : authority.authorizeGate,
  });
  await store.create({
    expectedVersion: 0,
    changeId: 'example',
    context: {
      artifacts: { requirements: { hash, revision: 1 } },
      changeAdd: {
        frozen: { path: relative, hash, revision: 1, authority: 'REQ_FROZEN-gate-transition' },
      },
    },
  });
  for (const to of ['REQ_CLARIFYING', 'REQ_CRITIQUE', 'H1_PENDING'])
    assert.equal(
      (await store.transition({ expectedVersion: (await store.inspect()).state.version, to })).ok,
      true,
    );
  const issued = forged
    ? {}
    : await authority.requestApproval({
        gate: 'H1',
        scope: 'example',
        artifactHash: hash,
        readArtifactHash: async () =>
          'sha256:' + hashValue(JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))),
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
  const service = createPlanService({
    projectRoot: root,
    store,
    roleProvider,
    testDesignerRunner,
  });
  const version = async () => (await store.inspect()).state.version;
  return { root, store, service, version, relative, snapshot };
}

const contracts = {
  contract: {
    version: 1,
    acIds: ['AC-1'],
    content: { endpoints: [{ method: 'GET', path: '/tasks', operation: 'query' }] },
  },
  model: { version: 1, acIds: ['AC-1'], content: { entities: [{ name: 'Task', id: 'string' }] } },
};
const assets = (count = 1) => ({
  role: 'test',
  cases: Array.from({ length: count }, (_, index) => ({
    id: `CASE-AC-${index + 1}`,
    acIds: [`AC-${index + 1}`],
    description: `Prove AC-${index + 1}`,
    codeFiles: [`cases/ac-${index + 1}.test.mjs`],
  })),
  code: Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `cases/ac-${index + 1}.test.mjs`,
      "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('pending implementation', () => assert.fail('implementation missing'));\n",
    ]),
  ),
  fixtures: { 'fixtures/task.json': '{"id":"fixture-task"}\n' },
  coverage: { lines: 80, branches: 70 },
});

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

test('dynamic AC task graph includes every required role, mapping and ordering without a fixed task count', () => {
  const small = buildTaskGraph({ requirements: requirements(1) });
  const large = buildTaskGraph({ requirements: requirements(3) });
  assert.equal(small.ok, true);
  assert.equal(large.ok, true);
  assert.ok(large.graph.tasks.length > small.graph.tasks.length);
  assert.equal(large.graph.maxParallelDevelopment, 1);
  for (const task of large.graph.tasks) {
    assert.ok(task.acIds.length && task.caseIds.length && task.role && task.acceptance.length);
    if (['frontend', 'backend'].includes(task.kind)) {
      assert.ok(task.deps.includes('contract') && task.deps.includes('model'));
      assert.ok(task.deps.some((dependency) => dependency.startsWith('test-')));
    }
  }
  assert.equal(validateTaskGraph(large.graph).ok, true);
  const extraAc = requirements(1);
  extraAc[0].acceptanceCriteria.push({ id: 'AC-second', text: 'A second observable condition' });
  assert.ok(
    buildTaskGraph({ requirements: extraAc }).graph.tasks.length > small.graph.tasks.length,
  );
});

test('DAG validation rejects cycles, dangling dependencies, invalid AC references and development gate removal', () => {
  const valid = buildTaskGraph({ requirements: requirements(2) }).graph;
  for (const mutate of [
    (graph) => graph.tasks[0].deps.push(graph.tasks.at(-1).id),
    (graph) => graph.tasks[0].deps.push('missing-task'),
    (graph) => graph.tasks[0].acIds.push('AC-unknown'),
    (graph) => {
      graph.tasks.find((task) => task.kind === 'frontend').deps = [];
    },
    (graph) => {
      graph.maxParallelDevelopment = 3;
    },
    (graph) => {
      graph.tasks.find((task) => task.kind === 'frontend').role = 'test';
    },
  ]) {
    const graph = structuredClone(valid);
    mutate(graph);
    assert.equal(validateTaskGraph(graph).ok, false);
  }
  assert.equal(validateTaskGraph({ acs: [null], tasks: [], maxParallelDevelopment: 2 }).ok, false);
});

test('every executable plan task binds requirements, file boundaries, dependencies and verification', () => {
  const built = buildTaskGraph({ requirements: requirements(2) });
  assert.equal(built.ok, true);
  for (const task of built.graph.tasks) {
    assert.ok(task.requirementIds?.length, task.id);
    assert.ok(task.allowedFiles?.length, task.id);
    assert.ok(task.forbiddenFiles?.length, task.id);
    assert.deepEqual(task.dependencies, task.deps);
    assert.ok(task.verification?.length, task.id);
  }
  for (const mutate of [
    (task) => {
      delete task.allowedFiles;
    },
    (task) => {
      task.allowedFiles = [];
    },
    (task) => {
      task.allowedFiles = ['../outside/**'];
    },
    (task) => {
      task.allowedFiles = ['/absolute/**'];
    },
    (task) => {
      task.allowedFiles = ['src/../outside/**'];
    },
    (task) => {
      task.allowedFiles = ['src/**', 'src/**'];
    },
    (task) => {
      task.requirementIds = ['REQ-missing'];
    },
    (task) => {
      task.dependencies = ['missing'];
    },
    (task) => {
      task.verification = [];
    },
  ]) {
    const graph = structuredClone(built.graph);
    mutate(graph.tasks.find((t) => t.kind === 'backend'));
    assert.equal(validateTaskGraph(graph).ok, false);
  }
});

test('task policy proposals can narrow files, while unknown tasks and escaping rules are rejected', () => {
  const snapshot = { requirements: requirements(1) };
  const graph = buildTaskGraph(snapshot).graph;
  const task = graph.tasks.find((t) => t.kind === 'backend');
  const built = buildTaskGraph(snapshot, {
    taskPolicies: {
      [task.id]: {
        allowedFiles: ['backend/src/Task.java'],
        forbiddenFiles: ['backend/src/blocked/**'],
      },
    },
  });
  assert.equal(built.ok, true);
  assert.deepEqual(built.graph.tasks.find((t) => t.id === task.id).allowedFiles, [
    'backend/src/Task.java',
  ]);
  assert.equal(
    buildTaskGraph(snapshot, { taskPolicies: { missing: { allowedFiles: ['src/**'] } } }).ok,
    false,
  );
  assert.equal(
    buildTaskGraph(snapshot, { taskPolicies: { [task.id]: { allowedFiles: ['E:/outside/**'] } } })
      .ok,
    false,
  );
});

test('contract and data model changes require explicit valid AC associations before freezing', async () => {
  for (const kind of ['contract', 'model']) {
    const context = await fixture();
    await context.service.generate({ expectedVersion: await context.version() });
    const draft = structuredClone(contracts);
    delete draft[kind].acIds;
    const before = await context.version();
    const result = await context.service.freezeContracts({ expectedVersion: before, ...draft });
    assert.equal(result.ok, false);
    assert.equal(await context.version(), before);
  }
});

test('dependency permissions originate in the H1-bound snapshot and bind exact file hashes and ACs', async () => {
  const dependencyChanges = [
    {
      path: 'backend/pom.xml',
      sha256: 'a'.repeat(64),
      acIds: ['AC-1'],
      reason: 'Required Maven dependency for AC-1.',
    },
  ];
  const context = await fixture({ dependencyChanges });
  const result = await context.service.generate({ expectedVersion: await context.version() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.plan.graph.dependencyChanges, dependencyChanges);
  assert.equal(result.plan.dependencyApproval.requirementsHash, result.plan.requirementsHash);
  const invalid = buildTaskGraph({
    requirements: requirements(),
    dependencyChanges: [{ ...dependencyChanges[0], acIds: ['AC-unknown'] }],
  });
  assert.equal(invalid.ok, false);
});

test('historical plans remain inspectable without rewrite and cannot authorize downstream mutations', async () => {
  const context = await fixture();
  const generated = await context.service.generate({ expectedVersion: await context.version() });
  assert.equal(generated.ok, true);
  const old = structuredClone(generated.plan);
  old.schemaVersion = 1;
  old.graph.schemaVersion = 1;
  delete old.dependencyApproval;
  delete old.graph.dependencyChanges;
  for (const task of old.graph.tasks)
    for (const key of [
      'requirementIds',
      'allowedFiles',
      'forbiddenFiles',
      'dependencies',
      'verification',
    ])
      delete task[key];
  const relative = '.specgate/codex/changes/example/plan/legacy-fixture.json';
  const original = canonicalJson(old) + '\n';
  fs.writeFileSync(path.join(context.root, relative), original);
  await context.store.update({
    expectedVersion: await context.version(),
    patch: { context: { plan: { path: relative, hash: 'sha256:' + hashValue(old), version: 1 } } },
  });
  const before = await context.version();
  const inspected = await context.service.inspect();
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.equal(inspected.readOnly, true);
  assert.equal(fs.readFileSync(path.join(context.root, relative), 'utf8'), original);
  assert.equal(
    (await context.service.freezeContracts({ expectedVersion: before, ...contracts })).code,
    'LEGACY_PLAN_READ_ONLY',
  );
  assert.equal(await context.version(), before);
});

test('plan generation requires an actual audited H1 consumption and intact P4 frozen locator', async () => {
  const untrusted = await fixture({ forged: true });
  assert.equal(
    (await untrusted.service.generate({ expectedVersion: await untrusted.version() })).code,
    'H1_EVIDENCE_INVALID',
  );
  assert.equal(
    fs.existsSync(path.join(untrusted.root, '.specgate/codex/changes/example/plan')),
    false,
  );
  const changed = await fixture();
  fs.writeFileSync(path.join(changed.root, changed.relative), '{}');
  assert.equal(
    (await changed.service.generate({ expectedVersion: await changed.version() })).code,
    'REQUIREMENTS_HASH_MISMATCH',
  );
  const ready = await fixture();
  const planned = await ready.service.generate({ expectedVersion: await ready.version() });
  assert.equal(planned.ok, true, JSON.stringify(planned));
  assert.equal(planned.state.phase, 'PLANNING');
  assert.equal(planned.plan.approvalSource, 'synthetic-unit-test-not-runtime');
  assert.equal(planned.plan.runtimeApprovalAttested, false);
  assert.equal((await ready.service.inspect()).ok, true);
});

test('contracts and Test-provider assets freeze before development; a boolean red flag can never advance', async () => {
  const calls = [];
  const context = await fixture({
    count: 2,
    roleProvider: async (role, challenge) => {
      calls.push({ role, operation: challenge.operation });
      return assets(2);
    },
  });
  assert.equal(
    (await context.service.generate({ expectedVersion: await context.version() })).ok,
    true,
  );
  const frozen = await context.service.freezeContracts({
    expectedVersion: await context.version(),
    ...contracts,
  });
  assert.equal(frozen.ok, true, JSON.stringify(frozen));
  assert.equal(frozen.state.phase, 'TEST_DESIGN');
  const tested = await context.service.freezeTests({ expectedVersion: await context.version() });
  assert.equal(tested.ok, true, JSON.stringify(tested));
  assert.equal(tested.state.phase, 'TEST_CASES_FROZEN');
  assert.deepEqual(calls, [{ role: 'test', operation: 'freeze-tests' }]);
  assert.equal((await context.service.inspect()).ok, true);
  assert.equal(tested.tests.files['cases.md'].startsWith('sha256:'), true);
  assert.equal((await context.service.checkDevelopmentReady()).code, 'RED_EVIDENCE_REQUIRED');
  assert.equal(
    (
      await context.service.beginDevelopment({
        expectedVersion: await context.version(),
        red: true,
      })
    ).code,
    'INVALID_ARGUMENT',
  );
  assert.equal(
    (await context.service.beginDevelopment({ expectedVersion: await context.version() })).code,
    'RED_EVIDENCE_REQUIRED',
  );
  assert.equal((await context.store.inspect()).state.phase, 'TEST_CASES_FROZEN');
  assert.deepEqual(fs.readdirSync(context.root), ['.specgate']);
});

test('tool parameters cannot assume the Test role and invalid asset mappings perform no asset writes', async () => {
  for (const provider of [
    undefined,
    async () => ({ ...assets(), role: 'backend' }),
    async () => ({ ...assets(), cases: [] }),
    async () => ({ ...assets(), coverage: {} }),
    async () => ({ ...assets(), code: { '../escape.mjs': 'bad' } }),
  ]) {
    const context = await fixture({ roleProvider: provider });
    await context.service.generate({ expectedVersion: await context.version() });
    await context.service.freezeContracts({
      expectedVersion: await context.version(),
      ...contracts,
    });
    assert.equal(
      (
        await context.service.freezeTests({
          expectedVersion: await context.version(),
          role: 'test',
        })
      ).code,
      'INVALID_ARGUMENT',
    );
    assert.equal(
      (await context.service.freezeTests({ expectedVersion: await context.version() })).ok,
      false,
    );
    assert.equal(
      fs.existsSync(path.join(context.root, '.specgate/codex/changes/example/tests')),
      false,
    );
  }
});

test('plan inspection is read-only and stale CAS cannot write new frozen artifacts', async () => {
  const context = await fixture();
  const version = await context.version();
  const planned = await context.service.generate({ expectedVersion: version });
  assert.equal(planned.ok, true);
  const inventory = () => {
    const files = [];
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(target);
        else
          files.push({
            path: path.relative(context.root, target),
            modified: fs.statSync(target).mtimeMs,
            content: fs.readFileSync(target, 'utf8'),
          });
      }
    };
    visit(context.root);
    return files;
  };
  const before = inventory();
  assert.equal((await context.service.inspect()).ok, true);
  assert.equal(
    (await context.service.freezeContracts({ expectedVersion: version, ...contracts })).code,
    'VERSION_CONFLICT',
  );
  assert.deepEqual(inventory(), before);
});

test('frozen contract, model and executable test content are rehashed on every inspection', async () => {
  for (const kind of ['contract', 'model', 'tests']) {
    const context = await fixture({ roleProvider: async () => assets() });
    await context.service.generate({ expectedVersion: await context.version() });
    await context.service.freezeContracts({
      expectedVersion: await context.version(),
      ...contracts,
    });
    await context.service.freezeTests({ expectedVersion: await context.version() });
    const state = (await context.store.inspect()).state;
    const locator = state.context.plan[kind];
    const target =
      kind === 'tests'
        ? path.join(context.root, locator.directory, 'cases/ac-1.test.mjs')
        : path.join(context.root, locator.path);
    fs.writeFileSync(target, 'tampered');
    assert.equal((await context.service.inspect()).code, 'PLAN_ARTIFACT_CHANGED');
  }
});

test('frozen tests cannot be replaced during implementation or verification and their original evidence is retained', async () => {
  const context = await fixture({ roleProvider: async () => assets() });
  await context.service.generate({ expectedVersion: await context.version() });
  await context.service.freezeContracts({ expectedVersion: await context.version(), ...contracts });
  await context.service.freezeTests({ expectedVersion: await context.version() });
  for (const to of ['DEVELOPING', 'INTEGRATING', 'TESTING']) {
    const moved = await context.store.transition({ expectedVersion: await context.version(), to });
    assert.equal(moved.ok, true, JSON.stringify(moved));
    const before = (await context.store.inspect()).state;
    const oldPath = path.join(context.root, before.context.plan.tests.path);
    const oldBody = fs.readFileSync(oldPath, 'utf8');
    const replaced = await context.service.replaceTests({
      expectedVersion: before.version,
      assets: assets(),
      reason: 'A reason cannot authorize modification of frozen tests.',
    });
    assert.equal(replaced.ok, false);
    assert.equal(replaced.code, 'FROZEN_TESTS_IMMUTABLE');
    assert.deepEqual((await context.store.inspect()).state, before);
    assert.equal(fs.readFileSync(oldPath, 'utf8'), oldBody);
    assert.equal((await context.service.inspect()).ok, true);
  }
});

test('native Test Designer freezes only committed specgate test assets from its worktree', async () => {
  const context = await fixture();
  git(context.root, ['init', '-q']);
  git(context.root, ['config', 'user.email', 'test@example.com']);
  git(context.root, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(context.root, '.gitignore'), '.specgate/\n');
  fs.mkdirSync(path.join(context.root, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(context.root, 'backend', 'App.java'), 'final class App {}\n');
  commitAll(context.root, 'product baseline');
  assert.equal(
    (await context.service.generate({ expectedVersion: await context.version() })).ok,
    true,
  );
  assert.equal(
    (
      await context.service.freezeContracts({
        expectedVersion: await context.version(),
        ...contracts,
      })
    ).ok,
    true,
  );
  const prepared = await context.service.testDesignPrepare({
    expectedVersion: await context.version(),
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const worktree = prepared.testDesign.path;
  fs.mkdirSync(path.join(worktree, 'specgate-tests'), { recursive: true });
  fs.writeFileSync(
    path.join(worktree, 'specgate-tests', 'case.test.mjs'),
    "import test from 'node:test'; import assert from 'node:assert/strict'; test('case',()=>assert.fail('red'));\n",
  );
  fs.writeFileSync(
    path.join(worktree, 'specgate-tests', 'runner.mjs'),
    "import fs from 'node:fs'; const args=process.argv; const report=args[args.indexOf('--report')+1]; fs.writeFileSync(report, JSON.stringify({cases:[{id:'CASE-AC-1',status:'fail'}]})); process.exit(1);\n",
  );
  fs.writeFileSync(path.join(worktree, 'specgate-tests', 'fixture.json'), '{"id":"fixture"}\n');
  fs.writeFileSync(
    path.join(worktree, 'specgate-tests.json'),
    JSON.stringify({
      schemaVersion: 1,
      code: ['specgate-tests/case.test.mjs', 'specgate-tests/runner.mjs'],
      fixtures: ['specgate-tests/fixture.json'],
      runner: 'specgate-tests/runner.mjs',
      coverage: { lines: 80, branches: 70 },
      cases: [
        {
          id: 'CASE-AC-1',
          acIds: ['AC-1'],
          description: 'Prove AC-1.',
          codeFiles: ['specgate-tests/case.test.mjs'],
        },
      ],
    }) + '\n',
  );
  const commit = commitAll(worktree, 'test: freeze native acceptance assets');
  const frozen = await context.service.testDesignFreeze({
    expectedVersion: await context.version(),
  });
  assert.equal(frozen.ok, true, JSON.stringify(frozen));
  assert.equal(frozen.state.phase, 'TEST_CASES_FROZEN');
  assert.equal(frozen.tests.source.commit, commit);
  assert.equal(frozen.tests.source.role, 'test-designer');
  assert.equal(fs.existsSync(path.join(context.root, 'backend', 'specgate-tests.json')), false);
  assert.equal((await context.service.inspect()).ok, true);
});

test('test design preparation assigns and runs the real designer before reporting completion', async () => {
  const assignments = [];
  const context = await fixture({
    testDesignerRunner: async (role, challenge) => {
      assignments.push({ role, challenge });
      fs.mkdirSync(path.join(challenge.worktree, 'specgate-tests'), { recursive: true });
      fs.writeFileSync(
        path.join(challenge.worktree, 'specgate-tests', 'case.test.mjs'),
        "import test from 'node:test'; import assert from 'node:assert/strict'; test('case',()=>assert.fail('red'));\n",
      );
      fs.writeFileSync(
        path.join(challenge.worktree, 'specgate-tests', 'runner.mjs'),
        "import fs from 'node:fs'; const args=process.argv; const report=args[args.indexOf('--report')+1]; fs.writeFileSync(report, JSON.stringify({cases:[{id:'CASE-AC-1',status:'fail'}]})); process.exit(1);\n",
      );
      fs.writeFileSync(
        path.join(challenge.worktree, 'specgate-tests', 'fixture.json'),
        '{"id":"fixture"}\n',
      );
      fs.writeFileSync(
        path.join(challenge.worktree, 'specgate-tests.json'),
        JSON.stringify({
          schemaVersion: 1,
          code: ['specgate-tests/case.test.mjs', 'specgate-tests/runner.mjs'],
          fixtures: ['specgate-tests/fixture.json'],
          runner: 'specgate-tests/runner.mjs',
          coverage: { lines: 80, branches: 70 },
          cases: [
            {
              id: 'CASE-AC-1',
              acIds: ['AC-1'],
              description: 'Prove AC-1.',
              codeFiles: ['specgate-tests/case.test.mjs'],
            },
          ],
        }) + '\n',
      );
      const commit = commitAll(challenge.worktree, 'test: assigned designer output');
      return {
        ok: true,
        role,
        agent: 'specgate_test_designer',
        summary: 'Committed the assigned tests.',
        assignmentHash: 'f'.repeat(64),
        commit,
      };
    },
  });
  git(context.root, ['init', '-q']);
  git(context.root, ['config', 'user.email', 'test@example.com']);
  git(context.root, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(context.root, '.gitignore'), '.specgate/\n');
  fs.mkdirSync(path.join(context.root, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(context.root, 'backend', 'App.java'), 'final class App {}\n');
  commitAll(context.root, 'product baseline');
  await context.service.generate({ expectedVersion: await context.version() });
  await context.service.freezeContracts({
    expectedVersion: await context.version(),
    ...contracts,
  });

  const prepared = await context.service.testDesignPrepare({
    expectedVersion: await context.version(),
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].role, 'test-designer');
  assert.equal(assignments[0].challenge.operation, 'design-executable-tests');
  assert.equal(assignments[0].challenge.worktree, prepared.testDesign.path);
  assert.equal(assignments[0].challenge.contract.content.endpoints[0].path, '/tasks');
  assert.equal(prepared.nextAction, 'FREEZE_TEST_DESIGN');
  assert.equal(prepared.execution.agent, 'specgate_test_designer');
  assert.notEqual(prepared.testDesignerCommit, prepared.testDesign.baseCommit);
  const frozen = await context.service.testDesignFreeze({
    expectedVersion: await context.version(),
  });
  assert.equal(frozen.ok, true, JSON.stringify(frozen));
  assert.equal(frozen.state.phase, 'TEST_CASES_FROZEN');
});
