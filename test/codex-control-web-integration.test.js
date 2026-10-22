import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';
import { createControlManagementServices } from '../src/codex/control/management-services.js';
import { createManagementServer } from '../src/codex/management/server.js';
import {
  createStepUpAuthority,
  currentTotp,
  generateTotpSecret,
} from '../src/codex/control/step-up.js';
import { createDeliveryRecordV3 } from '../src/codex/control/delivery-controlled.js';
import { persistDeliveryV3, readDeliveryRecord } from '../src/codex/delivery.js';

test('Web step-up Decision consumes one AttentionRequest and queues automatic resume', async (t) => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-web-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-web-project-'));
  const now = Date.parse('2026-10-22T10:00:00.000Z');
  let next = 0;
  const service = createControlService({
    store: createControlStore({ root: controlRoot, clock: () => now }),
    clock: () => now,
    randomId: () => `web-${++next}`,
  });
  const created = await service.createWorkItem({
    title: 'Exporter',
    request: 'Implement CSV export',
    projectRoot,
  });
  const attention = await service.requestAttention({
    workItemId: created.workItem.workItemId,
    expectedVersion: created.workItem.revision,
    type: 'H3_APPROVAL',
    reason: 'Approve release',
    question: 'Approve delivery?',
    actions: ['approve', 'request_changes'],
    artifactHash: 'a'.repeat(64),
  });
  const secret = generateTotpSecret();
  const managed = createControlManagementServices({
    service,
    stepUp: createStepUpAuthority({ secret, clock: () => now }),
    defaultProjectRoot: projectRoot,
  });
  const management = createManagementServer({
    services: managed,
    clock: () => now,
    pairingToken: 'integration-pairing-token',
  });
  const started = await management.start();
  t.after(() => management.close());
  const paired = await fetch(`${started.baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'integration-pairing-token' }),
  });
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await paired.json();
  const detail = await fetch(`${started.baseUrl}/api/work-items/${created.workItem.workItemId}`, {
    headers: { cookie },
  });
  const body = await detail.json();
  assert.equal(body.ok, true);
  assert.equal(body.workItem.projectRoot, undefined);
  const decided = await fetch(`${started.baseUrl}/api/decisions`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': csrfToken,
    },
    body: JSON.stringify({
      workItemId: created.workItem.workItemId,
      attentionId: attention.attention.requestId,
      attentionRevision: attention.attention.revision,
      expectedWorkItemVersion: attention.workItem.revision,
      artifactHash: 'a'.repeat(64),
      action: 'approve',
      idempotencyKey: 'web-approve-1',
      stepUpCode: currentTotp(secret, { clock: () => now }),
    }),
  });
  const result = await decided.json();
  assert.equal(decided.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.workItem.executionState, 'QUEUED');
  assert.equal(result.workItem.resume.action, 'approve');
  const state = await service.inspect();
  assert.equal(state.state.attention[attention.attention.requestId].status, 'DECIDED');
});

test('Web customer acceptance atomically links a DeliveryRecord receipt and Control Decision', async (t) => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-accept-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-accept-project-'));
  const now = Date.parse('2026-10-22T10:00:00.000Z');
  let next = 0;
  const service = createControlService({
    store: createControlStore({ root: controlRoot, clock: () => now }),
    clock: () => now,
    randomId: () => `accept-${++next}`,
  });
  const delivery = createDeliveryRecordV3({
    deliveryId: 'delivery-accept-1',
    projectId: 'project-1',
    changeId: 'change-1',
    baselineCommit: 'a'.repeat(40),
    deliveryCommit: 'b'.repeat(40),
    environmentFingerprint: 'c'.repeat(64),
    reviewMode: 'evidence-and-diff',
    acceptance: ['AC-1'],
    evidence: ['evidence-1'],
    knownIssues: [],
    risks: [],
    rollback: {
      code: 'git revert HEAD',
      data: 'No data migration.',
      forwardFix: 'Ship a follow-up release.',
    },
    contract: { artifactId: 'contract-1', hash: 'd'.repeat(64) },
    verification: {
      verificationId: 'verification-1',
      assessmentHash: 'e'.repeat(64),
      decision: 'verified-awaiting-acceptance',
    },
    h3: {
      artifactHash: 'f'.repeat(64),
      approvalHash: '1'.repeat(64),
      approvedAt: '2026-10-22T09:00:00.000Z',
    },
    approvedAt: '2026-10-22T09:00:00.000Z',
  }).delivery;
  const persisted = persistDeliveryV3({
    projectRoot,
    delivery,
    createTag: false,
  });
  assert.equal(persisted.ok, true, JSON.stringify(persisted));

  const created = await service.createWorkItem({
    title: 'Delivery acceptance',
    request: 'Complete the verified delivery.',
    projectRoot,
  });
  const claimed = await service.claimNext({ ownerId: 'supervisor', leaseMs: 60000 });
  assert.equal(claimed.ok, true);
  const finished = await service.finishRun({
    runId: claimed.run.runId,
    leaseToken: claimed.lease.token,
    status: 'COMPLETED',
    outcome: {
      summary: 'Verified delivery is ready.',
      delivery: {
        deliveryId: delivery.deliveryId,
        recordHash: persisted.recordHash,
        deliveryCommit: delivery.deliveryCommit,
        releaseState: 'release-approved',
      },
    },
  });
  assert.equal(finished.ok, true);
  const attention = await service.requestAttention({
    workItemId: created.workItem.workItemId,
    expectedVersion: finished.workItem.revision,
    type: 'COMPLETION',
    reason: 'Review the verified delivery.',
    question: 'Accept the delivery?',
    actions: ['request_changes', 'accept_delivery'],
    artifactHash: '2'.repeat(64),
  });
  assert.equal(attention.ok, true);

  const secret = generateTotpSecret();
  const managed = createControlManagementServices({
    service,
    stepUp: createStepUpAuthority({ secret, clock: () => now }),
    defaultProjectRoot: projectRoot,
  });
  const management = createManagementServer({
    services: managed,
    clock: () => now,
    pairingToken: 'acceptance-pairing-token',
  });
  const started = await management.start();
  t.after(() => management.close());
  const paired = await fetch(`${started.baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'acceptance-pairing-token' }),
  });
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await paired.json();
  const accepted = await fetch(`${started.baseUrl}/api/deliveries/accept`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': csrfToken,
    },
    body: JSON.stringify({
      workItemId: created.workItem.workItemId,
      attentionId: attention.attention.requestId,
      attentionRevision: attention.attention.revision,
      expectedWorkItemVersion: attention.workItem.revision,
      artifactHash: '2'.repeat(64),
      action: 'accept_delivery',
      idempotencyKey: 'accept-delivery-1',
      stepUpCode: currentTotp(secret, { clock: () => now }),
    }),
  });
  const result = await accepted.json();
  assert.equal(accepted.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.deliveryAccepted, true);
  assert.equal(result.workItem.executionState, 'COMPLETED');
  assert.equal(result.workItem.businessMilestone, 'DELIVERY_ACCEPTED');
  const stored = readDeliveryRecord({
    projectRoot,
    deliveryId: delivery.deliveryId,
  });
  assert.equal(stored.ok, true, JSON.stringify(stored));
  assert.equal(stored.delivery.releaseState, 'customer-accepted');
  assert.equal(stored.delivery.customerAcceptance.actorId, 'local-owner');
});
