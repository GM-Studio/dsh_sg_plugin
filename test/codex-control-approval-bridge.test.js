import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';
import { createControlApprovalAuthority } from '../src/codex/control/approval-bridge.js';

async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-approval-bridge-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-approval-project-'));
  let next = 0;
  const service = createControlService({
    store: createControlStore({ root }),
    randomId: () => `bridge-${++next}`,
    clock: () => Date.parse('2026-10-22T10:00:00.000Z'),
  });
  const created = await service.createWorkItem({
    title: 'Exporter',
    request: 'Implement export',
    projectRoot,
  });
  return { service, created };
}

test('H1 control bridge waits without holding an approval and later authorizes once', async () => {
  const { service, created } = await fixture();
  const artifactHash = 'a'.repeat(64);
  const readArtifactHash = async () => artifactHash;
  const documentPath = '.specgate/codex/changes/change-1/requirements/revision-1.md';
  const challenge = {
    gate: 'H1',
    scope: 'change-1',
    artifactHash,
    readArtifactHash,
    summary: 'Requirements snapshot\n需求文档：[打开完整文档](file:///C:/stale/hardcoded.md)',
    documentPath,
  };
  const first = createControlApprovalAuthority({
    service,
    workItemId: created.workItem.workItemId,
  });
  const waiting = await first.requestApproval(challenge);
  assert.equal(waiting.code, 'WAITING_FOR_USER');
  assert.equal(waiting.attention.status, 'OPEN');
  const attention = waiting.attention;
  assert.equal(attention.documentPath, documentPath);
  assert.doesNotMatch(attention.summary, /file:\/\/|hardcoded/);
  const documentFile = path.join(created.project.projectRoot, documentPath);
  fs.mkdirSync(path.dirname(documentFile), { recursive: true });
  fs.writeFileSync(documentFile, '# 动态需求文档\n', 'utf8');
  const document = await service.projection.getAttentionDocument(attention.requestId);
  assert.equal(document.ok, true, JSON.stringify(document));
  assert.equal(document.document.content, '# 动态需求文档\n');
  const decided = await service.decide({
    workItemId: created.workItem.workItemId,
    attentionId: attention.requestId,
    attentionRevision: attention.revision,
    expectedWorkItemVersion: waiting.workItem.revision,
    artifactHash,
    action: 'approve',
    idempotencyKey: 'h1-approval',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
  });
  assert.equal(decided.ok, true, JSON.stringify(decided));
  const restarted = createControlApprovalAuthority({
    service,
    workItemId: created.workItem.workItemId,
  });
  const issued = await restarted.requestApproval(challenge);
  assert.equal(issued.ok, true, JSON.stringify(issued));
  const consumed = await restarted.authorizeGate({
    gate: 'H1',
    to: 'REQ_FROZEN',
    approval: issued.approval,
  });
  assert.equal(consumed.ok, true, JSON.stringify(consumed));
  assert.ok(consumed.record.consumedAt);
  const replay = await restarted.authorizeGate({
    gate: 'H1',
    to: 'REQ_FROZEN',
    approval: issued.approval,
  });
  assert.equal(replay.code, 'APPROVAL_CONSUMED');
});

test('changed artifact and missing step-up cannot reach the native gate', async () => {
  const { service, created } = await fixture();
  const artifactHash = 'a'.repeat(64);
  const authority = createControlApprovalAuthority({
    service,
    workItemId: created.workItem.workItemId,
  });
  const waiting = await authority.requestApproval({
    gate: 'H1',
    scope: 'change-1',
    artifactHash,
    readArtifactHash: async () => 'b'.repeat(64),
    summary: 'Requirements',
  });
  assert.equal(waiting.code, 'APPROVAL_ARTIFACT_CHANGED');
});
