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
import { createManagementServer } from '../src/codex/management/server.js';

const PAIRING = 'worker-e2e-pairing-token';
const AT = Date.parse('2026-10-24T04:00:00.000Z');

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

function adminPost(server, pathname, body, stepUpCode = null) {
  return fetch(`${server.baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      cookie: server.cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': server.csrfToken,
    },
    body: JSON.stringify({ ...body, ...(stepUpCode ? { stepUpCode } : {}) }),
  });
}

test('outbound Worker e2e enforces identity, whitelist, leases, replay and revocation', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-worker-e2e-'));
  const projectA = path.join(root, 'project-a');
  const projectB = path.join(root, 'project-b');
  fs.mkdirSync(projectA);
  fs.mkdirSync(projectB);
  let sequence = 0;
  const service = createControlService({
    store: createControlStore({ root, clock: () => AT }),
    clock: () => AT,
    randomId: () => `worker-e2e-${++sequence}`,
  });
  const first = await service.createWorkItem({
    title: 'Project A work',
    request: 'Execute A',
    projectRoot: projectA,
  });
  const second = await service.createWorkItem({
    title: 'Project B work',
    request: 'Execute B',
    projectRoot: projectB,
  });
  const projectAId = first.workItem.projectId;
  const projectBId = second.workItem.projectId;
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
  const server = {
    ...started,
    cookie: paired.headers.get('set-cookie').split(';')[0],
    csrfToken: (await paired.json()).csrfToken,
  };

  async function register(name, projectIds) {
    const response = await adminPost(
      server,
      '/api/workers/register',
      {
        displayName: name,
        projectIds,
        capabilities: { codex: 'exec-json' },
      },
      '246810',
    );
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  }

  const workerA = await register('Worker A', [projectAId]);
  const workerB = await register('Worker B', [projectBId]);
  const workerC = await register('Worker C', [projectAId]);
  const clientA = createOutboundWorker({
    baseUrl: server.baseUrl,
    token: workerA.token,
    commandHandler: async () => ({ ok: true }),
  });
  const clientB = createOutboundWorker({
    baseUrl: server.baseUrl,
    token: workerB.token,
    commandHandler: async () => ({ ok: true }),
  });
  const clientC = createOutboundWorker({
    baseUrl: server.baseUrl,
    token: workerC.token,
    commandHandler: async () => ({ ok: true }),
  });
  t.after(() => Promise.all([clientA.stop(), clientB.stop(), clientC.stop()]));

  assert.equal((await clientA.connect()).ok, true);
  assert.equal((await clientB.connect()).ok, true);
  assert.equal((await clientC.connect()).ok, true);
  const forgedProject = await fetch(`${server.baseUrl}/api/worker/claim`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${workerA.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ projectIds: [projectBId] }),
  });
  assert.equal(forgedProject.status, 200);
  const claimedA = { ok: true, data: await forgedProject.json() };
  const claimedB = await clientB.claim();
  assert.equal(claimedA.ok, true, JSON.stringify(claimedA));
  assert.equal(claimedB.ok, true, JSON.stringify(claimedB));
  assert.equal(claimedA.data.workItem.projectId, projectAId);
  assert.notEqual(claimedA.data.workItem.projectId, projectBId);
  assert.equal(claimedB.data.workItem.projectId, projectBId);
  const deniedC = await clientC.claim();
  assert.equal(deniedC.ok, true);
  assert.equal(deniedC.data.idle, true);

  const heartbeat = await clientA.heartbeat({
    runId: claimedA.data.run.runId,
    leaseToken: claimedA.data.lease.token,
    expectedRunVersion: claimedA.data.run.revision,
    updates: { currentPhase: 'RUNNING' },
  });
  assert.equal(heartbeat.ok, true, JSON.stringify(heartbeat));
  const released = await clientA.release({
    runId: claimedA.data.run.runId,
    leaseToken: claimedA.data.lease.token,
  });
  assert.equal(released.ok, true, JSON.stringify(released));
  const interrupted = await service.getRun(claimedA.data.run.runId);
  assert.equal(interrupted.run.executionState, 'INTERRUPTED');
  assert.equal(interrupted.workItem.executionState, 'BLOCKED');

  const event = {
    eventId: 'event-a-1',
    dedupeKey: 'event-a-dedupe',
    type: 'execution.evidence',
    projectId: projectAId,
    workItemId: claimedA.data.workItem.workItemId,
    runId: claimedA.data.run.runId,
    occurredAt: new Date(AT).toISOString(),
    payload: { result: 'pass' },
  };
  const firstEvent = await clientA.reportEvents([event]);
  const replayEvent = await clientA.reportEvents([event]);
  assert.equal(firstEvent.ok, true, JSON.stringify(firstEvent));
  assert.equal(replayEvent.ok, true, JSON.stringify(replayEvent));
  const inspected = await store.inspect();
  assert.equal(inspected.ok, true);
  assert.equal(
    Object.values(inspected.state.events).filter(
      (entry) => entry.workerId === workerA.worker.workerId,
    ).length,
    1,
  );

  const commandInput = {
    workerId: workerA.worker.workerId,
    kind: 'CLAIM',
    payload: {},
    dedupeKey: 'e2e-command-1',
  };
  const command = await adminPost(server, '/api/workers/commands', commandInput);
  const commandBody = await command.json();
  assert.equal(command.status, 200, JSON.stringify(commandBody));
  const duplicate = await adminPost(server, '/api/workers/commands', commandInput);
  const duplicateBody = await duplicate.json();
  assert.equal(duplicateBody.command.commandId, commandBody.command.commandId);
  const shellCommand = await adminPost(server, '/api/workers/commands', {
    workerId: workerA.worker.workerId,
    kind: 'RUN_TYPED_OPERATION',
    payload: { command: 'whoami' },
    dedupeKey: 'e2e-shell-command',
  });
  const shellBody = await shellCommand.json();
  assert.equal(shellCommand.status, 400);
  assert.equal(shellBody.code, 'WORKER_COMMAND_SHELL_REJECTED');
  const synced = await clientA.sync({ cursor: 0, waitMs: 0 });
  assert.equal(synced.ok, true, JSON.stringify(synced));
  assert.equal(
    synced.commands.some((entry) => entry.commandId === commandBody.command.commandId),
    true,
  );
  const ack = await clientA.ackCommand(commandBody.command.commandId);
  assert.equal(ack.ok, true, JSON.stringify(ack));

  const revoked = await adminPost(
    server,
    '/api/workers/revoke',
    { workerId: workerA.worker.workerId },
    '246810',
  );
  assert.equal(revoked.status, 200);
  const rejected = await clientA.connect();
  assert.equal(rejected.ok, false);
  assert.equal(rejected.authFailure, true);
});
