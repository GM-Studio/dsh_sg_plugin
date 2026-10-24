import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';
import { createMemoryWorkerStore } from '../src/codex/core/control/worker/memory-worker-store.js';
import { createWorkerGateway } from '../src/codex/core/control/worker/worker-gateway.js';
import { createWorkerScheduler } from '../src/codex/core/control/worker/worker-scheduler.js';

const AT = Date.parse('2026-10-24T10:00:00.000Z');

test('scheduler integration keeps one lease and hands the next claim to another worker', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m10-integration-'));
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot);
  let sequence = 0;
  const controlStore = createControlStore({ root, clock: () => AT });
  const control = createControlService({
    store: controlStore,
    clock: () => AT,
    randomId: () => `m10-integration-${++sequence}`,
  });
  const created = await control.createWorkItem({
    title: 'Scheduled work',
    request: 'Run once',
    projectRoot,
  });
  await controlStore.mutate((state) => {
    state.workItems[created.workItem.workItemId].requirements = {
      toolchains: ['node'],
      labels: ['linux'],
      region: 'cn-east',
    };
    return { ok: true };
  });
  const projectId = created.workItem.projectId;
  const workerStore = createMemoryWorkerStore({ clock: () => AT });
  const scheduler = createWorkerScheduler({ clock: () => AT });
  const gateway = createWorkerGateway({
    store: workerStore,
    controlService: control,
    clock: () => AT,
    scheduler,
  });
  const first = await gateway.register({
    displayName: 'First worker',
    projectIds: [projectId],
    capabilities: {
      toolchains: ['node'],
      labels: ['linux'],
      maxConcurrency: 1,
      region: 'cn-east',
      priority: 10,
      skillStatuses: { node: 'ONLINE' },
    },
    actorId: 'owner',
  });
  const second = await gateway.register({
    displayName: 'Second worker',
    projectIds: [projectId],
    capabilities: {
      toolchains: ['node'],
      labels: ['linux'],
      maxConcurrency: 1,
      region: 'cn-east',
      priority: 10,
      skillStatuses: { node: 'ONLINE' },
    },
    actorId: 'owner',
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal((await gateway.connect({ token: first.token })).ok, true);
  assert.equal((await gateway.connect({ token: second.token })).ok, true);

  const firstAttempt = await gateway.claim({ token: first.token, leaseMs: 30000 });
  const secondAttempt = await gateway.claim({ token: second.token, leaseMs: 30000 });
  const attempts = [
    { token: first.token, result: firstAttempt },
    { token: second.token, result: secondAttempt },
  ];
  const winner = attempts.find((entry) => entry.result.ok && entry.result.idle === false);
  const loser = attempts.find((entry) => entry !== winner);
  assert.ok(winner, JSON.stringify(attempts));
  assert.equal(loser.result.ok, true);
  assert.equal(loser.result.idle, true);
  const claimed = winner.result;
  assert.equal(claimed.workItem.projectId, projectId);
  assert.equal(claimed.lease.fencingToken, 1);

  const heartbeat = await gateway.heartbeat({
    token: winner.token,
    runId: claimed.run.runId,
    leaseToken: claimed.lease.token,
    expectedRunVersion: claimed.run.revision,
    updates: { currentPhase: 'RUNNING' },
  });
  assert.equal(heartbeat.ok, true, JSON.stringify(heartbeat));
  const released = await gateway.release({
    token: winner.token,
    runId: claimed.run.runId,
    leaseToken: claimed.lease.token,
  });
  assert.equal(released.ok, true, JSON.stringify(released));
  assert.equal(scheduler.inspect().activeLeases.length, 0);

  const replacement = await control.createWorkItem({
    title: 'Next scheduled work',
    request: 'Run after release',
    projectRoot,
  });
  assert.equal(replacement.ok, true, JSON.stringify(replacement));
  const next = await gateway.claim({ token: loser.token, leaseMs: 30000 });
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.equal(next.idle, false, JSON.stringify(next));
  assert.equal(next.workItem.workItemId, replacement.workItem.workItemId);
  assert.equal(next.lease.fencingToken, 2);
});

test('gateway persists bounded multi-worker capabilities and rejects unsafe declarations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m10-capabilities-'));
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot);
  const control = createControlService({
    store: createControlStore({ root, clock: () => AT }),
    clock: () => AT,
  });
  const scheduler = createWorkerScheduler({ clock: () => AT });
  const gateway = createWorkerGateway({
    store: createMemoryWorkerStore({ clock: () => AT }),
    controlService: control,
    clock: () => AT,
    scheduler,
  });
  const capabilities = {
    codex: 'exec-json',
    toolchains: ['node', 'codex'],
    labels: ['linux'],
    maxConcurrency: 2,
    region: 'cn-east',
    priority: 10,
    skillStatuses: { node: 'ONLINE', codex: 'AVAILABLE' },
  };
  const registered = await gateway.register({
    displayName: 'Capability worker',
    projectIds: ['project-a'],
    capabilities,
    actorId: 'owner',
  });
  assert.equal(registered.ok, true, JSON.stringify(registered));
  assert.deepEqual(registered.worker.capabilities, capabilities);

  const connected = await gateway.connect({
    token: registered.token,
    capabilities: { ...capabilities, maxConcurrency: 3 },
  });
  assert.equal(connected.ok, true, JSON.stringify(connected));
  assert.equal(connected.worker.capabilities.maxConcurrency, 3);
  const scheduled = scheduler.registerWorker(
    {
      workerId: connected.worker.workerId,
      projectIds: connected.worker.projectIds,
      toolchains: connected.worker.capabilities.toolchains,
      labels: connected.worker.capabilities.labels,
      maxConcurrency: connected.worker.capabilities.maxConcurrency,
      region: connected.worker.capabilities.region,
      priority: connected.worker.capabilities.priority,
      skillStatuses: connected.worker.capabilities.skillStatuses,
    },
    { now: AT },
  );
  assert.equal(scheduled.ok, true, JSON.stringify(scheduled));

  for (const unsafe of [
    { ...capabilities, callbackUrl: 'https://example.test/worker' },
    { ...capabilities, shell: 'bash' },
    { ...capabilities, toolchains: ['C:\\private\\node.exe'] },
  ]) {
    const rejected = await gateway.register({
      displayName: 'Unsafe worker',
      projectIds: ['project-a'],
      capabilities: unsafe,
      actorId: 'owner',
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'WORKER_CAPABILITIES_INVALID');
  }
});

test('scheduler capability match is the exact WorkItem leased by the control plane', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m10-exact-item-'));
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot);
  let sequence = 0;
  const controlStore = createControlStore({ root, clock: () => AT });
  const control = createControlService({
    store: controlStore,
    clock: () => AT,
    randomId: () => `m10-exact-${++sequence}`,
  });
  const incompatible = await control.createWorkItem({
    title: 'GPU-only work',
    request: 'Requires an unavailable toolchain',
    projectRoot,
    priority: 'high',
  });
  const compatible = await control.createWorkItem({
    title: 'Node work',
    request: 'Runs on the connected worker',
    projectRoot,
    priority: 'normal',
  });
  assert.equal(incompatible.ok, true, JSON.stringify(incompatible));
  assert.equal(compatible.ok, true, JSON.stringify(compatible));
  const requirementsUpdated = await controlStore.mutate((state) => {
    state.workItems[incompatible.workItem.workItemId].requirements = {
      toolchains: ['gpu'],
    };
    state.workItems[compatible.workItem.workItemId].requirements = {
      toolchains: ['node'],
    };
    return {
      ok: true,
      type: 'scheduling.requirements.updated',
      payload: {
        workItemIds: [incompatible.workItem.workItemId, compatible.workItem.workItemId],
      },
    };
  });
  assert.equal(requirementsUpdated.ok, true, JSON.stringify(requirementsUpdated));

  const scheduler = createWorkerScheduler({ clock: () => AT });
  const gateway = createWorkerGateway({
    store: createMemoryWorkerStore({ clock: () => AT }),
    controlService: control,
    clock: () => AT,
    scheduler,
  });
  const registered = await gateway.register({
    displayName: 'Node worker',
    projectIds: [compatible.workItem.projectId],
    capabilities: {
      toolchains: ['node'],
      maxConcurrency: 1,
      skillStatuses: { node: 'ONLINE' },
    },
    actorId: 'owner',
  });
  assert.equal(registered.ok, true, JSON.stringify(registered));
  assert.equal((await gateway.connect({ token: registered.token })).ok, true);
  const inspected = await control.inspect();
  assert.deepEqual(inspected.state.workItems[incompatible.workItem.workItemId].requirements, {
    toolchains: ['gpu'],
  });
  const selection = scheduler.selectClaim({
    requestingWorkerId: registered.worker.workerId,
    workers: [
      {
        workerId: registered.worker.workerId,
        projectIds: registered.worker.projectIds,
        ...registered.worker.capabilities,
      },
    ],
    workItems: Object.values(inspected.state.workItems),
    leases: [],
    now: AT,
  });
  assert.equal(selection.workItemId, compatible.workItem.workItemId, JSON.stringify(selection));

  const claimed = await gateway.claim({ token: registered.token, leaseMs: 30000 });
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  assert.equal(claimed.idle, false, JSON.stringify(claimed));
  assert.equal(claimed.workItem.workItemId, compatible.workItem.workItemId);
  const finalState = await controlStore.inspect();
  assert.equal(
    finalState.state.workItems[incompatible.workItem.workItemId].executionState,
    'QUEUED',
  );
});
