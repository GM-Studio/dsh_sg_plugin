import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mcpClient } from './environment-mcp-client.mjs';
import { createApprovalAuthority } from '../src/codex/approvals.js';
import { canonicalJson, hashValue } from '../src/codex/events.js';
import { createReleaseService } from '../src/codex/release.js';
import { readDeliveryRecord } from '../src/codex/delivery.js';
import { persistProjectReadiness } from '../src/codex/project-state.js';
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

async function fixture({ mutateAfterRequest = false, projectBacked = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-review-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  fs.writeFileSync(path.join(root, '.gitignore'), '.specgate/\n');
  fs.mkdirSync(path.join(root, 'backend/src/main/java'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backend/src/main/java/App.java'), 'class App {}\n');
  fs.mkdirSync(path.join(root, 'frontend/src/api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'frontend/src/api/types.ts'), 'export type A = 1;\n');
  commitAll(root, 'initial');
  if (projectBacked) {
    const now = '2026-10-22T10:00:00.000Z';
    const projectProfile = {
      schemaVersion: 2,
      projectId: 'project-release',
      mode: 'new',
      stack: 'java-vue',
      javaPreset: 'jdk17-boot3.5',
      frontendFramework: 'vue',
      root: root,
      targetBranch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      remoteUrl: null,
      commands: { install: [], build: [], test: [], lint: [], format: [], runtime: [] },
      protectedPaths: [],
      createdAt: now,
      updatedAt: now,
    };
    const baseline = {
      schemaVersion: 2,
      baselineId: 'baseline-release',
      projectId: 'project-release',
      commit: git(root, ['rev-parse', 'HEAD']),
      status: 'green',
      knownFailures: [],
      unverifiedAreas: [],
      commands: [],
      evidence: [],
      environmentFingerprint: 'e'.repeat(64),
      createdAt: now,
    };
    const readiness = persistProjectReadiness({
      root: root,
      profile: projectProfile,
      baseline,
    });
    assert.equal(readiness.ok, true, JSON.stringify(readiness));
  }
  const freezeCommit = git(root, ['rev-parse', 'HEAD']);

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
  const redRelative = '.specgate/codex/changes/change/red/run-1/evidence.json';
  fs.mkdirSync(path.dirname(path.join(root, redRelative)), { recursive: true });
  fs.writeFileSync(
    path.join(root, redRelative),
    canonicalJson({ cases: [{ id: 'CASE-AC-1', status: 'fail' }] }) + '\n',
  );

  const qualityBody = {
    schemaVersion: 1,
    status: 'passed',
    integrationCommit,
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
        red: { path: redRelative },
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
    'FORMATTING',
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
      agent: 'specgate_reviewer',
      assignmentHash: 'a'.repeat(64),
      mode: challenge.mode,
      reviewedCommit: context.integrationCommit,
      qualityHash: context.quality.hash,
      summary: 'Reviewed the complete priority implementation.',
      verdict: 'pass',
      findings: [],
    };
  };
}

async function approvedReleaseFixture() {
  const context = await fixture({ projectBacked: true });
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-release-recovery-remote-'));
  git(remote, ['init', '--bare', '-q']);
  git(context.root, ['remote', 'add', 'origin', remote]);
  git(context.root, ['push', '-u', 'origin', 'main']);
  const review = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: passingProvider(context),
    approvalAuthority: context.authority,
  });
  assert.equal((await review.run({ expectedVersion: await context.version() })).ok, true);
  assert.equal((await review.requestH3({ expectedVersion: await context.version() })).ok, true);
  return { ...context, remote };
}
test('release validates DeliveryRecord before fast-forwarding the real target', async () => {
  const c = await approvedReleaseFixture();
  const original = c.planService.inspect;
  const release = createReleaseService({
    projectRoot: c.root,
    store: c.store,
    planService: {
      inspect: async () => {
        const v = await original();
        return { ...v, ref: { ...v.ref, contract: { ...v.ref.contract, hash: 'invalid' } } };
      },
    },
  });
  const result = await release.run({ expectedVersion: await c.version() });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(
    git(c.root, ['rev-parse', 'HEAD']),
    c.freezeCommit,
    'invalid delivery must not move target',
  );
});
test('real archive-report storage failure preserves worktrees and safely resumes the same H3', async () => {
  const c = await approvedReleaseFixture();
  const blocker = path.join(c.root, '.specgate/codex/archive/change/archive-report.json');
  fs.mkdirSync(blocker, { recursive: true });
  const release = createReleaseService({
    projectRoot: c.root,
    store: c.store,
    planService: c.planService,
  });
  const result = await release.run({ expectedVersion: await c.version() });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(
    fs.existsSync(c.integrationPath),
    true,
    'retain source until durable archive finalization',
  );
  const head = git(c.root, ['rev-parse', 'HEAD']);
  fs.rmdirSync(blocker);
  const retry = await release.run({ expectedVersion: await c.version() });
  assert.equal(retry.ok, true, JSON.stringify(retry));
  assert.equal(retry.state.phase, 'ARCHIVED_NOT_PUSHED');
  assert.equal(git(c.root, ['rev-parse', 'HEAD']), c.integrationCommit);
  assert.equal(head, c.integrationCommit);
  assert.equal(git(c.remote, ['rev-parse', 'main']), c.freezeCommit, 'no push on retry');
  const delivery = retry.report.delivery;
  assert.equal(git(c.root, ['rev-parse', `${delivery.tag}^{commit}`]), c.integrationCommit);
  const tagObject = git(c.root, ['rev-parse', delivery.tag]);
  const repeated = await release.run({ expectedVersion: await c.version() });
  assert.equal(repeated.ok, true, JSON.stringify(repeated));
  assert.equal(
    git(c.root, ['rev-parse', delivery.tag]),
    tagObject,
    'annotated tag is not recreated',
  );
});

test('an exited real publisher resumes in a new process and the MCP entry reuses its completed H3 delivery', async (t) => {
  const c = await approvedReleaseFixture();
  const checked = await c.planService.inspect();
  const publisher = (
    crash,
    version,
  ) => `import {createReleaseService} from ${JSON.stringify(new URL('../src/codex/release.js', import.meta.url).href)};import {createStateStore} from ${JSON.stringify(new URL('../src/codex/state-machine.js', import.meta.url).href)};
  const root=${JSON.stringify(c.root)},base=createStateStore({projectRoot:root});
  const store={...base,update:async(args)=>{if(${crash} && args.patch.context.archive)process.exit(73);return base.update(args);}};
  const result=await createReleaseService({projectRoot:root,store,planService:{inspect:async()=>(${JSON.stringify({ ok: true, plan: checked.plan, ref: checked.ref })})}}).run({expectedVersion:${version}});console.log(JSON.stringify(result));process.exit(result.ok?0:74);`;
  const crashed = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', publisher(true, await c.version())],
    {
      cwd: c.root,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  assert.equal(crashed.status, 73, crashed.stderr);
  assert.equal(git(c.root, ['rev-parse', 'HEAD']), c.integrationCommit);
  const tags = git(c.root, ['show-ref', '--tags']);
  assert.equal(fs.existsSync(c.integrationPath), true);
  const continued = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', publisher(false, await c.version())],
    { cwd: c.root, windowsHide: true, encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(continued.status, 0, continued.stderr || continued.stdout);
  const resumed = JSON.parse(continued.stdout.trim());
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.state.phase, 'ARCHIVED_NOT_PUSHED');
  assert.equal(git(c.root, ['show-ref', '--tags']), tags);
  assert.equal(git(c.remote, ['rev-parse', 'main']), c.freezeCommit);
  const client = await mcpClient(t, c.root);
  const repeated = (await client.call('sg_release_archive', { expectedVersion: await c.version() }))
    .structuredContent;
  assert.equal(repeated.ok, true, JSON.stringify(repeated));
  assert.equal(repeated.reused, true);
});

test('an existing conflicting annotated tag blocks before fast-forward and remains unchanged', async () => {
  const c = await approvedReleaseFixture();
  const stable =
    'delivery-' +
    hashValue({
      projectId: 'project-release',
      changeId: 'change',
      deliveryCommit: c.integrationCommit,
      parentDeliveryId: null,
    }).slice(0, 16);
  const tag = 'specgate-delivery-' + stable;
  git(c.root, ['tag', '-a', tag, '-m', 'existing user tag', c.freezeCommit]);
  const prior = git(c.root, ['rev-parse', tag]);
  const result = await createReleaseService({
    projectRoot: c.root,
    store: c.store,
    planService: c.planService,
  }).run({ expectedVersion: await c.version() });
  assert.equal(result.code, 'DELIVERY_TAG_CONFLICT', JSON.stringify(result));
  assert.equal(git(c.root, ['rev-parse', tag]), prior);
  assert.equal(git(c.root, ['rev-parse', 'HEAD']), c.freezeCommit);
});

for (const edge of ['intent', 'archive', 'transition'])
  test(`real state version conflict at ${edge} is recoverable without another H3 or duplicate tag`, async () => {
    const c = await approvedReleaseFixture();
    let injected = false;
    const wrapped = {
      ...c.store,
      update: async (args) => {
        if (
          !injected &&
          (edge === 'intent'
            ? args.patch.context.archiveOperation
            : edge === 'archive'
              ? args.patch.context.archive
              : false)
        ) {
          injected = true;
          const checkpoint = await c.store.checkpoint({
            expectedVersion: args.expectedVersion,
            label: 'actual competing fixture checkpoint',
          });
          assert.equal(checkpoint.ok, true, JSON.stringify(checkpoint));
        }
        return c.store.update(args);
      },
      transition: async (args) => {
        if (!injected && edge === 'transition' && args.to === 'ARCHIVED_NOT_PUSHED') {
          injected = true;
          assert.equal(
            (
              await c.store.checkpoint({
                expectedVersion: args.expectedVersion,
                label: 'actual competing finalization checkpoint',
              })
            ).ok,
            true,
          );
        }
        return c.store.transition(args);
      },
    };
    const release = createReleaseService({
      projectRoot: c.root,
      store: wrapped,
      planService: c.planService,
    });
    const result = await release.run({ expectedVersion: await c.version() });
    assert.equal(result.code, 'VERSION_CONFLICT', JSON.stringify(result));
    assert.equal(fs.existsSync(c.integrationPath), true);
    assert.equal(
      git(c.root, ['rev-parse', 'HEAD']),
      edge === 'intent' ? c.freezeCommit : c.integrationCommit,
    );
    const beforeTags = edge === 'intent' ? [] : git(c.root, ['show-ref', '--tags']).split('\n');
    const retry = await createReleaseService({
      projectRoot: c.root,
      store: c.store,
      planService: c.planService,
    }).run({ expectedVersion: await c.version() });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    if (edge !== 'intent')
      assert.deepEqual(git(c.root, ['show-ref', '--tags']).split('\n'), beforeTags);
    assert.equal(git(c.remote, ['rev-parse', 'main']), c.freezeCommit);
  });

test('immutable archive conflict is preserved and changed recovery source or target is rejected', async () => {
  const c = await approvedReleaseFixture();
  const source = path.join(c.root, '.specgate/codex/changes/change/red/run-1/evidence.json');
  const conflict = path.join(c.root, '.specgate/codex/archive/change/red/run-1/evidence.json');
  fs.mkdirSync(path.dirname(conflict), { recursive: true });
  fs.writeFileSync(conflict, 'user evidence must survive');
  const release = createReleaseService({
    projectRoot: c.root,
    store: c.store,
    planService: c.planService,
  });
  assert.equal(
    (await release.run({ expectedVersion: await c.version() })).code,
    'ARCHIVE_EVIDENCE_CONFLICT',
  );
  assert.equal(fs.readFileSync(conflict, 'utf8'), 'user evidence must survive');
  fs.appendFileSync(source, 'changed after approval');
  assert.equal(
    (await release.run({ expectedVersion: await c.version() })).code,
    'ARCHIVE_RECOVERY_CONFLICT',
  );
  assert.equal(fs.readFileSync(conflict, 'utf8'), 'user evidence must survive');
});
test('completed retry verifies packs and cannot acquire implicit push authorization', async () => {
  const c = await approvedReleaseFixture();
  const release = createReleaseService({
    projectRoot: c.root,
    store: c.store,
    planService: c.planService,
  });
  const done = await release.run({ expectedVersion: await c.version() });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(
    (await release.run({ expectedVersion: await c.version(), push: true })).code,
    'ARCHIVE_OPTION_CHANGED',
  );
  const pack = path.join(
    c.root,
    '.specgate/codex/deliveries',
    done.report.delivery.deliveryId,
    'customer.md',
  );
  fs.appendFileSync(pack, 'tampered pack');
  assert.equal(
    (await release.run({ expectedVersion: await c.version() })).code,
    'ARCHIVE_EVIDENCE_CONFLICT',
  );
  assert.match(fs.readFileSync(pack, 'utf8'), /tampered pack$/);
  assert.equal(git(c.remote, ['rev-parse', 'main']), c.freezeCommit);
});

test('a real received push followed by state CAS failure is recovered by observing the remote commit', async () => {
  const c = await approvedReleaseFixture();
  let injected = false;
  const store = {
    ...c.store,
    update: async (args) => {
      if (!injected && args.patch.context.archiveOperation?.pushReceipt) {
        injected = true;
        assert.equal(
          (
            await c.store.checkpoint({
              expectedVersion: args.expectedVersion,
              label: 'real push receipt contention',
            })
          ).ok,
          true,
        );
      }
      return c.store.update(args);
    },
  };
  const release = createReleaseService({ projectRoot: c.root, store, planService: c.planService });
  const first = await release.run({ expectedVersion: await c.version(), push: true });
  assert.equal(first.code, 'VERSION_CONFLICT', JSON.stringify(first));
  assert.equal(git(c.remote, ['rev-parse', 'main']), c.integrationCommit);
  const resumed = await createReleaseService({
    projectRoot: c.root,
    store: c.store,
    planService: c.planService,
  }).run({ expectedVersion: await c.version(), push: true });
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.state.phase, 'ARCHIVED');
  assert.equal(resumed.report.push.observed, true);
  assert.equal(resumed.report.push.command[1], 'ls-remote');
  assert.equal(resumed.report.delivery.deliveryCommit, c.integrationCommit);
});

test('two real publisher processes serialize one release without duplicate Git or delivery artifacts', async () => {
  const c = await approvedReleaseFixture(),
    checked = await c.planService.inspect();
  const script = `import {createReleaseService} from ${JSON.stringify(new URL('../src/codex/release.js', import.meta.url).href)};import {createStateStore} from ${JSON.stringify(new URL('../src/codex/state-machine.js', import.meta.url).href)};const result=await createReleaseService({projectRoot:${JSON.stringify(c.root)},store:createStateStore({projectRoot:${JSON.stringify(c.root)}}),planService:{inspect:async()=>(${JSON.stringify({ ok: true, plan: checked.plan, ref: checked.ref })})}}).run({expectedVersion:${await c.version()}});console.log(JSON.stringify(result));`;
  const launch = () =>
    promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
      cwd: c.root,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
  const results = (await Promise.all([launch(), launch()])).map((value) =>
    JSON.parse(value.stdout.trim()),
  );
  assert.equal(results.filter((value) => value.ok).length, 1, JSON.stringify(results));
  assert.ok(
    results
      .filter((value) => !value.ok)
      .every((value) => ['ARCHIVE_BUSY', 'VERSION_CONFLICT'].includes(value.code)),
    JSON.stringify(results),
  );
  assert.equal(git(c.root, ['rev-parse', 'HEAD']), c.integrationCommit);
  assert.equal(git(c.root, ['show-ref', '--tags']).split('\n').length, 1);
  assert.equal(git(c.remote, ['rev-parse', 'main']), c.freezeCommit);
});

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

test('Review and H3 reject quality evidence from another integration commit', async () => {
  const context = await fixture();
  const staleBody = { ...context.quality, integrationCommit: context.freezeCommit };
  delete staleBody.reportPath;
  delete staleBody.hash;
  fs.writeFileSync(
    path.join(context.root, context.quality.reportPath),
    canonicalJson(staleBody) + '\n',
  );
  const stale = {
    ...staleBody,
    reportPath: context.quality.reportPath,
    hash: 'sha256:' + hashValue(staleBody),
  };
  let loaded = await context.store.inspect();
  assert.equal(
    (
      await context.store.update({
        expectedVersion: loaded.state.version,
        patch: { context: { quality: stale } },
      })
    ).ok,
    true,
  );
  const service = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: passingProvider(context),
    approvalAuthority: context.authority,
  });
  assert.equal(
    (await service.prepare({ expectedVersion: await context.version() })).code,
    'QUALITY_COMMIT_MISMATCH',
  );
  assert.equal(
    (await service.run({ expectedVersion: await context.version() })).code,
    'QUALITY_COMMIT_MISMATCH',
  );
  assert.equal((await context.store.inspect()).state.phase, 'REVIEWING');
});

test('H3 refuses a quality report replaced after Review with a stale commit', async () => {
  const context = await fixture();
  const service = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: passingProvider(context),
    approvalAuthority: context.authority,
  });
  assert.equal((await service.run({ expectedVersion: await context.version() })).ok, true);
  const staleBody = { ...context.quality, integrationCommit: context.freezeCommit };
  delete staleBody.reportPath;
  delete staleBody.hash;
  fs.writeFileSync(
    path.join(context.root, context.quality.reportPath),
    canonicalJson(staleBody) + '\n',
  );
  const loaded = await context.store.inspect();
  assert.equal(
    (
      await context.store.update({
        expectedVersion: loaded.state.version,
        patch: {
          context: {
            quality: {
              ...staleBody,
              reportPath: context.quality.reportPath,
              hash: 'sha256:' + hashValue(staleBody),
            },
          },
        },
      })
    ).ok,
    true,
  );
  assert.equal(
    (await service.requestH3({ expectedVersion: await context.version() })).code,
    'QUALITY_COMMIT_MISMATCH',
  );
});

test('Review reports cannot come from public arguments and missing provider is unavailable', async () => {
  const context = await fixture();
  const service = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
  });
  assert.equal(
    (await service.run({ expectedVersion: await context.version(), report: {} })).code,
    'INVALID_ARGUMENT',
  );
  assert.equal(
    (await service.run({ expectedVersion: await context.version() })).code,
    'REVIEW_PROVIDER_UNAVAILABLE',
  );
});

test('server Reviewer receives a read-only challenge and submits a validated report', async () => {
  const context = await fixture();
  const service = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: passingProvider(context),
    approvalAuthority: context.authority,
  });
  const prepared = await service.prepare({ expectedVersion: await context.version() });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  assert.equal(prepared.challenge.reviewedCommit, undefined);
  assert.equal(prepared.challenge.integrationCommit, context.integrationCommit);
  assert.equal(prepared.challenge.qualityHash, context.quality.hash);
  assert.equal(prepared.challenge.mode, 'strict');
  const injected = await service.run({ expectedVersion: await context.version(), report: {} });
  assert.equal(injected.code, 'INVALID_ARGUMENT');
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.phase, 'H3_PENDING');
  assert.equal((await service.inspect()).review.report.verdict, 'pass');
});

test('server Reviewer must record its execution identity and assignment hash', async () => {
  const context = await fixture();
  const service = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: async (role, challenge) => ({
      mode: challenge.mode,
      reviewedCommit: context.integrationCommit,
      qualityHash: context.quality.hash,
      summary: 'A report without provider identity must not be accepted.',
      verdict: 'pass',
      findings: [],
    }),
    approvalAuthority: context.authority,
  });
  const result = await service.run({ expectedVersion: await context.version() });
  assert.equal(result.code, 'REVIEW_IDENTITY_REQUIRED');
  assert.equal((await context.store.inspect()).state.phase, 'REVIEWING');
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

test('Review finding field aliases are normalized into the machine contract', () => {
  const diff = {
    text: '+unsafe operation',
    ranges: new Map([['backend/Controller.java', [{ start: 1, end: 1 }]]]),
    lineEvidence: new Map([['backend/Controller.java', new Map([[1, 'unsafe operation']])]]),
  };
  const checked = validateReviewReport(
    {
      mode: 'strict',
      reviewedCommit: 'a'.repeat(40),
      qualityHash: 'sha256:' + 'b'.repeat(64),
      summary: 'Native reviewer used the prompt aliases.',
      verdict: 'fail',
      findings: [
        {
          id: 'F-1',
          severity: 'blocking',
          file: 'backend/Controller.java',
          'changed line': 1,
          acIds: ['AC-1'],
          'concrete evidence': 'unsafe operation',
          recommendation: 'Remove unsafe operation.',
        },
      ],
    },
    {
      mode: 'strict',
      diff,
      plan: { graph: { acs: [{ id: 'AC-1' }] } },
      integrity: { integrationCommit: 'a'.repeat(40) },
      quality: { hash: 'sha256:' + 'b'.repeat(64) },
    },
  );
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.findings[0].severity, 'P1');
  assert.equal(checked.findings[0].line, 1);
  assert.equal(checked.findings[0].evidence, 'unsafe operation');
  assert.equal(checked.blocking.length, 1);
});

test('Review evidence blockers cite immutable red evidence instead of an invented diff line', () => {
  const checked = validateReviewReport(
    {
      mode: 'strict',
      reviewedCommit: 'a'.repeat(40),
      qualityHash: 'sha256:' + 'b'.repeat(64),
      summary: 'The red baseline contains an infrastructure failure.',
      verdict: 'fail',
      findings: [
        {
          id: 'F-RED-1',
          severity: 'P1',
          file: '.specgate/codex/changes/change-1/red/run-1/evidence.json',
          line: 1,
          acIds: ['AC-1'],
          evidence:
            'The artifact reports `Missing backend test report` and the backend command failed.',
          recommendation: 'Provision Maven and rerun the red baseline.',
        },
      ],
    },
    {
      mode: 'strict',
      diff: {
        text: '',
        ranges: new Map(),
        redEvidence: {
          cases: [{ failures: [{ error: 'Missing backend test report' }] }],
        },
      },
      plan: { graph: { acs: [{ id: 'AC-1' }] } },
      integrity: { integrationCommit: 'a'.repeat(40) },
      quality: { hash: 'sha256:' + 'b'.repeat(64) },
    },
  );
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.blocking.length, 1);
});

test('a Review finding must cite evidence on its reported file and line', () => {
  const diff = {
    text: '+unsafe operation\n+safe operation',
    ranges: new Map([['backend/Controller.java', [{ start: 1, end: 2 }]]]),
    lineEvidence: new Map([
      [
        'backend/Controller.java',
        new Map([
          [1, 'unsafe operation'],
          [2, 'safe operation'],
        ]),
      ],
    ]),
  };
  const checked = validateReviewReport(
    {
      mode: 'strict',
      reviewedCommit: 'a'.repeat(40),
      qualityHash: 'sha256:' + 'b'.repeat(64),
      summary: 'Finding has a misplaced quote.',
      verdict: 'fail',
      findings: [
        {
          id: 'F-1',
          severity: 'P1',
          file: 'backend/Controller.java',
          line: 2,
          acIds: ['AC-1'],
          evidence: 'unsafe operation',
          recommendation: 'Remove unsafe operation.',
        },
      ],
    },
    {
      mode: 'strict',
      diff,
      plan: { graph: { acs: [{ id: 'AC-1' }] } },
      integrity: { integrationCommit: 'a'.repeat(40) },
      quality: { hash: 'sha256:' + 'b'.repeat(64) },
    },
  );
  assert.equal(checked.ok, false);
  assert.match(checked.errors.join(' '), /cited file and line/);
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
      agent: 'specgate_reviewer',
      assignmentHash: 'b'.repeat(64),
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
  const pushFailed = await failedRelease.run({
    expectedVersion: failedH3.state.version,
    push: true,
  });
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
  const archived = await passedRelease.run({
    expectedVersion: passedH3.state.version,
    push: true,
  });
  assert.equal(archived.ok, true, JSON.stringify(archived));
  assert.equal(archived.state.phase, 'ARCHIVED');
  assert.equal(archived.pushed, true);
  assert.equal(git(bare, ['rev-parse', 'main']), archived.state.context.archive.merge.commit);
});

test('a configured remote is not pushed unless push=true is explicit', async () => {
  const context = await fixture();
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-local-only-'));
  git(bare, ['init', '--bare', '-q']);
  git(context.root, ['remote', 'add', 'origin', bare]);
  const review = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: passingProvider(context),
    approvalAuthority: context.authority,
  });
  await review.run({ expectedVersion: await context.version() });
  const approved = await review.requestH3({ expectedVersion: await context.version() });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const release = createReleaseService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
  });
  const archived = await release.run({
    expectedVersion: approved.state.version,
    push: false,
  });
  assert.equal(archived.ok, true, JSON.stringify(archived));
  assert.equal(archived.state.phase, 'ARCHIVED_NOT_PUSHED');
  assert.equal(archived.pushed, false);
  assert.equal(archived.report.push, undefined);
});

test('archive blocks a diverged target and preserves its unreviewed commit', async () => {
  const context = await fixture();
  fs.writeFileSync(path.join(context.root, 'target-only.txt'), 'unreviewed target change\n');
  const targetCommit = commitAll(context.root, 'target advanced independently');
  const review = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: passingProvider(context),
    approvalAuthority: context.authority,
  });
  assert.equal((await review.run({ expectedVersion: await context.version() })).ok, true);
  assert.equal((await review.requestH3({ expectedVersion: await context.version() })).ok, true);
  const release = createReleaseService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
  });
  const result = await release.run({ expectedVersion: await context.version(), push: false });
  assert.equal(result.code, 'ARCHIVE_TARGET_DIVERGED');
  assert.equal(git(context.root, ['rev-parse', 'HEAD']), targetCommit);
  assert.equal(
    fs.readFileSync(path.join(context.root, 'target-only.txt'), 'utf8'),
    'unreviewed target change\n',
  );
});

test('project-backed archive creates a DeliveryRecord, local tag and separate packs', async () => {
  const context = await fixture({ projectBacked: true });
  const review = createReviewService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
    roleProvider: passingProvider(context),
    approvalAuthority: context.authority,
  });
  await review.run({ expectedVersion: await context.version() });
  const approved = await review.requestH3({ expectedVersion: await context.version() });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const release = createReleaseService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
  });
  const archived = await release.run({
    expectedVersion: approved.state.version,
    push: false,
  });
  assert.equal(archived.ok, true, JSON.stringify(archived));
  const delivery = archived.report.delivery;
  assert.equal(delivery.projectId, 'project-release');
  assert.equal(delivery.schemaVersion, 3);
  assert.equal(delivery.releaseState, 'release-approved');
  assert.equal(delivery.customerAcceptance, null);
  assert.equal(delivery.push.requested, false);
  assert.equal(git(context.root, ['tag', '--list', delivery.tag]), delivery.tag);
  assert.equal(archived.report.cleanup.ok, true, JSON.stringify(archived.report.cleanup));
  assert.equal(fs.existsSync(context.integrationPath), false);
  assert.equal(fs.existsSync(context.reviewPath), false);
  assert.equal(git(context.root, ['branch', '--list', 'sg/codex/change/*']), '');
  const read = readDeliveryRecord({
    projectRoot: context.root,
    deliveryId: delivery.deliveryId,
  });
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(
    fs.existsSync(
      path.join(context.root, `.specgate/codex/deliveries/${delivery.deliveryId}/customer.md`),
    ),
    true,
  );
});

for (const [mode, severity] of [
  ['standard', 'P3'],
  ['lenient', 'P2'],
]) {
  test(`${mode} release preserves approved ${severity} findings in the record and customer pack`, async () => {
    const context = await fixture({ projectBacked: true });
    const finding = {
      id: 'F-KNOWN-1',
      severity,
      file: 'backend/src/main/java/Controller.java',
      line: 1,
      acIds: ['AC-1'],
      evidence: 'public class Controller',
      recommendation: 'Extract account deletion into a service.',
    };
    const review = createReviewService({
      projectRoot: context.root,
      store: context.store,
      planService: context.planService,
      roleProvider: async (...args) => ({
        ...(await passingProvider(context)(...args)),
        findings: [finding],
      }),
      approvalAuthority: context.authority,
    });
    const reviewed = await review.run({ expectedVersion: await context.version(), mode });
    assert.equal(reviewed.ok, true, JSON.stringify(reviewed));
    const approved = await review.requestH3({ expectedVersion: await context.version() });
    assert.equal(approved.ok, true, JSON.stringify(approved));
    const release = createReleaseService({
      projectRoot: context.root,
      store: context.store,
      planService: context.planService,
    });
    const archived = await release.run({ expectedVersion: await context.version(), push: false });
    assert.equal(archived.ok, true, JSON.stringify(archived));
    const delivery = archived.report.delivery;
    assert.equal(delivery.knownIssues.length, 1);
    for (const value of [finding.id, severity, `${finding.file}:1`, finding.recommendation])
      assert.ok(delivery.knownIssues[0].includes(value), value);
    const base = path.join(context.root, '.specgate/codex/deliveries', delivery.deliveryId);
    const pack = fs.readFileSync(path.join(base, 'customer.md'), 'utf8');
    assert.ok(pack.includes(delivery.knownIssues[0]));
    assert.ok(delivery.evidence.includes(reviewed.review.hash));
    const record = readDeliveryRecord({
      projectRoot: context.root,
      deliveryId: delivery.deliveryId,
    });
    assert.deepEqual(record.delivery.knownIssues, delivery.knownIssues);
    const retry = await release.run({ expectedVersion: await context.version(), push: false });
    assert.equal(retry.ok, true, JSON.stringify(retry));
    assert.equal(retry.reused, true);
    assert.deepEqual(retry.report.delivery, delivery);
    assert.equal(fs.readFileSync(path.join(base, 'customer.md'), 'utf8'), pack);
  });
}

test('changed approved review cannot publish known issues or move the target', async () => {
  const context = await approvedReleaseFixture();
  const current = await context.store.inspect();
  const ref = current.state.context.artifacts.review;
  const file = path.join(context.root, ref.path);
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  body.report.findings = [{ id: 'unapproved' }];
  fs.writeFileSync(file, canonicalJson(body) + '\n');
  const release = createReleaseService({
    projectRoot: context.root,
    store: context.store,
    planService: context.planService,
  });
  const result = await release.run({ expectedVersion: await context.version() });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(git(context.root, ['rev-parse', 'HEAD']), context.freezeCommit);
  assert.equal(fs.existsSync(path.join(context.root, '.specgate/codex/deliveries')), false);
});
