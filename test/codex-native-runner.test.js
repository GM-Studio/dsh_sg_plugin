import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const wrapper = fileURLToPath(new URL('../src/codex/native-test-runner.mjs', import.meta.url));

test('native runner adapter retries the legacy snapshot argument only when canonical mode writes no report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-native-runner-'));
  const snapshot = path.join(root, '.specgate', 'tests', 'v1-frozen');
  const testRoot = path.join(snapshot, 'specgate-tests');
  const report = path.join(root, '.specgate', 'native-green-report.json');
  fs.mkdirSync(testRoot, { recursive: true });
  const runner = path.join(testRoot, 'runner.mjs');
  fs.writeFileSync(
    runner,
    `import fs from 'node:fs';
const values = process.argv.slice(2);
const args = {
  tests: values[values.indexOf('--tests') + 1],
  report: values[values.indexOf('--report') + 1],
};
if (args.tests === ${JSON.stringify(snapshot)}) {
  fs.mkdirSync(${JSON.stringify(path.dirname(report))}, { recursive: true });
  fs.writeFileSync(args.report, JSON.stringify({ cases: [{ id: 'CASE-1', status: 'pass' }] }));
  process.exitCode = 0;
} else {
  process.exitCode = 1;
}
`,
  );

  const result = spawnSync(
    process.execPath,
    [
      wrapper,
      runner,
      '--mode',
      'green',
      '--root',
      root,
      '--tests',
      testRoot,
      '--snapshot',
      snapshot,
      '--report',
      report,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(report, 'utf8')).cases, [
    { id: 'CASE-1', status: 'pass' },
  ]);
});

test('native runner adapter never retries a runner that produced an explicit failing report', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-native-runner-report-'));
  const snapshot = path.join(root, 'frozen');
  const testRoot = path.join(snapshot, 'specgate-tests');
  const report = path.join(root, 'report.json');
  fs.mkdirSync(testRoot, { recursive: true });
  const runner = path.join(testRoot, 'runner.mjs');
  const marker = path.join(root, 'legacy-called');
  fs.writeFileSync(
    runner,
    `import fs from 'node:fs';
const values = process.argv.slice(2);
const args = {
  tests: values[values.indexOf('--tests') + 1],
  report: values[values.indexOf('--report') + 1],
};
if (args.tests === ${JSON.stringify(snapshot)}) {
  fs.writeFileSync(${JSON.stringify(marker)}, 'called');
  process.exitCode = 0;
} else {
  fs.writeFileSync(args.report, JSON.stringify({ cases: [{ id: 'CASE-1', status: 'fail' }] }));
  process.exitCode = 1;
}
`,
  );

  const result = spawnSync(
    process.execPath,
    [
      wrapper,
      runner,
      '--mode',
      'green',
      '--root',
      root,
      '--tests',
      testRoot,
      '--snapshot',
      snapshot,
      '--report',
      report,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.equal(fs.existsSync(marker), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(report, 'utf8')).cases, [
    { id: 'CASE-1', status: 'fail' },
  ]);
});

test('native runner adapter retries an explicit setup failure caused by the duplicated test root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-native-runner-setup-'));
  const snapshot = path.join(root, 'frozen');
  const testRoot = path.join(snapshot, 'specgate-tests');
  const report = path.join(root, 'report.json');
  fs.mkdirSync(testRoot, { recursive: true });
  const runner = path.join(testRoot, 'runner.mjs');
  fs.writeFileSync(
    runner,
    `import fs from 'node:fs';
const values = process.argv.slice(2);
const tests = values[values.indexOf('--tests') + 1];
const report = values[values.indexOf('--report') + 1];
if (tests === ${JSON.stringify(snapshot)}) {
  fs.writeFileSync(report, JSON.stringify({
    cases: [{ id: 'CASE-1', status: 'pass' }],
    commands: { backend: { status: 0 } },
  }));
  process.exitCode = 0;
} else {
  fs.writeFileSync(report, JSON.stringify({
    cases: [{ id: 'CASE-1', status: 'fail' }],
    commands: { install: null, backend: null, frontend: null },
    error: 'ENOENT: ' + tests + '/specgate-tests/backend/Test.java',
  }));
  process.exitCode = 1;
}
`,
  );

  const result = spawnSync(
    process.execPath,
    [
      wrapper,
      runner,
      '--mode',
      'green',
      '--root',
      root,
      '--tests',
      testRoot,
      '--snapshot',
      snapshot,
      '--report',
      report,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(report, 'utf8')).cases, [
    { id: 'CASE-1', status: 'pass' },
  ]);
});
