import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDeliveryAssurance } from '../src/codex/control/delivery-assurance.js';

const NOW = '2026-10-24T02:00:00.000Z';
const ARTIFACT = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);
const clock = () => new Date(NOW);

function fixture(t, files = { 'test/ac-1.test.js': 'check ac one\n' }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m8-assurance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

function frozen(service, projectRoot, patch = {}) {
  const result = service.freezeTests({
    projectRoot,
    testFiles: ['test/ac-1.test.js'],
    changeId: 'change-1',
    actorId: 'owner',
    ...patch,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
}

function claim(patch = {}) {
  return {
    evidenceId: 'evidence-1',
    artifactHash: ARTIFACT,
    commit: COMMIT,
    completedAt: NOW,
    cases: [{ id: 'CASE-1', file: 'test/ac-1.test.js', status: 'pass' }],
    ...patch,
  };
}

function runnerFor(value, patch = {}) {
  return async () => ({ ...value, ...patch });
}

test('freezeTests stores deterministic immutable hashes without absolute paths', (t) => {
  const root = fixture(t);
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m8-artifacts-'));
  t.after(() => fs.rmSync(artifactRoot, { recursive: true, force: true }));
  const service = createDeliveryAssurance({ clock, artifactRoot });

  const first = frozen(service, root);
  const second = frozen(service, root);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(second.manifest.manifestHash, first.manifest.manifestHash);
  assert.match(first.manifest.testFiles[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(first.manifest).includes(root), false);
  assert.equal(JSON.stringify(first.manifest).includes(artifactRoot), false);
  assert.equal(fs.existsSync(path.join(artifactRoot, first.manifestKey)), true);

  fs.writeFileSync(path.join(root, 'test/ac-1.test.js'), 'changed after freeze\n');
  const changed = service.freezeTests({
    projectRoot: root,
    testFiles: ['test/ac-1.test.js'],
    changeId: 'change-1',
    actorId: 'owner',
  });
  assert.equal(changed.code, 'FROZEN_TESTS_IMMUTABLE');
});

test('freezeTests rejects traversal, binary and oversized test files', (t) => {
  const root = fixture(t, {
    'test/ac-1.test.js': 'check ac one\n',
    'test/binary.test.js': Buffer.from([0x61, 0x00, 0x62]),
    'test/large.test.js': Buffer.alloc(1024 * 1024 + 1, 0x61),
  });
  const service = createDeliveryAssurance({ clock });
  assert.equal(
    service.freezeTests({
      projectRoot: root,
      testFiles: ['../outside.test.js'],
      changeId: 'change-1',
      actorId: 'owner',
    }).code,
    'UNSAFE_TEST_FILE',
  );
  assert.equal(
    service.freezeTests({
      projectRoot: root,
      testFiles: ['test/binary.test.js'],
      changeId: 'change-1',
      actorId: 'owner',
    }).code,
    'BINARY_TEST_FILE',
  );
  assert.equal(
    service.freezeTests({
      projectRoot: root,
      testFiles: ['test/large.test.js'],
      changeId: 'change-1',
      actorId: 'owner',
    }).code,
    'TEST_FILE_TOO_LARGE',
  );
  let linkChecked = false;
  try {
    fs.symlinkSync(
      path.join(root, 'test/ac-1.test.js'),
      path.join(root, 'test/link.test.js'),
      'file',
    );
    assert.equal(
      service.freezeTests({
        projectRoot: root,
        testFiles: ['test/link.test.js'],
        changeId: 'change-1',
        actorId: 'owner',
      }).code,
      'UNSAFE_TEST_FILE',
    );
    linkChecked = true;
  } catch (error) {
    if (!['EACCES', 'EPERM', 'ENOTSUP'].includes(error.code)) throw error;
  }
  if (!linkChecked) {
    try {
      fs.symlinkSync(path.join(root, 'test'), path.join(root, 'test/linked'), 'junction');
      assert.equal(
        service.freezeTests({
          projectRoot: root,
          testFiles: ['test/linked/ac-1.test.js'],
          changeId: 'change-1',
          actorId: 'owner',
        }).code,
        'UNSAFE_TEST_FILE',
      );
      linkChecked = true;
    } catch (error) {
      if (!['EACCES', 'EPERM', 'ENOTSUP', 'EINVAL'].includes(error.code)) throw error;
    }
  }
  if (!linkChecked) {
    t.diagnostic('symlink and junction assertions are unavailable under the host policy');
  }
});

test('prepareRepair enforces round and usage budgets with an explicit Attention action', () => {
  const service = createDeliveryAssurance({
    clock,
    maxRepairRounds: 2,
    budget: { maxToolCalls: 5, maxDurationMs: 10_000 },
  });
  const available = service.prepareRepair({
    failure: {
      code: 'TEST_FAILED',
      message: 'C:\\secret\\project\\test.js failed with token=super-secret',
    },
    round: 1,
    usage: { toolCalls: 2, durationMs: 2_000 },
    attention: { attentionId: 'attention-1' },
  });
  assert.equal(available.ok, true, JSON.stringify(available));
  assert.deepEqual(available.plan.limits, {
    maxToolCalls: 3,
    maxDurationMs: 8_000,
  });
  assert.equal(available.plan.failureSummary.includes('C:\\'), false);
  assert.equal(available.plan.failureSummary.includes('super-secret'), false);

  for (const [input, reason] of [
    [{ round: 3, usage: { toolCalls: 0, durationMs: 0 } }, 'ROUND_LIMIT'],
    [{ round: 1, usage: { toolCalls: 5, durationMs: 0 } }, 'TOOL_CALL_LIMIT'],
    [{ round: 1, usage: { toolCalls: 0, durationMs: 10_000 } }, 'TIME_LIMIT'],
  ]) {
    const stopped = service.prepareRepair({
      failure: { code: 'TEST_FAILED' },
      attention: { attentionId: 'attention-1' },
      ...input,
    });
    assert.equal(stopped.ok, false);
    assert.equal(stopped.code, 'REPAIR_LIMIT_REACHED');
    assert.equal(stopped.stopReason, reason);
    assert.equal(stopped.attentionAction, 'ESCALATE');
    assert.equal(stopped.attention.attentionId, 'attention-1');
    assert.equal(stopped.attention.requiresHuman, true);
  }
});

test('verify requires a server runner and produces fresh artifact-bound evidence', async (t) => {
  const root = fixture(t);
  const service = createDeliveryAssurance({ clock });
  const freeze = frozen(service, root);
  const verification = claim();
  const verified = await service.verify({
    manifest: freeze.manifest,
    artifactHash: ARTIFACT,
    verification,
    runner: runnerFor(verification),
  });
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.match(verified.verificationFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(verified.verification.artifactHash, ARTIFACT);
  assert.equal(verified.verification.commit, COMMIT);
  assert.equal(JSON.stringify(verified.verification).includes(root), false);

  const replay = await service.verify({
    manifest: freeze.manifest,
    artifactHash: ARTIFACT,
    verification,
    runner: runnerFor(verification),
  });
  assert.equal(replay.code, 'EVIDENCE_REPLAYED');

  const missingRunner = await service.verify({
    manifest: freeze.manifest,
    artifactHash: ARTIFACT,
    verification: claim({ evidenceId: 'evidence-2' }),
  });
  assert.equal(missingRunner.code, 'SERVER_RUNNER_REQUIRED');
});

test('verify fails closed on test mutation, stale evidence and non-pass statuses', async (t) => {
  const root = fixture(t);
  const service = createDeliveryAssurance({ clock });
  const freeze = frozen(service, root);

  fs.writeFileSync(path.join(root, 'test/ac-1.test.js'), 'mutated test\n');
  const changed = await service.verify({
    manifest: freeze.manifest,
    artifactHash: ARTIFACT,
    verification: claim(),
    runner: runnerFor(claim()),
  });
  assert.equal(changed.code, 'FROZEN_TEST_CHANGED');
  fs.writeFileSync(path.join(root, 'test/ac-1.test.js'), 'check ac one\n');

  const staleClaim = claim({
    evidenceId: 'evidence-stale',
    completedAt: '2026-10-24T00:59:00.000Z',
  });
  const stale = await service.verify({
    manifest: freeze.manifest,
    artifactHash: ARTIFACT,
    verification: staleClaim,
    runner: runnerFor(staleClaim),
  });
  assert.equal(stale.code, 'STALE_VERIFICATION');

  for (const [status, code] of [
    ['skipped', 'FROZEN_TEST_SKIPPED'],
    ['not-run', 'FROZEN_TEST_NOT_RUN'],
    ['cancelled', 'FROZEN_TEST_CANCELLED'],
    ['timeout', 'FROZEN_TEST_TIMEOUT'],
  ]) {
    const nonPass = claim({
      evidenceId: `evidence-${status}`,
      cases: [{ id: 'CASE-1', file: 'test/ac-1.test.js', status }],
    });
    const result = await service.verify({
      manifest: freeze.manifest,
      artifactHash: ARTIFACT,
      verification: nonPass,
      runner: runnerFor(nonPass),
    });
    assert.equal(result.code, code);
  }
  const topLevelSkipped = claim({
    evidenceId: 'evidence-top-level-skipped',
    status: 'skipped',
  });
  const topLevelResult = await service.verify({
    manifest: freeze.manifest,
    artifactHash: ARTIFACT,
    verification: topLevelSkipped,
    runner: runnerFor(topLevelSkipped),
  });
  assert.equal(topLevelResult.code, 'FROZEN_TEST_SKIPPED');
});

test('verify rejects AI signers, tampered evidence and changes made during the run', async (t) => {
  const root = fixture(t);
  const service = createDeliveryAssurance({ clock });
  const freeze = frozen(service, root);

  const forged = claim({ evidenceId: 'evidence-ai', signer: { kind: 'ai' } });
  const rejected = await service.verify({
    manifest: freeze.manifest,
    artifactHash: ARTIFACT,
    verification: forged,
    runner: runnerFor(forged),
  });
  assert.equal(rejected.code, 'AI_SIGNER_REJECTED');

  const tampered = claim({ evidenceId: 'evidence-tampered' });
  const tamperedResult = await service.verify({
    manifest: freeze.manifest,
    artifactHash: ARTIFACT,
    verification: tampered,
    runner: runnerFor({
      ...tampered,
      cases: [{ id: 'CASE-1', file: 'test/ac-1.test.js', status: 'fail' }],
    }),
  });
  assert.equal(tamperedResult.code, 'EVIDENCE_TAMPERED');

  const during = claim({ evidenceId: 'evidence-during' });
  const changedDuringRun = await service.verify({
    manifest: freeze.manifest,
    artifactHash: ARTIFACT,
    verification: during,
    runner: async () => {
      fs.writeFileSync(path.join(root, 'test/ac-1.test.js'), 'changed by runner\n');
      return during;
    },
  });
  assert.equal(changedDuringRun.code, 'FROZEN_TEST_CHANGED');
});

test('package is immutable and identical package identities cannot be overwritten', async (t) => {
  const root = fixture(t);
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m8-packages-'));
  t.after(() => fs.rmSync(artifactRoot, { recursive: true, force: true }));
  const service = createDeliveryAssurance({ clock, artifactRoot });
  const freeze = frozen(service, root);
  const verification = claim();
  const verified = await service.verify({
    manifest: freeze.manifest,
    artifactHash: ARTIFACT,
    verification,
    runner: runnerFor(verification),
  });
  assert.equal(verified.ok, true, JSON.stringify(verified));

  const input = {
    verification: verified.verification,
    artifactHash: ARTIFACT,
    commit: COMMIT,
    unexecuted: ['manual mobile acceptance'],
    rollback: { code: 'git revert delivery', data: 'No data migration.', forwardFix: 'Redeliver.' },
  };
  const first = service.package(input);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(Object.isFrozen(first.package), true);
  assert.deepEqual(first.package.unexecuted, ['manual mobile acceptance']);
  assert.equal(JSON.stringify(first.package).includes(artifactRoot), false);
  assert.equal(fs.existsSync(path.join(artifactRoot, first.packageKey)), true);

  const tampered = service.package({
    ...input,
    verification: {
      ...verified.verification,
      cases: [{ id: 'CASE-1', file: 'test/ac-1.test.js', status: 'fail' }],
    },
  });
  assert.equal(tampered.code, 'EVIDENCE_TAMPERED');

  const duplicate = service.package(input);
  assert.equal(duplicate.code, 'PACKAGE_ID_CONFLICT');
  assert.deepEqual(first.package.unexecuted, ['manual mobile acceptance']);
});

test('redeliver requires an accepted parent, new artifact and affected AC references', async (t) => {
  const root = fixture(t);
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m8-redelivery-'));
  t.after(() => fs.rmSync(artifactRoot, { recursive: true, force: true }));
  const service = createDeliveryAssurance({ clock, artifactRoot });
  const freeze = frozen(service, root);
  const verification = claim();
  const verified = await service.verify({
    manifest: freeze.manifest,
    artifactHash: ARTIFACT,
    verification,
    runner: runnerFor(verification),
  });
  const first = service.package({
    verification: verified.verification,
    artifactHash: ARTIFACT,
    commit: COMMIT,
    unexecuted: [],
    rollback: 'git revert delivery',
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  const acceptedParent = { ...first.package, accepted: true };

  const reused = await service.redeliver({
    parent: acceptedParent,
    artifactHash: ARTIFACT,
    commit: COMMIT,
    verification: verified.verification,
    affectedAc: ['AC-1'],
    unexecuted: [],
    rollback: 'git revert delivery',
  });
  assert.equal(reused.code, 'REDELIVERY_ARTIFACT_REUSED');

  const nextArtifact = 'c'.repeat(64);
  const nextCommit = 'd'.repeat(40);
  const nextClaim = claim({
    evidenceId: 'evidence-2',
    artifactHash: nextArtifact,
    commit: nextCommit,
  });
  const nextVerified = await service.verify({
    manifest: freeze.manifest,
    artifactHash: nextArtifact,
    verification: nextClaim,
    runner: runnerFor(nextClaim),
  });
  assert.equal(nextVerified.ok, true, JSON.stringify(nextVerified));
  const next = await service.redeliver({
    parent: acceptedParent,
    artifactHash: nextArtifact,
    commit: nextCommit,
    verification: nextVerified.verification,
    affectedAc: ['AC-1'],
    unexecuted: ['manual mobile acceptance'],
    rollback: 'git revert delivery',
  });
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.notEqual(next.package.packageId, first.package.packageId);
  assert.notEqual(next.package.packageHash, first.package.packageHash);
  assert.equal(next.package.parentPackageId, first.package.packageId);
  assert.deepEqual(next.package.affectedAc, ['AC-1']);
  assert.equal(fs.existsSync(path.join(artifactRoot, first.packageKey)), true);
  assert.equal(fs.existsSync(path.join(artifactRoot, next.packageKey)), true);
});
