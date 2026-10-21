import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApprovalAuthority } from '../src/codex/approvals.js';
import { canonicalJson, hashValue } from '../src/codex/events.js';
import { createReleaseService } from '../src/codex/release.js';
import {
  createReviewService,
  selectReviewMode,
  validateReviewReport,
} from '../src/codex/review.js';
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

async function fixture({ mutateAfterRequest = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-review-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(root, '.gitignore'), '.specgate/\n');
  fs.mkdirSync(path.join(root, 'backend/src/main/java'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend/src/main/java/App.java'), 'class App {}\n');
  fs.mkdirSync(path.join(root, 'frontend/src/api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'frontend/src/api/types.ts'), 'export type A = 1;\n');
  const freezeCommit = commitAll(root, 'initial');

  const integrationPath = path.join(root, '.specgate/codex/worktrees/change/integration');
  fs.mkdirSync(path.dirname(integrationPath), { recursive: true });
  git(root, [
    'worktree',
    'add',
    '-b',
    'sg/codex/change/integration',
    integrationPath,
    freezeCommit,
  ]);
  fs.writeFileSync(
    path.join(integrationPath, 'backend/src/main/java/Controller.java'),
    'public class Controller { public void deleteAccount() { System.out.println("secure"); } }\n',
  );
  fs.writeFileSync(path.join(integrationPath, 'frontend/src/api/types.ts'), 'export type A = 2;\n');
  const integrationCommit = commitAll(integrationPath, 'feature');

  const reviewPath = path.join(root, '.specgate/codex/worktrees/change/review');
  git(root, ['worktree', 'add', '--detach', reviewPath, integrationCommit]);
  const testPath = path.join(root, '.specgate/codex/worktrees/change/test');
  git(root, ['worktree', 'add', '--detach', testPath, integrationCommit]);

  const qualityBody = {
    schemaVersion: 1,
    status: 'passed',
    runId: 'quality-1',
    cases: [{ id: 'CASE-AC-1', status: 'pass' }],
    p0: 0,
    p1: 0,
    coverage: { changed: { ok: true, rate: 0.96 } },
    defects: [],
  };
  const qualityRelative = '.specgate/codex/changes/change/quality/q1/report.json';
  fs.mkdirSync(path.dirname(path.join(root, qualityRelative)), { recursive: true });
  fs.writeFileSync(path.join(root, qualityRelative), canonicalJson(qualityBody) + '\n');
  const quality = {
    ...qualityBody,
    reportPath: qualityRelative,
    hash: 'sha256:' + hashValue(qualityBody),
  };

  let store;
  let authority;
  store = createStateStore({
    projectRoot: root,
    authorizeGate: async (challenge) => {
      if (challenge.gate === 'H1')
        return {
          ok: true,
          record: {
            gate: 'H1',
            scope: challenge.state.changeId,
            decision: 'approve',
            consumedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            nonce: 'a'.repeat(64),
            actor: { kind: 'user', id: 'fixture', source: 'synthetic-review-fixture' },
          },
        };
      return authority.authorizeGate(challenge);
    },
  });
  authority = createApprovalAuthority({
    request: async (_method, params) => {
      if (mutateAfterRequest) {
        const reportFile = path.join(root, '.specgate/codex/changes/change/review');
        const file = fs.readdirSync(reportFile).find((name) => name.endsWith('.json'));
        fs.appendFileSync(path.join(reportFile, file), 'tampered');
      }
      return {
        action: 'accept',
        content: {
          decision: 'approve',
          comment: `fixture H3: ${String(params?.message || '').slice(0, 20)}`,
        },
      };
    },
    trustedPeerIdentity: {
      id: 'fixture-user',
      kind: 'user',
      source: 'synthetic-review-release-fixture',
    },
    audit: async (entry) => {
      const current = await store.inspect();
      const saved = await store.recordEvent({
        expectedVersion: current.state.version,
        type: entry.type,
        payload: entry,
      });
      if (!saved.ok) throw Error(saved.code);
    },
    resolveGateArtifact: ({ gate, state }) => ({
      scope: state?.changeId,
      artifactHash:
        gate === 'H1'
          ? state?.context?.artifacts?.requirements?.hash
          : state?.context?.artifacts?.h3?.hash,
    }),
  });
  const requirementsHash = 'sha256:' + 'b'.repeat(64);
  await store.create({
    expectedVersion: 0,
    changeId: 'change',
    context: {
      artifacts: { requirements: { hash: requirementsHash } },
      quality,
      development: {
        freezeCommit,
        merged: [{ integrationCommit }],
        worktrees: {
          integration: { path: integrationPath, branch: 'sg/codex/change/integration' },
          review: { path: reviewPath, branch: 'review' },
          test: { path: testPath, branch: 'test' },
        },
      },
    },
  });
  for (const to of [
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
    'REVIEWING',
  ]) {
    const current = await store.inspect();
    const moved = await store.transition({ expectedVersion: current.state.version, to });
    assert.equal(moved.ok, true, JSON.stringify(moved));
  }
  const plan = {
    graph: {
      acs: [{ id: 'AC-1', caseId: 'CASE-AC-1', requirementId: 'REQ-1', text: 'Works' }],
    },
  };
  const planService = {
    inspect: async () => {
      const loaded = await store.inspect();
      return {
        ok: true,
        state: loaded.state,
        plan,
        ref: {
          hash: 'sha256:' + 'c'.repeat(64),
          contract: { path: '.specgate/contract.json', hash: 'sha256:' + 'd'.repeat(64) },
          model: { path: '.specgate/model.json', hash: 'sha256:' + 'e'.repeat(64) },
          tests: { hash: 'sha256:' + 'f'.repeat(64), directory: '.specgate/tests' },
        },
      };
    },
  };
  return {
    root,
    store,
    plan,
    planService,
    authority,
    quality,
    freezeCommit,
    integrationCommit,
    integrationPath,
    reviewPath,
    version: async () => (await store.inspect()).state.version,
  };
}

function passingProvider(context) {
  return async (role, challenge) => {
    assert.equal(role, 'review');
    return {
      mode: challenge.mode,
      reviewedCommit: context.integrationCommit,
      qualityHash: context.quality.hash,
      summary: 'Reviewed the complete priority implementation.',
      verdict: 'pass',
      findings: [],
    };
  };
}

test('risk selection escalates public contracts and Review enters H3 only on a valid pass', async () => {
  const context = await fixture();
  const service = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: passingProvider(context),
    approvalAuthority: context.authority,
  });
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.review.mode, 'strict');
  assert.equal(result.state.phase, 'H3_PENDING');
  const inspected = await service.inspect();
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.equal(inspected.review.valid, true);
  assert.deepEqual(
    selectReviewMode([{ id: 'large-change', triggered: true, evidence: { changedLines: 60 } }], {
      text: '',
    }),
    'standard',
  );
});

test('severity thresholds differ across lenient, standard and strict modes', () => {
  const diff = {
    text: '+public class Controller { void run() {} }',
    ranges: new Map([['backend/Controller.java', [{ start: 1, end: 1 }]]]),
  };
  const plan = { graph: { acs: [{ id: 'AC-1' }] } };
  const quality = { hash: 'sha256:' + '1'.repeat(64) };
  const integrity = { integrationCommit: 'a'.repeat(40) };
  const report = (mode, severity) => ({
    mode,
    reviewedCommit: integrity.integrationCommit,
    qualityHash: quality.hash,
    summary: 'Structured finding.',
    verdict: 'fail',
    findings: [
      {
        id: 'F-1',
        severity,
        file: 'backend/Controller.java',
        line: 1,
        acIds: ['AC-1'],
        evidence: 'public class Controller',
        recommendation: 'Refactor.',
      },
    ],
  });
  assert.equal(
    validateReviewReport(report('standard', 'P2'), {
      mode: 'standard',
      diff,
      plan,
      integrity,
      quality,
    }).blocking.length,
    1,
  );
  assert.equal(
    validateReviewReport(report('lenient', 'P2'), {
      mode: 'lenient',
      diff,
      plan,
      integrity,
      quality,
    }).blocking.length,
    0,
  );
  assert.equal(
    validateReviewReport(report('strict', 'P3'), {
      mode: 'strict',
      diff,
      plan,
      integrity,
      quality,
    }).blocking.length,
    1,
  );
});

test('Review Agent writes are rejected and no passed report is recorded', async () => {
  const context = await fixture();
  const service = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: async (role, challenge) => {
      fs.writeFileSync(path.join(challenge.worktree, 'touched.txt'), 'not read only');
      return passingProvider(context)(role, challenge);
    },
    approvalAuthority: context.authority,
  });
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'REVIEW_NOT_READ_ONLY');
  assert.equal((await context.store.inspect()).state.phase, 'REVIEWING');
});

test('strict mode blocks P3 findings and preserves the failed report', async () => {
  const context = await fixture();
  const service = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: async (role, challenge) => ({
      mode: challenge.mode,
      reviewedCommit: context.integrationCommit,
      qualityHash: context.quality.hash,
      summary: 'A maintainability issue remains.',
      verdict: 'fail',
      findings: [
        {
          id: 'F-1',
          severity: 'P3',
          file: 'backend/src/main/java/Controller.java',
          line: 1,
          acIds: ['AC-1'],
          evidence: 'public class Controller',
          recommendation: 'Extract the account deletion behavior from the controller.',
        },
      ],
    }),
    approvalAuthority: context.authority,
  });
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'REVIEW_BLOCKED');
  assert.equal(result.state.phase, 'REVIEWING');
  assert.equal(result.retryAllowed, true);
  assert.equal(fs.existsSync(path.join(context.root, result.review.reportPath)), true);
});

test('H3 preview changes invalidate approval and H3 cannot be bypassed for archive', async () => {
  const context = await fixture({ mutateAfterRequest: true });
  const service = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: passingProvider(context),
    approvalAuthority: context.authority,
  });
  const reviewed = await service.run({ expectedVersion: await context.version() });
  assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
  const h3 = await service.requestH3({ expectedVersion: await context.version() });
  assert.equal(h3.ok, false);
  assert.match(h3.code, /APPROVAL/);
  assert.equal((await context.store.inspect()).state.phase, 'H3_PENDING');

  const clean = await fixture();
  const release = createReleaseService({
    projectRoot: clean.root,
    store: clean.store,
    planService: clean.planService,
  });
  assert.equal((await release.run({ expectedVersion: await clean.version() })).code, 'H3_REQUIRED');
});

test('H3-approved archive without a remote becomes ARCHIVED_NOT_PUSHED and says not pushed', async () => {
  const context = await fixture();
  const review = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: passingProvider(context),
    approvalAuthority: context.authority,
  });
  assert.equal((await review.run({ expectedVersion: await context.version() })).ok, true);
  const approved = await review.requestH3({ expectedVersion: await context.version() });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  assert.equal(approved.state.phase, 'ARCHIVING');
  assert.equal(approved.state.version, await context.version());
  const release = createReleaseService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
  });
  const archived = await release.run({ expectedVersion: approved.state.version });
  assert.equal(archived.ok, true, JSON.stringify(archived));
  assert.equal(archived.state.phase, 'ARCHIVED_NOT_PUSHED');
  assert.equal(archived.pushed, false);
  assert.equal(archived.message, '未推送');
});

test('push failure records PUSH_FAILED without retry while a configured remote archives', async () => {
  const failed = await fixture();
  git(failed.root, ['remote', 'add', 'origin', path.join(failed.root, 'missing-remote.git')]);
  const failedReview = createReviewService({
    projectRoot: failed.root,
    store: failed.store,
    planService: failed.planService,
    roleProvider: passingProvider(failed),
    approvalAuthority: failed.authority,
  });
  await failedReview.run({ expectedVersion: await failed.version() });
  const failedH3 = await failedReview.requestH3({ expectedVersion: await failed.version() });
  assert.equal(failedH3.ok, true, JSON.stringify(failedH3));
  const failedRelease = createReleaseService({
    projectRoot: failed.root,
    store: failed.store,
    planService: failed.planService,
  });
  const pushFailed = await failedRelease.run({ expectedVersion: failedH3.state.version });
  assert.equal(pushFailed.ok, true, JSON.stringify(pushFailed));
  assert.equal(pushFailed.state.phase, 'PUSH_FAILED');
  assert.equal(pushFailed.pushed, false);
  assert.equal(pushFailed.report.push.status !== 0, true);
  assert.equal(pushFailed.report.push.command.includes('--force'), false);

  const passed = await fixture();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-remote-'));
  git(bare, ['init', '--bare', '-q']);
  git(passed.root, ['remote', 'add', 'origin', bare]);
  const passedReview = createReviewService({
    projectRoot: passed.root,
    store: passed.store,
    planService: passed.planService,
    roleProvider: passingProvider(passed),
    approvalAuthority: passed.authority,
  });
  await passedReview.run({ expectedVersion: await passed.version() });
  const passedH3 = await passedReview.requestH3({ expectedVersion: await passed.version() });
  assert.equal(passedH3.ok, true, JSON.stringify(passedH3));
  const passedRelease = createReleaseService({
    projectRoot: passed.root,
    store: passed.store,
    planService: passed.planService,
  });
  const archived = await passedRelease.run({ expectedVersion: passedH3.state.version });
  assert.equal(archived.ok, true, JSON.stringify(archived));
  assert.equal(archived.state.phase, 'ARCHIVED');
  assert.equal(archived.pushed, true);
  assert.equal(git(bare, ['rev-parse', 'main']), archived.state.context.archive.merge.commit);
});
