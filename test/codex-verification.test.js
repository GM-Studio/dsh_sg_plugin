import test from 'node:test';
import assert from 'node:assert/strict';
import { assessVerification } from '../src/codex/verification.js';

const SHA = 'a'.repeat(40);
const ENV = 'b'.repeat(64);
const NOW = '2026-10-22T10:00:00.000Z';

function evidence(patch = {}) {
  return {
    schemaVersion: 2,
    evidenceId: 'evidence-1',
    type: 'automated-test',
    acIds: ['AC-1'],
    executor: 'specgate_verifier',
    command: ['npm', 'test'],
    cwd: '.',
    commit: SHA,
    startedAt: NOW,
    finishedAt: NOW,
    status: 'passed',
    exitCode: 0,
    artifacts: [],
    summary: 'The behavior passed.',
    environmentFingerprint: ENV,
    ...patch,
  };
}

test('green verification requires fresh passing evidence for every AC', () => {
  const result = assessVerification({
    risk: 'green',
    independenceLevel: 'fresh-context',
    reviewMode: 'evidence',
    commit: SHA,
    environmentFingerprint: ENV,
    acceptanceCriteria: [{ id: 'AC-1', text: 'Search returns matching tasks.' }],
    evidenceRequirements: [{ acId: 'AC-1', allowedTypes: ['automated-test'] }],
    evidence: [evidence()],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.assessment.decision, 'requires-h3');
  assert.equal(result.assessment.acCoverage[0].sufficiency, 'sufficient');
});

test('unrelated evidence, skipped evidence and missing evidence cannot prove an AC', () => {
  const result = assessVerification({
    risk: 'green',
    independenceLevel: 'fresh-context',
    reviewMode: 'evidence',
    commit: SHA,
    environmentFingerprint: ENV,
    acceptanceCriteria: [
      { id: 'AC-1', text: 'Search returns matching tasks.' },
      { id: 'AC-2', text: 'The empty state is visible.' },
    ],
    evidenceRequirements: [
      { acId: 'AC-1', allowedTypes: ['automated-test'] },
      { acId: 'AC-2', allowedTypes: ['browser-observation', 'manual-demo'] },
    ],
    evidence: [
      evidence({ acIds: ['AC-2'] }),
      evidence({ evidenceId: 'evidence-2', status: 'skipped', exitCode: null }),
    ],
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.assessment.decision, 'blocked');
  assert.equal(
    result.assessment.acCoverage.every((entry) => entry.sufficiency === 'insufficient'),
    true,
  );
});

test('stale commits and mismatched environments block verification', () => {
  const stale = assessVerification({
    risk: 'green',
    independenceLevel: 'fresh-context',
    reviewMode: 'evidence',
    commit: 'c'.repeat(40),
    environmentFingerprint: ENV,
    acceptanceCriteria: [{ id: 'AC-1', text: 'Search works.' }],
    evidenceRequirements: [{ acId: 'AC-1', allowedTypes: ['automated-test'] }],
    evidence: [evidence()],
  });
  assert.equal(stale.code, 'VERIFICATION_COMMIT_MISMATCH');
  const environment = assessVerification({
    risk: 'green',
    independenceLevel: 'fresh-context',
    reviewMode: 'evidence',
    commit: SHA,
    environmentFingerprint: 'd'.repeat(64),
    acceptanceCriteria: [{ id: 'AC-1', text: 'Search works.' }],
    evidenceRequirements: [{ acId: 'AC-1', allowedTypes: ['automated-test'] }],
    evidence: [evidence()],
  });
  assert.equal(environment.code, 'VERIFICATION_ENVIRONMENT_MISMATCH');
});

test('red verification requires a fixed-commit full review and can remain blocked by risk', () => {
  const missingReview = assessVerification({
    risk: 'red',
    independenceLevel: 'fresh-context',
    reviewMode: 'evidence-and-diff',
    commit: SHA,
    environmentFingerprint: ENV,
    acceptanceCriteria: [{ id: 'AC-1', text: 'Payment reconciliation is correct.' }],
    evidenceRequirements: [{ acId: 'AC-1', allowedTypes: ['automated-test', 'manual-demo'] }],
    evidence: [evidence()],
  });
  assert.equal(missingReview.code, 'HIGH_RISK_REVIEW_REQUIRED');
  const blocked = assessVerification({
    risk: 'red',
    independenceLevel: 'strict-review',
    reviewMode: 'full-code-review',
    commit: SHA,
    environmentFingerprint: ENV,
    acceptanceCriteria: [{ id: 'AC-1', text: 'Payment reconciliation is correct.' }],
    evidenceRequirements: [{ acId: 'AC-1', allowedTypes: ['automated-test'] }],
    evidence: [evidence()],
    openRisks: [
      {
        id: 'risk-1',
        severity: 'blocking',
        text: 'Migration was not exercised.',
        evidence: 'review-1',
      },
    ],
  });
  assert.equal(blocked.ok, true, JSON.stringify(blocked));
  assert.equal(blocked.assessment.decision, 'blocked');
});

test('self-report cannot satisfy independent verification', () => {
  const result = assessVerification({
    risk: 'yellow',
    independenceLevel: 'self-report',
    reviewMode: 'evidence',
    commit: SHA,
    environmentFingerprint: ENV,
    acceptanceCriteria: [{ id: 'AC-1', text: 'Search works.' }],
    evidenceRequirements: [{ acId: 'AC-1', allowedTypes: ['automated-test'] }],
    evidence: [evidence()],
  });
  assert.equal(result.code, 'VERIFICATION_NOT_INDEPENDENT');
});
