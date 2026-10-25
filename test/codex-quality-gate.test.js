import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeChangedCoverage, createQualityService } from '../src/codex/quality.js';
import { projectEnvironmentFingerprint } from '../src/codex/baseline.js';
import { persistProjectReadiness } from '../src/codex/project-state.js';
import {
  fixture,
  runnerProvider,
  coverageVerifier,
  verificationReport,
  git,
  commitAll,
} from './helpers/quality-fixture.mjs';

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
      ...Object.fromEntries(
        ['test', 'lint', 'format', 'runtime'].map((kind) => [
          kind,
          [{ id: kind, cwd: '.', argv: [process.execPath, '-e', 'process.exit(0)'] }],
        ]),
      ),
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
          status: 'passed',
          commands: Object.entries(selected.commands).flatMap(([kind, commands]) =>
            commands.map((command) => ({
              ...command,
              kind,
              status: 'passed',
              exitCode: 0,
              durationMs: 1,
              startedAt: now,
              finishedAt: now,
              stdout: '',
              stderr: '',
              evidence: 'synthetic-' + kind,
            })),
          ),
          knownFailures: [],
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
  assert.equal(result.quality.baselineDelta.knownFailures.length, 0);
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
