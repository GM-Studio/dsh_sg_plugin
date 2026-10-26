import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  OUTCOMES,
  INFRASTRUCTURE_OUTCOMES,
  classifyErrorText,
  classifyCaseResult,
  summarizeOutcomes,
  classifyStage,
} from '../src/codex/core/outcome-classification.js';

test('the outcome vocabulary separates business from infrastructure', () => {
  assert.deepEqual([...OUTCOMES].sort(), [
    'business-failure',
    'business-pass',
    'missing-dependency',
    'not-run',
    'process-error',
    'timeout',
  ]);
  assert.deepEqual([...INFRASTRUCTURE_OUTCOMES].sort(), [
    'missing-dependency',
    'not-run',
    'process-error',
    'timeout',
  ]);
  // 业务结论绝不能出现在基础设施集合里。
  for (const outcome of ['business-failure', 'business-pass'])
    assert.equal(INFRASTRUCTURE_OUTCOMES.includes(outcome), false, outcome);
});

test('a timeout is not a business failure', () => {
  const result = classifyCaseResult({ status: 'fail', error: 'command ETIMEDOUT after 600000ms' });
  assert.equal(result.outcome, 'timeout');
  assert.equal(result.business, false, 'AC-21：超时不得冒充业务缺陷');
});

test('a missing dependency is not a business failure', () => {
  for (const error of [
    'Error: ENOENT: no such file or directory',
    "Cannot find module 'vitest'",
    'mvn: command not found',
    "'mvn' is not recognized as an internal or external command",
  ]) {
    const result = classifyCaseResult({ status: 'fail', error });
    assert.equal(result.outcome, 'missing-dependency', error);
    assert.equal(result.business, false);
  }
});

test('a crashed process is a process error, not a business failure', () => {
  for (const error of ['killed by SIGKILL', 'out of memory: ENOMEM', 'EACCES: permission denied']) {
    const result = classifyCaseResult({ status: 'fail', error });
    assert.equal(result.outcome, 'process-error', error);
    assert.equal(result.business, false);
  }
});

test('a non-zero exit without a readable report is a process error', () => {
  const result = classifyCaseResult({ status: 'fail', reportAvailable: false });
  assert.equal(result.outcome, 'process-error');
  assert.equal(result.business, false);
});

test('a skipped or missing case is not-run, which is neither pass nor fail', () => {
  for (const status of ['skip', 'skipped', 'not-run']) {
    const result = classifyCaseResult({ status });
    assert.equal(result.outcome, 'not-run', status);
    assert.equal(result.business, false);
  }
});

test('only a genuine assertion failure is a business failure', () => {
  const result = classifyCaseResult({ status: 'fail', error: 'expected 1 to equal 2' });
  assert.equal(result.outcome, 'business-failure');
  assert.equal(result.business, true);
  const pass = classifyCaseResult({ status: 'pass' });
  assert.equal(pass.outcome, 'business-pass');
  assert.equal(pass.business, true);
});

test('infrastructure signals win over business signals', () => {
  // 缺依赖导致的断言失败必须归为基础设施，否则实现方会去修不存在的缺陷。
  const result = classifyCaseResult({
    status: 'fail',
    error: "Cannot find module '@/utils/export' while asserting expected 1 to equal 2",
  });
  assert.equal(result.outcome, 'missing-dependency');
});

test('a report containing any infrastructure problem cannot serve as a red baseline', () => {
  const summary = summarizeOutcomes({
    cases: [{ status: 'fail' }, { status: 'skip' }, { status: 'fail', error: 'ETIMEDOUT' }],
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.counts.infrastructure, 2);
  assert.equal(summary.counts.businessFailures, 1);
  assert.equal(summary.usableAsBusinessEvidence, false);
  assert.equal(summary.usableAsRedBaseline, false, '基础设施问题使红基线不可用');
});

test('a clean report with a real business failure is a usable red baseline', () => {
  const summary = summarizeOutcomes({
    cases: [{ status: 'fail' }, { status: 'pass' }, { status: 'pass' }],
  });
  assert.equal(summary.usableAsBusinessEvidence, true);
  assert.equal(summary.usableAsRedBaseline, true);
  assert.equal(summary.counts.businessPasses, 2, '既有回归保持绿');
});

test('all-green is evidence but not a red baseline', () => {
  const summary = summarizeOutcomes({ cases: [{ status: 'pass' }] });
  assert.equal(summary.usableAsBusinessEvidence, true);
  assert.equal(summary.usableAsRedBaseline, false);
});

test('stage classification attributes infrastructure failures away from implementation', () => {
  const declared = classifyStage({
    name: 'frontend-build',
    exitCode: 1,
    failureKind: 'infrastructure',
  });
  assert.equal(declared.business, false);
  assert.equal(declared.reason, 'stage-declared-infrastructure');
  const missing = classifyStage({ name: 'frontend-install', exitCode: 1, error: 'ENOENT' });
  assert.equal(missing.business, false);
  const real = classifyStage({ name: 'backend-verify', exitCode: 1 });
  assert.equal(real.outcome, 'business-failure');
  assert.equal(real.business, true);
  const ok = classifyStage({ name: 'coverage', exitCode: 0 });
  assert.equal(ok.outcome, 'business-pass');
});

test('error text classification is null for ordinary assertion messages', () => {
  for (const value of ['expected 1 to equal 2', '', null, undefined, 42])
    assert.equal(classifyErrorText(value), null, String(value));
});

test('invalid input is refused', () => {
  assert.equal(summarizeOutcomes({ cases: 'x' }).code, 'OUTCOME_INPUT_INVALID');
});

test('the red baseline path in development.js keeps rejecting infrastructure errors', () => {
  // 回归守卫：SNA-0502 改写了红基线校验，不得顺手放宽这条 AC-21 约束。
  const source = fs.readFileSync(path.join(process.cwd(), 'src/codex/development.js'), 'utf8');
  assert.match(source, /infrastructureErrors/);
  assert.match(source, /failureKind === 'infrastructure'/);
  assert.match(source, /must not skip frozen cases/, '跳过仍须被拒');
});
