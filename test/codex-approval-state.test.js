import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApprovalAuthority } from '../src/codex/approvals.js';
import { createStateStore } from '../src/codex/state-machine.js';
import { verifyEventChain } from '../src/codex/events.js';

const HASH = `sha256:${'a'.repeat(64)}`;

test('a sync fault after a complete audit append cannot reuse its sequence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-audit-sync-fault-'));
  const store = createStateStore({
    projectRoot: root,
    authorizeGate: async ({ audit }) => {
      try {
        await audit({ type: 'approval.consumed', fixture: true });
      } catch {
        await audit({ type: 'approval.failed', fixture: true });
      }
      return { ok: false, code: 'APPROVAL_AUDIT_FAILED' };
    },
  });
  await store.create({ expectedVersion: 0, changeId: 'sync-fault' });
  for (const to of ['REQ_CLARIFYING', 'REQ_CRITIQUE', 'H1_PENDING'])
    await store.transition({ expectedVersion: (await store.inspect()).state.version, to });
  const write = fs.writeFileSync;
  const sync = fs.fsyncSync;
  let faultFd;
  let injected = false;
  fs.writeFileSync = (fd, bytes, ...rest) => {
    const result = write(fd, bytes, ...rest);
    if (typeof fd === 'number' && String(bytes).includes('"type":"approval.consumed"'))
      faultFd = fd;
    return result;
  };
  fs.fsyncSync = (fd) => {
    if (fd === faultFd && !injected) {
      injected = true;
      throw Object.assign(new Error('Injected sync fault'), { code: 'EIO' });
    }
    return sync(fd);
  };
  try {
    assert.equal(
      (
        await store.transition({
          expectedVersion: (await store.inspect()).state.version,
          to: 'REQ_FROZEN',
        })
      ).code,
      'APPROVAL_AUDIT_FAILED',
    );
  } finally {
    fs.writeFileSync = write;
    fs.fsyncSync = sync;
  }
  const checked = verifyEventChain(
    fs.readFileSync(path.join(root, '.specgate/codex/events.jsonl'), 'utf8'),
  );
  assert.equal(injected, true);
  assert.equal(checked.ok, true);
  assert.equal(new Set(checked.events.map((event) => event.sequence)).size, checked.events.length);
  assert.equal((await store.load()).ok, true);
});

test('pending authorization releases the writer lock and expires without a residual reservation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-gate-reservation-'));
  let entered;
  const pending = new Promise((resolve) => {
    entered = resolve;
  });
  const store = createStateStore({
    projectRoot: root,
    approvalTimeoutMs: 80,
    authorizeGate: async () => {
      entered();
      await new Promise(() => {});
    },
  });
  await store.create({ expectedVersion: 0, changeId: 'pending' });
  for (const to of ['REQ_CLARIFYING', 'REQ_CRITIQUE', 'H1_PENDING'])
    await store.transition({ expectedVersion: (await store.inspect()).state.version, to });
  const version = (await store.inspect()).state.version;
  const transition = store.transition({ expectedVersion: version, to: 'REQ_FROZEN' });
  await pending;
  assert.equal((await store.load()).ok, true);
  assert.equal(
    (await store.update({ expectedVersion: version, patch: { context: {} } })).code,
    'APPROVAL_IN_PROGRESS',
  );
  assert.equal((await transition).code, 'APPROVAL_TIMEOUT');
  assert.equal((await store.update({ expectedVersion: version, patch: { context: {} } })).ok, true);
});

async function fixture() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-approval-state-'));
  let store;
  // Simulated native source for core/store integration, not real Codex evidence.
  const authority = createApprovalAuthority({
    request: async () => ({ action: 'accept', content: { decision: 'approve', comment: '' } }),
    trustedPeerIdentity: { id: 'fixture-user', kind: 'user', source: 'fixture-native-channel' },
    audit: async (event) => {
      const loaded = await store.load();
      assert.equal(loaded.ok, true);
      const saved = await store.recordEvent({
        expectedVersion: loaded.state.version,
        type: event.type,
        payload: event,
      });
      if (!saved.ok) throw new Error(saved.code);
    },
  });
  store = createStateStore({
    projectRoot,
    authorizeGate: authority.authorizeGate,
    lockTimeoutMs: 100,
  });
  const created = await store.create({
    expectedVersion: 0,
    changeId: 'change-one',
    context: { artifacts: { requirements: { hash: HASH } } },
  });
  assert.equal(created.ok, true);
  for (const to of ['REQ_CLARIFYING', 'REQ_CRITIQUE', 'H1_PENDING']) {
    const loaded = await store.load();
    assert.equal((await store.transition({ expectedVersion: loaded.state.version, to })).ok, true);
  }
  const issued = await authority.requestApproval({
    gate: 'H1',
    scope: 'change-one',
    artifactHash: HASH,
    readArtifactHash: async () => HASH,
    summary: 'Requirements snapshot shown in full.',
  });
  assert.equal(issued.ok, true, JSON.stringify(issued));
  return { projectRoot, store, approval: issued.approval };
}

test('a real state transaction durably audits and consumes the opaque handle without recursive locking', async () => {
  const { projectRoot, store, approval } = await fixture();
  const before = (await store.load()).state;
  const result = await store.transition({
    expectedVersion: before.version,
    to: 'REQ_FROZEN',
    approval,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.state.phase, 'REQ_FROZEN');
  assert.equal(result.state.version, before.version + 2);
  assert.ok(result.event.payload.approval.consumedAt);
  const checked = verifyEventChain(
    fs.readFileSync(path.join(projectRoot, '.specgate/codex/events.jsonl'), 'utf8'),
  );
  assert.equal(checked.ok, true);
  assert.deepEqual(
    checked.events.slice(-2).map((event) => event.type),
    ['approval.consumed', 'state.transitioned'],
  );
  assert.equal(checked.events.at(-2).state.phase, 'H1_PENDING');
  assert.equal(checked.events.at(-1).state.phase, 'REQ_FROZEN');
});

test('forged handles are rejected with durable failure evidence and a fresh actual version', async () => {
  const { store } = await fixture();
  const before = (await store.load()).state;
  const result = await store.transition({
    expectedVersion: before.version,
    to: 'REQ_FROZEN',
    approval: { approved: true },
  });
  assert.equal(result.code, 'APPROVAL_UNKNOWN');
  assert.equal(result.actualVersion, before.version + 1);
  const loaded = await store.load();
  assert.equal(loaded.state.phase, 'H1_PENDING');
  assert.equal(loaded.state.version, result.actualVersion);
});

test('failed consumption audit denies transition and permanently invalidates its handle', async () => {
  const { store, approval } = await fixture();
  const before = (await store.load()).state;
  const write = fs.writeFileSync;
  fs.writeFileSync = (target, data, ...rest) => {
    if (typeof target === 'number' && String(data).includes('"type":"approval.consumed"'))
      throw new Error('Simulated audit write failure');
    return write(target, data, ...rest);
  };
  let failed;
  try {
    failed = await store.transition({
      expectedVersion: before.version,
      to: 'REQ_FROZEN',
      approval,
    });
  } finally {
    fs.writeFileSync = write;
  }
  assert.equal(failed.code, 'APPROVAL_AUDIT_FAILED');
  assert.equal(failed.actualVersion, undefined);
  assert.equal((await store.load()).state.phase, 'H1_PENDING');
  const retry = await store.transition({
    expectedVersion: before.version,
    to: 'REQ_FROZEN',
    approval,
  });
  assert.equal(retry.code, 'APPROVAL_INVALIDATED');
  assert.equal(retry.actualVersion, before.version + 1);
});

test('a state WAL failure after approval consumption keeps the phase pending and rejects reuse', async () => {
  const { projectRoot, store, approval } = await fixture();
  const before = (await store.load()).state;
  const write = fs.writeFileSync;
  fs.writeFileSync = (target, data, ...rest) => {
    if (typeof target === 'number' && String(data).includes('"type":"state.transitioned"'))
      throw Object.assign(new Error('Simulated transition write failure'), { code: 'EPERM' });
    return write(target, data, ...rest);
  };
  let failed;
  try {
    failed = await store.transition({
      expectedVersion: before.version,
      to: 'REQ_FROZEN',
      approval,
    });
  } finally {
    fs.writeFileSync = write;
  }
  assert.equal(failed.code, 'STORAGE_ERROR');
  assert.equal(failed.storageCode, 'EPERM');
  const recovered = await store.load();
  assert.equal(recovered.ok, true);
  assert.equal(recovered.state.phase, 'H1_PENDING');
  assert.equal(recovered.state.version, before.version + 1);
  const checked = verifyEventChain(
    fs.readFileSync(path.join(projectRoot, '.specgate/codex/events.jsonl'), 'utf8'),
  );
  assert.equal(checked.events.at(-1).type, 'approval.consumed');
  const retry = await store.transition({
    expectedVersion: recovered.state.version,
    to: 'REQ_FROZEN',
    approval,
  });
  assert.equal(retry.code, 'APPROVAL_CONSUMED');
  assert.equal(retry.actualVersion, recovered.state.version + 1);
});
