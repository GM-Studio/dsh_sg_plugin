import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCoverage } from '../../src/v3/executor.js';

function tempRoot(blocking = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-coverage-'));
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'config.yaml'),
    `coverage:\n  blocking: ${blocking}\n  lines: 80\n  branches: 70\n  p0p1: 100\n  p2: 90\n`,
    'utf8',
  );
  return root;
}

function suiteResult(
  lineCovered = 9,
  lineMissed = 1,
  branchCovered = 4,
  branchMissed = 1,
  status = 'pass',
) {
  return {
    results: [
      {
        coverage: {
          lines: { covered: lineCovered, missed: lineMissed },
          branches: { covered: branchCovered, missed: branchMissed },
        },
        report: {
          cases: [{ id: 'TC-001', ac: ['AC-001'], status }],
        },
      },
    ],
  };
}

const plan = { mapping: { requirements: [{ ac: 'AC-001', priority: 'P0' }] } };

test('checkCoverage 通过', () => {
  const root = tempRoot();
  assert.equal(checkCoverage({ root, suiteResult: suiteResult(), plan }), null);
});

test('checkCoverage 覆盖率不足返回错误', () => {
  const root = tempRoot();
  const result = checkCoverage({ root, suiteResult: suiteResult(5, 5, 5, 5), plan });
  assert.equal(result.code, 'COVERAGE_BELOW_THRESHOLD');
  assert.match(result.message, /lines/);
});

test('checkCoverage P0 未通过返回错误', () => {
  const root = tempRoot();
  const result = checkCoverage({ root, suiteResult: suiteResult(9, 1, 4, 1, 'fail'), plan });
  assert.equal(result.code, 'COVERAGE_BELOW_THRESHOLD');
  assert.match(result.message, /P0/);
});

test('checkCoverage blocking=false 不阻断', () => {
  const root = tempRoot(false);
  assert.equal(checkCoverage({ root, suiteResult: suiteResult(1, 9, 1, 9), plan }), null);
});
