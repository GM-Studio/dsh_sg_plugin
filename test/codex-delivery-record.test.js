import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createArtifactStore } from '../src/codex/core/artifact-store.js';
import {
  createDeliveryRecord,
  persistDelivery,
  readDeliveryRecord,
  renderCustomerPack,
} from '../src/codex/delivery.js';
import { validateDeliveryRecord } from '../src/codex/project-model.js';

const SHA = 'a'.repeat(40);
const ENV = 'b'.repeat(64);
const NOW = '2026-10-22T10:00:00.000Z';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-delivery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function record(patch = {}) {
  return createDeliveryRecord({
    projectId: 'project-1',
    changeId: 'change-1',
    parentDeliveryId: null,
    baselineCommit: SHA,
    deliveryCommit: SHA,
    environmentFingerprint: ENV,
    reviewMode: 'evidence',
    acceptance: ['AC-1'],
    evidence: ['evidence-1'],
    knownIssues: ['Legacy import remains out of scope.'],
    rollback: {
      code: 'git revert ' + SHA,
      data: 'No data migration.',
      forwardFix: 'Apply the next delivery.',
    },
    push: { requested: false, remoteUrl: null, status: 'not-requested' },
    acceptedAt: NOW,
    ...patch,
  });
}

test('creates and validates accepted delivery records with stable local tag names', () => {
  const first = record();
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.delivery.state, 'delivery-accepted');
  assert.match(first.delivery.deliveryId, /^delivery-/);
  assert.match(first.delivery.tag, /^specgate-delivery-delivery-/);
  assert.deepEqual(validateDeliveryRecord(first.delivery), { ok: true });
  const second = record({ deliveryId: 'delivery-explicit', tag: 'delivery-v1' });
  assert.equal(second.ok, true);
  assert.equal(second.delivery.deliveryId, 'delivery-explicit');
  assert.equal(second.delivery.tag, 'delivery-v1');
});

test('invalid acceptance, rollback, push and credentials fail closed', () => {
  for (const patch of [
    { acceptance: [] },
    { evidence: [] },
    { rollback: { code: '', data: '', forwardFix: '' } },
    { environmentFingerprint: 'main' },
    { push: { requested: false, remoteUrl: null, status: 'passed' } },
    { knownIssues: ['token=abcdefghijklmnop'] },
  ]) {
    assert.equal(record(patch).ok, false, JSON.stringify(patch));
  }
});

test('persists immutable delivery artifacts and creates a local annotated tag', (t) => {
  const root = temp(t);
  git(root, ['init', '-q']);
  fs.writeFileSync(path.join(root, 'README.md'), 'delivery\n');
  git(root, ['add', '.']);
  const commit = spawnSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@local',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'delivery',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(commit.status, 0, commit.stderr);
  const delivery = record({
    baselineCommit: git(root, ['rev-parse', 'HEAD']),
    deliveryCommit: git(root, ['rev-parse', 'HEAD']),
  }).delivery;
  const result = persistDelivery({
    projectRoot: root,
    delivery,
    internal: {
      commands: [{ id: 'test', status: 'passed', log: '.specgate/codex/evidence/test.log' }],
    },
    customer: {
      title: 'Task filter fix',
      summary: 'Completed tasks now appear in the completed filter.',
      verification: ['Filter verification passed.'],
      knownIssues: delivery.knownIssues,
      upgrade: 'Deploy the new commit.',
      rollback: delivery.rollback,
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(git(root, ['tag', '--list', delivery.tag]), delivery.tag);
  assert.equal(git(root, ['rev-parse', `${delivery.tag}^{commit}`]), delivery.deliveryCommit);
  assert.equal(readDeliveryRecord({ projectRoot: root, deliveryId: delivery.deliveryId }).ok, true);
  const store = createArtifactStore({ projectRoot: root });
  assert.equal(store.readText(`${result.directory}/customer.md`).ok, true);
  assert.equal(store.readText(`${result.directory}/internal.md`).ok, true);
  const second = persistDelivery({
    projectRoot: root,
    delivery,
    internal: { commands: [] },
    customer: { title: 'Changed' },
  });
  assert.equal(second.code, 'ARTIFACT_CONFLICT');
});

test('customer packs never expose absolute paths or apparent credentials', () => {
  const delivery = record().delivery;
  const result = persistDelivery({
    projectRoot: path.resolve('.'),
    delivery,
    internal: {
      command: 'C:\\secret\\project\\mvn.cmd',
      token: 'token=abcdefghijklmnop',
    },
    customer: {
      title: 'Safe delivery',
      summary: 'Changed C:\\secret\\project\\frontend and used token=abcdefghijklmnop.',
      verification: ['Open /tmp/project and verify.'],
      knownIssues: [],
      upgrade: 'Deploy.',
      rollback: delivery.rollback,
    },
    write: false,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.doesNotMatch(result.customer, /C:\\secret|\/tmp\/project|abcdefghijklmnop/);
  assert.match(result.internal, /C:\\\\secret/);
});

test('customer summary preserves every known issue from the immutable DeliveryRecord', () => {
  const delivery = record({
    knownIssues: ['Risk A remains.', 'Area B was not verified.'],
  }).delivery;
  const pack = renderCustomerPack({ delivery, customer: { knownIssues: [] } });
  assert.match(pack, /Risk A remains/);
  assert.match(pack, /Area B was not verified/);
});
