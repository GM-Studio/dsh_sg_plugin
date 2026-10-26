import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_LAYERS,
  LAYER_STATES,
  buildLayeredReport,
  assertExecutionEvidence,
  canReusePass,
  classifyFormatCheck,
} from '../src/codex/core/report-layers.js';

const C1 = 'a'.repeat(40);
const C2 = 'b'.repeat(40);
const at = '2026-10-26T00:00:00.000Z';

test('five independent report layers exist', () => {
  assert.deepEqual([...REPORT_LAYERS].sort(), [
    'archive',
    'human-acceptance',
    'production-deployment',
    'push',
    'technical-verification',
  ]);
  assert.deepEqual([...LAYER_STATES].sort(), ['failed', 'not-run', 'passed', 'skipped']);
});

test('a layer that is not reported stays not-run rather than implied', () => {
  const report = buildLayeredReport({
    layers: { 'technical-verification': { state: 'passed', evidence: ['runs/1.json'] } },
  });
  assert.equal(report.ok, true);
  assert.equal(report.rows['technical-verification'].state, 'passed');
  assert.equal(report.rows['human-acceptance'].state, 'not-run', '未报告就不得推导为通过');
  assert.equal(report.rows['production-deployment'].state, 'not-run');
  assert.equal(report.allPassed, false);
  assert.equal(report.derivedFromOtherLayers, false);
});

test('technical verification passing never implies push or deployment', () => {
  // AC-33：五类结论分别报告。
  const report = buildLayeredReport({
    layers: { 'technical-verification': { state: 'passed', evidence: ['x'] } },
  });
  assert.equal(report.rows.push.state, 'not-run');
  assert.equal(report.productionDeploymentTriggered, false);
});

test('all five layers passing is required for allPassed', () => {
  const layers = Object.fromEntries(
    REPORT_LAYERS.map((layer) => [layer, { state: 'passed', evidence: ['e'] }]),
  );
  const report = buildLayeredReport({ layers });
  assert.equal(report.ok, true);
  assert.equal(report.allPassed, true);
});

test('a passed layer without evidence is flagged', () => {
  const report = buildLayeredReport({ layers: { archive: { state: 'passed', evidence: [] } } });
  assert.equal(report.ok, false);
  assert.equal(report.issues[0].code, 'PASS_WITHOUT_EVIDENCE');
});

test('an unknown layer or invalid state is refused', () => {
  assert.equal(
    buildLayeredReport({ layers: { nope: { state: 'passed' } } }).code,
    'REPORT_INVALID',
  );
  const report = buildLayeredReport({ layers: { archive: { state: 'great' } } });
  assert.equal(report.issues[0].code, 'LAYER_STATE_INVALID');
});

test('documents, templates and scripts cannot prove execution', () => {
  // AC-34
  for (const kind of ['report-template', 'requirement-baseline', 'generated-document', 'script']) {
    const result = assertExecutionEvidence({
      source: { kind, state: 'passed', command: 'npm test', exitCode: 0, recordedAt: at },
    });
    assert.equal(result.ok, false, kind);
    assert.equal(result.code, 'EVIDENCE_NOT_EXECUTION');
  }
});

test('a real execution record passes the evidence check', () => {
  const result = assertExecutionEvidence({
    source: { kind: 'command', state: 'passed', command: 'npm test', exitCode: 0, recordedAt: at },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
});

test('evidence without command, exit code or timestamp is incomplete', () => {
  const base = {
    kind: 'command',
    state: 'passed',
    command: 'npm test',
    exitCode: 0,
    recordedAt: at,
  };
  for (const mutate of [{ command: undefined }, { exitCode: 1 }, { recordedAt: 'not-a-date' }]) {
    const result = assertExecutionEvidence({ source: { ...base, ...mutate } });
    assert.equal(result.ok, false, JSON.stringify(mutate));
  }
  assert.equal(
    assertExecutionEvidence({ source: { ...base, state: 'not-run' } }).code,
    'EVIDENCE_NOT_PASSED',
  );
});

test('a PASS cannot be reused on a different commit', () => {
  // AC-35
  const result = canReusePass({ passCommit: C1, targetCommit: C2 });
  assert.equal(result.reusable, false);
  assert.equal(result.reason, 'commit-changed');
  assert.equal(result.requiresRerun, true);
});

test('a PASS survives on the same commit', () => {
  const result = canReusePass({ passCommit: C1, targetCommit: C1 });
  assert.equal(result.reusable, true);
  assert.equal(result.requiresRerun, false);
});

test('a formatter that rewrote the commit invalidates the earlier PASS', () => {
  const result = canReusePass({ passCommit: C1, targetCommit: C1, formattingRewroteCommit: true });
  assert.equal(result.reusable, false);
  assert.equal(result.reason, 'formatter-created-a-new-commit');
  assert.equal(result.requiresRerun, true);
});

test('a format check is distinguished from a formatting action', () => {
  const check = classifyFormatCheck({ argv: ['npm', 'run', 'format:check'] });
  assert.equal(check.mode, 'check');
  assert.equal(check.readOnly, true);
  assert.equal(check.changesWorkingTree, false);

  const write = classifyFormatCheck({ argv: ['prettier', '--write', '.'] });
  assert.equal(write.mode, 'write');
  assert.equal(write.readOnly, false);
  assert.equal(write.changesWorkingTree, true, '会写文件就必须重跑质量门');
});

test('an explicit write flag wins over a coexisting check flag by explicitness', () => {
  // 两者同时出现时，写入意图优先，避免把写操作误判为只读。
  const both = classifyFormatCheck({ argv: ['prettier', '--write', '--check', '.'] });
  assert.equal(both.readOnly, false);
});

test('an explicitly declared write behaviour overrides the heuristic', () => {
  const declared = classifyFormatCheck({ argv: ['weird-formatter'], writesFiles: true });
  assert.equal(declared.mode, 'write');
});

test('invalid input is refused', () => {
  assert.equal(buildLayeredReport({ layers: 'x' }).code, 'REPORT_INVALID');
  assert.equal(assertExecutionEvidence({ source: null }).code, 'EVIDENCE_INVALID');
  assert.equal(canReusePass({ passCommit: 'nope', targetCommit: C1 }).code, 'EVIDENCE_INVALID');
  assert.equal(classifyFormatCheck({ argv: 'x' }).code, 'EVIDENCE_INVALID');
});
