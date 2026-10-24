import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WORKER_COMMAND_KINDS,
  WORKER_ROUTES,
  createOutboundWorker,
} from '../src/codex/control/outbound-worker.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(repositoryRoot, 'src/codex/control/outbound-worker.js');
const command = (overrides = {}) => ({
  commandId: 'command-one',
  workerId: 'worker-one',
  sequence: 1,
  kind: 'APPLY_DECISION',
  dedupeKey: 'decision-one',
  fingerprint: 'a'.repeat(64),
  issuedBy: 'owner-one',
  issuedAt: '2026-10-24T00:00:00.000Z',
  ackedAt: null,
  payload: {
    workItemId: 'work-one',
    runId: 'run-one',
    decisionId: 'decision-one',
    artifactHash: 'b'.repeat(64),
    expectedVersion: 3,
  },
  ...overrides,
});

function response(body = {}, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function worker(fetchImpl, overrides = {}) {
  return createOutboundWorker({
    baseUrl: 'https://control.example.test/base/',
    token: 'worker-secret-token',
    fetchImpl,
    commandHandler: async () => ({ ok: true }),
    ...overrides,
  });
}

test('base URL validation allows loopback HTTP and rejects unsafe remote targets', () => {
  const safe = worker(async () => response(), { baseUrl: 'http://127.0.0.1:43120' });
  assert.equal(safe.routes.connect, WORKER_ROUTES.connect);
  for (const baseUrl of [
    'http://control.example.test',
    'ftp://control.example.test',
    'https://worker:secret@control.example.test',
    'https://control.example.test?token=secret',
    'https://control.example.test#fragment',
  ]) {
    assert.throws(() => worker(async () => response(), { baseUrl }), TypeError);
  }
  assert.throws(() => worker(async () => response(), { token: '   ' }), TypeError);
});

test('all public requests use only fixed HTTPS routes and a bearer header', async () => {
  const calls = [];
  const client = worker(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith(WORKER_ROUTES.sync)) return response({ cursor: 'cursor-2', commands: [] });
    return response({ ok: true });
  });
  await client.connect();
  await client.sync({ cursor: 'cursor-1', waitMs: 0 });
  await client.claim();
  await client.heartbeat({ state: 'idle' });
  await client.reportEvents([{ type: 'worker.ready' }]);
  await client.ackCommand('command-one');
  await client.release({ reason: 'idle' });
  await client.reportWaiting({
    runId: 'run-one',
    leaseToken: 'lease-one',
    sessionId: 'session-one',
    waiting: { type: 'H1_APPROVAL' },
  });
  await client.finishRun({ runId: 'run-one', leaseToken: 'lease-one', status: 'COMPLETED' });
  await client.beginDecisionApply({ decisionId: 'decision-one', workItemId: 'work-one' });
  await client.completeDecisionApply({ decisionId: 'decision-one', workItemId: 'work-one' });
  await client.failDecisionApply({
    decisionId: 'decision-one',
    workItemId: 'work-one',
    error: 'session unavailable',
  });

  const expected = [
    WORKER_ROUTES.connect,
    WORKER_ROUTES.sync,
    WORKER_ROUTES.claim,
    WORKER_ROUTES.heartbeat,
    WORKER_ROUTES.events,
    WORKER_ROUTES.ack,
    WORKER_ROUTES.release,
    WORKER_ROUTES.reportWaiting,
    WORKER_ROUTES.finishRun,
    WORKER_ROUTES.beginDecisionApply,
    WORKER_ROUTES.completeDecisionApply,
    WORKER_ROUTES.failDecisionApply,
  ];
  assert.deepEqual(
    calls.map(({ url }) => new URL(url).pathname),
    expected.map((route) => `/base/${route}`),
  );
  for (const call of calls) {
    assert.ok(call.url.startsWith('https://control.example.test/base/'));
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.authorization, 'Bearer worker-secret-token');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.body.includes('worker-secret-token'), false);
    assert.equal(call.url.includes('worker-secret-token'), false);
  }
});

test('start reconnects with bounded jittered backoff and stops on token revocation', async () => {
  const delays = [];
  const lifecycle = [];
  let attempt = 0;
  const client = worker(
    async () => {
      attempt += 1;
      if (attempt === 1) return response({ code: 'UNAVAILABLE' }, 503);
      if (attempt === 2) throw new Error('network unavailable');
      return response({ code: 'WORKER_REVOKED' }, 401);
    },
    {
      pollIntervalMs: 10,
      maxBackoffMs: 40,
      random: () => 0.5,
      sleepImpl: async (delay) => {
        delays.push(delay);
      },
      eventHandler: async (event) => {
        lifecycle.push(event);
      },
    },
  );

  const started = client.start();
  assert.equal(started.running, true);
  const outcome = await started.done;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'WORKER_AUTHENTICATION_FAILED');
  assert.deepEqual(delays, [8, 15]);
  assert.deepEqual(
    lifecycle.map(({ type }) => type),
    ['worker.transport_error', 'worker.transport_error', 'worker.authentication_failure'],
  );
  assert.equal(client.status().stopped, true);
  assert.equal(client.start().code, 'WORKER_STOPPED');
});

test('request timeout is bounded and stop aborts an in-flight request', async () => {
  const timed = worker(
    async (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
    { requestTimeoutMs: 5 },
  );
  const timeout = await timed.runOnce();
  assert.equal(timeout.ok, false);
  assert.equal(timeout.code, 'WORKER_REQUEST_TIMEOUT');

  let requestSignal;
  const stopped = worker(async (_url, { signal }) => {
    requestSignal = signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('stop aborted request')));
    });
  });
  const started = stopped.start();
  await Promise.resolve();
  assert.equal(requestSignal.aborted, false);
  const cleanup = await stopped.stop();
  assert.equal(cleanup.stopped, true);
  assert.equal(requestSignal.aborted, true);
  assert.equal((await started.done).stopped, true);
  assert.equal((await stopped.stop()).stopped, true);
});

test('start never creates concurrent poll loops', async () => {
  let calls = 0;
  const client = worker(async (_url, { signal }) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () =>
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      );
    });
  });
  const first = client.start();
  const second = client.start();
  assert.equal(second.alreadyRunning, true);
  assert.equal(second.done, first.done);
  await Promise.resolve();
  assert.equal(calls, 1);
  await client.stop();
});

test('duplicate command replay invokes the handler once and acks after reporting', async () => {
  let handlerCalls = 0;
  let ackCalls = 0;
  let reportCalls = 0;
  const client = worker(
    async (url, options) => {
      if (url.endsWith(WORKER_ROUTES.connect)) return response({ cursor: 'c0' });
      if (url.endsWith(WORKER_ROUTES.sync)) {
        return response({
          commands: [command(), command()],
          cursor: { commands: 11, decisions: 'decision-cursor-1' },
          pendingDecisions: [
            {
              decisionId: 'decision-one',
              workItemId: 'work-one',
              projectId: 'project-one',
              status: 'PENDING_APPLY',
            },
          ],
        });
      }
      if (url.endsWith(WORKER_ROUTES.events)) {
        reportCalls += 1;
        assert.deepEqual(
          JSON.parse(options.body).events.map(({ type, commandId, ok }) => [type, commandId, ok]),
          [['command.result', 'command-one', true]],
        );
        return response({ accepted: true });
      }
      if (url.endsWith(WORKER_ROUTES.ack)) {
        ackCalls += 1;
        assert.deepEqual(JSON.parse(options.body), { commandId: 'command-one' });
        return response({ acknowledged: true });
      }
      assert.fail(`unexpected route ${url}`);
    },
    {
      commandHandler: async (validated) => {
        handlerCalls += 1;
        assert.equal(Object.isFrozen(validated), true);
        assert.deepEqual(Object.keys(validated), ['commandId', 'kind', 'payload']);
        return { ok: true, decisionId: validated.payload.decisionId };
      },
    },
  );

  const result = await client.runOnce();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.cursor, { commands: 11, decisions: 'decision-cursor-1' });
  assert.equal(result.pendingDecisions[0].decisionId, 'decision-one');
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 1);
  assert.equal(handlerCalls, 1);
  assert.equal(reportCalls, 1);
  assert.equal(ackCalls, 1);
});

test('handler failure is reported without an ack and is not rerun in the same process', async () => {
  let handlerCalls = 0;
  let ackCalls = 0;
  const failures = [];
  let syncCalls = 0;
  const client = worker(
    async (url, options) => {
      if (url.endsWith(WORKER_ROUTES.connect)) return response({});
      if (url.endsWith(WORKER_ROUTES.sync)) {
        syncCalls += 1;
        return response({ cursor: `c${syncCalls}`, commands: [command()] });
      }
      if (url.endsWith(WORKER_ROUTES.events)) {
        failures.push(...JSON.parse(options.body).events);
        return response({ accepted: true });
      }
      if (url.endsWith(WORKER_ROUTES.ack)) {
        ackCalls += 1;
        return response({});
      }
      assert.fail(`unexpected route ${url}`);
    },
    {
      commandHandler: async () => {
        handlerCalls += 1;
        throw Object.assign(new Error('handler exploded with worker-secret-token'), {
          code: 'APPLY_FAILED',
        });
      },
    },
  );

  const first = await client.runOnce();
  const replay = await client.runOnce();
  assert.equal(first.ok, true);
  assert.equal(first.failed, 1);
  assert.equal(first.cursor, 'c1');
  assert.equal(replay.ok, true);
  assert.equal(replay.skipped, 1);
  assert.equal(replay.cursor, 'c2');
  assert.equal(handlerCalls, 1);
  assert.equal(ackCalls, 0);
  assert.equal(failures.length, 2);
  assert.equal(failures[0].error.code, 'APPLY_FAILED');
  assert.doesNotMatch(JSON.stringify(failures), /worker-secret-token/);
});

test('unknown and shell-like commands are reported but never passed to the handler', async () => {
  const reported = [];
  const client = worker(
    async (url, options) => {
      if (url.endsWith(WORKER_ROUTES.connect)) return response({});
      if (url.endsWith(WORKER_ROUTES.sync)) {
        return response({
          cursor: 'rejected',
          commands: [
            command({ commandId: 'unknown', kind: 'RUN_ANYTHING' }),
            command({ commandId: 'shell-kind', kind: 'SHELL' }),
            command({
              commandId: 'shell-payload',
              kind: 'APPLY_DECISION',
              payload: { 'exec-command': 'Remove-Item -Recurse .' },
            }),
            command({
              commandId: 'callback',
              kind: 'APPLY_DECISION',
              payload: { callbackUrl: 'https://attacker.example.test' },
            }),
          ],
        });
      }
      if (url.endsWith(WORKER_ROUTES.events)) {
        reported.push(...JSON.parse(options.body).events);
        return response({});
      }
      if (url.endsWith(WORKER_ROUTES.ack)) assert.fail('rejected commands must not be acked');
      assert.fail(`unexpected route ${url}`);
    },
    {
      commandHandler: async () => assert.fail('rejected commands must not execute'),
    },
  );

  const result = await client.runOnce();
  assert.equal(result.ok, true);
  assert.equal(result.rejected, 4);
  assert.deepEqual(
    reported.map(({ error }) => error.code),
    [
      'WORKER_COMMAND_KIND_INVALID',
      'WORKER_COMMAND_KIND_INVALID',
      'COMMAND_SHELL_REJECTED',
      'COMMAND_REMOTE_DESTINATION_REJECTED',
    ],
  );
});

test('all canonical worker-contract command kinds reach the handler without shell access', async () => {
  const handled = [];
  const acknowledged = [];
  const commands = [
    command({ commandId: 'claim-command', kind: 'CLAIM', payload: {} }),
    command({
      commandId: 'operation-command',
      kind: 'RUN_TYPED_OPERATION',
      payload: {
        workItemId: 'work-one',
        runId: 'run-one',
        operation: { type: 'repo.inspect', input: { scope: 'status' } },
      },
    }),
    command({
      commandId: 'evidence-command',
      kind: 'UPLOAD_EVIDENCE',
      payload: {
        workItemId: 'work-one',
        runId: 'run-one',
        eventIds: ['event-one'],
        artifactHash: 'c'.repeat(64),
      },
    }),
    command({ commandId: 'decision-command', kind: 'APPLY_DECISION' }),
    command({
      commandId: 'release-command',
      kind: 'RELEASE_LEASE',
      payload: { workItemId: 'work-one', runId: 'run-one' },
    }),
    command({
      commandId: 'stop-command',
      kind: 'STOP',
      payload: { runId: 'run-one', reason: 'cancelled' },
    }),
  ];
  const client = worker(
    async (url, options) => {
      if (url.endsWith(WORKER_ROUTES.connect)) return response({});
      if (url.endsWith(WORKER_ROUTES.sync)) {
        return response({ commands, cursor: { commands: 6, decisions: '' } });
      }
      if (url.endsWith(WORKER_ROUTES.events)) return response({ accepted: 1 });
      if (url.endsWith(WORKER_ROUTES.ack)) {
        acknowledged.push(JSON.parse(options.body).commandId);
        return response({ acknowledged: true });
      }
      assert.fail(`unexpected route ${url}`);
    },
    {
      commandHandler: async (validated) => {
        handled.push(validated);
        return { ok: true };
      },
    },
  );

  const result = await client.runOnce();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    handled.map(({ kind }) => kind),
    WORKER_COMMAND_KINDS,
  );
  assert.deepEqual(acknowledged, [
    'claim-command',
    'operation-command',
    'evidence-command',
    'decision-command',
    'release-command',
    'stop-command',
  ]);
});

test('event uploads are chunked to the bounded batch size', async () => {
  const batches = [];
  const client = worker(async (url, options) => {
    if (url.endsWith(WORKER_ROUTES.events)) {
      batches.push(JSON.parse(options.body).events);
      return response({ accepted: true });
    }
    assert.fail(`unexpected route ${url}`);
  });
  const result = await client.reportEvents(
    Array.from({ length: 205 }, (_, index) => ({ type: 'evidence', index })),
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [100, 100, 5],
  );
});

test('M4 request methods reject unbounded payloads before any network request', async () => {
  let calls = 0;
  const client = worker(async () => {
    calls += 1;
    return response({ ok: true });
  });
  const oversized = {
    runId: 'run-one',
    outcome: 'x'.repeat(65 * 1024),
  };
  for (const method of [
    'reportWaiting',
    'finishRun',
    'beginDecisionApply',
    'completeDecisionApply',
    'failDecisionApply',
  ]) {
    const invalidType = await client[method](null);
    assert.equal(invalidType.ok, false);
  }
  const tooLarge = await client.finishRun(oversized);
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.retryable, false);
  assert.equal(calls, 0);
});

test('static transport contract has no listener or arbitrary URL callback parameter', async () => {
  const source = await fs.readFile(sourcePath, 'utf8');
  assert.doesNotMatch(source, /\b(?:createServer|listen)\s*\(/);
  assert.doesNotMatch(source, /\b(?:callbackUrl|connectUrl|eventsUrl|nextUrl|pollUrl)\b/);
  assert.doesNotMatch(source, /fetchImpl\s*\(\s*(?:response|data|command|event)\./);
  assert.deepEqual(Object.keys(WORKER_ROUTES), [
    'connect',
    'sync',
    'claim',
    'heartbeat',
    'events',
    'ack',
    'release',
    'reportWaiting',
    'finishRun',
    'beginDecisionApply',
    'completeDecisionApply',
    'failDecisionApply',
  ]);
  assert.deepEqual(WORKER_COMMAND_KINDS, [
    'CLAIM',
    'RUN_TYPED_OPERATION',
    'UPLOAD_EVIDENCE',
    'APPLY_DECISION',
    'RELEASE_LEASE',
    'STOP',
  ]);
});
