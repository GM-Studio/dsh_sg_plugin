import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMemoryWorkerStore } from '../src/codex/core/control/worker/memory-worker-store.js';
import { createWorkerGateway } from '../src/codex/core/control/worker/worker-gateway.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

function createFakeControlService(clock) {
  const state = {
    workItems: {},
    runs: {},
    decisions: {},
    leases: {},
  };
  const calls = {
    claims: [],
    heartbeats: [],
    releases: [],
    evidence: [],
    applied: [],
  };
  let sequence = 0;

  function expireLeases() {
    for (const [projectId, lease] of Object.entries(state.leases)) {
      if (Date.parse(lease.expiresAt) > clock()) continue;
      const run = state.runs[lease.runId];
      if (run) run.executionState = 'INTERRUPTED';
      const workItem = state.workItems[lease.workItemId];
      if (workItem) workItem.executionState = 'BLOCKED';
      delete state.leases[projectId];
    }
  }

  return {
    state,
    calls,
    addWorkItem(projectId, workItemId, executionState = 'QUEUED') {
      state.workItems[workItemId] = {
        workItemId,
        projectId,
        executionState,
        revision: 1,
      };
    },
    addDecision(decisionId, workItemId, status, extra = {}) {
      state.decisions[decisionId] = {
        decisionId,
        workItemId,
        attentionId: `attention-${decisionId}`,
        action: 'approve',
        artifactHash: 'a'.repeat(64),
        expectedWorkItemVersion: 2,
        attentionRevision: 1,
        status,
        createdAt:
          extra.createdAt ?? `2026-10-24T00:00:0${Object.keys(state.decisions).length}.000Z`,
        payload: { privateDecisionPayload: true },
        actorId: 'private-actor',
        ...extra,
      };
    },
    async claimNext({ ownerId, projectIds, leaseMs }) {
      calls.claims.push({ ownerId, projectIds: [...projectIds], leaseMs });
      expireLeases();
      const workItem = Object.values(state.workItems).find(
        (entry) => entry.executionState === 'QUEUED' && projectIds.includes(entry.projectId),
      );
      if (!workItem)
        return {
          ok: true,
          type: 'supervisor.idle',
          result: { idle: true, workItem: null, run: null, lease: null },
        };
      sequence += 1;
      const runId = `run-${sequence}`;
      const run = {
        runId,
        workItemId: workItem.workItemId,
        projectId: workItem.projectId,
        ownerId,
        executionState: 'RUNNING',
        revision: 1,
      };
      const lease = {
        leaseId: `lease-${sequence}`,
        token: `lease-token-${sequence}`,
        projectId: workItem.projectId,
        workItemId: workItem.workItemId,
        runId,
        ownerId,
        expiresAt: new Date(clock() + leaseMs).toISOString(),
      };
      state.runs[runId] = run;
      state.leases[workItem.projectId] = lease;
      workItem.executionState = 'RUNNING';
      workItem.currentRunId = runId;
      return {
        ok: true,
        type: 'run.claimed',
        result: {
          idle: false,
          workItem: clone(workItem),
          run: clone(run),
          lease: clone(lease),
        },
      };
    },
    async heartbeat({ runId, leaseToken, expectedRunVersion, updates }) {
      calls.heartbeats.push({ runId, leaseToken, expectedRunVersion, updates: clone(updates) });
      expireLeases();
      const run = state.runs[runId];
      const lease = run ? state.leases[run.projectId] : null;
      if (!run || !lease || lease.runId !== runId || lease.token !== leaseToken)
        return { ok: false, code: 'LEASE_INVALID', message: 'Lease is invalid' };
      if (run.revision !== expectedRunVersion)
        return { ok: false, code: 'VERSION_CONFLICT', message: 'Run changed' };
      Object.assign(run, clone(updates));
      run.revision += 1;
      return { ok: true, run: clone(run) };
    },
    async releaseLease({ runId, leaseToken, ownerId }) {
      calls.releases.push({ runId, leaseToken, ownerId });
      const run = state.runs[runId];
      const lease = run ? state.leases[run.projectId] : null;
      if (!run || !lease || lease.runId !== runId || lease.token !== leaseToken)
        return { ok: false, code: 'LEASE_INVALID', message: 'Lease is invalid' };
      delete state.leases[run.projectId];
      run.executionState = 'INTERRUPTED';
      return { ok: true, released: true };
    },
    async inspect() {
      return { ok: true, state: clone(state) };
    },
    async appendEvidence(event) {
      calls.evidence.push(clone(event));
      return { ok: true, event: clone(event), duplicate: false };
    },
    async applyDecision(input) {
      calls.applied.push(clone(input));
      return { ok: true };
    },
  };
}

function createHarness(tokens = []) {
  let now = 1_760_000_000_000;
  let tokenIndex = 0;
  const audits = [];
  const controlService = createFakeControlService(() => now);
  const store = createMemoryWorkerStore({ clock: () => now });
  const gateway = createWorkerGateway({
    store,
    controlService,
    clock: () => now,
    tokenFactory: async () =>
      tokens[tokenIndex++] ?? `sgw_${String(tokenIndex).padStart(2, '0')}_${'x'.repeat(32)}`,
    leaseMs: 60_000,
    heartbeatIntervalMs: 15_000,
    offlineAfterMs: 45_000,
    audit: async (entry) => audits.push(entry),
  });
  return {
    gateway,
    store,
    controlService,
    audits,
    advance(ms) {
      now += ms;
    },
  };
}

test('worker registration stores only hashes and rotation/revocation invalidate access', async () => {
  const harness = createHarness(['sgw_first_secret_token', 'sgw_second_secret_token']);
  const registered = await harness.gateway.register({
    displayName: 'Build worker',
    projectIds: ['project-a'],
    capabilities: ['codex', 'node'],
    actorId: 'owner-1',
  });
  assert.equal(registered.ok, true);
  assert.equal(registered.token, 'sgw_first_secret_token');
  assert.equal(registered.worker.tokenHash, sha256('sgw_first_secret_token'));
  assert.equal(JSON.stringify(registered.worker).includes(registered.token), false);

  const authenticated = await harness.gateway.authenticate({ token: registered.token });
  assert.equal(authenticated.ok, true);
  assert.equal((await harness.gateway.authenticate({ token: 'wrong-token' })).ok, false);

  const connected = await harness.gateway.connect({
    token: registered.token,
    capabilities: ['codex'],
  });
  assert.equal(connected.ok, true);
  assert.equal(connected.worker.status, 'ONLINE');
  assert.equal(connected.heartbeatIntervalMs, 15_000);

  const rotated = await harness.gateway.rotateToken({
    workerId: registered.worker.workerId,
    actorId: 'owner-1',
  });
  assert.equal(rotated.ok, true);
  assert.notEqual(rotated.worker.tokenHash, registered.worker.tokenHash);
  assert.equal((await harness.gateway.authenticate({ token: registered.token })).ok, false);
  assert.equal((await harness.gateway.authenticate({ token: rotated.token })).ok, true);

  const revoked = await harness.gateway.revoke({
    workerId: registered.worker.workerId,
    actorId: 'owner-1',
  });
  assert.equal(revoked.ok, true);
  assert.equal(revoked.worker.status, 'REVOKED');
  assert.equal(
    (await harness.gateway.authenticate({ token: rotated.token })).code,
    'WORKER_REVOKED',
  );

  const listed = await harness.gateway.listWorkers();
  assert.equal(listed.ok, true);
  const serialized = JSON.stringify(listed);
  assert.equal(serialized.includes(registered.token), false);
  assert.equal(serialized.includes(rotated.token), false);
  const auditText = JSON.stringify(harness.audits);
  assert.equal(auditText.includes(registered.token), false);
  assert.equal(auditText.includes(rotated.token), false);
  assert.ok(harness.audits.some((entry) => entry.action === 'worker.token.rotate'));
  assert.ok(harness.audits.some((entry) => entry.action === 'worker.revoke'));
});

test('memory store exposes both common token and audit contract aliases', async () => {
  const harness = createHarness(['sgw_alias_surface_token']);
  const registered = await harness.gateway.register({
    displayName: 'Alias worker',
    projectIds: ['project-a'],
    capabilities: { codex: true },
    actorId: 'owner-1',
  });
  assert.equal(registered.ok, true);
  assert.equal(harness.store.findWorkerByTokenHash, harness.store.getWorkerByTokenHash);
  assert.equal(harness.store.appendWorkerAudit, harness.store.appendAudit);

  const viaFind = await harness.store.findWorkerByTokenHash(registered.worker.tokenHash);
  const viaGet = await harness.store.getWorkerByTokenHash(registered.worker.tokenHash);
  assert.equal(viaFind.ok, true);
  assert.equal(viaGet.ok, true);
  assert.deepEqual(viaFind.worker, viaGet.worker);

  const appended = await harness.store.appendWorkerAudit({
    actorType: 'system',
    actorId: 'test',
    action: 'worker.alias.checked',
    objectType: 'worker',
    objectId: registered.worker.workerId,
    detail: {},
    createdAt: new Date().toISOString(),
  });
  assert.equal(appended.ok, true);
  const listed = await harness.store.listAudit();
  assert.ok(listed.audits.some((entry) => entry.action === 'worker.alias.checked'));
});

test('claims use only the server whitelist and ignore idle as completion', async () => {
  const harness = createHarness();
  const worker = await harness.gateway.register({
    displayName: 'Project A worker',
    projectIds: ['project-a'],
    capabilities: ['codex'],
    actorId: 'owner-1',
  });
  await harness.gateway.connect({ token: worker.token });
  harness.controlService.addWorkItem('project-a', 'work-a');
  harness.controlService.addWorkItem('project-b', 'work-b');

  const forgedProject = await harness.gateway.claim({
    token: worker.token,
    projectIds: ['project-b'],
  });
  assert.equal(forgedProject.ok, false);
  assert.equal(forgedProject.code, 'WORKER_INPUT_INVALID');
  assert.equal(harness.controlService.calls.claims.length, 0);

  const claimed = await harness.gateway.claim({ token: worker.token });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.workItem.projectId, 'project-a');
  assert.deepEqual(harness.controlService.calls.claims[0].projectIds, ['project-a']);
  assert.equal(harness.controlService.calls.claims[0].ownerId, worker.worker.workerId);

  const synced = await harness.gateway.sync({ token: worker.token });
  assert.equal(synced.ok, true);
  assert.equal(synced.commands.length, 0);
  assert.equal(harness.controlService.state.workItems['work-a'].executionState, 'RUNNING');

  const idle = await harness.gateway.claim({ token: worker.token });
  assert.equal(idle.ok, true);
  assert.equal(idle.idle, true);
  assert.equal(harness.controlService.state.runs[claimed.run.runId].executionState, 'RUNNING');
  assert.ok(
    harness.audits.some(
      (entry) => entry.action === 'worker.claim.deny' && entry.detail.reason === 'IDLE',
    ),
  );

  const updatedProjects = await harness.gateway.setProjects({
    workerId: worker.worker.workerId,
    projectIds: ['project-a', 'project-b'],
    actorId: 'owner-1',
  });
  assert.equal(updatedProjects.ok, true);
  assert.deepEqual(updatedProjects.worker.projectIds, ['project-a', 'project-b']);
  assert.ok(harness.audits.some((entry) => entry.action === 'worker.projects.update'));
});

test('two workers receive only one lease and a disconnected worker is not completed', async () => {
  const harness = createHarness();
  const first = await harness.gateway.register({
    displayName: 'First worker',
    projectIds: ['project-a'],
    capabilities: ['codex'],
    actorId: 'owner-1',
  });
  const second = await harness.gateway.register({
    displayName: 'Second worker',
    projectIds: ['project-a'],
    capabilities: ['codex'],
    actorId: 'owner-1',
  });
  await harness.gateway.connect({ token: first.token });
  await harness.gateway.connect({ token: second.token });
  harness.controlService.addWorkItem('project-a', 'work-single');

  const results = await Promise.all([
    harness.gateway.claim({ token: first.token }),
    harness.gateway.claim({ token: second.token }),
  ]);
  assert.equal(results.filter((result) => result.ok && !result.idle).length, 1);
  assert.equal(results.filter((result) => result.ok && result.idle).length, 1);
  assert.equal(Object.keys(harness.controlService.state.runs).length, 1);

  harness.advance(46_000);
  const timedOut = await harness.gateway.authenticate({ token: first.token });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.code, 'WORKER_OFFLINE');
  assert.notEqual(
    harness.controlService.state.workItems['work-single'].executionState,
    'COMPLETED',
  );
  const reconnected = await harness.gateway.connect({ token: first.token });
  assert.equal(reconnected.ok, true);
  assert.equal(reconnected.worker.status, 'ONLINE');
});

test('heartbeat renews an owned run and release never reports completion', async () => {
  const harness = createHarness();
  const worker = await harness.gateway.register({
    displayName: 'Lease worker',
    projectIds: ['project-a'],
    capabilities: ['codex'],
    actorId: 'owner-1',
  });
  await harness.gateway.connect({ token: worker.token });
  harness.controlService.addWorkItem('project-a', 'work-heartbeat');
  const claimed = await harness.gateway.claim({ token: worker.token });

  const rejected = await harness.gateway.heartbeat({
    token: worker.token,
    runId: claimed.run.runId,
    leaseToken: claimed.lease.token,
    expectedRunVersion: 1,
    updates: { command: 'rm -rf /' },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'WORKER_HEARTBEAT_INVALID');

  const heartbeat = await harness.gateway.heartbeat({
    token: worker.token,
    runId: claimed.run.runId,
    leaseToken: claimed.lease.token,
    expectedRunVersion: 1,
    updates: { currentPhase: 'TESTING' },
  });
  assert.equal(heartbeat.ok, true);
  assert.equal(heartbeat.run.revision, 2);
  assert.equal(heartbeat.run.currentPhase, 'TESTING');

  const released = await harness.gateway.release({
    token: worker.token,
    runId: claimed.run.runId,
    leaseToken: claimed.lease.token,
  });
  assert.equal(released.ok, true);
  assert.equal(released.released, true);
  assert.equal(harness.controlService.calls.releases.length, 1);
  assert.notEqual(
    harness.controlService.state.workItems['work-heartbeat'].executionState,
    'COMPLETED',
  );
  assert.ok(harness.audits.some((entry) => entry.action === 'worker.heartbeat'));
  assert.ok(harness.audits.some((entry) => entry.action === 'worker.release'));

  harness.controlService.addWorkItem('project-a', 'work-expired');
  const expiring = await harness.gateway.claim({ token: worker.token, leaseMs: 1_000 });
  assert.equal(expiring.ok, true);
  harness.advance(2_000);
  const expired = await harness.gateway.heartbeat({
    token: worker.token,
    runId: expiring.run.runId,
    leaseToken: expiring.lease.token,
    expectedRunVersion: 1,
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'LEASE_INVALID');
  assert.equal(harness.controlService.state.workItems['work-expired'].executionState, 'BLOCKED');
});

test('worker events are idempotent, conflict-aware, project-scoped and fail closed', async () => {
  const harness = createHarness();
  const worker = await harness.gateway.register({
    displayName: 'Event worker',
    projectIds: ['project-a'],
    capabilities: ['codex'],
    actorId: 'owner-1',
  });
  await harness.gateway.connect({ token: worker.token });
  harness.controlService.addWorkItem('project-a', 'work-event');
  const event = {
    eventId: 'event-1',
    dedupeKey: 'dedupe-event-1',
    type: 'TEST_RESULT',
    projectId: 'project-a',
    workItemId: 'work-event',
    occurredAt: '2026-10-24T00:01:00.000Z',
    payload: { passed: 4, failed: 0, summary: 'focused tests' },
  };

  const first = await harness.gateway.reportEvents({
    token: worker.token,
    events: [event],
  });
  assert.equal(first.ok, true);
  assert.equal(first.accepted.length, 1);
  assert.equal(harness.controlService.calls.evidence.length, 1);

  const replay = await harness.gateway.reportEvents({
    token: worker.token,
    events: [event],
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.accepted.length, 0);
  assert.deepEqual(replay.duplicates, ['event-1']);

  const conflict = await harness.gateway.reportEvents({
    token: worker.token,
    events: [{ ...event, payload: { passed: 3, failed: 1 } }],
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'WORKER_EVENT_CONFLICT');

  const outsideProject = await harness.gateway.reportEvents({
    token: worker.token,
    events: [{ ...event, eventId: 'event-2', projectId: 'project-b' }],
  });
  assert.equal(outsideProject.ok, false);
  assert.equal(outsideProject.code, 'WORKER_PROJECT_DENIED');

  const localPath = await harness.gateway.reportEvents({
    token: worker.token,
    events: [
      {
        ...event,
        eventId: 'event-3',
        dedupeKey: 'dedupe-event-3',
        payload: { logPath: 'C:\\Users\\operator\\private.log' },
      },
    ],
  });
  assert.equal(localPath.ok, false);
  assert.equal(localPath.code, 'WORKER_EVENT_SENSITIVE');

  const credential = await harness.gateway.reportEvents({
    token: worker.token,
    events: [
      {
        ...event,
        eventId: 'event-4',
        dedupeKey: 'dedupe-event-4',
        payload: { authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' },
      },
    ],
  });
  assert.equal(credential.ok, false);
  assert.equal(credential.code, 'WORKER_EVENT_SENSITIVE');
  assert.ok(harness.audits.some((entry) => entry.action === 'worker.event.replay'));
  assert.equal(JSON.stringify(harness.audits).includes('C:\\\\Users'), false);
});

test('typed command outbox deduplicates, rejects shell payloads and acknowledges replay', async () => {
  const harness = createHarness();
  const worker = await harness.gateway.register({
    displayName: 'Command worker',
    projectIds: ['project-a'],
    capabilities: ['codex'],
    actorId: 'owner-1',
  });
  await harness.gateway.connect({ token: worker.token });

  const commandInput = {
    workerId: worker.worker.workerId,
    kind: 'STOP',
    payload: { reason: 'operator requested stop' },
    dedupeKey: 'stop-1',
    actorId: 'owner-1',
  };
  const first = await harness.gateway.issueCommand(commandInput);
  const replay = await harness.gateway.issueCommand(commandInput);
  assert.equal(first.ok, true);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.command.commandId, first.command.commandId);

  const pulled = await harness.gateway.pullCommands({
    token: worker.token,
    after: 0,
    limit: 10,
  });
  assert.equal(pulled.ok, true);
  assert.equal(pulled.commands.length, 1);
  const acknowledged = await harness.gateway.ackCommand({
    token: worker.token,
    commandId: first.command.commandId,
  });
  assert.equal(acknowledged.ok, true);
  assert.equal(
    (
      await harness.gateway.pullCommands({
        token: worker.token,
        after: 0,
        limit: 10,
      })
    ).commands.length,
    0,
  );

  const shell = await harness.gateway.issueCommand({
    workerId: worker.worker.workerId,
    kind: 'RUN_TYPED_OPERATION',
    payload: { command: 'rm -rf /', cwd: 'C:\\repo' },
    dedupeKey: 'shell-1',
    actorId: 'owner-1',
  });
  assert.equal(shell.ok, false);
  assert.equal(shell.code, 'WORKER_COMMAND_SHELL_REJECTED');

  const unknown = await harness.gateway.issueCommand({
    workerId: worker.worker.workerId,
    kind: 'RAW_SHELL',
    payload: {},
    dedupeKey: 'unknown-1',
    actorId: 'owner-1',
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'WORKER_COMMAND_KIND_INVALID');

  const callback = await harness.gateway.issueCommand({
    workerId: worker.worker.workerId,
    kind: 'STOP',
    payload: { callbackUrl: 'https://attacker.invalid/hook' },
    dedupeKey: 'callback-1',
    actorId: 'owner-1',
  });
  assert.equal(callback.ok, false);
  assert.ok(
    harness.audits.some(
      (entry) =>
        entry.action === 'worker.command.rejected' &&
        entry.detail.code === 'WORKER_COMMAND_SHELL_REJECTED',
    ),
  );
});

test('pending decisions are bounded and isolated to the worker project whitelist', async () => {
  const harness = createHarness();
  const worker = await harness.gateway.register({
    displayName: 'Decision worker',
    projectIds: ['project-a'],
    capabilities: ['codex'],
    actorId: 'owner-1',
  });
  await harness.gateway.connect({ token: worker.token });
  harness.controlService.addWorkItem('project-a', 'work-a');
  harness.controlService.addWorkItem('project-b', 'work-b');
  harness.controlService.addDecision('decision-a', 'work-a', 'RECORDED', {
    createdAt: '2026-10-24T00:00:01.000Z',
  });
  harness.controlService.addDecision('decision-b', 'work-b', 'RECORDED', {
    createdAt: '2026-10-24T00:00:02.000Z',
  });
  harness.controlService.addDecision('decision-c', 'work-a', 'PENDING_APPLY', {
    createdAt: '2026-10-24T00:00:03.000Z',
  });
  harness.controlService.addDecision('decision-d', 'work-a', 'APPLIED', {
    createdAt: '2026-10-24T00:00:04.000Z',
  });

  const synced = await harness.gateway.sync({ token: worker.token });
  assert.equal(synced.ok, true);
  assert.deepEqual(
    synced.pendingDecisions.map((decision) => decision.decisionId),
    ['decision-a', 'decision-c'],
  );
  for (const decision of synced.pendingDecisions) {
    assert.equal(decision.projectId, 'project-a');
    assert.equal(decision.payload, undefined);
    assert.equal(decision.actorId, undefined);
  }
  assert.equal(harness.controlService.calls.applied.length, 0);

  const next = await harness.gateway.sync({
    token: worker.token,
    cursor: synced.cursor,
  });
  assert.equal(next.ok, true);
  assert.equal(next.pendingDecisions.length, 0);
});

test('connection inputs reject callback URLs and no inbound endpoint is accepted', async () => {
  const harness = createHarness();
  const registration = await harness.gateway.register({
    displayName: 'No callback worker',
    projectIds: ['project-a'],
    capabilities: ['codex'],
    actorId: 'owner-1',
    callbackUrl: 'https://attacker.invalid/inbound',
  });
  assert.equal(registration.ok, false);
  assert.equal(registration.code, 'WORKER_INPUT_INVALID');

  const worker = await harness.gateway.register({
    displayName: 'No callback worker',
    projectIds: ['project-a'],
    capabilities: ['codex'],
    actorId: 'owner-1',
  });
  const connected = await harness.gateway.connect({
    token: worker.token,
    callbackUrl: 'https://attacker.invalid/inbound',
  });
  assert.equal(connected.ok, false);
  assert.equal(connected.code, 'WORKER_INPUT_INVALID');
});
