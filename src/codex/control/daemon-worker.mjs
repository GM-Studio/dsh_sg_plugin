import { startControlDaemon } from './daemon.js';

let daemon;
let stopping = false;

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  try {
    await daemon?.stop();
  } finally {
    process.exitCode = signal ? 0 : process.exitCode || 0;
  }
}

process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));

try {
  daemon = await startControlDaemon({ requireExecJson: true });
  if (!daemon || daemon.ok === false) {
    process.stderr.write(
      JSON.stringify({
        ok: false,
        code: daemon?.code || 'CONTROL_DAEMON_START_FAILED',
        message: daemon?.message || 'Control daemon failed to start',
        capabilities: daemon?.capabilities || null,
        degradation: daemon?.degradation || null,
      }) + '\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        pid: process.pid,
        baseUrl: daemon.baseUrl,
        pairingUrl: daemon.pairingUrl,
      }) + '\n',
    );
  }
} catch (error) {
  process.stderr.write(
    JSON.stringify({
      ok: false,
      code: error.code || 'CONTROL_DAEMON_START_FAILED',
      message: error.message || 'Control daemon failed to start',
    }) + '\n',
  );
  process.exitCode = 1;
}
