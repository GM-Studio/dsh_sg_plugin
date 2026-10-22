import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createManagementServer } from '../management/server.js';
import {
  createFileSessionStore,
  createLocalControlRuntime,
  createLocalManagementServices,
} from './runtime.js';
import { createCodexExecutionAdapter } from './codex-execution-adapter.js';
import { createControlSupervisor } from './supervisor.js';
import { controlExecutionEnvironment, resolveControlMode } from './config.js';
import { resolveGlobalConcurrency } from './projects.js';
import { createFeishuNotifier } from '../channels/feishu.js';
import { createAttentionNotifier, createNotificationOutbox } from '../channels/outbox.js';

const failure = (code, message) => ({ ok: false, code, message });

function writeJsonAtomic(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.rmSync(target, { force: true });
    fs.renameSync(temporary, target);
  }
}

export async function startControlDaemon({
  env = process.env,
  clock = Date.now,
  projectRoot = env.SPECGATE_PROJECT_ROOT || process.cwd(),
  mode = null,
  maxConcurrent = undefined,
  pollMs = 2000,
  shutdownTimeoutMs = 5000,
  managementPort = undefined,
  managementHost = '127.0.0.1',
  adapter = null,
  feishuNotifier = null,
  runtime: providedRuntime = null,
  logger = () => {},
} = {}) {
  const selectedMode = resolveControlMode({ env, mode });
  if (!selectedMode.ok) return selectedMode;
  const controlMode = selectedMode.mode;
  const resolvedProjectRoot = path.resolve(projectRoot);
  const runtime =
    providedRuntime ||
    createLocalControlRuntime({ env, clock, mode: controlMode, projectRoot: resolvedProjectRoot });
  if (runtime && runtime.ok === false && runtime.code) return runtime;
  const config = runtime.config;

  // Register this project in the durable control home so a single aggregate
  // console can see several projects. Re-registering the same project is
  // idempotent and never overwrites another project's row.
  let registration = null;
  if (typeof runtime.service.registerProject === 'function') {
    registration = await runtime.service.registerProject({
      projectRoot: resolvedProjectRoot,
      mode: controlMode,
    });
    if (!registration.ok) return registration;
  }

  // The aggregate global concurrency limit is enforced across every project the
  // shared daemon serves; an absent request falls back to the configured
  // default (2) and a request is clamped to the configured bounds.
  let concurrency = null;
  let concurrencyLimit =
    Number.isSafeInteger(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 2;
  if (typeof runtime.service.inspect === 'function') {
    const inspected = await runtime.service.inspect();
    if (inspected.ok) {
      concurrency = resolveGlobalConcurrency(inspected.state, maxConcurrent);
      if (concurrency.ok) concurrencyLimit = concurrency.effective;
    }
  }

  const managed = createLocalManagementServices({
    env,
    clock,
    service: runtime.service,
    defaultProjectRoot: resolvedProjectRoot,
  });
  const pairing = { token: randomBytes(24).toString('base64url') };
  const sessionStore = createFileSessionStore({ root: runtime.store.root });
  const management = createManagementServer({
    services: managed.services,
    clock,
    pairingToken: pairing.token,
    port: managementPort ?? config.managementPort,
    host: managementHost,
    secureCookie: config.managementPublicUrl.startsWith('https:'),
    sessionStore,
  });
  const started = await management.start();
  const executionAdapter =
    adapter ||
    createCodexExecutionAdapter({
      clock,
      command: config.codexCommand,
      sandbox: config.codexSandbox,
      env: controlExecutionEnvironment({
        env: config.codexHome ? { ...env, CODEX_HOME: config.codexHome } : env,
        projectRoot: resolvedProjectRoot,
        controlRoot: runtime.store.root,
      }),
    });
  const supervisor = createControlSupervisor({
    service: runtime.service,
    adapter: executionAdapter,
    controlRoot: runtime.store.root,
    ownerId: `supervisor-${process.pid}`,
    clock,
    logger,
  });

  let feishu = null;
  let outbox = null;
  let attentionNotifier = null;
  if (feishuNotifier || config.feishuWebhookUrl) {
    feishu =
      feishuNotifier ||
      createFeishuNotifier({
        webhookUrl: config.feishuWebhookUrl,
        clock,
      });
    outbox = createNotificationOutbox({
      store: runtime.service,
      notifier: feishu,
      clock,
      ownerId: `outbox-${process.pid}`,
    });
    attentionNotifier = createAttentionNotifier({
      outbox,
      managementBaseUrl: config.managementPublicUrl,
      tokenFactory: () => management.issuePairingToken().token,
    });
  }

  let stopped = false;
  const active = new Set();
  let timer = null;
  let dispatchTimer = null;
  const stopRequestPath = path.join(runtime.store.root, 'stop.request');
  fs.rmSync(stopRequestPath, { force: true });

  async function dispatchAttention() {
    if (!attentionNotifier) return { ok: true, dispatched: 0 };
    const listed = await runtime.service.projection.listAttention();
    if (!listed.ok) return listed;
    let dispatched = 0;
    for (const attention of listed.attention) {
      if (
        !['OPEN', 'REMINDED'].includes(attention.status) ||
        attention.notificationId ||
        Date.parse(attention.expiresAt) <= clock()
      )
        continue;
      const item = await runtime.service.getWorkItem(attention.workItemId);
      if (!item.ok) continue;
      const notified = await attentionNotifier.notify({
        workItem: item.workItem,
        attention,
      });
      if (notified.ok) dispatched += 1;
    }
    return { ok: true, dispatched };
  }

  async function dispatchResolutions() {
    if (!attentionNotifier) return { ok: true, dispatched: 0 };
    const listed = await runtime.service.projection.listAttention();
    if (!listed.ok) return listed;
    let dispatched = 0;
    for (const attention of listed.attention) {
      if (
        ['OPEN', 'DELIVERED', 'REMINDED'].includes(attention.status) &&
        Date.parse(attention.expiresAt) <= clock()
      )
        await runtime.service.expireAttention({
          attentionId: attention.requestId,
          now: clock(),
        });
    }
    const refreshed = await runtime.service.projection.listAttention();
    if (!refreshed.ok) return refreshed;
    for (const attention of refreshed.attention) {
      if (
        !['DECIDED', 'SUPERSEDED', 'EXPIRED'].includes(attention.status) ||
        !attention.notificationId ||
        attention.resolutionNotificationId
      )
        continue;
      const item = await runtime.service.getWorkItem(attention.workItemId);
      if (!item.ok) continue;
      const notified = await attentionNotifier.notifyResolution({
        workItem: item.workItem,
        attention,
      });
      if (notified.ok) dispatched += 1;
    }
    return { ok: true, dispatched };
  }

  async function tick() {
    if (stopped) return;
    if (fs.existsSync(stopRequestPath)) {
      fs.rmSync(stopRequestPath, { force: true });
      await stop();
      return;
    }
    for (let launch = active.size; launch < concurrencyLimit; launch += 1) {
      const execution = supervisor
        .runOnce()
        .then((result) => {
          active.delete(execution);
          if (result?.status && result.status !== 'idle')
            logger({ event: 'supervisor.result', result });
          return result;
        })
        .catch((error) => {
          active.delete(execution);
          logger({
            event: 'supervisor.error',
            code: error?.code || 'SUPERVISOR_FAILED',
            message: error?.message || 'Supervisor failed',
          });
          return failure(error?.code || 'SUPERVISOR_FAILED', error?.message || 'Supervisor failed');
        });
      active.add(execution);
    }
    await dispatchAttention();
    await dispatchResolutions();
    if (outbox) await outbox.drain({ maxBatches: 20 });
  }

  timer = setInterval(() => void tick(), pollMs);
  dispatchTimer = setInterval(
    () => {
      void dispatchAttention();
      void dispatchResolutions();
      if (outbox) void outbox.drain({ maxBatches: 20 });
    },
    Math.max(1000, pollMs),
  );
  void tick();

  const statusPath = path.join(runtime.store.root, 'daemon.json');
  const baseUrl = started.baseUrl;
  const pairingUrl = management.pairingUrl(baseUrl);
  let registeredProjects = [];
  if (typeof runtime.service.projection.listRegistry === 'function') {
    const registry = await runtime.service.projection.listRegistry();
    if (registry.ok) registeredProjects = registry.projects;
  }
  writeJsonAtomic(statusPath, {
    schemaVersion: 1,
    pid: process.pid,
    startedAt: new Date(clock()).toISOString(),
    controlRoot: runtime.store.root,
    projectRoot: resolvedProjectRoot,
    projectId: registration?.projectId || null,
    mode: controlMode,
    maxConcurrent: concurrencyLimit,
    registeredProjects,
    managementBaseUrl: baseUrl,
    managementPublicUrl: config.managementPublicUrl,
    pairingUrl,
    feishuConfigured: Boolean(feishu),
    mfaConfigured: Boolean(config.mfaSecret),
    codexCommand: config.codexCommand,
    codexSandbox: config.codexSandbox,
    codexHomeConfigured: Boolean(config.codexHome),
    isolatedMcp: true,
  });

  async function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearInterval(dispatchTimer);
    supervisor.stop();
    const drained = Promise.allSettled([...active]);
    const timeout = new Promise((resolve) => setTimeout(resolve, shutdownTimeoutMs));
    await Promise.race([drained, timeout]);
    await management.close();
    try {
      fs.rmSync(statusPath, { force: true });
    } catch {
      // Retained status is safer than deleting another process's file.
    }
  }

  return {
    ok: true,
    runtime,
    management,
    supervisor,
    outbox,
    mode: controlMode,
    projectRoot: resolvedProjectRoot,
    registration,
    concurrency,
    concurrencyLimit,
    baseUrl,
    pairingUrl,
    statusPath,
    stopRequestPath,
    tick,
    dispatchAttention,
    dispatchResolutions,
    stop,
  };
}

export function readDaemonStatus({ controlRoot, fsImpl = fs } = {}) {
  if (!controlRoot) return failure('INVALID_ARGUMENT', 'Control root is required');
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(path.join(controlRoot, 'daemon.json'), 'utf8'));
    return { ok: true, status: parsed };
  } catch {
    return failure('DAEMON_NOT_RUNNING', 'No control daemon status is available');
  }
}
