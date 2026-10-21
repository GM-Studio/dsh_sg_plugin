import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function pairs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key?.startsWith('--') || argv[index + 1] === undefined)
      throw new Error('Expected --name value arguments');
    values.set(key.slice(2), argv[index + 1]);
  }
  return values;
}

function spawnRunner(executable, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: 'inherit',
      windowsHide: true,
    });
    const stop = (signal) => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    };
    const interrupt = () => stop('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    child.once('error', (error) => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      process.stderr.write(error.message + '\n');
      resolve(1);
    });
    child.once('close', (code, signal) => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function replaceTestsArgument(args, tests) {
  const next = [...args];
  const index = next.indexOf('--tests');
  if (index === -1 || index + 1 >= next.length)
    throw new Error('Native runner requires a --tests argument');
  next[index + 1] = tests;
  return next;
}

function needsLegacyRetry(output, tests) {
  if (!fs.existsSync(output)) return true;
  try {
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (Object.values(report.commands || {}).some(Boolean)) return false;
    const error = String(report.error || '').replaceAll('\\', '/');
    const basename = path.basename(tests);
    return error.includes(`${basename}/${basename}`);
  } catch {
    return false;
  }
}

async function main() {
  const [runner, ...forwarded] = process.argv.slice(2);
  if (!runner) throw new Error('Usage: native-test-runner <runner> --snapshot <root> ...');
  const parsed = pairs(forwarded);
  const snapshot = parsed.get('snapshot');
  const report = parsed.get('report');
  if (!snapshot || !report) throw new Error('Native runner requires --snapshot and --report');
  const output = path.resolve(report);
  fs.rmSync(output, { force: true });
  const canonical = [];
  for (let index = 0; index < forwarded.length; index += 2) {
    if (forwarded[index] === '--snapshot') continue;
    canonical.push(forwarded[index], forwarded[index + 1]);
  }

  const primaryStatus = await spawnRunner(process.execPath, [runner, ...canonical], process.cwd());
  const canonicalTests = canonical[canonical.indexOf('--tests') + 1];
  if (!needsLegacyRetry(output, canonicalTests)) return primaryStatus;

  // Frozen test assets created before the canonical root contract may interpret
  // --tests as the snapshot parent. Retry only when no product command ran and
  // the setup error shows the duplicated specgate-tests/specgate-tests path.
  const legacyStatus = await spawnRunner(
    process.execPath,
    [runner, ...replaceTestsArgument(canonical, path.resolve(snapshot))],
    process.cwd(),
  );
  return fs.existsSync(output) ? legacyStatus : legacyStatus || 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
