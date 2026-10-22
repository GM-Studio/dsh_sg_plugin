import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOutcome } from '../src/codex/control/outcome.js';

const verification = {
  verificationId: 'verify-1',
  risk: 'yellow',
  decision: 'requires-h3',
  independenceLevel: 'fresh-context',
  reviewMode: 'evidence-and-diff',
  environmentFingerprint: 'b'.repeat(64),
  acCoverage: [
    {
      acId: 'AC-1',
      evidenceIds: ['evidence-1'],
      sufficiency: 'sufficient',
      summary: 'AC-1 passed.',
    },
  ],
  evidence: ['evidence-1'],
  openRisks: [
    {
      id: 'RISK-1',
      severity: 'warning',
      text: 'Legacy import remains out of scope.',
      evidence: 'scope',
    },
  ],
};

test('Outcome is generated from structured verification facts', () => {
  const built = buildOutcome({
    contract: {
      changeId: 'change-1',
      request: 'Fix export',
      acceptance: ['AC-1'],
      risks: ['Legacy import remains out of scope.'],
    },
    commit: 'a'.repeat(40),
    verification,
    evidence: [
      {
        evidenceId: 'evidence-1',
        type: 'automated-test',
        status: 'passed',
        summary: 'Export test passed.',
      },
    ],
  });
  assert.equal(built.ok, true);
  assert.equal(built.outcome.deliverable, true);
  assert.equal(built.outcome.knownIssues.length, 1);
  assert.equal(built.outcome.acceptance[0].status, 'passed');
  assert.equal(built.outcome.risk, 'yellow');
});

test('Outcome cannot turn insufficient evidence into a completion', () => {
  const built = buildOutcome({
    contract: {
      changeId: 'change-1',
      request: 'Fix export',
      acceptance: ['AC-1', 'AC-2'],
      risks: [],
    },
    commit: 'a'.repeat(40),
    verification: {
      ...verification,
      acCoverage: [
        ...verification.acCoverage,
        {
          acId: 'AC-2',
          evidenceIds: [],
          sufficiency: 'insufficient',
          summary: 'No evidence.',
        },
      ],
    },
    evidence: [{ evidenceId: 'evidence-1', status: 'passed' }],
  });
  assert.equal(built.ok, true);
  assert.equal(built.outcome.deliverable, false);
  assert.equal(built.outcome.acceptance[1].status, 'insufficient');
});

test('Model summary claims are retained only as rendering metadata', () => {
  const built = buildOutcome({
    contract: {
      changeId: 'change-1',
      request: 'Fix export',
      acceptance: ['AC-1'],
      risks: [],
    },
    commit: 'a'.repeat(40),
    verification: {
      ...verification,
      acCoverage: [
        {
          acId: 'AC-1',
          evidenceIds: [],
          sufficiency: 'insufficient',
          summary: 'No evidence.',
        },
      ],
    },
    evidence: [],
    modelSummary: 'All criteria passed and the delivery is ready.',
  });
  assert.equal(built.outcome.deliverable, false);
  assert.equal(built.outcome.summaryConflict, true);
  assert.match(built.outcome.summary, /insufficient|not deliverable/i);
});
