import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagementServer } from '../src/codex/management/server.js';

const PAIRING = 'm9-metrics-pairing-token';

async function start(t) {
  const management = createManagementServer({
    services: {
      projection: {
        health: async () => ({ ok: true, status: 'healthy' }),
        overview: async () => ({ ok: true, projects: [] }),
        listWorkItems: async () => ({ ok: true, workItems: [] }),
        getWorkItem: async (id) => ({ ok: true, workItem: { workItemId: id } }),
        getRun: async (id) => ({ ok: true, run: { runId: id } }),
        listAttention: async () => ({ ok: true, attention: [] }),
        listNotifications: async () => ({ ok: true, notifications: [] }),
      },
      decisions: { create: async () => ({ ok: true }) },
    },
    metricsProvider: async () => ({
      workerCounts: { online: 1, offline: 2 },
      pendingAttentionCount: 3,
      notificationFailures: 1,
      lastWorkerHeartbeatAt: '2026-10-24T09:00:00.000Z',
      databaseStatus: 'UP',
      version: '0.3.4',
      projectRoot: 'C:\\secret\\project',
      token: 'secret-token',
      customerName: 'Private Customer',
    }),
    clock: () => Date.parse('2026-10-24T09:01:00.000Z'),
    pairingToken: PAIRING,
  });
  const started = await management.start();
  t.after(() => management.close());
  const paired = await fetch(`${started.baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: PAIRING }),
  });
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  return { ...started, cookie };
}

test('authenticated metrics endpoint exposes only bounded operational data', async (t) => {
  const server = await start(t);
  assert.equal((await fetch(`${server.baseUrl}/api/metrics`)).status, 401);
  const response = await fetch(`${server.baseUrl}/api/metrics`, {
    headers: { cookie: server.cookie },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.workers.online, 1);
  assert.equal(body.workers.offline, 2);
  assert.equal(body.pendingAttention, 3);
  assert.equal(body.notificationFailures, 1);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /C:\\\\secret|secret-token|Private Customer|projectRoot/i);
});
