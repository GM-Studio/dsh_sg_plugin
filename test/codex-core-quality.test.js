import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createQualityService } from '../src/codex/quality.js';
import { createDevelopmentService } from '../src/codex/development.js';
import { persistProjectReadiness } from '../src/codex/project-state.js';
import { projectEnvironmentFingerprint } from '../src/codex/baseline.js';
import { failureContext } from '../src/codex/core/failure-context.js';
import {
  fixture,
  runnerProvider,
  coverageVerifier,
  git,
  commitAll,
} from './helpers/quality-fixture.mjs';

const service = (context, options = {}) => {
  const { testRunner = runnerProvider(), ...other } = options;
  return createQualityService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    testRunner: (challenge) => {
      fs.mkdirSync(path.join(challenge.worktree, '.specgate'), { recursive: true });
      return testRunner(challenge);
    },
    verifier: coverageVerifier(),
    ...other,
  });
};

test('a stale passing case report cannot prove a new command that produced no observations', async () => {
  const context = await fixture();
  const worktree = context.development.worktrees.test.path;
  fs.mkdirSync(path.join(worktree, '.specgate'), { recursive: true });
  fs.writeFileSync(
    path.join(worktree, '.specgate/quality-report.json'),
    JSON.stringify({ cases: [{ id: 'CASE-AC-1', status: 'pass' }] }),
  );
  let verified = false;
  const quality = service(context, {
    testRunner: () => ({
      command: process.execPath,
      args: ['-e', 'process.exit(0)'],
      cwd: worktree,
      reportPath: '.specgate/quality-report.json',
    }),
    verifier: () => {
      verified = true;
      return coverageVerifier()({ root: worktree });
    },
  });
  const result = await quality.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(verified, false);
  assert.equal(result.quality.status, 'failed');
});

test('failed case evidence retains observed expected/actual values, command and real logs', async () => {
  const context = await fixture();
  const quality = service(context, {
    testRunner: ({ worktree }) => ({
      command: process.execPath,
      cwd: worktree,
      reportPath: '.specgate/quality-report.json',
      args: [
        '-e',
        "const fs=require('node:fs');console.log('expected title differs from actual title');fs.writeFileSync('.specgate/quality-report.json',JSON.stringify({cases:[{id:'CASE-AC-1',status:'fail',expected:'expected-title',actual:'actual-title',file:'backend/src/TaskApi.java'}]}));process.exit(1)",
      ],
    }),
  });
  const result = await quality.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(result.quality.command.exitCode, 1);
  assert.equal(result.quality.cases[0].id, 'CASE-AC-1');
  assert.equal(result.quality.cases[0].expected, 'expected-title');
  assert.equal(result.quality.cases[0].actual, 'actual-title');
  assert.match(
    fs.readFileSync(path.join(context.root, result.quality.stdoutLog), 'utf8'),
    /expected title differs/,
  );
  assert.ok(result.defects[0].caseIds.includes('CASE-AC-1'));
  assert.ok(result.defects[0].acIds.includes('AC-1'));
});

test('a failed generated project command retains its own argv, exit and trace for repair', async () => {
  const context = await fixture();
  const result = await service(context, {
    verifier: async () => ({
      ok: false,
      code: 'VERIFY_FAILED',
      report: {
        status: 'failed',
        stages: [
          {
            name: 'frontend-build',
            command: process.execPath,
            args: ['--check', 'frontend/src/App.ts'],
            status: 2,
            reason: null,
            error: null,
            tail: ['Observed template build failure'],
          },
        ],
      },
    }),
  }).run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  const prompt = failureContext({ root: context.root, source: 'quality', quality: result.quality });
  assert.equal(prompt.command.exitCode, 2);
  assert.deepEqual(prompt.command.args, ['--check', 'frontend/src/App.ts']);
  assert.match(prompt.logSummary, /Observed template build failure/);
});

test('timeout and process failure remain failed and cannot invoke the project verifier', async () => {
  for (const timeout of [false, true]) {
    const context = await fixture();
    let verified = false;
    const quality = service(context, {
      timeoutMs: timeout ? 150 : 1000,
      testRunner: ({ worktree }) => ({
        command: process.execPath,
        args: [
          '-e',
          timeout
            ? 'setTimeout(()=>process.exit(99),2000);setInterval(()=>{},1000)'
            : 'process.exit(2)',
        ],
        cwd: worktree,
        reportPath: '.specgate/quality-report.json',
      }),
      verifier: () => {
        verified = true;
        return { ok: true };
      },
    });
    const result = await quality.run({ expectedVersion: await context.version() });
    assert.equal(
      result.code,
      timeout ? 'TEST_COMMAND_TIMEOUT' : 'TEST_COMMAND_FAILED',
      JSON.stringify(result),
    );
    assert.equal(result.quality.status, 'failed');
    assert.equal(verified, false);
    if (timeout) {
      assert.equal(result.quality.command.reason, 'COMMAND_TIMEOUT');
      assert.ok(
        result.quality.command.durationMs < 1500,
        'The timeout must terminate automatically before the test watchdog exits',
      );
    } else assert.equal(result.quality.command.exitCode, 2);
  }
});

test('an already cancelled gate executes neither test provider nor verifier', async () => {
  const context = await fixture();
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const quality = service(context, {
    testRunner: () => {
      called = true;
    },
    verifier: () => {
      called = true;
    },
  });
  const result = await quality.run(
    { expectedVersion: await context.version() },
    { signal: controller.signal },
  );
  assert.equal(result.code, 'CANCELLED');
  assert.equal(called, false);
  assert.equal((await context.store.inspect()).state.phase, 'TESTING');
});

test('missing runtime or unexecuted build stages cannot produce a passing Web/API gate', async () => {
  for (const mode of ['missing-runtime', 'not-run-build']) {
    const context = await fixture();
    const quality = service(context, {
      verifier: async (input) => {
        const result = await coverageVerifier()(input);
        if (mode === 'missing-runtime')
          result.report.stages = result.report.stages.filter(
            (stage) => stage.name !== 'frontend-runtime',
          );
        else
          result.report.stages.find((stage) => stage.name === 'frontend-build').status = 'not-run';
        return result;
      },
    });
    const result = await quality.run({ expectedVersion: await context.version() });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'VERIFY_EVIDENCE_INCOMPLETE', JSON.stringify(result));
    assert.equal((await context.store.inspect()).state.phase, 'TESTING');
  }
});

test('moving integration HEAD during verification invalidates a would-be pass and retains failure evidence', async () => {
  const context = await fixture();
  const integration = context.development.worktrees.integration.path;
  const quality = service(context, {
    verifier: async (input) => {
      const result = await coverageVerifier()(input);
      fs.writeFileSync(
        path.join(integration, 'frontend/src/App.ts'),
        "export const title = 'unexpected newer commit';\n",
      );
      commitAll(integration, 'move integration during quality');
      return result;
    },
  });
  const result = await quality.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTEGRATION_COMMIT_CHANGED');
  assert.equal(result.quality.status, 'failed');
  assert.equal((await context.store.inspect()).state.phase, 'TESTING');
});

test('historical quality is refused after integration advances to a different commit', async () => {
  const context = await fixture();
  const quality = service(context);
  const passed = await quality.run({ expectedVersion: await context.version() });
  assert.equal(passed.ok, true, JSON.stringify(passed));
  const integration = context.development.worktrees.integration.path;
  assert.equal(passed.quality.integrationCommit, git(integration, ['rev-parse', 'HEAD']));
  fs.writeFileSync(
    path.join(integration, 'frontend/src/App.ts'),
    "export const title = 'later';\n",
  );
  commitAll(integration, 'later integration commit');
  const inspected = await quality.inspect();
  assert.equal(inspected.ok, false);
  assert.equal(inspected.code, 'QUALITY_COMMIT_MISMATCH');
});

test('a repaired commit reruns frozen cases and the complete project verifier with fresh evidence', async () => {
  const context = await fixture();
  const failed = await service(context, {
    testRunner: runnerProvider({ status: 'fail', fail: true }),
  }).run({ expectedVersion: await context.version() });
  assert.equal(failed.ok, false);
  const calls = [];
  const development = createDevelopmentService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: async (role, challenge) => {
      calls.push(challenge);
      const relative = role === 'frontend' ? 'frontend/src/App.ts' : 'backend/src/TaskApi.java';
      fs.writeFileSync(
        path.join(challenge.worktree, relative),
        role === 'frontend'
          ? "export const title = 'repaired';\n"
          : 'final class TaskApi { String title = "repaired"; }\n',
      );
      commitAll(challenge.worktree, 'repair failed title case');
      return { ok: true };
    },
  });
  assert.equal(
    (await development.prepareRepair({ expectedVersion: await context.version() })).ok,
    true,
  );
  assert.equal((await development.run({ expectedVersion: await context.version() })).ok, true);
  assert.ok(calls.every((challenge) => challenge.repairContext.cases[0].id === 'CASE-AC-1'));
  let stages;
  let testExecutions = 0;
  const verifier = coverageVerifier();
  const passed = await service(context, {
    testRunner: async (challenge) => {
      testExecutions++;
      return runnerProvider()(challenge);
    },
    verifier: async (input) => {
      const result = await verifier(input);
      stages = result.report.stages.map((stage) => stage.name);
      return result;
    },
  }).run({ expectedVersion: await context.version() });
  assert.equal(passed.ok, true, JSON.stringify(passed));
  assert.equal(testExecutions, 1);
  for (const group of [/build/, /test|verify/, /lint/, /format/, /runtime/])
    assert.ok(
      stages.some((stage) => group.test(stage)),
      String(group),
    );
  assert.notEqual(passed.quality.runId, failed.quality.runId);
  assert.notEqual(passed.quality.integrationCommit, failed.quality.integrationCommit);
  assert.equal(
    passed.quality.cases.length,
    (await context.planService.inspect()).plan.graph.acs.length,
  );
  assert.equal(passed.quality.command.source, 'frozen-tests-runner');
});

test('adopted quality cannot turn known failures, skipped commands or nonzero exits into a pass', async () => {
  for (const mode of ['known-failure', 'skipped', 'nonzero']) {
    const context = await fixture();
    const now = new Date().toISOString();
    const profile = {
      schemaVersion: 2,
      projectId: 'project-strict-quality',
      mode: 'adopted',
      stack: 'java-vue',
      root: context.root,
      targetBranch: git(context.root, ['branch', '--show-current']),
      remoteUrl: null,
      commands: {
        install: [],
        ...Object.fromEntries(
          ['build', 'test', 'lint', 'format', 'runtime'].map((kind) => [
            kind,
            [{ id: kind, cwd: '.', argv: [process.execPath, '-e', 'process.exit(0)'] }],
          ]),
        ),
      },
      protectedPaths: [],
      createdAt: now,
      updatedAt: now,
    };
    const fingerprint = projectEnvironmentFingerprint(profile);
    assert.equal(
      persistProjectReadiness({
        root: context.root,
        profile,
        baseline: {
          schemaVersion: 2,
          baselineId: 'baseline-strict-quality',
          projectId: profile.projectId,
          commit: git(context.root, ['rev-parse', 'HEAD']),
          status: 'green',
          knownFailures: [],
          unverifiedAreas: [],
          commands: ['build', 'test', 'lint', 'format', 'runtime'],
          evidence: ['synthetic-baseline'],
          environmentFingerprint: fingerprint,
          createdAt: now,
        },
      }).ok,
      true,
    );
    const fillCoverage = coverageVerifier();
    const quality = createQualityService({
      projectRoot: context.root,
      store: context.store,
      planService: context.planService,
      testRunner: runnerProvider(),
      adoptedVerifier: async ({ worktree, commit }) => {
        for (const relative of ['state.json', 'init-report.json'])
          fs.copyFileSync(
            path.join(context.root, '.specgate', relative),
            path.join(worktree, '.specgate', relative),
          );
        await fillCoverage({ root: worktree });
        const commands = ['build', 'test', 'lint', 'format', 'runtime'].map((kind) => ({
          id: kind,
          kind,
          argv: profile.commands[kind][0].argv,
          cwd: '.',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          startedAt: now,
          finishedAt: now,
          evidence: 'synthetic-' + kind,
          stdout: '',
          stderr: '',
        }));
        const lint = commands.find((command) => command.id === 'lint');
        lint.status =
          mode === 'skipped' ? 'skipped' : mode === 'known-failure' ? 'failed' : 'passed';
        lint.exitCode = mode === 'skipped' ? null : 1;
        lint.stderr = 'Observed lint failure trace';
        return {
          ok: true,
          report: {
            schemaVersion: 1,
            kind: 'adopted-project-verification',
            projectId: profile.projectId,
            baselineId: 'baseline-strict-quality',
            status: mode === 'known-failure' ? 'passed-with-known-failures' : 'passed',
            commit,
            environmentFingerprint: fingerprint,
            commands,
            knownFailures:
              mode === 'known-failure'
                ? [
                    {
                      commandId: 'lint',
                      status: 'failed',
                      exitCode: 1,
                      signature: 'synthetic-known',
                      evidence: 'synthetic-baseline',
                    },
                  ]
                : [],
            newFailures: [],
          },
        };
      },
    });
    const result = await quality.run({ expectedVersion: await context.version() });
    assert.equal(result.ok, false, mode);
    assert.equal(result.code, 'VERIFY_EVIDENCE_INCOMPLETE', JSON.stringify(result));
    assert.equal((await context.store.inspect()).state.phase, 'TESTING');
    const prompt = failureContext({
      root: context.root,
      source: 'quality',
      quality: result.quality,
    });
    assert.equal(prompt.command.exitCode, mode === 'skipped' ? null : 1);
    assert.match(prompt.logSummary, /Observed lint failure trace/);
  }
});
