#!/usr/bin/env node
import { createCodexExecutionAdapter } from '../src/codex/control/codex-execution-adapter.js';
import { createOutboundWorker } from '../src/codex/control/outbound-worker.js';
import { createRemoteWorkerSupervisor } from '../src/codex/control/remote-worker-supervisor.js';

const once = process.argv.includes('--once');
const baseUrl = process.env.SPECGATE_WORKER_URL;
const token = process.env.SPECGATE_WORKER_TOKEN;
const POLL_INTERVAL_MS = 1000;

function log(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function projectRootsFromEnvironment() {
  const raw = process.env.SPECGATE_WORKER_PROJECTS;
  if (!raw) throw new TypeError('SPECGATE_WORKER_PROJECTS is required');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('SPECGATE_WORKER_PROJECTS must be a JSON object');
  }
  return parsed;
}

function wait(delayMs, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    timer.unref?.();
    signal?.addEventListener('abort', finish, { once: true });
  });
}

if (!baseUrl || !token) {
  process.stderr.write(
    'Worker requires SPECGATE_WORKER_URL and SPECGATE_WORKER_TOKEN; tokens are never accepted as CLI arguments.\n',
  );
  process.exitCode = 2;
} else {
  let worker;
  let supervisor;
  try {
    const projectRoots = projectRootsFromEnvironment();
    worker = createOutboundWorker({
      baseUrl,
      token,
      commandHandler: async (command) => ({
        ok: false,
        code: 'WORKER_TYPED_OPERATION_UNSUPPORTED',
        message: `Typed operation ${command.kind} is not enabled by this executor`,
      }),
      eventHandler: log,
    });
    supervisor = createRemoteWorkerSupervisor({
      workerClient: worker,
      adapter: createCodexExecutionAdapter(),
      projectRoots,
      logger: log,
    });
  } catch (error) {
    process.stderr.write(
      `Worker configuration is invalid: ${String(error?.message || 'invalid configuration')
        .replace(/[A-Za-z]:[\\/][^\s"'`]+/g, '<local-path>')
        .replace(/\/(?:tmp|home|Users|opt|var|private)\/[^\s"'`]+/g, '<local-path>')
        .slice(0, 1000)}\n`,
    );
    process.exitCode = 2;
  }

  if (worker && supervisor) {
    if (once) {
      const result = await supervisor.runOnce();
      log(result);
      process.exitCode = result.ok ? 0 : 1;
    } else {
      const controller = new AbortController();
      let closing = false;
      const stop = async () => {
        if (closing) return;
        closing = true;
        controller.abort();
        supervisor.stop();
        await worker.stop();
      };
      process.once('SIGINT', () => void stop());
      process.once('SIGTERM', () => void stop());

      while (!closing) {
        const result = await supervisor.runOnce({ signal: controller.signal });
        if (closing) break;
        log(result);
        if (!result.ok && (result.authFailure || result.retryable === false)) {
          process.exitCode = 1;
          break;
        }
        await wait(POLL_INTERVAL_MS, controller.signal);
      }
      if (closing && process.exitCode === undefined) process.exitCode = 0;
    }
  }
}
