import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateReport } from '../../src/v3/report.js';
import { runTestCommand } from '../../src/v3/testrunner.js';
import { appendEvidence, verifyEvidence } from '../../src/v3/evidence.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-s4core-'));
}

const MAP = { requirements: [{ ac: 'AC-001' }] };
const ACS = new Set(['AC-001']);

function run(worktree, items) {
  return validateReport({
    report: { schemaVersion: 1, cases: items },
    deltaAcs: ACS,
    mapping: MAP,
    worktree,
  });
}

test('合法报告通过', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'tests', 'automation'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'automation', 'a.test.js'), '', 'utf8');
  const result = run(root, [
    { id: 'TC-001', ac: ['AC-001'], status: 'pass', file: 'tests/automation/a.test.js' },
  ]);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.stats.passed, 1);
});

test('AC 只有 skip 时判失败', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'a.js'), '', 'utf8');
  const result = run(root, [{ id: 'TC-001', ac: ['AC-001'], status: 'skip', file: 'a.js' }]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /没有通过的用例/);
});

test('引用未冻结的 AC 判失败', () => {
  const root = tempRoot();
  const result = run(root, [{ id: 'TC-001', ac: ['AC-999'], status: 'pass', file: 'a.js' }]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /未冻结/);
});

test('缺少 file 或文件不存在判失败', () => {
  const root = tempRoot();
  const missing = run(root, [{ id: 'TC-001', ac: ['AC-001'], status: 'pass' }]);
  assert.equal(missing.ok, false);
  const absent = run(root, [
    { id: 'TC-001', ac: ['AC-001'], status: 'pass', file: 'nope.js' },
  ]);
  assert.equal(absent.ok, false);
  assert.match(absent.errors.join('; '), /不存在/);
});

test('用例文件不在本次 diff 时判失败', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'a.js'), '', 'utf8');
  const result = validateReport({
    report: {
      schemaVersion: 1,
      cases: [{ id: 'TC-001', ac: ['AC-001'], status: 'pass', file: 'a.js' }],
    },
    deltaAcs: ACS,
    mapping: MAP,
    worktree: root,
    changedFiles: ['b.js'],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /没有通过的用例/);
});

test('集成回归允许已有用例不在本次 diff', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'a.js'), '', 'utf8');
  const result = validateReport({
    report: {
      schemaVersion: 1,
      cases: [{ id: 'TC-001', ac: ['AC-001'], status: 'pass', file: 'a.js' }],
    },
    deltaAcs: ACS,
    mapping: MAP,
    worktree: root,
    changedFiles: ['b.js'],
    requireChangedFiles: false,
  });
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('evidence 链可校验，篡改后失败', () => {
  const root = tempRoot();
  assert.equal(appendEvidence(root, 'c1', { event: 'm1', decision: 'pass' }).ok, true);
  assert.equal(appendEvidence(root, 'c1', { event: 'h1', decision: 'approve' }).ok, true);
  appendEvidence(root, 'c1', { event: 'task', decision: 'merged' });
  const verified = verifyEvidence(root, 'c1');
  assert.equal(verified.ok, true);
  assert.equal(verified.count, 3);
  assert.equal(verified.headSeq, 3);

  const file = path.join(root, '.specgate', 'evidence', 'c1', '0002.json');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record.decision = 'rejected';
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
  const broken = verifyEvidence(root, 'c1');
  assert.equal(broken.ok, false);
  assert.equal(broken.brokenAt, 2);
});

test('runTestCommand 读取 SG_REPORT', () => {
  const root = tempRoot();
  const script = path.join(root, 'reporter.mjs');
  fs.writeFileSync(
    script,
    `import fs from 'node:fs';
const report = { schemaVersion: 1, cases: [{ id: 'TC-001', ac: ['AC-001'], status: 'pass', file: 'a.js' }] };
fs.writeFileSync(process.env.SG_REPORT, JSON.stringify(report));
`,
    'utf8',
  );
  const result = runTestCommand({ argv: [process.execPath, script], cwd: root });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.cases[0].id, 'TC-001');
  assert.equal(result.reportError, null);
});

test('runTestCommand 报告缺失时给出 reportError', () => {
  const root = tempRoot();
  const result = runTestCommand({ argv: [process.execPath, '-e', 'process.exit(1)'], cwd: root });
  assert.equal(result.exitCode, 1);
  assert.match(result.reportError, /没有写 SG_REPORT/);
});
