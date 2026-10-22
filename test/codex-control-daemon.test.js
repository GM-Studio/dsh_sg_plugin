import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startControlDaemon } from '../src/codex/control/daemon.js';
import { runControlCli } from '../scripts/specgate-control.mjs';
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';
import { localControlEnvironment } from '../src/codex/control/config.js';

test('control daemon starts management independently and stops without deleting state', async (t) => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-daemon-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-daemon-project-'));
  const daemon = await startControlDaemon({
    env: {
      ...process.env,
      SPECGATE_CONTROL_HOME: controlRoot,
      SPECGATE_PROJECT_ROOT: projectRoot,
    },
    projectRoot,
    managementPort: 0,
    pollMs: 60000,
    adapter: {
      async run() {
        return { ok: true, exitCode: 0, sessionId: 'session-test' };
      },
    },
  });
  t.after(() => daemon.stop());
  assert.equal(daemon.ok, true);
  assert.match(daemon.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(fs.existsSync(daemon.statusPath), true);
  assert.equal(
    JSON.parse(fs.readFileSync(daemon.statusPath, 'utf8')).projectRoot,
    path.resolve(projectRoot),
  );
  const paired = await fetch(`${daemon.baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: new URL(daemon.pairingUrl).hash.split('token=')[1] }),
  });
  assert.equal(paired.status, 200);
  const status = await runControlCli({
    args: ['status'],
    env: { ...process.env, SPECGATE_CONTROL_HOME: controlRoot },
  });
  assert.equal(status.ok, true);
  assert.equal(status.running, true);
  await daemon.stop();
});

test('control CLI exposes help and generates MFA material without writing config', async () => {
  const help = await runControlCli({ args: ['help'], env: {} });
  assert.equal(help.ok, true);
  assert.ok(help.usage.some((line) => line.includes('specgate-control start')));
  const mfa = await runControlCli({ args: ['mfa'], env: {} });
  assert.equal(mfa.ok, true);
  assert.match(mfa.secret, /^[A-Z2-7]+$/);
  assert.match(mfa.otpauth, /^otpauth:\/\/totp\//);
});

test('control CLI doctor reports portable launch readiness without leaking secrets', async () => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-doctor-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-doctor-project-'));
  const calls = [];
  const result = await runControlCli({
    args: ['doctor', '--project', projectRoot],
    env: {
      ...process.env,
      SPECGATE_CONTROL_HOME: controlRoot,
      SPECGATE_CODEX_COMMAND: 'codex-portable',
      SPECGATE_CODEX_HOME: '/portable/codex-home',
      SPECGATE_FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/secret',
      SPECGATE_MFA_SECRET: 'ABCDEFGHIJKLMNOP',
    },
    platform: 'linux',
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'codex-cli 9.9.9\n', stderr: '' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.platform, 'linux');
  assert.equal(result.codex.command, 'codex-portable');
  assert.equal(result.codex.version, 'codex-cli 9.9.9');
  assert.equal(result.isolation.controlSecretsExcluded, true);
  assert.equal(calls[0].options.env.CODEX_HOME, '/portable/codex-home');
  assert.equal(Object.hasOwn(calls[0].options.env, 'SPECGATE_FEISHU_WEBHOOK_URL'), false);
  assert.equal(Object.hasOwn(calls[0].options.env, 'SPECGATE_MFA_SECRET'), false);
  assert.doesNotMatch(JSON.stringify(result), /hook\/secret|ABCDEFGHIJKLMNOP/);
});

test('control CLI create uses the project bound by the running daemon', async () => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-bound-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-bound-project-'));
  fs.writeFileSync(
    path.join(controlRoot, 'daemon.json'),
    JSON.stringify({
      pid: process.pid,
      controlRoot,
      projectRoot,
      managementBaseUrl: 'http://127.0.0.1:43120',
    }),
  );

  const result = await runControlCli({
    args: ['create', '--title', 'Bound project', '--request', 'Use the daemon binding'],
    env: { ...process.env, SPECGATE_CONTROL_HOME: controlRoot },
    cwd: path.resolve('.'),
    runtimeFactory: () => ({
      service: {
        async createWorkItem(input) {
          return { ok: true, workItem: { projectRoot: input.projectRoot } };
        },
      },
    }),
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.workItem.projectRoot, projectRoot);
});

test('control CLI uses SPECGATE_PROJECT_ROOT when no daemon binding is active', async () => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-env-bound-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-env-project-'));

  const result = await runControlCli({
    args: ['create', '--title', 'Environment project', '--request', 'Use the process binding'],
    env: {
      ...process.env,
      SPECGATE_CONTROL_HOME: controlRoot,
      SPECGATE_PROJECT_ROOT: projectRoot,
    },
    cwd: path.resolve('.'),
    runtimeFactory: () => ({
      service: {
        async createWorkItem(input) {
          return { ok: true, workItem: { projectRoot: input.projectRoot } };
        },
      },
    }),
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.workItem.projectRoot, projectRoot);
});

test('control CLI refuses to silently rebind an already running daemon project', async () => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-rebind-'));
  const firstProject = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-rebind-first-'));
  const secondProject = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-rebind-second-'));
  fs.writeFileSync(
    path.join(controlRoot, 'daemon.json'),
    JSON.stringify({
      pid: process.pid,
      controlRoot,
      projectRoot: firstProject,
      managementBaseUrl: 'http://127.0.0.1:43120',
    }),
  );

  const result = await runControlCli({
    args: ['start', '--project', secondProject],
    env: { ...process.env, SPECGATE_CONTROL_HOME: controlRoot },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'PROJECT_BINDING_CONFLICT');
});

test('daemon dispatches open AttentionRequest through Feishu Outbox without blocking state', async (t) => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-notify-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-notify-project-'));
  const env = {
    ...process.env,
    SPECGATE_CONTROL_HOME: controlRoot,
    SPECGATE_PROJECT_ROOT: projectRoot,
  };
  const store = createControlStore({ root: controlRoot });
  let next = 0;
  const service = createControlService({
    store,
    randomId: () => `notify-${++next}`,
  });
  const runtime = {
    config: localControlEnvironment(env),
    store,
    service,
  };
  const sent = [];
  const daemon = await startControlDaemon({
    env,
    runtime,
    projectRoot,
    managementPort: 0,
    maxConcurrent: 1,
    pollMs: 60000,
    adapter: {
      async run() {
        return { ok: true, exitCode: 0 };
      },
    },
    feishuNotifier: {
      async send(message) {
        sent.push(message);
        return { ok: true, receipt: { messageId: 'message-1' } };
      },
    },
  });
  t.after(() => daemon.stop());
  const created = await service.createWorkItem({
    title: 'Export',
    request: 'Implement export',
    projectRoot,
  });
  const attention = await service.requestAttention({
    workItemId: created.workItem.workItemId,
    expectedVersion: created.workItem.revision,
    type: 'H1_APPROVAL',
    reason: 'Confirm scope',
    question: 'Approve?',
    actions: ['approve', 'request_changes'],
    artifactHash: 'a'.repeat(64),
  });
  assert.equal(attention.ok, true);
  const dispatched = await daemon.dispatchAttention();
  assert.equal(dispatched.ok, true);
  assert.equal(dispatched.dispatched, 1);
  const drained = await daemon.outbox.drain();
  assert.equal(drained.ok, true);
  assert.equal(drained.sent, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].managementUrl, /#attention=/);
  const current = await service.projection.getWorkItem(created.workItem.workItemId);
  assert.equal(current.workItem.executionState, 'WAITING_FOR_USER');
  assert.equal(current.attention.status, 'DELIVERED');
  const decided = await service.decide({
    workItemId: created.workItem.workItemId,
    attentionId: attention.attention.requestId,
    attentionRevision: attention.attention.revision,
    expectedWorkItemVersion: attention.workItem.revision,
    artifactHash: 'a'.repeat(64),
    action: 'approve',
    idempotencyKey: 'notify-approve-1',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
  });
  assert.equal(decided.ok, true);
  const resolved = await daemon.dispatchResolutions();
  assert.equal(resolved.ok, true);
  assert.equal(resolved.dispatched, 1);
  const resolutionDrain = await daemon.outbox.drain();
  assert.equal(resolutionDrain.sent, 1);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].notification.kind, 'resolution');
  assert.equal(sent[1].notification.status, 'DECIDED');
});

test('daemon background loop claims queued WorkItems without an external tick', async (t) => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-loop-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-loop-project-'));
  const env = {
    ...process.env,
    SPECGATE_CONTROL_HOME: controlRoot,
    SPECGATE_PROJECT_ROOT: projectRoot,
  };
  const store = createControlStore({ root: controlRoot });
  let next = 0;
  const service = createControlService({
    store,
    randomId: () => `loop-${++next}`,
  });
  const created = await service.createWorkItem({
    title: 'Loop',
    request: 'Process without manual tick',
    projectRoot,
  });
  assert.equal(created.ok, true);
  const daemon = await startControlDaemon({
    env,
    runtime: { config: localControlEnvironment(env), store, service },
    projectRoot,
    managementPort: 0,
    maxConcurrent: 1,
    pollMs: 1000,
    adapter: {
      async run() {
        return { ok: true, exitCode: 0, sessionId: 'loop-session' };
      },
    },
  });
  t.after(() => daemon.stop());
  let current;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    current = await service.projection.getWorkItem(created.workItem.workItemId);
    if (current.attention || current.workItem.executionState === 'FAILED') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(current.ok, true);
  assert.equal(current.attention.type, 'COMPLETION');
});

test('file-based stop request shuts down without relying on Unix signals', async (t) => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-stop-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-stop-project-'));
  const daemon = await startControlDaemon({
    env: {
      ...process.env,
      SPECGATE_CONTROL_HOME: controlRoot,
      SPECGATE_PROJECT_ROOT: projectRoot,
    },
    projectRoot,
    managementPort: 0,
    maxConcurrent: 1,
    pollMs: 20,
    adapter: {
      async run() {
        return { ok: true, exitCode: 0, sessionId: 'stop-session' };
      },
    },
  });
  t.after(() => daemon.stop());
  fs.writeFileSync(daemon.stopRequestPath, '{"requested":true}\n');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!daemon.management.server.listening) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(daemon.management.server.listening, false);
  assert.equal(fs.existsSync(daemon.stopRequestPath), false);
});
