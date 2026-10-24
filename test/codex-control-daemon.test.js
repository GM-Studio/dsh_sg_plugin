import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startControlDaemon } from '../src/codex/control/daemon.js';
import { runControlCli } from '../scripts/specgate-control.mjs';

function remoteAuthService() {
  return {
    async login() {
      return {
        ok: true,
        token: 'remote-session',
        csrfToken: 'remote-csrf',
        expiresAt: Date.now() + 60000,
        user: { userId: 'owner-1', username: 'owner', role: 'owner' },
        device: { deviceId: 'device-1', name: 'Phone', status: 'ACTIVE' },
      };
    },
    async authenticate({ token }) {
      return token === 'remote-session'
        ? {
            ok: true,
            session: {
              sessionId: 'session-1',
              userId: 'owner-1',
              deviceId: 'device-1',
              csrfHash: '0'.repeat(64),
              authLevel: 'session',
              createdAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 60000).toISOString(),
            },
            user: { userId: 'owner-1', username: 'owner', role: 'owner' },
            device: { deviceId: 'device-1', name: 'Phone', status: 'ACTIVE' },
          }
        : { ok: false, code: 'UNAUTHORIZED' };
    },
    verifyCsrf: () => false,
    beginStepUp: async () => ({ ok: true }),
    completeStepUp: async () => ({ ok: true }),
    authorizeStepUp: async () => ({ ok: true }),
    listDevices: async () => ({ ok: true, devices: [] }),
    revokeDevice: async () => ({ ok: true }),
    logout: async () => ({ ok: true }),
    redeemAttentionNonce: async () => ({ ok: true }),
    createAttentionNonce: async () => ({ ok: true, nonce: 'nonce-1' }),
  };
}

function workerGateway() {
  return {
    register: async () => ({ ok: true, worker: { workerId: 'worker-1' }, token: 'sgw_test' }),
    rotateToken: async () => ({ ok: true, token: 'sgw_rotated' }),
    revoke: async () => ({ ok: true }),
    listWorkers: async () => ({ ok: true, workers: [] }),
    setProjects: async () => ({ ok: true, projectIds: [] }),
    connect: async () => ({ ok: true, heartbeatIntervalMs: 15000 }),
    sync: async () => ({ ok: true, commands: [], pendingDecisions: [], cursor: 0 }),
    claim: async () => ({ ok: true, idle: true }),
    heartbeat: async () => ({ ok: true }),
    reportEvents: async () => ({ ok: true }),
    pullCommands: async () => ({ ok: true, commands: [], cursor: 0 }),
    ackCommand: async () => ({ ok: true }),
    release: async () => ({ ok: true }),
    issueCommand: async () => ({ ok: true }),
    reportWaiting: async () => ({ ok: true }),
    finishRun: async () => ({ ok: true }),
    beginDecisionApply: async () => ({ ok: true }),
    completeDecisionApply: async () => ({ ok: true }),
    failDecisionApply: async () => ({ ok: false }),
  };
}
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';
import {
  CONTROL_MODE_ENV,
  localControlEnvironment,
  resolveControlEnvironment,
} from '../src/codex/control/config.js';

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
  const daemonStatus = JSON.parse(fs.readFileSync(daemon.statusPath, 'utf8'));
  assert.equal(daemonStatus.workerApiConfigured, true);
  assert.equal(daemonStatus.workerStorage, 'memory');
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
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const workers = await fetch(`${daemon.baseUrl}/api/workers`, { headers: { cookie } });
  assert.equal(workers.status, 200);
  assert.deepEqual((await workers.json()).workers, []);
  const status = await runControlCli({
    args: ['status'],
    env: { ...process.env, SPECGATE_CONTROL_HOME: controlRoot },
  });
  assert.equal(status.ok, true);
  assert.equal(status.running, true);
  await daemon.stop();
});

test('remote management daemon refuses incomplete deployment configuration before startup', async () => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-remote-invalid-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-remote-invalid-project-'));
  const daemon = await startControlDaemon({
    env: {
      ...process.env,
      SPECGATE_CONTROL_HOME: controlRoot,
      SPECGATE_PROJECT_ROOT: projectRoot,
      SPECGATE_MANAGEMENT_DEPLOYMENT_MODE: 'remote',
      SPECGATE_MANAGEMENT_PUBLIC_URL: 'https://control.example.test',
      SPECGATE_MANAGEMENT_ALLOWED_HOSTS: 'control.example.test',
      SPECGATE_MANAGEMENT_ALLOWED_ORIGINS: 'https://control.example.test',
      SPECGATE_MYSQL_CONFIG: path.join(controlRoot, 'mysql-config-placeholder.json'),
      SPECGATE_AUTH_ENCRYPTION_KEY: 'a'.repeat(64),
      SPECGATE_AUTH_DEVICE_CONFIRMATION_CODE_HASH: 'b'.repeat(64),
    },
    projectRoot,
    managementPort: 0,
    pollMs: 60000,
    adapter: {
      async run() {
        return { ok: true, exitCode: 0, sessionId: 'remote-invalid-session' };
      },
    },
  });
  assert.equal(daemon.ok, false);
  assert.equal(daemon.code, 'REMOTE_MODE_CONFIG_INVALID');
  assert.equal(fs.existsSync(path.join(controlRoot, 'daemon.json')), false);
});

test('remote management daemon starts only behind a configured HTTPS proxy boundary', async (t) => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-remote-valid-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-remote-valid-project-'));
  const daemon = await startControlDaemon({
    env: {
      ...process.env,
      SPECGATE_CONTROL_HOME: controlRoot,
      SPECGATE_PROJECT_ROOT: projectRoot,
      SPECGATE_MANAGEMENT_DEPLOYMENT_MODE: 'remote',
      SPECGATE_MANAGEMENT_PUBLIC_URL: 'https://control.example.test',
      SPECGATE_MANAGEMENT_ALLOWED_HOSTS: 'control.example.test',
      SPECGATE_MANAGEMENT_ALLOWED_ORIGINS: 'https://control.example.test',
      SPECGATE_MANAGEMENT_TRUSTED_PROXIES: '127.0.0.1',
      SPECGATE_MYSQL_CONFIG: path.join(controlRoot, 'mysql-config-placeholder.json'),
      SPECGATE_AUTH_ENCRYPTION_KEY: 'a'.repeat(64),
      SPECGATE_AUTH_DEVICE_CONFIRMATION_CODE_HASH: 'b'.repeat(64),
    },
    projectRoot,
    managementPort: 0,
    pollMs: 60000,
    authService: remoteAuthService(),
    workerGateway: workerGateway(),
    adapter: {
      async run() {
        return { ok: true, exitCode: 0, sessionId: 'remote-valid-session' };
      },
    },
  });
  t.after(() => daemon.stop());
  assert.equal(daemon.ok, true);
  const forged = await fetch(`${daemon.baseUrl}/api/health`, {
    headers: { 'x-forwarded-proto': 'https', origin: 'https://control.example.test' },
  });
  assert.equal(forged.status, 400);
  assert.equal((await forged.json()).code, 'HOST_NOT_ALLOWED');
});

test('control CLI exposes help and generates MFA material without writing config', async () => {
  const help = await runControlCli({ args: ['help'], env: {} });
  assert.equal(help.ok, true);
  assert.ok(help.usage.some((line) => line.includes('specgate-control start')));
  assert.ok(help.usage.some((line) => line.includes('specgate-control auth-init')));
  const mfa = await runControlCli({ args: ['mfa'], env: {} });
  assert.equal(mfa.ok, true);
  assert.match(mfa.secret, /^[A-Z2-7]+$/);
  assert.match(mfa.otpauth, /^otpauth:\/\/totp\//);
  const missingAuthInput = await runControlCli({ args: ['auth-init'], env: {} });
  assert.equal(missingAuthInput.ok, false);
  assert.equal(missingAuthInput.code, 'AUTH_INPUT_REQUIRED');
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

test('a second project registers without clobbering the first and re-registration is idempotent', async () => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-registry-'));
  const projectA = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-registry-a-'));
  const projectB = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-registry-b-'));
  const store = createControlStore({ root: controlRoot });
  const service = createControlService({ store });

  const first = await service.registerProject({ projectRoot: projectA, mode: 'aggregate' });
  assert.equal(first.ok, true);
  const second = await service.registerProject({ projectRoot: projectB, mode: 'isolated' });
  assert.equal(second.ok, true);
  assert.notEqual(first.projectId, second.projectId);

  const registry = await service.projection.listRegistry();
  assert.equal(registry.ok, true);
  assert.equal(registry.projects.length, 2);
  const roots = registry.projects.map((row) => row.projectRoot);
  assert.ok(roots.includes(fs.realpathSync(projectA)));
  assert.ok(roots.includes(fs.realpathSync(projectB)));
  assert.equal(
    registry.projects.find((row) => row.projectId === first.projectId).mode,
    'aggregate',
  );
  assert.equal(
    registry.projects.find((row) => row.projectId === second.projectId).mode,
    'isolated',
  );

  // Re-registering the same project is idempotent and appends nothing.
  const again = await service.registerProject({ projectRoot: projectA, mode: 'aggregate' });
  assert.equal(again.ok, true);
  assert.equal(again.registered, false);
  assert.equal(again.project.projectRoot, fs.realpathSync(projectA));
  const after = await service.projection.listRegistry();
  assert.equal(after.projects.length, 2);

  // An invalid mode fails closed and leaves the registry unchanged.
  const invalid = await service.registerProject({ projectRoot: projectA, mode: 'nope' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'MODE_INVALID');
  assert.equal((await service.projection.listRegistry()).projects.length, 2);
});

test('aggregate mode serves several registered projects under one global concurrency limit', async (t) => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-agg-'));
  const projectA = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-agg-a-'));
  const projectB = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-agg-b-'));
  const env = {
    ...process.env,
    SPECGATE_CONTROL_HOME: controlRoot,
    SPECGATE_PROJECT_ROOT: projectA,
  };
  const store = createControlStore({ root: controlRoot });
  let next = 0;
  const service = createControlService({ store, randomId: () => `agg-${++next}` });
  const created = await Promise.all([
    service.createWorkItem({ title: 'A', request: 'a', projectRoot: projectA }),
    service.createWorkItem({ title: 'B', request: 'b', projectRoot: projectB }),
  ]);
  assert.equal(created[0].ok, true);
  assert.equal(created[1].ok, true);

  const gates = [];
  const started = [];
  const adapter = {
    async run({ projectRoot }) {
      started.push(projectRoot);
      await new Promise((resolve) => gates.push(resolve));
      return { ok: true, exitCode: 0, sessionId: 'agg-session' };
    },
  };
  const daemon = await startControlDaemon({
    env,
    runtime: { config: localControlEnvironment(env), store, service },
    projectRoot: projectA,
    mode: 'aggregate',
    maxConcurrent: 1,
    pollMs: 60000,
    adapter,
  });
  t.after(async () => {
    for (const release of gates.splice(0)) release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await daemon.stop();
  });
  assert.equal(daemon.ok, true);
  assert.equal(daemon.mode, 'aggregate');
  assert.equal(daemon.concurrencyLimit, 1);
  assert.equal(daemon.registration.ok, true);

  for (let attempt = 0; attempt < 100 && started.length < 1; attempt += 1)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(started.length, 1, 'the global limit starts only one project');
  const inspected = await service.inspect();
  const states = Object.values(inspected.state.workItems).map((item) => item.executionState);
  assert.equal(states.filter((state) => state === 'RUNNING').length, 1);
  assert.equal(states.filter((state) => state === 'QUEUED').length, 1);

  // The running daemon reports both registered projects from one control home.
  const status = await runControlCli({ args: ['status'], env });
  assert.equal(status.ok, true);
  assert.equal(status.running, true);
  assert.equal(status.mode, 'aggregate');
  assert.equal(status.projects.length, 2);

  const list = await runControlCli({ args: ['list'], env });
  assert.equal(list.ok, true);
  assert.equal(list.mode, 'aggregate');
  assert.equal(new Set(list.projects.map((row) => row.projectRoot)).size, 2);

  const registered = await runControlCli({ args: ['register', '--project', projectB], env });
  assert.equal(registered.ok, true);
  assert.equal(registered.registered, false);
  assert.equal(registered.project.projectRoot, fs.realpathSync(projectB));
  assert.equal(registered.mode, 'aggregate');
});

test('isolated mode derives its own control home and port without moving aggregate state', async () => {
  const baseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-iso-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-iso-project-'));
  const env = { ...process.env, SPECGATE_CONTROL_HOME: baseRoot };

  const store = createControlStore({ root: baseRoot });
  const service = createControlService({ store });
  const created = await service.createWorkItem({
    title: 'Kept',
    request: 'stay',
    projectRoot,
  });
  assert.equal(created.ok, true);
  const before = await store.inspect();
  assert.equal(Object.keys(before.state.workItems).length, 1);

  const isolated = resolveControlEnvironment({ env, mode: 'isolated', projectRoot });
  assert.equal(isolated.ok, true);
  assert.equal(isolated.mode, 'isolated');
  assert.notEqual(isolated.controlRoot, path.resolve(baseRoot));
  assert.equal(
    isolated.controlRoot,
    path.join(path.resolve(baseRoot), 'projects', isolated.projectId),
  );
  assert.notEqual(isolated.managementPort, 43120);

  // The isolated home is a fresh store: no durable WorkItem/Decision state moved.
  const isolatedStore = createControlStore({ root: isolated.controlRoot });
  const isolatedState = await isolatedStore.inspect();
  assert.equal(Object.keys(isolatedState.state.workItems).length, 0);
  const after = await store.inspect();
  assert.equal(after.state.version, before.state.version);
  assert.deepEqual(Object.keys(after.state.workItems), Object.keys(before.state.workItems));
});

test('an invalid control mode or project root fails closed', async () => {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-invalid-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-invalid-project-'));
  const env = { ...process.env, SPECGATE_CONTROL_HOME: controlRoot };

  const cli = await runControlCli({
    args: ['start', '--mode', 'bogus', '--project', projectRoot],
    env,
  });
  assert.equal(cli.ok, false);
  assert.equal(cli.code, 'MODE_INVALID');

  const daemon = await startControlDaemon({ env, projectRoot, mode: 'bogus', managementPort: 0 });
  assert.equal(daemon.ok, false);
  assert.equal(daemon.code, 'MODE_INVALID');

  const envMode = await startControlDaemon({
    env: { ...env, [CONTROL_MODE_ENV]: 'nope' },
    projectRoot,
    managementPort: 0,
  });
  assert.equal(envMode.ok, false);
  assert.equal(envMode.code, 'MODE_INVALID');

  const missing = await startControlDaemon({
    env,
    projectRoot: path.join(controlRoot, 'missing-project'),
    managementPort: 0,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'PROJECT_ROOT_MISSING');
});

test('control CLI --mode isolated selects the per-project control home', async () => {
  const baseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cli-iso-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cli-iso-project-'));
  const env = { ...process.env, SPECGATE_CONTROL_HOME: baseRoot };
  fs.writeFileSync(
    path.join(baseRoot, 'daemon.json'),
    JSON.stringify({
      pid: process.pid,
      controlRoot: baseRoot,
      projectRoot,
      mode: 'aggregate',
      managementBaseUrl: 'http://127.0.0.1:43120',
    }),
  );

  const aggregate = await runControlCli({ args: ['status', '--project', projectRoot], env });
  assert.equal(aggregate.ok, true);
  assert.equal(aggregate.running, true);
  assert.equal(aggregate.mode, 'aggregate');

  const resolved = resolveControlEnvironment({ env, mode: 'isolated', projectRoot });
  assert.equal(resolved.ok, true);
  const isolated = await runControlCli({
    args: ['status', '--mode', 'isolated', '--project', projectRoot],
    env,
  });
  assert.equal(isolated.ok, false);
  assert.equal(isolated.code, 'DAEMON_NOT_RUNNING');
  assert.equal(fs.existsSync(path.join(resolved.controlRoot, 'daemon.json')), false);
  assert.equal(fs.existsSync(path.join(baseRoot, 'daemon.json')), true);
});

test('an isolated daemon registers and writes into its per-project control home', async (t) => {
  const baseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-iso-daemon-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-iso-daemon-project-'));
  const env = { ...process.env, SPECGATE_CONTROL_HOME: baseRoot };
  const resolved = resolveControlEnvironment({ env, mode: 'isolated', projectRoot });
  assert.equal(resolved.ok, true);

  const daemon = await startControlDaemon({
    env,
    projectRoot,
    mode: 'isolated',
    managementPort: 0,
    pollMs: 60000,
    adapter: {
      async run() {
        return { ok: true, exitCode: 0, sessionId: 'iso-session' };
      },
    },
  });
  t.after(() => daemon.stop());
  assert.equal(daemon.ok, true);
  assert.equal(daemon.mode, 'isolated');
  assert.equal(daemon.runtime.store.root, fs.realpathSync(resolved.controlRoot));
  assert.equal(daemon.registration.project.mode, 'isolated');
  const status = JSON.parse(
    fs.readFileSync(path.join(resolved.controlRoot, 'daemon.json'), 'utf8'),
  );
  assert.equal(status.mode, 'isolated');
  assert.equal(status.projectRoot, fs.realpathSync(projectRoot));
  assert.equal(status.registeredProjects.length, 1);
  assert.equal(status.registeredProjects[0].mode, 'isolated');
  // The shared aggregate home is untouched.
  assert.equal(fs.existsSync(path.join(baseRoot, 'daemon.json')), false);
});
