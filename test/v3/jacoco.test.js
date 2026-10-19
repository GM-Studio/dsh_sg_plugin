import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJacocoXml, mergeCoverage, evaluateCoverage } from '../../src/v3/coverage/jacoco.js';

const XML = `<?xml version="1.0"?>
<report name="demo">
  <package name="com/example">
    <class name="com/example/App">
      <counter type="LINE" missed="1" covered="9"/>
      <counter type="BRANCH" missed="0" covered="2"/>
    </class>
    <counter type="LINE" missed="1" covered="9"/>
    <counter type="BRANCH" missed="0" covered="2"/>
  </package>
  <counter type="LINE" missed="5" covered="95"/>
  <counter type="BRANCH" missed="10" covered="30"/>
</report>`;

test('parseJacocoXml 读取报告级 LINE/BRANCH', () => {
  const result = parseJacocoXml(XML);
  assert.equal(result.ok, true);
  assert.equal(result.lines.covered, 95);
  assert.equal(result.lines.missed, 5);
  assert.equal(result.lines.rate, 0.95);
  assert.equal(result.branches.rate, 0.75);
});

test('parseJacocoXml 无 counter 返回 COVERAGE_MISSING', () => {
  const result = parseJacocoXml('<report/>');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'COVERAGE_MISSING');
});

test('mergeCoverage 按 covered/missed 聚合', () => {
  const merged = mergeCoverage([
    { ok: true, lines: { covered: 8, missed: 2 }, branches: { covered: 1, missed: 1 } },
    { ok: true, lines: { covered: 10, missed: 10 }, branches: { covered: 3, missed: 1 } },
  ]);
  assert.equal(merged.lines.covered, 18);
  assert.equal(merged.lines.missed, 12);
  assert.equal(merged.lines.rate, 0.6);
  assert.equal(merged.branches.rate, 4 / 6);
});

test('evaluateCoverage 通过阈值', () => {
  const result = evaluateCoverage({
    coverage: { lines: { rate: 0.9 }, branches: { rate: 0.8 } },
    thresholds: { lines: 80, branches: 70 },
    stats: {
      P0: { total: 2, passed: 2 },
      P1: { total: 2, passed: 2 },
      P2: { total: 10, passed: 9 },
    },
  });
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('evaluateCoverage 覆盖率不足阻断', () => {
  const result = evaluateCoverage({
    coverage: { lines: { rate: 0.7 }, branches: { rate: 0.6 } },
    thresholds: { lines: 80, branches: 70 },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /lines/);
  assert.match(result.errors.join('; '), /branches/);
});

test('evaluateCoverage baseline 只告警', () => {
  const result = evaluateCoverage({
    coverage: { lines: { rate: 0.7 }, branches: { rate: 0.6 } },
    thresholds: { lines: 80, branches: 70 },
    baseline: { lines: 65, branches: 55 },
  });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.warnings.length, 2);
});

test('evaluateCoverage P0/P1/P2 通过率', () => {
  const result = evaluateCoverage({
    coverage: { lines: { rate: 0.9 }, branches: { rate: 0.8 } },
    thresholds: { lines: 80, branches: 70, p0p1: 100, p2: 90 },
    stats: {
      P0: { total: 2, passed: 1 },
      P1: { total: 2, passed: 1 },
      P2: { total: 10, passed: 8 },
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /P0/);
  assert.match(result.errors.join('; '), /P1/);
  assert.match(result.errors.join('; '), /P2/);
});

test('evaluateCoverage blocking=false 只告警', () => {
  const result = evaluateCoverage({
    coverage: { lines: { rate: 0.1 }, branches: { rate: 0.1 } },
    thresholds: { lines: 80, branches: 70, blocking: false },
  });
  assert.equal(result.ok, true);
  assert.equal(result.blocking, false);
  assert.ok(result.warnings.length > 0);
});
