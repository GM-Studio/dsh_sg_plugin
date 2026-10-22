import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createDeliveryRecordV3,
  validateDeliveryRecordV3,
} from '../src/codex/control/delivery-controlled.js';
import {
  findLatestDeliveryRecord,
  persistDeliveryV3,
  readDeliveryRecord,
  recordCustomerAcceptance,
} from '../src/codex/delivery.js';

const SHA = 'a'.repeat(40);
const HASH = 'b'.repeat(64);

function draft(patch = {}) {
  return {
    projectId: 'project-1',
    changeId: 'change-1',
    parentDeliveryId: null,
    baselineCommit: SHA,
    deliveryCommit: SHA,
    environmentFingerprint: HASH,
    reviewMode: 'evidence-and-diff',
    acceptance: ['AC-1'],
    evidence: ['evidence-1'],
    knownIssues: ['Legacy import remains out of scope.'],
    risks: ['RISK-1'],
    rollback: {
      code: `git revert ${SHA}`,
      data: 'No data migration.',
      forwardFix: 'Apply a follow-up delivery.',
    },
    push: { requested: false, remoteUrl: null, status: 'not-requested' },
    contract: { artifactId: 'change-contract', hash: HASH },
    verification: {
      verificationId: 'verify-1',
      assessmentHash: HASH,
      decision: 'requires-h3',
    },
    h3: {
      artifactHash: HASH,
      approvalHash: HASH,
      approvedAt: '2026-10-22T10:00:00.000Z',
    },
    ...patch,
  };
}

test('schema 3 DeliveryRecord keeps release approval separate from customer acceptance', () => {
  const created = createDeliveryRecordV3(draft());
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.delivery.schemaVersion, 3);
  assert.equal(created.delivery.releaseState, 'release-approved');
  assert.equal(created.delivery.customerAcceptance, null);
  assert.deepEqual(validateDeliveryRecordV3(created.delivery), { ok: true });
});

test('schema 3 rejects missing verification, H3 and risks when evidence is incomplete', () => {
  assert.equal(createDeliveryRecordV3(draft({ verification: null })).code, 'DELIVERY_V3_INVALID');
  assert.equal(createDeliveryRecordV3(draft({ h3: null })).code, 'DELIVERY_V3_INVALID');
  assert.equal(createDeliveryRecordV3(draft({ acceptance: [] })).code, 'DELIVERY_V3_INVALID');
  assert.equal(
    createDeliveryRecordV3(draft({ knownIssues: ['token=abcdefghijklmnop'] })).code,
    'SENSITIVE_DELIVERY',
  );
});

test('customer acceptance is explicit and append-only', () => {
  const created = createDeliveryRecordV3({
    ...draft(),
    customerAcceptance: {
      status: 'accepted',
      actorId: 'customer-1',
      source: 'web',
      at: '2026-10-22T11:00:00.000Z',
      evidence: 'receipt-1',
    },
    releaseState: 'customer-accepted',
  });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.delivery.customerAcceptance.status, 'accepted');
});

test('persisted release approval remains separate until a trusted acceptance receipt', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-delivery-v3-accept-'));
  const created = createDeliveryRecordV3(draft());
  assert.equal(created.ok, true);
  const persisted = persistDeliveryV3({
    projectRoot,
    delivery: created.delivery,
    write: true,
    createTag: false,
    customer: {
      title: 'Release candidate',
      summary: 'Ready for customer acceptance.',
      knownIssues: created.delivery.knownIssues,
      rollback: created.delivery.rollback,
    },
  });
  assert.equal(persisted.ok, true, JSON.stringify(persisted));
  const before = readDeliveryRecord({
    projectRoot,
    deliveryId: created.delivery.deliveryId,
  });
  assert.equal(before.delivery.releaseState, 'release-approved');
  assert.equal(before.delivery.customerAcceptance, null);
  assert.equal(
    recordCustomerAcceptance({
      projectRoot,
      deliveryId: created.delivery.deliveryId,
      actorId: 'customer-1',
      source: 'web',
      authLevel: 'session',
      evidence: 'receipt-1',
      at: '2026-10-22T11:00:00.000Z',
    }).code,
    'CUSTOMER_ACCEPTANCE_INVALID',
  );
  const accepted = recordCustomerAcceptance({
    projectRoot,
    deliveryId: created.delivery.deliveryId,
    actorId: 'customer-1',
    source: 'web',
    authLevel: 'step-up',
    evidence: 'receipt-1',
    at: '2026-10-22T11:00:00.000Z',
  });
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  const after = readDeliveryRecord({
    projectRoot,
    deliveryId: created.delivery.deliveryId,
  });
  assert.equal(after.ok, true, JSON.stringify(after));
  assert.equal(after.delivery.releaseState, 'customer-accepted');
  assert.equal(after.delivery.customerAcceptance.status, 'accepted');
});

test('identical persisted customer acceptance is idempotent and returns the original receipt', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-delivery-v3-idempotent-'));
  const created = createDeliveryRecordV3(draft());
  assert.equal(created.ok, true);
  const persisted = persistDeliveryV3({
    projectRoot,
    delivery: created.delivery,
    createTag: false,
  });
  assert.equal(persisted.ok, true, JSON.stringify(persisted));
  const input = {
    projectRoot,
    deliveryId: created.delivery.deliveryId,
    actorId: 'customer-1',
    source: 'web',
    authLevel: 'step-up',
    evidence: 'control:decision-1',
    at: '2026-10-22T11:00:00.000Z',
  };
  const first = recordCustomerAcceptance(input);
  const second = recordCustomerAcceptance(input);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.duplicate, true);
  assert.equal(second.acceptanceHash, first.acceptanceHash);
  assert.equal(second.delivery.releaseState, 'customer-accepted');
});

test('latest validated schema 3 delivery can be discovered without a local record path', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-delivery-v3-latest-'));
  const older = createDeliveryRecordV3(
    draft({
      deliveryId: 'delivery-old',
      approvedAt: '2026-10-21T10:00:00.000Z',
    }),
  ).delivery;
  const newer = createDeliveryRecordV3(
    draft({
      deliveryId: 'delivery-new',
      approvedAt: '2026-10-22T10:00:00.000Z',
    }),
  ).delivery;
  assert.equal(persistDeliveryV3({ projectRoot, delivery: older, createTag: false }).ok, true);
  assert.equal(persistDeliveryV3({ projectRoot, delivery: newer, createTag: false }).ok, true);
  const latest = findLatestDeliveryRecord({ projectRoot });
  assert.equal(latest.ok, true);
  assert.equal(latest.deliveryId, 'delivery-new');
  assert.equal(latest.delivery.deliveryId, 'delivery-new');
  assert.match(latest.recordHash, /^[a-f0-9]{64}$/);
});

test('customer acceptance checks the linked record hash before writing a receipt', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-delivery-v3-hash-'));
  const created = createDeliveryRecordV3(draft());
  const persisted = persistDeliveryV3({
    projectRoot,
    delivery: created.delivery,
    createTag: false,
  });
  assert.equal(persisted.ok, true);
  const result = recordCustomerAcceptance({
    projectRoot,
    deliveryId: created.delivery.deliveryId,
    expectedRecordHash: 'f'.repeat(64),
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
    evidence: 'control:decision-1',
  });
  assert.equal(result.code, 'DELIVERY_ARTIFACT_CHANGED');
});
