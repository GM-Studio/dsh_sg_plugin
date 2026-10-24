import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';
import { createMemoryWorkerStore } from '../src/codex/core/control/worker/memory-worker-store.js';
import { createWorkerGateway } from '../src/codex/core/control/worker/worker-gateway.js';
import { createOutboundWorker } from '../src/codex/control/outbound-worker.js';
import { createRemoteWorkerSupervisor } from '../src/codex/control/remote-worker-supervisor.js';
import { createManagementServer } from '../src/codex/management/server.js';

const PAIRING = 'm4-e2e-pairing-token';
const AT = Date.parse('2026-10-24T05:00:00.000Z');
const ARTIFACT = 'a'.repeat(64);

async function startOnFetchPort(management) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await management.start({ port: 49152 + randomInt(16384) });
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('Unable to reserve a Fetch-safe test port');
}

function waitingMarker() {
  return {
    type: 'H1_APPROVAL',
    reason: 'Confirm the implementation scope',
    question: 'Approve this plan?',
    actions: ['approve', 'request_changes'],
    artifactHash: ARTIFACT,
  };
}

test('M4 remote waiting, Decision apply and original-session resume close the loop', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m4-e2e-'));
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot);
  let sequence = 0;
  const service = createControlService({
    store: createControlStore({ root, clock: () => AT }),
    clock: () => AT,
    randomId: () => `m4-${++sequence}`,
  });
  const created = await service.createWorkItem({
    title: 'Remote delivery',
    request: 'Implement the requested feature',
    projectRoot,
  });
  const projectId = created.workItem.projectId;
  const store = createMemoryWorkerStore({ clock: () => AT });
  const gateway = createWorkerGateway({
    store,
    controlService: service,
    clock: () => AT,
  });
  const management = createManagementServer({
    services: {
      projection: service.projection,
      decisions: service.decisions,
      verifyStepUp: async (code) => (code === '246810' ? 'step-up' : null),
    },
    workerGateway: gateway,
    pairingToken: PAIRING,
    clock: () => AT,
  });
  const started = await startOnFetchPort(management);
  t.after(() => management.close());
  const paired = await fetch(`${started.baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: PAIRING }),
  });
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await paired.json();
  const registered = await fetch(`${started.baseUrl}/api/workers/register`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': csrfToken,
    },
    body: JSON.stringify({
      displayName: 'M4 Worker',
      projectIds: [projectId],
      capabilities: { codex: 'exec-json' },
      stepUpCode: '246810',
    }),
  });
  const worker = await registered.json();
  assert.equal(registered.status, 200, JSON.stringify(worker));

  const events = [];
  const calls = [];
  const adapter = {
    async run(input) {
      calls.push({
        mode: input.mode,
        sessionId: input.sessionId,
        prompt: input.prompt,
      });
      if (input.mode === 'start') {
        input.onEvent({ type: 'thread.started', thread_id: 'session-original' });
        input.onEvent({
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: `SPECGATE_WAITING_FOR_USER:${JSON.stringify(waitingMarker())}`,
          },
        });
        return { ok: true, exitCode: 0, sessionId: 'session-original' };
      }
      assert.equal(input.sessionId, 'session-original');
      input.onEvent({ type: 'turn.completed' });
      return { ok: true, exitCode: 0, sessionId: 'session-original' };
    },
  };
  const workerClient = createOutboundWorker({
    baseUrl: started.baseUrl,
    token: worker.token,
    commandHandler: async () => ({ ok: true }),
    eventHandler: (event) => events.push(event),
    requestTimeoutMs: 5000,
  });
  t.after(() => workerClient.stop());
  const remote = createRemoteWorkerSupervisor({
    workerClient,
    adapter,
    projectRoots: { [projectId]: projectRoot },
    clock: () => AT,
    heartbeatIntervalMs: 60_000,
  });

  const waiting = await remote.runOnce();
  assert.equal(waiting.ok, true, JSON.stringify(waiting));
  assert.equal(waiting.status, 'waiting');
  assert.equal(calls[0].mode, 'start');
  const waitingState = await service.getWorkItem(created.workItem.workItemId);
  assert.equal(waitingState.workItem.executionState, 'WAITING_FOR_USER');
  assert.equal(waitingState.run.executionState, 'WAITING_FOR_USER');
  assert.equal(waitingState.run.sessionId, 'session-original');
  assert.equal(waitingState.attention.type, 'H1_APPROVAL');
  assert.equal((await service.inspect()).state.leases[projectId], undefined);

  const decided = await service.decide({
    workItemId: waitingState.workItem.workItemId,
    attentionId: waitingState.attention.requestId,
    attentionRevision: waitingState.attention.revision,
    expectedWorkItemVersion: waitingState.workItem.revision,
    artifactHash: ARTIFACT,
    action: 'approve',
    idempotencyKey: 'm4-e2e-approve',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
    payload: { comment: 'Approved for implementation.' },
  });
  assert.equal(decided.ok, true, JSON.stringify(decided));
  assert.equal(decided.workItem.resume.sessionId, 'session-original');

  const resumed = await remote.runOnce();
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.status, 'completed');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].mode, 'resume');
  assert.equal(calls[1].sessionId, 'session-original');
  assert.match(calls[1].prompt, /Approved for implementation/);
  assert.match(calls[1].prompt, /Do not create a replacement session/i);

  const finalState = await service.getWorkItem(created.workItem.workItemId);
  assert.equal(finalState.workItem.executionState, 'COMPLETED');
  const inspected = await service.inspect();
  const decision = Object.values(inspected.state.decisions).find(
    (entry) => entry.idempotencyKey === 'm4-e2e-approve',
  );
  assert.equal(decision.status, 'APPLIED');
  assert.equal(decision.applyStatus, 'APPLIED');
  assert.equal(decision.appliedBy, worker.worker.workerId);
});

test('cancel Decision is applied by an online Worker without resuming Codex', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m4-cancel-'));
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot);
  let sequence = 0;
  const service = createControlService({
    store: createControlStore({ root, clock: () => AT }),
    clock: () => AT,
    randomId: () => `m4-cancel-${++sequence}`,
  });
  const created = await service.createWorkItem({
    title: 'Cancel remote work',
    request: 'Stop safely',
    projectRoot,
  });
  const projectId = created.workItem.projectId;
  const gateway = createWorkerGateway({
    store: createMemoryWorkerStore({ clock: () => AT }),
    controlService: service,
    clock: () => AT,
  });
  const management = createManagementServer({
    services: {
      projection: service.projection,
      decisions: service.decisions,
      verifyStepUp: async (code) => (code === '246810' ? 'step-up' : null),
    },
    workerGateway: gateway,
    pairingToken: PAIRING,
    clock: () => AT,
  });
  const started = await startOnFetchPort(management);
  t.after(() => management.close());
  const paired = await fetch(`${started.baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: PAIRING }),
  });
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await paired.json();
  const registered = await fetch(`${started.baseUrl}/api/workers/register`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': csrfToken,
    },
    body: JSON.stringify({
      displayName: 'Cancel Worker',
      projectIds: [projectId],
      capabilities: {},
      stepUpCode: '246810',
    }),
  });
  const worker = await registered.json();
  assert.equal(registered.status, 200, JSON.stringify(worker));
  const workerClient = createOutboundWorker({
    baseUrl: started.baseUrl,
    token: worker.token,
    commandHandler: async () => ({ ok: true }),
    requestTimeoutMs: 5000,
  });
  t.after(() => workerClient.stop());
  let executions = 0;
  const remote = createRemoteWorkerSupervisor({
    workerClient,
    adapter: {
      async run(input) {
        executions += 1;
        input.onEvent({ type: 'thread.started', thread_id: 'cancel-session' });
        input.onEvent({
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: `SPECGATE_WAITING_FOR_USER:${JSON.stringify({
              ...waitingMarker(),
              actions: ['cancel'],
            })}`,
          },
        });
        return { ok: true, sessionId: 'cancel-session' };
      },
    },
    projectRoots: { [projectId]: projectRoot },
    clock: () => AT,
  });
  const waiting = await remote.runOnce();
  assert.equal(waiting.status, 'waiting');
  assert.equal(executions, 1);
  const waitingState = await service.getWorkItem(created.workItem.workItemId);
  const cancelled = await service.decide({
    workItemId: created.workItem.workItemId,
    attentionId: waitingState.attention.requestId,
    attentionRevision: waitingState.attention.revision,
    expectedWorkItemVersion: waitingState.workItem.revision,
    artifactHash: ARTIFACT,
    action: 'cancel',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
    idempotencyKey: 'm4-cancel-action',
  });
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  const state = await service.getWorkItem(created.workItem.workItemId);
  assert.equal(state.workItem.executionState, 'CANCELLED');
  const afterCancel = await remote.runOnce();
  assert.equal(afterCancel.ok, true, JSON.stringify(afterCancel));
  assert.equal(executions, 1);
  const inspected = await service.inspect();
  const decision = Object.values(inspected.state.decisions).find(
    (entry) => entry.idempotencyKey === 'm4-cancel-action',
  );
  assert.equal(decision.status, 'APPLIED');
});
