import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export const MYSQL_TEST_FILES = Object.freeze([
  'codex-control-auth-mysql.test.js',
  'codex-control-auth-runtime.test.js',
  'codex-control-persistence-mysql.test.js',
  'codex-control-worker-mysql.test.js',
  'codex-control-worker-runtime.test.js',
]);

export function selectTestFiles(mode, directory = path.join(root, 'test')) {
  if (!['core', 'mysql', 'all'].includes(mode))
    throw new TypeError('Test suite must be core, mysql or all');
  const files = fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.test.js'))
    .sort();
  for (const file of MYSQL_TEST_FILES)
    if (!files.includes(file)) throw new Error(`Registered MySQL test is missing: ${file}`);
  for (const file of files) {
    const source = fs.readFileSync(path.join(directory, file), 'utf8');
    if (
      /^\s*import\s+(?:[^'";]+?\sfrom\s*)?['"](?:mysql2(?:\/[^'"]*)?|\.\/mysql-test-config\.mjs)['"]/m.test(
        source,
      ) &&
      !MYSQL_TEST_FILES.includes(file)
    )
      throw new Error(`EXTERNAL_TEST_CLASSIFICATION_REQUIRED: ${file}`);
  }
  return files.filter(
    (file) => mode === 'all' || MYSQL_TEST_FILES.includes(file) === (mode === 'mysql'),
  );
}

async function main() {
  const mode = process.argv[2] || 'core';
  const files = selectTestFiles(mode);
  if (mode === 'mysql' || mode === 'all') {
    try {
      createRequire(import.meta.url).resolve('mysql2/promise');
    } catch {
      throw new Error(
        'MYSQL_DRIVER_NOT_INSTALLED: MySQL integration is outside Core v1; explicitly install the historical driver before running this suite.',
      );
    }
  }
  process.stdout.write(
    `SpecGate ${mode}: ${files.length} test files; MySQL integration is an explicit separate suite.\n`,
  );
  const child = spawn(
    process.execPath,
    [
      '--import',
      './test/setup-temp.mjs',
      '--test',
      '--test-concurrency=2',
      ...files.map((file) => `test/${file}`),
    ],
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  child.on('error', (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
