import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRemoteWorkerSupervisor } from '../src/codex/control/remote-worker-supervisor.js';

async function projectRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'specgate-remote-worker-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function pendingDecision(overrides = {}) {
  return {
    decisionId: 'decision-1',
    workItemId: 'work-1',
    projectId: 'project-1',
    action: 'approve',
    artifactHash: 'a'.repeat(64),
    expectedWorkItemVersion: 3,
    status: 'PENDING_APPLY',
    createdAt: '2026-10-24T01:00:00.000Z',
    ...overrides,
  };
}

function workItem(overrides = {}) {
  return {
    workItemId: 'work-1',
    projectId: 'project-1',
    request: 'Implement the remote execution loop.',
    revision: 3,
    executionState: 'RUNNING',
    resume: {
      decisionId: 'decision-1',
      action: 'approve',
      payload: {},
      sessionId: 'session-original',
    },
    projectRoot: 'C:\\cloud\\must-not-be-used',
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    runId: 'run-1',
    workItemId: 'work-1',
    projectId: 'project-1',
    revision: 1,
    sessionId: 'session-original',
    ...overrides,
  };
}

function fakeWorker({
  pendingDecisions = [],
  claim = { idle: true },
  syncCursor = 'cursor-1',
  heartbeatResult = null,
} = {}) {
  const calls = [];
  let heartbeatCount = 0;
  return {
    calls,
    async connect() {
      calls.push(['connect']);
      return { ok: true };
    },
    async sync(input) {
      calls.push(['sync', input]);
      return { ok: true, cursor: syncCursor, pendingDecisions };
    },
    async claim() {
      calls.push(['claim']);
      return { ok: true, ...claim };
    },
    async heartbeat(input) {
      calls.push(['heartbeat', input]);
      heartbeatCount += 1;
      if (heartbeatResult) return heartbeatResult(input, heartbeatCount);
      return {
        ok: true,
        run: { runId: input.runId, revision: input.expectedRunVersion + 1 },
      };
    },
    async reportEvents(events) {
      calls.push(['reportEvents', events]);
      return { ok: true, accepted: events.length };
    },
    async reportWaiting(input) {
      calls.push(['reportWaiting', input]);
      return { ok: true, attention: { requestId: 'attention-1' } };
    },
    async finishRun(input) {
      calls.push(['finishRun', input]);
      return { ok: true, status: input.status };
    },
    async completeDecisionApply(input) {
      calls.push(['completeDecisionApply', input]);
      return { ok: true, decision: { decisionId: input.decisionId, status: 'APPLIED' } };
    },
    async failDecisionApply(input) {
      calls.push(['failDecisionApply', input]);
      return { ok: true, decision: { decisionId: input.decisionId, status: 'FAILED' } };
    },
  };
}

function fakeAdapter(result, { onRun } = {}) {
  const calls = [];
  return {
    calls,
    async run(input) {
      calls.push(['run', input]);
      onRun?.(input);
      return typeof result === 'function' ? result(input) : result;
    },
    async start(input) {
      calls.push(['start', input]);
      return result;
    },
    async resume(input) {
      calls.push(['resume', input]);
      return result;
    },
  };
}

function claimed(root, { item = workItem(), runValue = run(), leaseToken = 'lease-1' } = {}) {
  return {
    workItem: item,
    run: runValue,
    lease: { token: leaseToken, projectId: item.projectId },
  };
}

test('waiting marker completes the Decision, reports Attention and never completes the Run', async (t) => {
  const root = await projectRoot(t);
  const marker = {
    type: 'H1_APPROVAL',
    reason: 'Scope changed',
    question: 'Approve?',
    actions: ['approve', 'request_changes'],
    artifactHash: 'b'.repeat(64),
  };
  const worker = fakeWorker({
    pendingDecisions: [pendingDecision()],
    claim: claimed(root),
  });
  const adapter = fakeAdapter(
    { ok: true, exitCode: 0, sessionId: 'session-original', parsedEvents: 2 },
    {
      onRun(input) {
        input.onSession('session-original');
        input.onEvent({
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: `SPECGATE_WAITING_FOR_USER:${JSON.stringify(marker)}`,
          },
        });
      },
    },
  );
  const supervisor = createRemoteWorkerSupervisor({
    workerClient: worker,
    adapter,
    projectRoots: { 'project-1': root },
    heartbeatIntervalMs: 60_000,
  });

  const result = await supervisor.runOnce();

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.status, 'waiting');
  assert.equal(result.attention.requestId, 'attention-1');
  const waiting = worker.calls.find(([name]) => name === 'reportWaiting')?.[1];
  assert.equal(waiting.runId, 'run-1');
  assert.equal(waiting.leaseToken, 'lease-1');
  assert.equal(waiting.sessionId, 'session-original');
  assert.deepEqual(waiting.waiting, marker);
  assert.ok(worker.calls.some(([name]) => name === 'completeDecisionApply'));
  assert.equal(
    worker.calls.some(([name]) => name === 'finishRun'),
    false,
  );
});

test('request_changes resumes the exact session with its payload in the prompt', async (t) => {
  const root = await projectRoot(t);
  const item = workItem({
    resume: {
      decisionId: 'decision-1',
      action: 'request_changes',
      payload: { instructions: 'Preserve the existing public API.' },
      sessionId: 'session-exact',
    },
  });
  const worker = fakeWorker({
    pendingDecisions: [pendingDecision({ action: 'request_changes' })],
    claim: claimed(root, { item, runValue: run({ sessionId: 'session-exact' }) }),
  });
  const adapter = fakeAdapter({
    ok: true,
    exitCode: 0,
    sessionId: 'session-exact',
    parsedEvents: 1,
  });
  const supervisor = createRemoteWorkerSupervisor({
    workerClient: worker,
    adapter,
    projectRoots: { 'project-1': root },
    heartbeatIntervalMs: 60_000,
  });

  const result = await supervisor.runOnce();

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.status, 'completed');
  const execution = adapter.calls.find(([name]) => name === 'run')?.[1];
  assert.equal(execution.mode, 'resume');
  assert.equal(execution.sessionId, 'session-exact');
  assert.equal(execution.projectRoot, root);
  assert.match(execution.prompt, /request_changes/);
  assert.match(execution.prompt, /Preserve the existing public API/);
  assert.match(execution.prompt, /SPECGATE_WAITING_FOR_USER/);
  assert.equal(execution.prompt.includes('C:\\cloud\\must-not-be-used'), false);
  const callNames = worker.calls.map(([name]) => name);
  assert.ok(
    callNames.indexOf('completeDecisionApply') < callNames.indexOf('reportEvents') &&
      callNames.indexOf('reportEvents') < callNames.indexOf('finishRun'),
  );
  const evidence = worker.calls.find(([name]) => name === 'reportEvents')?.[1];
  assert.equal(JSON.stringify(evidence).includes(root), false);
  const finished = worker.calls.find(([name]) => name === 'finishRun')?.[1];
  assert.equal(finished.status, 'COMPLETED');
  assert.equal(finished.outcome.delivery, null);
});

test('a Decision without its original session blocks without starting a replacement', async (t) => {
  const root = await projectRoot(t);
  const item = workItem({
    resume: {
      decisionId: 'decision-1',
      action: 'approve',
      payload: {},
      sessionId: null,
    },
  });
  const worker = fakeWorker({
    pendingDecisions: [pendingDecision()],
    claim: claimed(root, { item, runValue: run({ sessionId: null }) }),
  });
  const adapter = fakeAdapter({ ok: true, sessionId: 'replacement-must-not-start' });
  const supervisor = createRemoteWorkerSupervisor({
    workerClient: worker,
    adapter,
    projectRoots: { 'project-1': root },
  });

  const result = await supervisor.runOnce();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'RESUME_SESSION_REQUIRED');
  assert.equal(adapter.calls.length, 0);
  assert.ok(worker.calls.some(([name]) => name === 'failDecisionApply'));
  const finished = worker.calls.find(([name]) => name === 'finishRun')?.[1];
  assert.equal(finished.status, 'FAILED');
  assert.equal(finished.attention.type, 'FAILED');
  assert.match(finished.attention.artifactHash, /^[a-f0-9]{64}$/);
  const failedApply = worker.calls.find(([name]) => name === 'failDecisionApply')?.[1];
  assert.equal(failedApply.attention.artifactHash, finished.attention.artifactHash);
});

test('an adapter resume failure is reported as a failed Decision apply without fallback', async (t) => {
  const root = await projectRoot(t);
  const worker = fakeWorker({
    pendingDecisions: [pendingDecision()],
    claim: claimed(root),
  });
  const adapter = fakeAdapter({
    ok: false,
    code: 'RESUME_SESSION_REQUIRED',
    message: `Session is unavailable below ${root}`,
  });
  const supervisor = createRemoteWorkerSupervisor({
    workerClient: worker,
    adapter,
    projectRoots: { 'project-1': root },
  });

  const result = await supervisor.runOnce();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'RESUME_SESSION_REQUIRED');
  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0][0], 'run');
  assert.ok(worker.calls.some(([name]) => name === 'failDecisionApply'));
  assert.equal(JSON.stringify(result).includes(root), false);
  const finished = worker.calls.find(([name]) => name === 'finishRun')?.[1];
  assert.equal(finished.status, 'FAILED');
  assert.equal(finished.attention.type, 'FAILED');
});

test('a pending cancel Decision is completed without invoking Codex', async (t) => {
  const root = await projectRoot(t);
  const worker = fakeWorker({
    pendingDecisions: [pendingDecision({ action: 'cancel' })],
  });
  const adapter = fakeAdapter({ ok: true });
  const supervisor = createRemoteWorkerSupervisor({
    workerClient: worker,
    adapter,
    projectRoots: { 'project-1': root },
  });

  const result = await supervisor.runOnce();

  assert.equal(result.ok, true);
  assert.equal(result.status, 'idle');
  assert.equal(result.cancelled.length, 1);
  assert.equal(adapter.calls.length, 0);
  const completed = worker.calls.find(([name]) => name === 'completeDecisionApply')?.[1];
  assert.equal(completed.decisionId, 'decision-1');
  assert.equal(
    worker.calls.some(([name]) => name === 'finishRun'),
    false,
  );
});

test('idle claims never finish a Run and retain the sync cursor', async (t) => {
  const root = await projectRoot(t);
  const worker = fakeWorker({ syncCursor: { commands: 7, decisions: 'decision-7' } });
  const adapter = fakeAdapter({ ok: true });
  const supervisor = createRemoteWorkerSupervisor({
    workerClient: worker,
    adapter,
    projectRoots: { 'project-1': root },
  });

  const first = await supervisor.runOnce();
  const second = await supervisor.runOnce();

  assert.equal(first.status, 'idle');
  assert.equal(second.status, 'idle');
  assert.deepEqual(worker.calls.filter(([name]) => name === 'sync').at(-1)[1], {
    cursor: { commands: 7, decisions: 'decision-7' },
  });
  assert.equal(
    worker.calls.some(([name]) => name === 'finishRun'),
    false,
  );
  assert.equal(adapter.calls.length, 0);
});

test('heartbeats are serialized with session state and stop after execution cleanup', async (t) => {
  const root = await projectRoot(t);
  const worker = fakeWorker({ claim: claimed(root) });
  const adapter = fakeAdapter(
    { ok: true, exitCode: 0, sessionId: 'session-live', parsedEvents: 1 },
    {
      onRun(input) {
        input.onSession('session-live');
      },
    },
  );
  const supervisor = createRemoteWorkerSupervisor({
    workerClient: worker,
    adapter,
    projectRoots: { 'project-1': root },
    heartbeatIntervalMs: 5,
  });

  const result = await supervisor.runOnce();
  const heartbeatCount = worker.calls.filter(([name]) => name === 'heartbeat').length;
  await new Promise((resolve) => setTimeout(resolve, 30));
  const afterCleanup = worker.calls.filter(([name]) => name === 'heartbeat').length;

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(heartbeatCount >= 2);
  assert.equal(afterCleanup, heartbeatCount);
  assert.ok(
    worker.calls.some(
      ([name, input]) =>
        name === 'heartbeat' &&
        input.updates.sessionId === 'session-live' &&
        typeof input.updates.currentPhase === 'string' &&
        Number.isSafeInteger(input.expectedRunVersion),
    ),
  );
});

test('unknown projects fail closed even when the cloud claims an absolute path', async (t) => {
  const root = await projectRoot(t);
  const cloudPath = await projectRoot(t);
  const item = workItem({ projectId: 'project-cloud', projectRoot: cloudPath });
  const worker = fakeWorker({
    pendingDecisions: [pendingDecision({ projectId: 'project-cloud' })],
    claim: claimed(root, {
      item,
      runValue: run({ projectId: 'project-cloud' }),
    }),
  });
  const adapter = fakeAdapter({ ok: true });
  const supervisor = createRemoteWorkerSupervisor({
    workerClient: worker,
    adapter,
    projectRoots: { 'project-1': root },
  });

  const result = await supervisor.runOnce();

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORKER_PROJECT_ROOT_UNKNOWN');
  assert.equal(adapter.calls.length, 0);
  assert.ok(worker.calls.some(([name]) => name === 'failDecisionApply'));
  assert.equal(JSON.stringify(result).includes(cloudPath), false);
  const finished = worker.calls.find(([name]) => name === 'finishRun')?.[1];
  assert.equal(finished.status, 'FAILED');
  assert.equal(finished.attention.type, 'FAILED');
});

test('projectRoots reject relative and nonexistent local directories at startup', async (t) => {
  const root = await projectRoot(t);
  const worker = fakeWorker();
  const adapter = fakeAdapter({ ok: true });
  assert.throws(
    () =>
      createRemoteWorkerSupervisor({
        workerClient: worker,
        adapter,
        projectRoots: { 'project-1': 'relative/project' },
      }),
    /absolute/i,
  );
  assert.throws(
    () =>
      createRemoteWorkerSupervisor({
        workerClient: worker,
        adapter,
        projectRoots: { 'project-1': path.join(root, 'missing') },
      }),
    /existing directory/i,
  );
});
