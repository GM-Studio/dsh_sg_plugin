import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlSupervisor } from '../src/codex/control/supervisor.js';

function serviceFor(item, calls = []) {
  let current = { ...item };
  return {
    calls,
    async reconcile() {
      calls.push(['reconcile']);
      return { ok: true, changed: 0 };
    },
    async claimNext() {
      calls.push(['claimNext']);
      return {
        ok: true,
        workItem: current,
        run: { runId: 'run-1', revision: 1 },
        lease: { token: 'lease-1' },
      };
    },
    async heartbeat(input) {
      calls.push(['heartbeat', input.updates]);
      current = { ...current, revision: current.revision + 1 };
      return { ok: true, run: { ...input, revision: input.expectedRunVersion + 1 } };
    },
    async requestAttention(input) {
      calls.push(['requestAttention', input]);
      return {
        ok: true,
        attention: { requestId: 'attention-1' },
        workItem: { ...current, revision: current.revision + 1 },
      };
    },
    async finishRun(input) {
      calls.push(['finishRun', input]);
      return { ok: true };
    },
    async getWorkItem() {
      return { ok: true, workItem: current };
    },
  };
}

function adapter(result, calls = []) {
  return {
    async run(input) {
      calls.push(['run', input]);
      for (const event of result.events || []) input.onEvent?.(event);
      return result;
    },
  };
}

test('supervisor claims, heartbeats and finishes a completed execution', async () => {
  const calls = [];
  const service = serviceFor(
    {
      workItemId: 'work-1',
      title: 'Export',
      request: 'Implement export',
      projectId: 'project-1',
      revision: 2,
      executionState: 'RUNNING',
      resume: null,
      budget: {},
    },
    calls,
  );
  const supervisor = createControlSupervisor({
    service,
    adapter: adapter(
      {
        ok: true,
        exitCode: 0,
        sessionId: 'session-1',
        events: [{ type: 'command.started', command: 'npm test' }],
      },
      calls,
    ),
    ownerId: 'supervisor-1',
    clock: () => Date.parse('2026-10-22T10:00:00.000Z'),
    deliveryResolver: async () => ({
      ok: true,
      deliveryId: 'delivery-1',
      recordHash: 'b'.repeat(64),
      releaseState: 'release-approved',
      deliveryCommit: 'c'.repeat(40),
    }),
  });
  const result = await supervisor.runOnce();
  assert.equal(result.ok, true);
  assert.equal(result.status, 'completed');
  const finished = calls.find(([name]) => name === 'finishRun');
  assert.equal(finished[1].outcome.delivery.deliveryId, 'delivery-1');
  assert.ok(calls.some(([name]) => name === 'heartbeat'));
  const attention = calls.find(([name]) => name === 'requestAttention');
  assert.ok(attention[1].actions.includes('accept_delivery'));
});

test('supervisor passes the daemon control root to the project-bound execution', async () => {
  const calls = [];
  const service = serviceFor(
    {
      workItemId: 'work-1',
      title: 'Export',
      request: 'Implement export',
      projectId: 'project-1',
      projectRoot: '/work/product',
      revision: 2,
      executionState: 'RUNNING',
      resume: null,
      budget: {},
    },
    calls,
  );
  const supervisor = createControlSupervisor({
    service,
    adapter: adapter({ ok: true, exitCode: 0, sessionId: 'session-1' }, calls),
    controlRoot: '/srv/specgate-control',
    deliveryResolver: async () => ({ ok: false, code: 'DELIVERY_NOT_FOUND' }),
  });

  await supervisor.runOnce();

  const runCall = calls.find(([name]) => name === 'run');
  assert.equal(runCall[1].environment.SPECGATE_WORK_ITEM_ID, 'work-1');
  assert.equal(runCall[1].environment.SPECGATE_CONTROL_HOME, '/srv/specgate-control');
});

test('supervisor does not offer customer acceptance without a DeliveryRecord', async () => {
  const calls = [];
  const service = serviceFor(
    {
      workItemId: 'work-1',
      title: 'Export',
      request: 'Implement export',
      projectId: 'project-1',
      projectRoot: '/work/product',
      revision: 2,
      executionState: 'RUNNING',
      resume: null,
      budget: {},
    },
    calls,
  );
  const supervisor = createControlSupervisor({
    service,
    adapter: adapter({ ok: true, exitCode: 0, sessionId: 'session-1' }),
    deliveryResolver: async () => ({
      ok: false,
      code: 'DELIVERY_NOT_FOUND',
    }),
  });

  const result = await supervisor.runOnce();
  assert.equal(result.status, 'completed');
  const attention = calls.find(([name]) => name === 'requestAttention');
  assert.deepEqual(attention[1].actions, ['request_changes']);
  assert.match(attention[1].summary, /not available|no DeliveryRecord/i);
});

test('supervisor uses resume prompt after a consumed Decision', async () => {
  const calls = [];
  const service = serviceFor(
    {
      workItemId: 'work-1',
      title: 'Export',
      request: 'Implement export',
      projectId: 'project-1',
      revision: 3,
      executionState: 'RUNNING',
      resume: { action: 'approve', payload: {}, sessionId: 'session-1' },
      budget: {},
    },
    calls,
  );
  const supervisor = createControlSupervisor({
    service,
    adapter: adapter({ ok: true, exitCode: 0, sessionId: 'session-1' }, calls),
  });
  await supervisor.runOnce();
  const runCall = calls.find(([name]) => name === 'run');
  assert.equal(runCall[1].mode, 'resume');
  assert.match(runCall[1].prompt, /resume/i);
});

test('approved WorkItem without a prior session starts a new run with Decision context', async () => {
  const calls = [];
  const service = serviceFor(
    {
      workItemId: 'work-1',
      title: 'Export',
      request: 'Implement export',
      projectId: 'project-1',
      revision: 3,
      executionState: 'RUNNING',
      resume: { action: 'approve', payload: {}, sessionId: null },
      budget: {},
    },
    calls,
  );
  const supervisor = createControlSupervisor({
    service,
    adapter: adapter({ ok: true, exitCode: 0, sessionId: 'session-new' }, calls),
  });
  await supervisor.runOnce();
  const runCall = calls.find(([name]) => name === 'run');
  assert.equal(runCall[1].mode, 'start');
  assert.match(runCall[1].prompt, /Prior user Decision: approve/);
});

test('supervisor turns a waiting marker into AttentionRequest and does not finish the run', async () => {
  const calls = [];
  const service = serviceFor(
    {
      workItemId: 'work-1',
      title: 'Export',
      request: 'Implement export',
      projectId: 'project-1',
      revision: 2,
      executionState: 'RUNNING',
      resume: null,
      budget: {},
    },
    calls,
  );
  const marker = {
    type: 'H1_APPROVAL',
    reason: 'Confirm scope',
    question: 'Approve?',
    actions: ['approve', 'request_changes'],
    artifactHash: 'a'.repeat(64),
  };
  const supervisor = createControlSupervisor({
    service,
    adapter: adapter({
      ok: true,
      exitCode: 0,
      events: [
        { type: 'thread.started', thread_id: 'session-waiting' },
        {
          type: 'item.completed',
          item: {
            type: 'agent_message',
            text: `SPECGATE_WAITING_FOR_USER:${JSON.stringify(marker)}`,
          },
        },
      ],
    }),
  });
  const result = await supervisor.runOnce();
  assert.equal(result.ok, true);
  assert.equal(result.status, 'waiting');
  assert.ok(calls.some(([name]) => name === 'requestAttention'));
  assert.equal(
    calls.some(([name]) => name === 'finishRun'),
    false,
  );
  assert.ok(
    calls.some(
      ([name, updates]) => name === 'heartbeat' && updates?.sessionId === 'session-waiting',
    ),
  );
});

test('supervisor creates a failed AttentionRequest after unrecoverable execution failure', async () => {
  const calls = [];
  const service = serviceFor(
    {
      workItemId: 'work-1',
      title: 'Export',
      request: 'Implement export',
      projectId: 'project-1',
      revision: 2,
      executionState: 'RUNNING',
      resume: null,
      budget: { wallClockMs: 60000, maxModelTokens: 1000, maxToolCalls: 100 },
      budgetUsage: {},
    },
    calls,
  );
  const supervisor = createControlSupervisor({
    service,
    adapter: adapter({ ok: false, code: 'CODEX_EXECUTION_FAILED', exitCode: 1 }),
  });
  const result = await supervisor.runOnce();
  assert.equal(result.status, 'failed');
  const attention = calls.find(([name]) => name === 'requestAttention');
  assert.equal(attention[1].type, 'FAILED');
  assert.ok(calls.some(([name]) => name === 'finishRun'));
});

test('supervisor stops at a hard tool-call budget and creates a budget decision', async () => {
  const calls = [];
  const service = serviceFor(
    {
      workItemId: 'work-1',
      title: 'Export',
      request: 'Implement export',
      projectId: 'project-1',
      revision: 2,
      executionState: 'RUNNING',
      resume: null,
      budget: { wallClockMs: 60000, maxModelTokens: 1000, maxToolCalls: 1 },
      budgetUsage: {},
    },
    calls,
  );
  const supervisor = createControlSupervisor({
    service,
    adapter: adapter({
      ok: true,
      exitCode: 0,
      events: [
        { type: 'command.started', command: 'npm test' },
        { type: 'command.started', command: 'npm run build' },
      ],
    }),
  });
  const result = await supervisor.runOnce();
  assert.equal(result.status, 'waiting');
  const attention = calls.find(([name]) => name === 'requestAttention');
  assert.equal(attention[1].type, 'BUDGET');
  assert.match(attention[1].summary, /TOOL_CALL_BUDGET/);
  assert.match(attention[1].summary, /toolCalls/);
  assert.ok(attention[1].evidence.includes('budget:TOOL_CALL_BUDGET'));
});
