import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerScheduler } from '../src/codex/core/control/worker/worker-scheduler.js';

const START = Date.parse('2026-10-24T08:00:00.000Z');

function worker(workerId, projectIds, extra = {}) {
  return {
    workerId,
    projectIds,
    toolchains: ['node'],
    labels: [],
    maxConcurrency: 1,
    region: 'cn-east',
    priority: 1,
    status: 'ONLINE',
    ...extra,
  };
}

function item(workItemId, projectId, extra = {}) {
  return {
    workItemId,
    projectId,
    executionState: 'QUEUED',
    priority: 'normal',
    createdAt: new Date(START - 60_000).toISOString(),
    queueSequence: Number(workItemId.replace(/\D/g, '')) || 1,
    ...extra,
  };
}

function setup() {
  const time = { now: START };
  return {
    time,
    scheduler: createWorkerScheduler({ clock: () => time.now }),
  };
}

test('two workers cannot claim the same project WorkItem', () => {
  const { scheduler, time } = setup();
  const alpha = worker('worker-alpha', ['project-a']);
  const beta = worker('worker-beta', ['project-a']);
  const queue = [item('work-1', 'project-a', { priority: 'high' })];
  for (const candidate of [alpha, beta]) {
    assert.equal(scheduler.registerWorker(candidate).ok, true);
  }

  const first = scheduler.assign({
    requestingWorkerId: alpha.workerId,
    workers: [alpha, beta],
    workItems: queue,
    leases: [],
    now: time.now,
  });
  assert.equal(first.ok, true);
  assert.equal(first.idle, false);
  assert.equal(first.workerId, alpha.workerId);
  assert.equal(first.lease.fencingToken, 1);

  const second = scheduler.assign({
    requestingWorkerId: beta.workerId,
    workers: [alpha, beta],
    workItems: queue,
    leases: [],
    now: time.now,
  });
  assert.equal(second.ok, true);
  assert.equal(second.idle, true);
  assert.match(second.reason, /No queued WorkItem/);
  assert.equal(scheduler.inspect().activeLeases.length, 1);
});

test('equal projects rotate by least recent project assignment', () => {
  const { scheduler, time } = setup();
  const executor = worker('worker-alpha', ['project-a', 'project-b'], {
    maxConcurrency: 2,
  });
  assert.equal(scheduler.registerWorker(executor, { now: time.now }).ok, true);
  const queue = [item('work-1', 'project-a'), item('work-2', 'project-b')];

  const first = scheduler.assign({
    requestingWorkerId: executor.workerId,
    workers: [executor],
    workItems: queue,
    now: time.now,
  });
  assert.equal(first.projectId, 'project-a');

  const second = scheduler.assign({
    requestingWorkerId: executor.workerId,
    workers: [executor],
    workItems: queue,
    now: time.now,
  });
  assert.equal(second.projectId, 'project-b');
  assert.match(second.reason, /least-recently-assigned project/);
});

test('business priority beats project fairness', () => {
  const { scheduler, time } = setup();
  const executor = worker('worker-alpha', ['project-a', 'project-b'], {
    maxConcurrency: 2,
  });
  scheduler.registerWorker(executor, { now: time.now });
  const low = item('work-1', 'project-a', { priority: 'low' });
  const high = item('work-2', 'project-b', { priority: 'high' });

  assert.equal(
    scheduler.assign({
      requestingWorkerId: executor.workerId,
      workers: [executor],
      workItems: [low],
      now: time.now,
    }).projectId,
    'project-a',
  );
  const selected = scheduler.assign({
    requestingWorkerId: executor.workerId,
    workers: [executor],
    workItems: [low, high],
    now: time.now,
  });
  assert.equal(selected.projectId, 'project-b');
  assert.match(selected.reason, /priority high/);
});

test('toolchain and strict region requirements exclude incompatible workers', () => {
  const { scheduler, time } = setup();
  const east = worker('worker-east', ['project-a'], {
    toolchains: ['node'],
    region: 'cn-east',
    skills: { node: 'ONLINE' },
  });
  const west = worker('worker-west', ['project-a'], {
    toolchains: ['node'],
    region: 'cn-west',
  });
  for (const candidate of [east, west]) {
    scheduler.registerWorker(candidate, { now: time.now });
  }
  const selected = scheduler.selectClaim({
    requestingWorkerId: east.workerId,
    workers: [east, west],
    workItems: [
      item('work-1', 'project-a', {
        requiredToolchain: 'node',
        requiredRegion: 'cn-east',
      }),
    ],
    now: time.now,
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.idle, false);
  assert.equal(selected.workerId, east.workerId);
  assert.equal(selected.alternatives[0].workerAlternatives[0].regionMatch, true);

  const revokedSkill = worker('worker-revoked-skill', ['project-b'], {
    skills: { node: 'REVOKED' },
  });
  scheduler.registerWorker(revokedSkill, { now: time.now });
  const unavailable = scheduler.selectClaim({
    requestingWorkerId: revokedSkill.workerId,
    workers: [revokedSkill],
    workItems: [item('work-2', 'project-b', { requiredToolchain: 'node' })],
    now: time.now,
  });
  assert.equal(unavailable.ok, true);
  assert.equal(unavailable.idle, true);
  assert.equal(unavailable.alternatives[0].code, 'NO_ELIGIBLE_WORKER');
});

test('expired lease takeover increments fencing and rejects the old token', () => {
  const { scheduler, time } = setup();
  const takeoverWorker = worker('worker-takeover', ['project-a'], {
    priority: 10,
  });
  scheduler.registerWorker(takeoverWorker, { now: time.now });
  const expiredLease = {
    leaseId: 'lease-old',
    leaseToken: 'lease-token-old',
    fencingToken: 7,
    projectId: 'project-a',
    workItemId: 'work-1',
    workerId: 'worker-old',
    runId: 'run-old',
    acquiredAt: new Date(START - 120_000).toISOString(),
    expiresAt: new Date(START - 1).toISOString(),
    releasedAt: null,
  };

  const assigned = scheduler.assign({
    requestingWorkerId: takeoverWorker.workerId,
    workers: [takeoverWorker],
    workItems: [item('work-1', 'project-a')],
    leases: [expiredLease],
    now: time.now,
  });
  assert.equal(assigned.ok, true);
  assert.equal(assigned.idle, false);
  assert.equal(assigned.lease.fencingToken, 8);
  assert.notEqual(assigned.lease.leaseToken, expiredLease.leaseToken);

  const oldToken = scheduler.validateLeaseToken({
    workerId: takeoverWorker.workerId,
    leaseToken: expiredLease.leaseToken,
    now: time.now,
  });
  assert.equal(oldToken.ok, false);
  assert.equal(oldToken.code, 'LEASE_INVALID');
  assert.equal(
    scheduler.renew({
      workerId: takeoverWorker.workerId,
      leaseToken: expiredLease.leaseToken,
      now: time.now,
    }).ok,
    false,
  );
  assert.equal(
    scheduler.validateLeaseToken({
      workerId: takeoverWorker.workerId,
      leaseToken: assigned.lease.leaseToken,
      now: time.now,
    }).ok,
    true,
  );
});

test('disconnect and reconnect replay ordered events without duplicate application', () => {
  const { scheduler, time } = setup();
  const executor = worker('worker-alpha', ['project-a']);
  scheduler.registerWorker(executor, { now: time.now });
  const firstEvent = {
    eventId: 'event-1',
    eventKey: 'work-1:started',
    type: 'work.started',
    occurredAt: new Date(START).toISOString(),
    payload: { state: 'RUNNING' },
  };
  const secondEvent = {
    eventId: 'event-2',
    eventKey: 'work-1:progress',
    type: 'work.progress',
    occurredAt: new Date(START + 1000).toISOString(),
    payload: { percent: 50 },
  };

  assert.equal(scheduler.disconnect({ workerId: executor.workerId, now: time.now }).ok, true);
  const offline = scheduler.assign({
    requestingWorkerId: executor.workerId,
    workers: [executor],
    workItems: [item('work-1', 'project-a')],
    now: time.now,
  });
  assert.equal(offline.ok, false);
  assert.equal(offline.code, 'WORKER_OFFLINE');

  time.now += 1000;
  const reconnected = scheduler.reconnect({
    workerId: executor.workerId,
    events: [firstEvent],
    cursor: 0,
    now: time.now,
  });
  assert.equal(reconnected.ok, true);
  assert.equal(reconnected.cursor, 1);
  assert.equal(reconnected.replay.length, 1);

  const synced = scheduler.syncEvents({
    workerId: executor.workerId,
    events: [firstEvent, secondEvent, firstEvent],
    cursor: 1,
    now: time.now + 1000,
  });
  assert.equal(synced.ok, true);
  assert.equal(synced.accepted.length, 1);
  assert.deepEqual(synced.duplicates, ['event-1', 'event-1']);
  assert.equal(synced.cursor, 2);

  const replay = scheduler.replayEvents({
    workerId: executor.workerId,
    after: 0,
    limit: 10,
  });
  assert.deepEqual(
    replay.events.map((event) => event.eventId),
    ['event-1', 'event-2'],
  );
  const firstPage = scheduler.replayEvents({
    workerId: executor.workerId,
    after: 0,
    limit: 1,
  });
  assert.equal(firstPage.cursor, 1);
  assert.equal(firstPage.serverCursor, 2);
});

test('revoked worker cannot reconnect, claim, or reuse a lease', () => {
  const { scheduler, time } = setup();
  const executor = worker('worker-alpha', ['project-a']);
  scheduler.registerWorker(executor, { now: time.now });
  const assigned = scheduler.assign({
    requestingWorkerId: executor.workerId,
    workers: [executor],
    workItems: [item('work-1', 'project-a')],
    now: time.now,
  });
  assert.equal(scheduler.revokeWorker({ workerId: executor.workerId, now: time.now }).ok, true);
  assert.equal(
    scheduler.reconnect({ workerId: executor.workerId, now: time.now }).code,
    'WORKER_REVOKED',
  );
  assert.equal(
    scheduler.validateLeaseToken({
      workerId: executor.workerId,
      leaseToken: assigned.lease.leaseToken,
      now: time.now,
    }).code,
    'WORKER_REVOKED',
  );
  const claim = scheduler.assign({
    requestingWorkerId: executor.workerId,
    workers: [executor],
    workItems: [item('work-2', 'project-a')],
    now: time.now,
  });
  assert.equal(claim.ok, false);
  assert.equal(claim.code, 'WORKER_REVOKED');
});

test('cross-project claim is denied and audited', () => {
  const { scheduler, time } = setup();
  const executor = worker('worker-alpha', ['project-a']);
  scheduler.registerWorker(executor, { now: time.now });
  const denied = scheduler.selectClaim({
    requestingWorkerId: executor.workerId,
    workers: [executor],
    workItems: [item('work-1', 'project-b')],
    now: time.now,
  });
  assert.equal(denied.ok, true);
  assert.equal(denied.idle, true);
  assert.equal(denied.alternatives[0].code, 'NO_ELIGIBLE_WORKER');
  assert.equal(
    scheduler
      .listAudit({ limit: 20 })
      .audits.some(
        (audit) =>
          audit.action === 'worker.claim.deny' &&
          audit.detail.reason === 'NO_ELIGIBLE_WORKER' &&
          audit.detail.rejected.some(
            (entry) => entry.projectId === 'project-b' && entry.code === 'NO_ELIGIBLE_WORKER',
          ),
      ),
    true,
  );
});

test('callback, URL, and shell fields are denied and audited', () => {
  const { scheduler, time } = setup();
  const callback = scheduler.registerWorker(
    worker('worker-alpha', ['project-a'], { callbackUrl: 'https://example.test/callback' }),
    { now: time.now },
  );
  assert.equal(callback.ok, false);
  assert.equal(callback.code, 'WORKER_CAPABILITY_CALLBACK_REJECTED');

  const shell = scheduler.registerWorker(
    worker('worker-beta', ['project-a'], { capabilities: { toolchains: ['node'], shell: 'bash' } }),
    { now: time.now },
  );
  assert.equal(shell.ok, false);
  assert.equal(shell.code, 'WORKER_CAPABILITY_SHELL_REJECTED');

  const executor = worker('worker-gamma', ['project-a']);
  scheduler.registerWorker(executor, { now: time.now });
  const denied = scheduler.assign({
    requestingWorkerId: executor.workerId,
    workers: [executor],
    workItems: [item('work-1', 'project-a', { command: 'rm -rf /' })],
    now: time.now,
  });
  assert.equal(denied.ok, true);
  assert.equal(denied.idle, true);
  assert.equal(denied.alternatives[0].code, 'WORK_ITEM_SHELL_REJECTED');
  assert.equal(
    scheduler
      .listAudit({ limit: 20 })
      .audits.some((audit) => audit.action === 'worker.capability.deny'),
    true,
  );
  assert.equal(
    scheduler
      .listAudit({ limit: 20 })
      .audits.some(
        (audit) =>
          audit.action === 'worker.claim.deny' &&
          audit.detail.reason === 'WORK_ITEM_SHELL_REJECTED',
      ),
    true,
  );
});

test('100 workers and 1000 queued items remain bounded and singly assigned', () => {
  const { scheduler, time } = setup();
  const workers = [];
  const queue = [];
  for (let workerIndex = 0; workerIndex < 100; workerIndex += 1) {
    const projectIds = Array.from(
      { length: 10 },
      (_, projectIndex) =>
        `project-${String(workerIndex).padStart(3, '0')}-${String(projectIndex).padStart(2, '0')}`,
    );
    const candidate = worker(`worker-${workerIndex}`, projectIds);
    workers.push(candidate);
    assert.equal(scheduler.registerWorker(candidate, { now: time.now }).ok, true);
    for (const projectId of projectIds) {
      queue.push(item(`work-${workerIndex}-${projectId}`, projectId));
    }
  }
  assert.equal(workers.length, 100);
  assert.equal(queue.length, 1000);

  const started = performance.now();
  const assigned = [];
  for (const candidate of workers) {
    const result = scheduler.assign({
      requestingWorkerId: candidate.workerId,
      workers,
      workItems: queue,
      now: time.now,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.idle, false, JSON.stringify(result));
    assigned.push(result.workItemId);
  }
  const elapsed = performance.now() - started;

  assert.equal(new Set(assigned).size, 100);
  assert.equal(scheduler.inspect().activeLeases.length, 100);
  assert.ok(elapsed < 5000, `scheduler stress run took ${elapsed.toFixed(1)}ms`);
});
