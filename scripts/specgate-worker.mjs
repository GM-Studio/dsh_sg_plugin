#!/usr/bin/env node
import { createOutboundWorker } from '../src/codex/control/outbound-worker.js';

const once = process.argv.includes('--once');
const baseUrl = process.env.SPECGATE_WORKER_URL;
const token = process.env.SPECGATE_WORKER_TOKEN;

function log(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

if (!baseUrl || !token) {
  process.stderr.write(
    'Worker requires SPECGATE_WORKER_URL and SPECGATE_WORKER_TOKEN; tokens are never accepted as CLI arguments.\n',
  );
  process.exitCode = 2;
} else {
  const worker = createOutboundWorker({
    baseUrl,
    token,
    commandHandler: async (command) => ({
      ok: false,
      code: 'WORKER_COMMAND_HANDLER_UNAVAILABLE',
      message: `M3 transport connected but command ${command.kind} requires the M4 typed executor`,
    }),
    eventHandler: log,
  });
  if (once) {
    const result = await worker.runOnce();
    log(result);
    process.exitCode = result.ok ? 0 : 1;
  } else {
    const running = worker.start();
    if (!running.ok) {
      log(running);
      process.exitCode = 1;
    } else {
      let closing = false;
      const stop = async () => {
        if (closing) return;
        closing = true;
        await worker.stop();
        process.exitCode = 0;
      };
      process.once('SIGINT', () => void stop());
      process.once('SIGTERM', () => void stop());
      const result = await running.done;
      log(result);
      if (!result.ok) process.exitCode = 1;
    }
  }
}
