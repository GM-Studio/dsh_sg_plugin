import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  commandFailureSignature,
  legacyCommandFailureSignature,
  projectEnvironmentFingerprint,
} from '../src/codex/baseline.js';
import {
  validateAdoptedVerification,
  verifyAdoptedProject,
} from '../src/codex/adopted-verification.js';

const NOW = '2026-10-22T10:00:00.000Z';

function profile(commands) {
  return {
    schemaVersion: 2,
    projectId: 'project-adopted',
    mode: 'adopted',
    stack: 'java-vue',
    root: '/project',
    targetBranch: 'main',
    remoteUrl: null,
    backendPackage: 'com.acme.orders',
    frontendDefaultLocale: 'zh-CN',
    frontendLocales: ['zh-CN', 'en-US'],
    commands,
    protectedPaths: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function baseline(sourceProfile, knownFailures = []) {
  return {
    schemaVersion: 2,
    baselineId: 'baseline-adopted',
    projectId: sourceProfile.projectId,
    commit: 'a'.repeat(40),
    status: knownFailures.length ? 'known-failures' : 'green',
    knownFailures,
    unverifiedAreas: [],
    commands: Object.values(sourceProfile.commands)
      .flat()
      .map((command) => command.id),
    evidence: ['baseline-run'],
    environmentFingerprint: projectEnvironmentFingerprint(sourceProfile),
    createdAt: NOW,
  };
}

function commands() {
  return {
    install: [],
    build: [{ id: 'backend-build', cwd: 'backend', argv: ['mvn', 'verify'] }],
    test: [{ id: 'backend-test', cwd: 'backend', argv: ['mvn', 'test'] }],
    lint: [],
    format: [],
    runtime: [],
  };
}

function runnerFor(results) {
  return async ({ command }) => ({
    commandId: command.id,
    status: 'passed',
    exitCode: 0,
    stdout: '',
    stderr: '',
    durationMs: 1,
    ...(results[command.id] || {}),
  });
}

test('adopted verification preserves unchanged known failures and reports no pass claim', async () => {
  const sourceProfile = profile(commands());
  const knownFailure = {
    id: 'known-backend-test',
    signature: commandFailureSignature(sourceProfile.commands.test[0], {
      status: 'failed',
      exitCode: 1,
      stderr: 'legacy failure',
    }),
    commandId: 'backend-test',
    scope: 'test',
    evidence: 'baseline-test',
  };
  const result = await verifyAdoptedProject({
    profile: sourceProfile,
    baseline: baseline(sourceProfile, [knownFailure]),
    worktree: process.cwd(),
    commit: 'b'.repeat(40),
    runner: runnerFor({
      'backend-test': {
        status: 'failed',
        exitCode: 1,
        stderr: 'legacy failure',
      },
    }),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.report.status, 'passed-with-known-failures');
  assert.equal(result.report.knownFailures.length, 1);
  assert.equal(result.report.newFailures.length, 0);
  assert.deepEqual(validateAdoptedVerification(result), { ok: true, report: result.report });
});

test('adopted verification blocks new failures, missing commands and environment drift', async () => {
  const sourceProfile = profile(commands());
  const sourceBaseline = baseline(sourceProfile);
  const newFailure = await verifyAdoptedProject({
    profile: sourceProfile,
    baseline: sourceBaseline,
    worktree: process.cwd(),
    commit: 'b'.repeat(40),
    runner: runnerFor({
      'backend-test': {
        status: 'failed',
        exitCode: 1,
        stderr: 'new regression',
      },
    }),
  });
  assert.equal(newFailure.ok, false);
  assert.equal(newFailure.code, 'BASELINE_NEW_FAILURE');
  assert.deepEqual(
    newFailure.newFailures.map((entry) => entry.commandId),
    ['backend-test'],
  );

  const drifted = await verifyAdoptedProject({
    profile: sourceProfile,
    baseline: { ...sourceBaseline, environmentFingerprint: 'f'.repeat(64) },
    worktree: process.cwd(),
    commit: 'b'.repeat(40),
    runner: runnerFor({}),
  });
  assert.equal(drifted.code, 'BASELINE_ENVIRONMENT_MISMATCH');

  const invalid = validateAdoptedVerification({
    ...newFailure,
    ok: true,
    report: { ...newFailure.report, status: 'passed' },
  });
  assert.equal(invalid.code, 'ADOPTED_VERIFICATION_INVALID');
});

test('new failures include bounded command evidence and never become passed artifacts', async () => {
  const sourceProfile = profile(commands());
  const result = await verifyAdoptedProject({
    profile: sourceProfile,
    baseline: baseline(sourceProfile),
    worktree: process.cwd(),
    commit: 'b'.repeat(40),
    runner: runnerFor({
      'backend-test': {
        status: 'failed',
        exitCode: 2,
        stderr: 'failure detail',
      },
    }),
  });
  assert.equal(result.report.status, 'blocked');
  const failure = result.report.newFailures[0];
  assert.equal(failure.status, 'failed');
  assert.equal(failure.exitCode, 2);
  assert.equal(failure.evidence, 'baseline-does-not-cover');
  assert.equal(fs.existsSync(path.join(os.tmpdir(), 'never-created-by-adopted-verifier')), false);
});

test('known failure signatures ignore timestamps, process ids and worktree paths', async () => {
  const sourceProfile = profile(commands());
  const knownFailure = {
    id: 'known-stable',
    signature: commandFailureSignature(sourceProfile.commands.test[0], {
      status: 'failed',
      exitCode: 1,
      stderr:
        '2026-10-22T10:00:00.000Z PID 100 failed at C:\\worktrees\\first\\backend\\report.log',
    }),
    commandId: 'backend-test',
    scope: 'test',
    evidence: 'baseline-stable',
  };
  const result = await verifyAdoptedProject({
    profile: sourceProfile,
    baseline: baseline(sourceProfile, [knownFailure]),
    worktree: process.cwd(),
    commit: 'b'.repeat(40),
    runner: runnerFor({
      'backend-test': {
        status: 'failed',
        exitCode: 1,
        stderr:
          '2027-11-23T11:22:33.000Z PID 999 failed at C:\\worktrees\\second\\backend\\report.log',
      },
    }),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.report.knownFailures.length, 1);
});

test('adopted verification executes real ProjectProfile commands in the fixed worktree', async (t) => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-adopted-command-'));
  t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
  const sourceProfile = profile({
    install: [],
    build: [
      {
        id: 'build',
        cwd: '.',
        argv: [process.execPath, '-e', "process.stdout.write('adopted-build-ok')"],
      },
    ],
    test: [],
    lint: [],
    format: [],
    runtime: [],
  });
  const result = await verifyAdoptedProject({
    profile: sourceProfile,
    baseline: baseline(sourceProfile),
    worktree,
    commit: 'b'.repeat(40),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.commands[0].status, 'passed');
  assert.match(result.report.commands[0].stdout, /adopted-build-ok/);
});

test('legacy baselines rebuild stable signatures from retained command evidence', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-adopted-legacy-baseline-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceProfile = profile(commands());
  sourceProfile.root = root;
  const sourceBaseline = baseline(sourceProfile, [
    {
      id: 'known-legacy',
      signature: legacyCommandFailureSignature(sourceProfile.commands.test[0], {
        status: 'failed',
        exitCode: 1,
        stderr: 'legacy /home/sc/project/backend/report.log',
      }),
      commandId: 'backend-test',
      scope: 'test',
      evidence: 'baseline-legacy',
    },
  ]);
  const runDirectory = path.join(
    root,
    '.specgate',
    'codex',
    'baseline-runs',
    'baseline-run-0123456789abcdef',
  );
  fs.mkdirSync(runDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(runDirectory, 'summary.json'),
    JSON.stringify({
      baseline: { baselineId: sourceBaseline.baselineId },
      commands: [
        {
          id: 'backend-test',
          status: 'failed',
          exitCode: 1,
          stdout: '',
          stderr: 'legacy /home/sc/project/backend/report.log',
        },
      ],
    }),
  );
  const result = await verifyAdoptedProject({
    profile: sourceProfile,
    baseline: sourceBaseline,
    worktree: process.cwd(),
    commit: 'b'.repeat(40),
    runner: runnerFor({
      'backend-test': {
        status: 'failed',
        exitCode: 1,
        stderr: 'legacy /tmp/other-worktree/backend/report.log',
      },
    }),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.report.knownFailures.length, 1);
});
