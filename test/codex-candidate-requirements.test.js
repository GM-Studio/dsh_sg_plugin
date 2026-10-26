import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVIDENCE_CLASSES,
  STATIC_ONLY_CLASSES,
  isEvidenceClass,
  isRuntimeVerified,
  isUserConfirmed,
  candidateRequirement,
  candidatesFromObservations,
  evidenceGaps,
  snapshotId,
  buildRequirementBaseline,
  renderCandidate,
} from '../src/codex/core/discovery/candidates.js';

const refs = ['src/app.js:1'];

test('only four evidence classes exist', () => {
  assert.deepEqual([...EVIDENCE_CLASSES].sort(), [
    'inferred-intent',
    'runtime-verified',
    'static-observed',
    'user-confirmed',
  ]);
  for (const value of ['observed', 'assumed', 'tested', '', null, 42])
    assert.equal(isEvidenceClass(value), false, String(value));
  for (const value of EVIDENCE_CLASSES) assert.equal(isEvidenceClass(value), true, value);
});

test('static analysis cannot claim runtime verification or user confirmation', () => {
  for (const evidenceClass of ['runtime-verified', 'user-confirmed']) {
    const result = candidateRequirement({
      id: 'C-1',
      text: 'The system exports reports.',
      evidenceClass,
      sourceRefs: refs,
      stage: 'static',
    });
    assert.equal(result.ok, false, evidenceClass);
    assert.equal(result.code, 'CANDIDATE_EVIDENCE_ESCALATION');
    assert.deepEqual(result.allowed, [...STATIC_ONLY_CLASSES]);
  }
});

test('reading a test file statically never becomes runtime-verified', () => {
  // AC-05：测试文件存在 ≠ 测试已运行。
  const built = candidatesFromObservations([
    {
      id: 'test-exists',
      text: 'export.spec.js 断言导出接口',
      sourceRefs: ['test/export.spec.js:12'],
    },
  ]);
  assert.equal(built.ok, true);
  assert.equal(built.candidates.length, 1);
  assert.equal(built.candidates[0].evidenceClass, 'static-observed');
  assert.equal(built.candidates[0].runtimeVerified, false);
  assert.equal(isRuntimeVerified(built.candidates[0].evidenceClass), false);
});

test('model inference is marked inferred and never shown as user confirmed', () => {
  const built = candidatesFromObservations([
    { id: 'intent', text: '导出功能用于月度结算', sourceRefs: ['README.md:4'], inferred: true },
  ]);
  const candidate = built.candidates[0];
  assert.equal(candidate.evidenceClass, 'inferred-intent');
  assert.equal(candidate.userConfirmed, false);
  assert.equal(isUserConfirmed(candidate.evidenceClass), false);
  const rendered = renderCandidate(candidate);
  assert.match(rendered, /模型推断（未经用户确认）/);
  assert.doesNotMatch(rendered, /用户已确认/);
});

test('a candidate without sources is refused rather than fabricated', () => {
  for (const sourceRefs of [[], null, undefined, ['']]) {
    const result = candidateRequirement({
      id: 'C-2',
      text: 'Something observable.',
      evidenceClass: 'static-observed',
      sourceRefs,
    });
    assert.equal(result.ok, false, JSON.stringify(sourceRefs));
    assert.equal(result.code, 'CANDIDATE_INVALID');
  }
});

test('observations lacking sources are reported as rejected, not silently dropped', () => {
  const built = candidatesFromObservations([
    { id: 'good', text: 'A fact', sourceRefs: ['a.js:1'] },
    { id: 'bad', text: 'No source' },
  ]);
  assert.equal(built.ok, true);
  assert.equal(built.candidates.length, 1);
  assert.equal(built.rejected.length, 1);
  assert.equal(built.rejected[0].id, 'bad');
  assert.equal(built.rejected[0].code, 'CANDIDATE_INVALID');
});

test('declared capabilities are not evidence that anything ran', () => {
  const gaps = evidenceGaps({
    capabilities: [
      { id: 'root-npm-build', kind: 'build' },
      { id: 'root-npm-test', kind: 'test' },
    ],
    observedEvidence: [],
  });
  assert.equal(gaps.length, 2);
  for (const gap of gaps) assert.equal(gap.reason, 'capability-declared-but-not-executed');
});

test('a capability with real evidence is not listed as a gap', () => {
  const gaps = evidenceGaps({
    capabilities: [{ id: 'a', kind: 'build' }],
    observedEvidence: [{ kind: 'build', status: 'passed' }],
  });
  assert.deepEqual(gaps, []);
});

test('a snapshot id is stable, content based and explicitly not an execution baseline', () => {
  const files = [
    { path: 'b.js', bytes: 10 },
    { path: 'a.js', bytes: 5 },
  ];
  const first = snapshotId({ files });
  const second = snapshotId({ files: [...files].reverse() });
  assert.equal(first.snapshotId, second.snapshotId, '顺序不影响快照标识');
  assert.match(first.snapshotId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.representsExecutionBaseline, false);
  // 内容变化必须改变标识。
  const changed = snapshotId({ files: [...files, { path: 'c.js', bytes: 1 }] });
  assert.notEqual(changed.snapshotId, first.snapshotId);
});

test('a repository without git still gets a snapshot id', () => {
  const result = snapshotId({ files: [{ path: 'x.py', bytes: 3 }], gitCommit: null });
  assert.match(result.snapshotId, /^sha256:/);
  assert.equal(result.gitCommit, null);
});

test('a requirement baseline never claims execution and keeps revision history', () => {
  const previous = { revision: 1, snapshot: { snapshotId: 'sha256:aaa' } };
  const built = buildRequirementBaseline({
    candidates: [
      {
        id: 'C-1',
        text: 'Export exists.',
        evidenceClass: 'static-observed',
        sourceRefs: refs,
      },
    ],
    snapshot: { snapshotId: 'sha256:bbb', fileCount: 3 },
    gaps: ['no test command'],
    revision: 2,
    previous,
  });
  assert.equal(built.ok, true);
  const baseline = built.baseline;
  assert.equal(baseline.kind, 'requirement-baseline');
  assert.equal(baseline.revision, 2);
  assert.equal(baseline.isExecutionBaseline, false, '不得冒充执行基线');
  assert.equal(baseline.claimsExecutionPass, false, '生成文档不得产生通过结论');
  assert.equal(baseline.previousRevision.revision, 1);
  assert.equal(baseline.candidates[0].evidenceClass, 'static-observed');
});

test('a baseline with a duplicate or sourceless candidate is refused', () => {
  const duplicate = buildRequirementBaseline({
    candidates: [
      { id: 'C-1', text: 'a', evidenceClass: 'static-observed', sourceRefs: refs },
      { id: 'C-1', text: 'b', evidenceClass: 'static-observed', sourceRefs: refs },
    ],
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.code, 'BASELINE_INVALID');

  const sourceless = buildRequirementBaseline({
    candidates: [{ id: 'C-2', text: 'a', evidenceClass: 'static-observed', sourceRefs: [] }],
  });
  assert.equal(sourceless.ok, false);
  assert.equal(sourceless.code, 'BASELINE_INVALID');

  const badClass = buildRequirementBaseline({
    candidates: [{ id: 'C-3', text: 'a', evidenceClass: 'assumed', sourceRefs: refs }],
  });
  assert.equal(badClass.ok, false);
});

test('rendering always shows the evidence class so a reader can tell confirmation apart', () => {
  const rendered = renderCandidate({
    id: 'C-1',
    text: 'Orders can be exported.',
    evidenceClass: 'static-observed',
    sourceRefs: ['src/orders.js:10', 'test/orders.test.js:4'],
  });
  assert.match(rendered, /静态观察/);
  assert.match(rendered, /src\/orders\.js:10/);
  assert.match(rendered, /test\/orders\.test\.js:4/);
});
