import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPOSITIONS,
  applyDisposition,
  createRevision,
  evidenceTrail,
} from '../src/codex/core/discovery/baseline-revision.js';

const seed = () => [
  {
    id: 'C-1',
    text: 'Orders can be exported as CSV.',
    evidenceClass: 'static-observed',
    sourceRefs: ['src/orders.js:12'],
  },
  {
    id: 'C-2',
    text: 'Export runs monthly.',
    evidenceClass: 'inferred-intent',
    sourceRefs: ['README.md:4'],
  },
];

const base = () => {
  const created = createRevision({ candidates: seed(), snapshot: { snapshotId: 'sha256:a' } });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.revision;
};

test('three dispositions are supported', () => {
  assert.deepEqual([...DISPOSITIONS].sort(), ['confirm', 'correct', 'reject']);
});

test('confirming upgrades the class while keeping the original in history', () => {
  const revision = base();
  const result = applyDisposition({
    revision,
    candidateId: 'C-2',
    action: 'confirm',
    actionId: 'act-1',
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const answered = result.revision.candidates.find((entry) => entry.id === 'C-2');
  assert.equal(answered.evidenceClass, 'user-confirmed');
  assert.equal(answered.userConfirmed, true);
  // 原始证据不被覆盖。
  const trail = evidenceTrail(result.revision, 'C-2');
  assert.equal(trail.length, 1);
  assert.equal(trail[0].original.evidenceClass, 'inferred-intent');
  assert.deepEqual(trail[0].original.sourceRefs, ['README.md:4']);
});

test('the input revision is not mutated', () => {
  const revision = base();
  const snapshot = JSON.stringify(revision);
  applyDisposition({ revision, candidateId: 'C-1', action: 'confirm', actionId: 'act-1' });
  assert.equal(JSON.stringify(revision), snapshot, '历史不可变');
});

test('correcting produces revision N+1 and keeps N readable', () => {
  const revision = base();
  const result = applyDisposition({
    revision,
    candidateId: 'C-2',
    action: 'correct',
    text: 'Export runs on the 1st of each month.',
    actionId: 'act-2',
  });
  assert.equal(result.ok, true);
  assert.equal(result.revision.revision, revision.revision + 1);
  const corrected = result.revision.candidates.find((entry) => entry.id === 'C-2');
  assert.equal(corrected.text, 'Export runs on the 1st of each month.');
  assert.equal(corrected.evidenceClass, 'user-confirmed');
  // 旧陈述仍可读。
  const trail = evidenceTrail(result.revision, 'C-2');
  assert.equal(trail[0].original.text, 'Export runs monthly.');
});

test('correcting without a new statement is refused', () => {
  const revision = base();
  for (const value of [undefined, '', '   ']) {
    const result = applyDisposition({
      revision,
      candidateId: 'C-1',
      action: 'correct',
      text: value,
      actionId: 'act-3',
    });
    assert.equal(result.ok, false, String(value));
    assert.equal(result.code, 'DISPOSITION_INVALID');
  }
});

test('rejecting marks the candidate without deleting it', () => {
  const revision = base();
  const result = applyDisposition({
    revision,
    candidateId: 'C-2',
    action: 'reject',
    actionId: 'act-4',
  });
  assert.equal(result.ok, true);
  const rejected = result.revision.candidates.find((entry) => entry.id === 'C-2');
  assert.equal(rejected.status, 'rejected');
  assert.equal(result.revision.candidates.length, 2, '拒绝不得删除候选');
  assert.equal(evidenceTrail(result.revision, 'C-2').length, 1);
});

test('the same action id cannot be consumed twice', () => {
  const revision = base();
  const first = applyDisposition({
    revision,
    candidateId: 'C-1',
    action: 'confirm',
    actionId: 'act-5',
  });
  assert.equal(first.ok, true);
  const second = applyDisposition({
    revision: first.revision,
    candidateId: 'C-1',
    action: 'confirm',
    actionId: 'act-5',
    consumedActions: first.consumed,
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'DISPOSITION_ALREADY_CONSUMED');
});

test('an action id is required so consumption is auditable', () => {
  const revision = base();
  for (const actionId of [undefined, '', null]) {
    const result = applyDisposition({
      revision,
      candidateId: 'C-1',
      action: 'confirm',
      actionId,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'DISPOSITION_INVALID');
  }
});

test('an unknown candidate or action is refused', () => {
  const revision = base();
  assert.equal(
    applyDisposition({ revision, candidateId: 'nope', action: 'confirm', actionId: 'a' }).code,
    'CANDIDATE_NOT_FOUND',
  );
  assert.equal(
    applyDisposition({ revision, candidateId: 'C-1', action: 'delete', actionId: 'a' }).code,
    'DISPOSITION_INVALID',
  );
});

test('a revision never claims execution pass', () => {
  const revision = base();
  assert.equal(revision.isExecutionBaseline, false);
  assert.equal(revision.claimsExecutionPass, false);
  const after = applyDisposition({
    revision,
    candidateId: 'C-1',
    action: 'confirm',
    actionId: 'act-6',
  }).revision;
  assert.equal(after.claimsExecutionPass, false, '确认不等于执行通过');
});

test('duplicate candidate ids and illegal classes are refused at creation', () => {
  const duplicated = createRevision({
    candidates: [...seed(), { ...seed()[0] }],
  });
  assert.equal(duplicated.ok, false);
  assert.equal(duplicated.code, 'BASELINE_REVISION_INVALID');

  const illegal = createRevision({
    candidates: [{ id: 'C-9', text: 'x', evidenceClass: 'assumed', sourceRefs: ['a:1'] }],
  });
  assert.equal(illegal.ok, false);
});

test('history accumulates every disposition in order', () => {
  let revision = base();
  let consumed = [];
  const steps = [
    { candidateId: 'C-1', action: 'confirm', actionId: 'a1' },
    { candidateId: 'C-2', action: 'reject', actionId: 'a2' },
    {
      candidateId: 'C-1',
      action: 'correct',
      text: 'Export supports CSV and XLSX.',
      actionId: 'a3',
    },
  ];
  for (const step of steps) {
    const result = applyDisposition({ revision, consumedActions: consumed, ...step });
    assert.equal(result.ok, true, JSON.stringify(result));
    revision = result.revision;
    consumed = result.consumed;
  }
  assert.equal(revision.revision, 4);
  assert.deepEqual(
    revision.history.map((entry) => entry.actionId),
    ['a1', 'a2', 'a3'],
  );
  assert.equal(evidenceTrail(revision, 'C-1').length, 2);
});
