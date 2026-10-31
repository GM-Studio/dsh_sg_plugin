import { spawn } from 'node:child_process';
import { observeSupervisedBaselineProcess } from './core/baseline-lease.js';

// This supervisor outlives a crashed MCP/worker. Its PID represents the entire
// foreground command, so npm's shell descendants cannot become invisible owners.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
async function main() {
  const spec = JSON.parse(process.argv[2]);
  observeSupervisedBaselineProcess(spec.lease);
  const child = spawn(spec.command, spec.args, {
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments: spec.windowsVerbatimArguments,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const forward = (sink) => (chunk) => {
    if (!sink.destroyed && sink.writableLength < 64 * 1024) sink.write(chunk);
  };
  child.stdout.on('data', forward(process.stdout));
  child.stderr.on('data', forward(process.stderr));
  const code = await new Promise((resolve) => {
    child.once('error', (error) => {
      process.stderr.write(error.message);
      resolve(1);
    });
    child.once('close', (status) => resolve(Number.isInteger(status) ? status : 1));
  });
  observeSupervisedBaselineProcess(spec.lease, true);
  process.exitCode = code;
}
main().catch((error) => {
  process.stderr.write(String(error.message));
  process.exitCode = 1;
});
