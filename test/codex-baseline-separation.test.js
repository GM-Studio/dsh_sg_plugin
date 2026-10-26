import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXECUTION_STATES,
  isExecutionPass,
  buildBaselineReport,
  assertDocumentIsNotExecution,
} from '../src/codex/core/discovery/baseline-separation.js';
import { buildRequirementBaseline, snapshotId } from '../src/codex/core/discovery/candidates.js';
import { validateProjectBaseline } from '../src/codex/project-model.js';

const requirement = () =>
  buildRequirementBaseline({
    candidates: [
      {
        id: 'C-1',
        text: 'Export exists.',
        evidenceClass: 'static-observed',
        sourceRefs: ['a.js:1'],
      },
    ],
    snapshot: snapshotId({ files: [{ path: 'a.js', bytes: 1 }] }),
    gaps: ['no test command'],
    revision: 1,
  }).baseline;

const execution = (state) => ({
  baselineId: 'baseline-1',
  state,
  createdAt: '2026-10-26T00:00:00.000Z',
  evidence: ['runs/baseline-run-1/summary.json'],
});

test('only passed counts as an execution pass', () => {
  assert.deepEqual([...EXECUTION_STATES].sort(), [
    'cancelled',
    'failed',
    'not-run',
    'passed',
    'skipped',
    'timeout',
  ]);
  for (const state of EXECUTION_STATES) assert.equal(isExecutionPass(state), state === 'passed');
});

test('generating a requirement baseline produces no execution conclusion', () => {
  const baseline = requirement();
  assert.equal(baseline.isExecutionBaseline, false);
  assert.equal(baseline.claimsExecutionPass, false);
  const report = buildBaselineReport({ requirement: baseline });
  assert.equal(report.ok, true);
  assert.equal(report.requirement.kind, 'requirement-baseline');
  assert.equal(report.execution, null);
  assert.equal(report.established, false);
  assert.equal(report.executionStatus, 'execution-baseline-not-established');
});

test('a requirement baseline can exist while the execution baseline is missing', () => {
  const report = buildBaselineReport({ requirement: requirement(), execution: null });
  assert.equal(report.ok, true);
  assert.equal(report.requirement.candidateCount, 1);
  assert.equal(report.requirement.gaps, 1, '缺口必须计数并可见');
  assert.match(report.executionStatus, /not-established/);
});

test('the two baselines have independent identity and timestamps', () => {
  const baseline = requirement();
  const report = buildBaselineReport({
    requirement: { ...baseline, createdAt: '2026-10-26T01:00:00.000Z' },
    execution: execution('passed'),
  });
  assert.equal(report.ok, true);
  assert.notEqual(report.requirement.id, report.execution.id, '标识必须独立');
  assert.notEqual(report.requirement.createdAt, report.execution.createdAt);
  assert.equal(report.requirement.kind, 'requirement-baseline');
  assert.equal(report.execution.kind, 'execution-baseline');
});

test('a requirement baseline claiming execution is rejected', () => {
  const baseline = requirement();
  for (const mutation of [{ isExecutionBaseline: true }, { claimsExecutionPass: true }]) {
    const report = buildBaselineReport({ requirement: { ...baseline, ...mutation } });
    assert.equal(report.ok, false, JSON.stringify(mutation));
    assert.equal(report.issues.length, 1);
  }
});

test('only a real passed execution reports passed, and other states never do', () => {
  for (const state of EXECUTION_STATES) {
    const report = buildBaselineReport({ requirement: requirement(), execution: execution(state) });
    assert.equal(report.execution.passed, state === 'passed', state);
  }
});

test('an unknown execution state is reported instead of silently accepted', () => {
  const report = buildBaselineReport({
    requirement: requirement(),
    execution: execution('probably-fine'),
  });
  assert.equal(report.ok, false);
  assert.equal(report.issues[0].code, 'EXECUTION_STATE_INVALID');
  assert.equal(report.execution.passed, false);
});

test('a generated document cannot prove execution', () => {
  for (const source of [
    { kind: 'requirement-baseline', state: 'passed', evidence: ['x'] },
    { kind: 'generated-document', state: 'passed', evidence: ['x'] },
    { kind: 'report', generatedByDocument: true, state: 'passed', evidence: ['x'] },
  ]) {
    const result = assertDocumentIsNotExecution({ source });
    assert.equal(result.ok, false, JSON.stringify(source));
    assert.equal(result.code, 'DOCUMENT_CANNOT_PROVE_EXECUTION');
  }
});

test('a pass without referenced execution evidence is refused', () => {
  const missing = assertDocumentIsNotExecution({ source: { kind: 'command', state: 'passed' } });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'EXECUTION_EVIDENCE_MISSING');

  const notRun = assertDocumentIsNotExecution({
    source: { kind: 'command', state: 'not-run', evidence: ['x'] },
  });
  assert.equal(notRun.ok, false);
  assert.equal(notRun.code, 'EXECUTION_NOT_PASSED');

  const real = assertDocumentIsNotExecution({
    source: { kind: 'command', state: 'passed', evidence: ['runs/1.txt'] },
  });
  assert.equal(real.ok, true);
});

test('the requirement baseline shape is not accepted by the execution baseline validator', () => {
  // 两种基线不能互相冒充：把需求基线喂给执行基线校验必须被拒。
  const baseline = requirement();
  const result = validateProjectBaseline(baseline);
  assert.equal(result.ok, false, '需求基线不得通过执行基线校验');
  assert.equal(result.code, 'BASELINE_INVALID');
});
