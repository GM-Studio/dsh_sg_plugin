import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const runtimeRoot = process.env.SPECGATE_PACKAGE_SMOKE_ROOT
  ? pathToFileURL(path.join(process.env.SPECGATE_PACKAGE_SMOKE_ROOT, 'src/codex/'))
  : new URL('../src/codex/', import.meta.url);
const runtime = (relative) => import(new URL(relative, runtimeRoot).href);
const { createApprovalAuthority } = await runtime('approvals.js');
const { createDevelopmentService } = await runtime('development.js');
const { createFormatService } = await runtime('format.js');
const { canonicalJson, hashValue } = await runtime('events.js');
const { createPlanService } = await runtime('plan.js');
const { computeChangedCoverage, createQualityService } = await runtime('quality.js');
const { projectEnvironmentFingerprint } = await runtime('baseline.js');
const { persistProjectReadiness } = await runtime('project-state.js');
const { createStateStore } = await runtime('state-machine.js');
const { VERIFY_STAGES } = await runtime('core/java/verify-evidence.js');
const { createReviewService } = await runtime('review.js');
const { createReleaseService } = await runtime('release.js');
const { readDeliveryRecord } = await runtime('delivery.js');

test('synthetic local delivery smoke crosses all gates and archives the formatted commit without pushing', async () => {
  const context = await fixture({ projectBacked: true });
  const quality = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: runnerProvider(),
    verifier: coverageVerifier(),
  });
  const before = await quality.run({ expectedVersion: await context.version() });
  assert.equal(before.ok, true, JSON.stringify(before));
  const formatter = createFormatService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    qualityService: quality,
    formatter: async ({ worktree }) => {
      const file = path.join(worktree, 'backend/src/TaskApi.java');
      fs.appendFileSync(file, '// deterministic fixture formatting\n');
      return { ok: true };
    },
  });
  const formatted = await formatter.run({ expectedVersion: await context.version() });
  assert.equal(formatted.ok, true, JSON.stringify(formatted));
  const current = (await context.store.inspect()).state;
  assert.equal(current.phase, 'REVIEWING');
  assert.notEqual(current.context.quality.runId, before.quality.runId);
  assert.notEqual(current.context.quality.integrationCommit, before.quality.integrationCommit);
  const fixedCommit = current.context.quality.integrationCommit;
  const review = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    approvalAuthority: context.authority,
    roleProvider: async (_role, challenge) => ({
      agent: 'specgate_reviewer',
      assignmentHash: 'a'.repeat(64),
      mode: challenge.mode,
      reviewedCommit: challenge.integrationCommit,
      qualityHash: challenge.qualityHash,
      verdict: 'pass',
      findings: [],
      summary: 'Synthetic read-only reviewer; no native AI session is claimed.',
    }),
  });
  const reviewed = await review.run({ expectedVersion: await context.version() });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  const release = createReleaseService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
  });
  assert.equal(
    (await release.run({ expectedVersion: await context.version() })).code,
    'H3_REQUIRED',
  );
  const h3 = await review.requestH3({ expectedVersion: await context.version() });
  assert.equal(h3.ok, true, JSON.stringify(h3));
  const delivered = await release.run({ expectedVersion: await context.version(), push: false });
  assert.equal(delivered.ok, true, JSON.stringify(delivered));
  assert.equal(delivered.pushed, false);
  const record = readDeliveryRecord({
    projectRoot: context.root,
    deliveryId: delivered.report.delivery.deliveryId,
  });
  assert.equal(record.ok, true, JSON.stringify(record));
  assert.equal(record.delivery.deliveryCommit, fixedCommit);
  assert.equal(git(context.root, ['rev-parse', 'HEAD']), fixedCommit);
  const summary = fs.readFileSync(
    path.join(context.root, `.specgate/codex/deliveries/${record.delivery.deliveryId}/customer.md`),
    'utf8',
  );
  assert.match(summary, /real business project and native approvals are not verified/);
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

const requirements = [
  {
    id: 'REQ-1',
    category: 'functional',
    text: 'Show and persist the task title.',
    acceptanceCriteria: [{ id: 'AC-1', text: 'The UI displays the persisted title.' }],
  },
];
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

function report(status = 'pass') {
  return JSON.stringify({ cases: [{ id: 'CASE-AC-1', status }] });
}

function verificationReport(root) {
  const names = [...VERIFY_STAGES, 'frontend-runtime'];
  return {
    ok: true,
    v1Complete: true,
    report: {
      schemaVersion: 1,
      kind: 'codex-v1-local',
      root,
      runId: 'quality-unit-verified',
      status: 'verified',
      ok: true,
      v1Complete: true,
      expectedStages: names,
      stages: names.map((name) => ({
        name,
        status: 0,
        fixture: false,
        durationMs: 1,
        command: process.execPath,
        args: [],
        log: `.specgate/unit-${name}.log`,
        ...(name === 'backend-verify' ? { tests: { total: 1, passed: 1, skipped: 0 } } : {}),
        ...(name === 'frontend-test'
          ? { tests: { total: 1, passed: 1, failed: 0, skipped: 0 } }
          : {}),
        ...(name === 'frontend-runtime'
          ? {
              pid: 1,
              terminated: true,
              http: {
                html: { status: 200 },
                assets: [{ status: 200, bytes: 1, sha256: 'a'.repeat(64) }],
              },
            }
          : {}),
      })),
      checks: names.map((name) => ({ name, status: 'passed' })),
      reconciliation: {
        expected: names.length,
        executed: names.length,
        passed: names.length,
        failed: 0,
        notRun: 0,
      },
    },
  };
}

async function fixture({ projectBacked = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-quality-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.writeFileSync(
    path.join(root, '.gitignore'),
    '.specgate/\nbackend/target/\nfrontend/coverage/\n',
  );
  fs.mkdirSync(path.join(root, 'backend', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend', 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backend', 'src', 'TaskApi.java'),
    'final class TaskApi { String title = "base"; }\n',
  );
  fs.writeFileSync(path.join(root, 'frontend', 'src', 'App.ts'), "export const title = 'base';\n");
  commitAll(root, 'initial product');
  if (projectBacked) {
    const now = new Date().toISOString();
    const profile = {
      schemaVersion: 2,
      projectId: 'project-core-smoke',
      mode: 'adopted',
      stack: 'java-vue',
      root: root,
      targetBranch: git(root, ['branch', '--show-current']),
      remoteUrl: null,
      commands: { install: [], build: [], test: [], lint: [], format: [], runtime: [] },
      protectedPaths: [],
      createdAt: now,
      updatedAt: now,
    };
    const baseline = {
      schemaVersion: 2,
      baselineId: 'baseline-core-smoke',
      projectId: profile.projectId,
      commit: git(root, ['rev-parse', 'HEAD']),
      status: 'green',
      knownFailures: [],
      unverifiedAreas: [
        {
          id: 'native-canary',
          description:
            'Synthetic smoke only; real business project and native approvals are not verified.',
          risk: 'yellow',
        },
      ],
      commands: [],
      evidence: [],
      environmentFingerprint: projectEnvironmentFingerprint(profile),
      createdAt: now,
    };
    const readiness = persistProjectReadiness({ root: root, profile, baseline });
    assert.equal(readiness.ok, true, JSON.stringify(readiness));
  }

  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'state.json'),
    '{"fixture":"verification-state"}\n',
  );
  fs.writeFileSync(
    path.join(root, '.specgate', 'init-report.json'),
    '{"fixture":"verification-init-report"}\n',
  );

  const relative = '.specgate/codex/changes/example/requirements/revision-1-fixture.json';
  const snapshot = {
    schemaVersion: 1,
    changeId: 'example',
    revision: 1,
    requirements,
    fixture: 'synthetic-unit-test-not-runtime',
  };
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), canonicalJson(snapshot));
  const requirementsHash = 'sha256:' + hashValue(snapshot);
  let store;
  const authority = createApprovalAuthority({
    request: async () => ({
      action: 'accept',
      content: { decision: 'approve', comment: 'Synthetic unit fixture, not runtime evidence.' },
    }),
    trustedPeerIdentity: {
      id: 'test-user',
      kind: 'user',
      source: 'synthetic-unit-test-not-runtime',
    },
    resolveGateArtifact: ({ gate, state }) => ({
      scope: state?.changeId,
      artifactHash:
        gate === 'H1'
          ? state?.context?.artifacts?.requirements?.hash
          : state?.context?.artifacts?.h3?.hash,
    }),
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
  await planService.generate({ expectedVersion: (await store.inspect()).state.version });
  await planService.freezeContracts({
    expectedVersion: (await store.inspect()).state.version,
    ...contracts,
  });
  await planService.freezeTests({ expectedVersion: (await store.inspect()).state.version });

  const redRunnerPath = path.join(root, '.specgate', 'red-runner.mjs');
  const redReport = '.specgate/red-report.json';
  fs.writeFileSync(
    redRunnerPath,
    [
      "import fs from 'node:fs';",
      `fs.writeFileSync(${JSON.stringify(path.join(root, redReport))}, JSON.stringify({ cases: [{ id: 'CASE-AC-1', status: 'fail' }] }));`,
      'process.exit(1);',
      '',
    ].join('\n'),
  );
  const development = createDevelopmentService({
    projectRoot: root,
    store,
    planService,
    redRunner: () => ({
      command: process.execPath,
      args: [redRunnerPath],
      cwd: root,
      reportPath: redReport,
    }),
    roleProvider: async (role, challenge) => {
      if (role === 'backend') {
        fs.writeFileSync(
          path.join(challenge.worktree, 'backend', 'src', 'TaskApi.java'),
          'final class TaskApi { String title = "integrated title"; }\n',
        );
      } else {
        fs.writeFileSync(
          path.join(challenge.worktree, 'frontend', 'src', 'App.ts'),
          "export const title = 'integrated title';\n",
        );
      }
      commitAll(challenge.worktree, `${role} implementation`);
      return { ok: true, summary: `${role} complete` };
    },
  });
  const prepared = await development.prepare({
    expectedVersion: (await store.inspect()).state.version,
  });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  const developed = await development.run({ expectedVersion: prepared.state.version });
  assert.equal(developed.ok, true, JSON.stringify(developed));
  assert.equal(developed.state.phase, 'TESTING');
  return {
    root,
    store,
    planService,
    development: developed.development,
    authority,
    version: async () => (await store.inspect()).state.version,
  };
}

function runnerProvider({ status = 'pass', writeProduction = false, fail = false } = {}) {
  return async (challenge) => {
    if (writeProduction)
      fs.writeFileSync(
        path.join(challenge.worktree, 'backend', 'src', 'TaskApi.java'),
        'final class TaskApi { String title = "test changed production"; }\n',
      );
    const runner = path.join(challenge.worktree, '.specgate', 'quality-runner.mjs');
    const reportPath = '.specgate/quality-report.json';
    fs.mkdirSync(path.dirname(runner), { recursive: true });
    fs.writeFileSync(
      runner,
      [
        "import fs from 'node:fs';",
        `fs.writeFileSync(${JSON.stringify(reportPath)}, ${JSON.stringify(report(status))});`,
        fail ? 'process.exit(2);' : 'process.exit(0);',
        '',
      ].join('\n'),
    );
    return {
      command: process.execPath,
      args: [runner],
      cwd: challenge.worktree,
      reportPath,
    };
  };
}

function coverageVerifier({
  frontendCovered = true,
  backendLines = 90,
  backendBranches = 80,
  frontendLines = 90,
  frontendBranches = 80,
} = {}) {
  return async ({ root }) => {
    assert.equal(fs.existsSync(path.join(root, '.specgate/state.json')), true);
    assert.equal(fs.existsSync(path.join(root, '.specgate/init-report.json')), true);
    const backend = path.join(root, 'backend/target/site/jacoco/jacoco.xml');
    const frontend = path.join(root, 'frontend/coverage/coverage-summary.json');
    const final = path.join(root, 'frontend/coverage/coverage-final.json');
    fs.mkdirSync(path.dirname(backend), { recursive: true });
    fs.mkdirSync(path.dirname(frontend), { recursive: true });
    fs.writeFileSync(
      backend,
      [
        '<report>',
        `<counter type="LINE" covered="${backendLines}" missed="${100 - backendLines}"/>`,
        `<counter type="BRANCH" covered="${backendBranches}" missed="${100 - backendBranches}"/>`,
        '<package name="com/example">',
        '<sourcefile name="TaskApi.java"><line nr="1" mi="0" ci="1"/></sourcefile>',
        '</package>',
        '</report>',
      ].join('\n'),
    );
    fs.writeFileSync(
      frontend,
      JSON.stringify({
        total: {
          lines: { total: 100, covered: frontendLines },
          branches: { total: 100, covered: frontendBranches },
        },
      }),
    );
    fs.writeFileSync(
      final,
      JSON.stringify({
        [path.join(root, 'frontend/src/App.ts')]: {
          statementMap: {
            0: {
              start: { line: 1, column: 0 },
              end: { line: 1, column: 20 },
            },
          },
          s: { 0: frontendCovered ? 1 : 0 },
        },
      }),
    );
    return verificationReport(root);
  };
}

test('quality passes only with frozen green cases, real logs, both coverage sides and changed-line coverage', async () => {
  const context = await fixture();
  const generatedTest = path.join(
    context.development.worktrees.test.path,
    'backend/src/test/java/com/example/GeneratedByPreviousRunTest.java',
  );
  fs.mkdirSync(path.dirname(generatedTest), { recursive: true });
  fs.writeFileSync(generatedTest, 'final class GeneratedByPreviousRunTest {}\n');
  const service = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: runnerProvider(),
    verifier: coverageVerifier(),
  });
  const beforeInvalid = await context.version();
  assert.equal(
    (await service.run({ expectedVersion: beforeInvalid, command: 'unregistered-command' })).code,
    'INVALID_ARGUMENT',
  );
  assert.equal(await context.version(), beforeInvalid);
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.phase, 'FORMATTING');
  assert.equal(result.quality.coverage.changed.rate >= 0.9, true);
  assert.equal(result.quality.cases[0].status, 'pass');
  assert.equal(Number.isFinite(Date.parse(result.quality.command.startedAt)), true);
  assert.equal(Number.isFinite(Date.parse(result.quality.command.finishedAt)), true);
  assert.equal(result.quality.command.durationMs >= 0, true);
  assert.equal(result.quality.command.source.kind, 'server-provider');
  assert.ok(
    result.quality.verification.stages.every(
      (stage) => stage.source.ref && stage.source.id === stage.name,
    ),
  );
  assert.equal(fs.existsSync(generatedTest), false);
  for (const relative of [
    result.quality.testLog,
    result.quality.stdoutLog,
    result.quality.stderrLog,
    result.quality.reportPath,
  ])
    assert.equal(fs.existsSync(path.join(context.root, relative)), true, relative);
  assert.equal(
    git(context.development.worktrees.test.path, ['rev-parse', 'HEAD']),
    context.development.merged.at(-1).integrationCommit,
  );
  const inspected = await service.inspect();
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.equal(inspected.quality.status, 'passed');
});

for (const scenario of ['valid', 'stale-commit', 'missing-log', 'stale-time']) {
  test(`native frozen verification preserves command logs and rejects invalid evidence: ${scenario}`, async () => {
    const context = await fixture();
    const service = createQualityService({
      projectRoot: context.root,
      store: context.store,
      planService: context.planService,
      nativeVerification: true,
      testRunner: async (challenge) => {
        fs.mkdirSync(path.join(challenge.worktree, '.specgate'), { recursive: true });
        for (const file of ['state.json', 'init-report.json'])
          fs.writeFileSync(path.join(challenge.worktree, '.specgate', file), '{}');
        const { report: verification } = await coverageVerifier()({ root: challenge.worktree });
        verification.commit =
          scenario === 'stale-commit'
            ? '0'.repeat(40)
            : git(challenge.worktree, ['rev-parse', 'HEAD']);
        verification.stages.find((stage) => stage.name === 'runtime').pid = 1;
        verification.stages.find((stage) => stage.name === 'runtime').terminated = true;
        const runner = path.join(challenge.worktree, '.specgate', 'native-evidence-fixture.mjs');
        fs.writeFileSync(
          runner,
          [
            "import fs from 'node:fs';",
            `const verification = ${JSON.stringify(verification)};`,
            'for (const stage of verification.stages) {',
            `stage.startedAt = ${scenario === 'stale-time' ? "'2000-01-01T00:00:00Z'" : 'new Date().toISOString()'};`,
            'stage.finishedAt = new Date().toISOString();',
            ...(scenario === 'missing-log'
              ? []
              : ["fs.writeFileSync(stage.log, 'Explicit synthetic fixture command output\\n');"]),
            '}',
            "fs.writeFileSync('.specgate/quality-report.json', JSON.stringify({cases:[{id:'CASE-AC-1',status:'pass'}],verification}));",
          ].join('\n'),
        );
        return {
          command: process.execPath,
          args: [runner],
          cwd: challenge.worktree,
          reportPath: '.specgate/quality-report.json',
        };
      },
      verifier: () => {
        throw new Error('Frozen verification must not rerun a different provider');
      },
    });
    const result = await service.run({ expectedVersion: await context.version() });
    if (scenario === 'valid') {
      assert.equal(result.ok, true, JSON.stringify(result));
      for (const stage of result.quality.verification.stages) {
        assert.equal(stage.source.kind, 'frozen-runner');
        assert.match(stage.source.testsHash, /^sha256:[a-f0-9]{64}$/);
        assert.match(stage.logHash, /^sha256:[a-f0-9]{64}$/);
        assert.match(
          fs.readFileSync(path.join(context.root, stage.log), 'utf8'),
          /Explicit synthetic fixture/,
        );
      }
    } else {
      assert.equal(result.ok, false);
      assert.notEqual(result.state?.phase, 'FORMATTING');
      assert.equal(
        result.code,
        scenario === 'stale-commit'
          ? 'VERIFY_COMMIT_MISMATCH'
          : scenario === 'missing-log'
            ? 'ENOENT'
            : 'VERIFY_EVIDENCE_INCOMPLETE',
      );
    }
  });
}

test('formatter reruns the server quality gate against the formatted integration commit', async () => {
  const context = await fixture();
  let runnerCalls = 0;
  let verifierCalls = 0;
  const runner = runnerProvider();
  const verifier = coverageVerifier();
  const quality = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: async (challenge) => {
      runnerCalls += 1;
      return runner(challenge);
    },
    verifier: async (challenge) => {
      verifierCalls += 1;
      return verifier(challenge);
    },
  });
  const first = await quality.run({ expectedVersion: await context.version() });
  assert.equal(first.ok, true, JSON.stringify(first));
  const firstCommit = first.quality.integrationCommit;
  const format = createFormatService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    qualityService: quality,
    formatter: async ({ worktree }) => {
      fs.writeFileSync(
        path.join(worktree, 'frontend/src/App.ts'),
        'export const title = "integrated title";\n',
      );
      return { ok: true, commands: [{ command: 'fixture-format', exitCode: 0 }] };
    },
  });
  const result = await format.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.phase, 'REVIEWING');
  assert.equal(runnerCalls, 2);
  assert.equal(verifierCalls, 2);
  assert.notEqual(result.quality.runId, first.quality.runId);
  assert.notEqual(result.quality.integrationCommit, firstCommit);
  assert.equal(result.quality.integrationCommit, result.format.integrationAfter);
  assert.equal(result.format.preQualityRunId, first.quality.runId);
});

test('an idempotent formatter passes when only checkout line endings changed', async () => {
  const context = await fixture();
  const quality = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: runnerProvider(),
    verifier: coverageVerifier(),
  });
  const first = await quality.run({ expectedVersion: await context.version() });
  assert.equal(first.ok, true, JSON.stringify(first));

  git(context.root, ['config', 'core.autocrlf', 'true']);
  const format = createFormatService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    qualityService: quality,
    formatter: async ({ worktree }) => {
      const file = path.join(worktree, 'backend/src/TaskApi.java');
      const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      fs.writeFileSync(file, text.replace(/\n/g, '\r\n'));
      return { ok: true, commands: [{ command: 'fixture-format', exitCode: 0 }] };
    },
  });

  const result = await format.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.phase, 'REVIEWING');
  assert.equal(result.format.formatCommit, null);
  assert.equal(result.format.integrationBefore, result.format.integrationAfter);
  assert.deepEqual(result.format.changedFiles, []);
});

test('a failed post-format quality run keeps Review closed and records repair evidence', async () => {
  const context = await fixture();
  let runnerCalls = 0;
  const quality = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: async (challenge) => {
      runnerCalls += 1;
      return runnerProvider({ status: runnerCalls === 1 ? 'pass' : 'fail' })(challenge);
    },
    verifier: coverageVerifier(),
  });
  assert.equal((await quality.run({ expectedVersion: await context.version() })).ok, true);
  const format = createFormatService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    qualityService: quality,
    formatter: async () => ({ ok: true, commands: [] }),
  });
  const failed = await format.run({ expectedVersion: await context.version() });
  assert.equal(failed.ok, false);
  assert.equal(runnerCalls, 2);
  const loaded = await context.store.inspect();
  assert.equal(loaded.state.phase, 'FORMATTING');
  assert.equal(loaded.state.context.quality.status, 'failed');
  assert.equal(
    loaded.state.context.quality.integrationCommit,
    loaded.state.context.format.integrationAfter,
  );
  assert.equal(
    (await context.store.transition({ expectedVersion: loaded.state.version, to: 'REVIEWING' }))
      .code,
    'POST_FORMAT_QUALITY_REQUIRED',
  );
});

test('adopted quality verification uses ProjectProfile commands and Baseline Delta', async () => {
  const context = await fixture();
  const now = '2026-10-22T10:00:00.000Z';
  const profile = {
    schemaVersion: 2,
    projectId: 'project-adopted-quality',
    mode: 'adopted',
    stack: 'java-vue',
    root: context.root,
    targetBranch: git(context.root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    remoteUrl: null,
    backendPackage: 'com.acme.orders',
    frontendDefaultLocale: 'zh-CN',
    frontendLocales: ['zh-CN', 'en-US'],
    commands: {
      install: [],
      build: [{ id: 'build', cwd: '.', argv: [process.execPath, '-e', 'process.exit(0)'] }],
      test: [],
      lint: [],
      format: [],
      runtime: [],
    },
    protectedPaths: [],
    createdAt: now,
    updatedAt: now,
  };
  const baseline = {
    schemaVersion: 2,
    baselineId: 'baseline-adopted-quality',
    projectId: profile.projectId,
    commit: git(context.root, ['rev-parse', 'HEAD']),
    status: 'green',
    knownFailures: [],
    unverifiedAreas: [],
    commands: ['build'],
    evidence: ['baseline-quality'],
    environmentFingerprint: projectEnvironmentFingerprint(profile),
    createdAt: now,
  };
  const persisted = persistProjectReadiness({
    root: context.root,
    profile,
    baseline,
  });
  assert.equal(persisted.ok, true, JSON.stringify(persisted));
  let selectedMode;
  const fillCoverage = coverageVerifier();
  const service = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: runnerProvider(),
    adoptedVerifier: async ({ profile: selected, worktree, commit, baseline: accepted }) => {
      selectedMode = selected.mode;
      fs.mkdirSync(path.join(worktree, '.specgate'), { recursive: true });
      for (const relative of ['state.json', 'init-report.json']) {
        fs.copyFileSync(
          path.join(context.root, '.specgate', relative),
          path.join(worktree, '.specgate', relative),
        );
      }
      await fillCoverage({ root: worktree });
      return {
        ok: true,
        report: {
          schemaVersion: 1,
          kind: 'adopted-project-verification',
          projectId: selected.projectId,
          baselineId: accepted.baselineId,
          commit,
          status: 'passed-with-known-failures',
          commands: [
            {
              id: 'build',
              kind: 'build',
              status: 'passed',
              exitCode: 0,
              durationMs: 1,
              evidence: 'adopted-build',
            },
          ],
          knownFailures: [
            {
              commandId: 'build',
              signature: 'legacy-known',
              status: 'failed',
              exitCode: 1,
              evidence: 'baseline-known',
            },
          ],
          newFailures: [],
          environmentFingerprint: projectEnvironmentFingerprint(selected),
        },
      };
    },
  });
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(selectedMode, 'adopted');
  assert.equal(result.quality.projectMode, 'adopted');
  assert.equal(result.quality.baselineDelta.knownFailures.length, 1);
  assert.equal(result.quality.baselineDelta.newFailures.length, 0);
  assert.ok(
    result.quality.verification.commands.every(
      (command) => command.source.kind === 'project-profile' && command.source.id === command.id,
    ),
  );
});

test('skipped frozen cases become P1 defects and the third failed attempt blocks without deleting evidence', async () => {
  const context = await fixture();
  const service = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: runnerProvider({ status: 'skip' }),
    verifier: coverageVerifier(),
  });
  let result;
  for (let attempt = 0; attempt < 3; attempt++)
    result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORKFLOW_BLOCKED');
  assert.equal(result.state.phase, 'BLOCKED');
  assert.equal(
    result.defects.some((defect) => defect.severity === 'P1'),
    true,
  );
  assert.equal(fs.existsSync(path.join(context.root, result.quality.reportPath)), true);
  assert.equal(fs.existsSync(context.development.worktrees.test.path), true);
});

test('failed verification stages are attributed to the owning implementation role', async () => {
  const context = await fixture();
  const service = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: async (challenge) => {
      const runner = path.join(challenge.worktree, '.specgate', 'quality-runner.mjs');
      const reportPath = '.specgate/quality-report.json';
      fs.mkdirSync(path.dirname(runner), { recursive: true });
      fs.writeFileSync(
        runner,
        [
          "import fs from 'node:fs';",
          `fs.writeFileSync(${JSON.stringify(reportPath)}, ${JSON.stringify(
            JSON.stringify({
              cases: [{ id: 'CASE-AC-1', status: 'fail' }],
              verification: {
                stages: [
                  {
                    name: 'backend-verify',
                    status: 1,
                    error: 'Spotless found a Java formatting violation',
                  },
                  { name: 'frontend-build', status: 0 },
                  { name: 'frontend-runtime', status: 0 },
                ],
              },
            }),
          )});`,
          'process.exit(1);',
          '',
        ].join('\n'),
      );
      return {
        command: process.execPath,
        args: [runner],
        cwd: challenge.worktree,
        reportPath,
      };
    },
    verifier: coverageVerifier(),
  });

  const failed = await service.run({ expectedVersion: await context.version() });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'FROZEN_CASE_RECONCILIATION_FAILED');
  assert.deepEqual(failed.defects[0].owners, ['backend']);
  assert.match(failed.defects[0].message, /backend-verify/);
  assert.deepEqual(
    failed.defects[0].actual.failedStages.map((stage) => stage.name),
    ['backend-verify'],
  );

  const development = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: async () => {
      throw new Error('Repair preparation must not invoke an implementation role');
    },
  });
  const repaired = await development.prepareRepair({
    expectedVersion: (await context.store.inspect()).state.version,
  });
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  assert.match(repaired.repair.worktrees.backend.path.replace(/\\/g, '/'), /round-1\/backend/);
  assert.match(repaired.repair.worktrees.format.path.replace(/\\/g, '/'), /round-1\/format/);
  assert.equal(repaired.state.context.development.roles.frontend.status, 'skipped');
});

test('a Test role writing production code fails closed before quality commands run', async () => {
  const context = await fixture();
  let verified = false;
  const service = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: runnerProvider({ writeProduction: true }),
    verifier: async () => {
      verified = true;
      return verificationReport(context.root);
    },
  });
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TEST_ROLE_POLICY_VIOLATION');
  assert.equal(verified, false);
  assert.equal((await context.store.inspect()).state.phase, 'TESTING');
});

test('insufficient changed-line coverage cannot advance even when aggregate coverage thresholds pass', async () => {
  const context = await fixture();
  const service = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: runnerProvider(),
    verifier: coverageVerifier({ frontendCovered: false }),
  });
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CHANGED_COVERAGE_BELOW_THRESHOLD');
  assert.equal((await context.store.inspect()).state.phase, 'TESTING');
  assert.equal(result.retryAllowed, true);
});

test('a declaration-only Java interface does not become unavailable changed coverage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-interface-coverage-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  const javaRoot = path.join(root, 'backend/src/main/java/com/example');
  fs.mkdirSync(javaRoot, { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend/coverage'), { recursive: true });
  const repository = path.join(javaRoot, 'CustomerRepository.java');
  const service = path.join(javaRoot, 'CustomerService.java');
  fs.writeFileSync(
    repository,
    'package com.example; public interface CustomerRepository { String NAME = "customers"; List<Customer> findAll(); }\n',
  );
  fs.writeFileSync(
    service,
    'package com.example; public class CustomerService { int count() { return 1; } }\n',
  );
  const base = commitAll(root, 'base');

  fs.writeFileSync(
    repository,
    'package com.example; public interface CustomerRepository { String NAME = "customers"; List<Customer> findAll(); Customer save(Customer customer); }\n',
  );
  fs.writeFileSync(
    service,
    'package com.example; public class CustomerService { int count() { return 2; } }\n',
  );
  const head = commitAll(root, 'changed production');
  fs.writeFileSync(path.join(root, 'frontend/coverage/coverage-final.json'), '{}');
  fs.mkdirSync(path.join(root, 'backend/target/site/jacoco'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backend/target/site/jacoco/jacoco.xml'),
    [
      '<report>',
      '<package name="com/example">',
      '<sourcefile name="CustomerService.java"><line nr="1" mi="0" ci="1"/></sourcefile>',
      '</package>',
      '</report>',
    ].join('\n'),
  );

  const coverage = computeChangedCoverage({ root, base, head });
  assert.equal(coverage.ok, true, JSON.stringify(coverage));
  assert.equal(coverage.sides.backend.unavailable, 0, JSON.stringify(coverage));
  assert.equal(coverage.executable, 1, JSON.stringify(coverage));
  assert.equal(coverage.covered, 1, JSON.stringify(coverage));
});

for (const changedCovered of [true, false]) {
  test(`frontend changed coverage measures changed unique lines rather than old statements: ${changedCovered}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-frontend-diff-'));
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'test']);
    const source = path.join(root, 'frontend/src/App.ts');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, 'export const old = 1;\nexport const changed = 1;\n');
    const base = commitAll(root, 'base');
    fs.writeFileSync(source, 'export const old = 1;\nexport const changed = 2;\n');
    const head = commitAll(root, 'change line two');
    fs.mkdirSync(path.join(root, 'frontend/coverage'), { recursive: true });
    fs.mkdirSync(path.join(root, 'backend/target/site/jacoco'), { recursive: true });
    fs.writeFileSync(path.join(root, 'backend/target/site/jacoco/jacoco.xml'), '<report/>');
    fs.writeFileSync(
      path.join(root, 'frontend/coverage/coverage-final.json'),
      JSON.stringify({
        [source]: {
          statementMap: {
            0: { start: { line: 1 } },
            1: { start: { line: 2 } },
            2: { start: { line: 2 } },
          },
          s: { 0: changedCovered ? 0 : 1, 1: changedCovered ? 1 : 0, 2: 0 },
        },
      }),
    );
    const result = computeChangedCoverage({ root, base, head });
    assert.equal(result.ok, changedCovered, JSON.stringify(result));
    assert.equal(result.executable, 1, JSON.stringify(result));
    assert.equal(result.covered, changedCovered ? 1 : 0, JSON.stringify(result));
  });
}

test('frontend changed coverage ignores build config outside the measured source tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-frontend-config-coverage-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  const source = path.join(root, 'frontend/src/App.ts');
  const config = path.join(root, 'frontend/vite.config.ts');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'export const title = "base";\n');
  fs.writeFileSync(config, 'export default { server: { port: 5173 } };\n');
  const base = commitAll(root, 'base');

  fs.writeFileSync(source, 'export const title = "covered";\n');
  fs.writeFileSync(config, 'export default { server: { port: 4173 } };\n');
  const head = commitAll(root, 'source and build config');
  fs.mkdirSync(path.join(root, 'frontend/coverage'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'frontend/coverage/coverage-final.json'),
    JSON.stringify({
      [source]: {
        statementMap: { 0: { start: { line: 1 } } },
        s: { 0: 1 },
        b: {},
      },
    }),
  );
  fs.mkdirSync(path.join(root, 'backend/target/site/jacoco'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend/target/site/jacoco/jacoco.xml'), '<report/>');

  const coverage = computeChangedCoverage({ root, base, head });
  assert.equal(coverage.ok, true, JSON.stringify(coverage));
  assert.equal(coverage.sides.frontend.changed, 1);
  assert.equal(coverage.sides.frontend.unavailable, 0);
  assert.equal(coverage.sides.frontend.executable, 1);
  assert.equal(coverage.sides.frontend.covered, 1);
});

test('a Java class without JaCoCo evidence remains unavailable changed coverage', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-class-coverage-'));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  const javaRoot = path.join(root, 'backend/src/main/java/com/example');
  fs.mkdirSync(javaRoot, { recursive: true });
  fs.mkdirSync(path.join(root, 'frontend/coverage'), { recursive: true });
  const service = path.join(javaRoot, 'CustomerService.java');
  fs.writeFileSync(
    service,
    'package com.example; public class CustomerService { int count() { return 1; } }\n',
  );
  const base = commitAll(root, 'base');
  fs.writeFileSync(
    service,
    'package com.example; public class CustomerService { int count() { return 2; } }\n',
  );
  const head = commitAll(root, 'changed production');
  fs.writeFileSync(path.join(root, 'frontend/coverage/coverage-final.json'), '{}');
  fs.mkdirSync(path.join(root, 'backend/target/site/jacoco'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'backend/target/site/jacoco/jacoco.xml'),
    '<report><package name="com/example"></package></report>',
  );

  const coverage = computeChangedCoverage({ root, base, head });
  assert.equal(coverage.ok, false, JSON.stringify(coverage));
  assert.equal(coverage.sides.backend.unavailable, 1, JSON.stringify(coverage));
});

test('aggregate coverage below either side threshold blocks Review', async () => {
  const context = await fixture();
  const service = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: runnerProvider(),
    verifier: coverageVerifier({ backendLines: 79 }),
  });
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'COVERAGE_FAILED');
  assert.equal((await context.store.inspect()).state.phase, 'TESTING');
  assert.equal(result.defects[0].severity, 'P1');
});

test('missing Test runner or failed real verification never records a quality pass', async () => {
  const context = await fixture();
  const unavailable = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    verifier: coverageVerifier(),
  });
  assert.equal(
    (await unavailable.run({ expectedVersion: await context.version() })).code,
    'TEST_RUNNER_UNAVAILABLE',
  );
  assert.equal((await context.store.inspect()).state.phase, 'TESTING');

  const failed = createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: runnerProvider(),
    verifier: async () => ({
      ok: false,
      code: 'VERIFY_FAILED',
      report: { ok: false, v1Complete: false, status: 'failed' },
    }),
  });
  const result = await failed.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VERIFY_FAILED');
  assert.equal(result.state.phase, 'TESTING');
  assert.equal(result.retryAllowed, true);
});
