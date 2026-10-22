import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApprovalAuthority } from '../src/codex/approvals.js';
import { createDevelopmentService } from '../src/codex/development.js';
import { canonicalJson, hashValue } from '../src/codex/events.js';
import { createPlanService } from '../src/codex/plan.js';
import { computeChangedCoverage, createQualityService } from '../src/codex/quality.js';
import { projectEnvironmentFingerprint } from '../src/codex/baseline.js';
import { persistProjectReadiness } from '../src/codex/project-state.js';
import { createStateStore } from '../src/codex/state-machine.js';
import { VERIFY_STAGES } from '../src/codex/core/java/verify-evidence.js';

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

async function fixture() {
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
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.phase, 'FORMATTING');
  assert.equal(result.quality.coverage.changed.rate >= 0.9, true);
  assert.equal(result.quality.cases[0].status, 'pass');
  assert.equal(Number.isFinite(Date.parse(result.quality.command.startedAt)), true);
  assert.equal(Number.isFinite(Date.parse(result.quality.command.finishedAt)), true);
  assert.equal(result.quality.command.durationMs >= 0, true);
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
