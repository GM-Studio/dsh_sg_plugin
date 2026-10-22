import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canStartChange,
  validateChangeContract,
  validateDeliveryRecord,
  validateDeliveryStateTransition,
  validateEvidence,
  validateProjectBaseline,
  validateProjectProfile,
  validateVerificationAssessment,
} from '../src/codex/project-model.js';

const SHA = 'a'.repeat(40);
const HASH = 'b'.repeat(64);
const NOW = '2026-10-22T10:00:00.000Z';

function profile(patch = {}) {
  return {
    schemaVersion: 2,
    projectId: 'project-1',
    mode: 'new',
    stack: 'java-vue',
    root: '/tmp/project',
    targetBranch: 'main',
    remoteUrl: null,
    pushApproved: false,
    backendPackage: 'com.example.tasks',
    frontendDefaultLocale: 'zh-CN',
    frontendLocales: ['zh-CN', 'en-US'],
    commands: {
      install: [{ id: 'install', cwd: '.', argv: ['npm', 'ci'] }],
      build: [{ id: 'build', cwd: '.', argv: ['mvn', '-B', 'verify'] }],
      test: [{ id: 'test', cwd: '.', argv: ['mvn', '-B', 'test'] }],
      lint: [],
      format: [],
      runtime: [],
    },
    protectedPaths: ['.env'],
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

function baseline(patch = {}) {
  return {
    schemaVersion: 2,
    baselineId: 'baseline-1',
    projectId: 'project-1',
    commit: SHA,
    status: 'green',
    knownFailures: [],
    unverifiedAreas: [],
    commands: [],
    evidence: [],
    environmentFingerprint: HASH,
    createdAt: NOW,
    ...patch,
  };
}

function contract(patch = {}) {
  return {
    schemaVersion: 2,
    changeId: 'change-1',
    parentDeliveryId: null,
    type: 'fix',
    request: 'Fix the title filter.',
    scope: ['Task title filter'],
    nonGoals: ['Do not change task creation.'],
    acceptance: ['AC-1'],
    assumptions: [],
    risks: [],
    baselineId: 'baseline-1',
    status: 'H1_PENDING',
    ...patch,
  };
}

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
    artifacts: [{ path: '.specgate/codex/evidence/test.log', sha256: HASH }],
    summary: 'The title filter regression passed.',
    environmentFingerprint: HASH,
    ...patch,
  };
}

function assessment(patch = {}) {
  return {
    schemaVersion: 2,
    verificationId: 'verify-1',
    risk: 'green',
    independenceLevel: 'fresh-context',
    acCoverage: [
      {
        acId: 'AC-1',
        evidenceIds: ['evidence-1'],
        sufficiency: 'sufficient',
        summary: 'Automated regression covers the reported behavior.',
      },
    ],
    evidence: ['evidence-1'],
    reviewMode: 'evidence',
    environmentFingerprint: HASH,
    openRisks: [],
    decision: 'requires-h3',
    ...patch,
  };
}

function delivery(patch = {}) {
  return {
    schemaVersion: 2,
    deliveryId: 'delivery-1',
    projectId: 'project-1',
    changeId: 'change-1',
    parentDeliveryId: null,
    baselineCommit: SHA,
    deliveryCommit: SHA,
    tag: 'specgate-delivery-delivery-1',
    state: 'delivery-accepted',
    environmentFingerprint: HASH,
    reviewMode: 'evidence',
    acceptedAt: NOW,
    acceptance: ['AC-1'],
    evidence: ['evidence-1'],
    knownIssues: [],
    rollback: {
      code: 'git revert ' + SHA,
      data: 'No data migration.',
      forwardFix: 'Apply the next delivery.',
    },
    push: {
      requested: false,
      remoteUrl: null,
      status: 'not-requested',
    },
    ...patch,
  };
}

test('ProjectProfile accepts new and adopted Java/Vue modes and rejects unsafe configuration', () => {
  for (const mode of ['new', 'adopted']) {
    assert.deepEqual(validateProjectProfile(profile({ mode })), { ok: true });
  }
  assert.equal(validateProjectProfile(profile({ mode: 'imported' })).ok, false);
  assert.equal(validateProjectProfile(profile({ stack: 'node' })).ok, false);
  assert.equal(
    validateProjectProfile(profile({ remoteUrl: 'https://user:secret@example.com/repo.git' })).ok,
    false,
  );
  assert.equal(validateProjectProfile(profile({ pushApproved: 'yes' })).ok, false);
  assert.equal(validateProjectProfile(profile({ backendPackage: 'Com.Example' })).ok, false);
  assert.equal(
    validateProjectProfile(
      profile({ frontendDefaultLocale: 'fr-FR', frontendLocales: ['zh-CN', 'en-US'] }),
    ).ok,
    false,
  );
  assert.equal(
    validateProjectProfile(profile({ commands: { build: [{ argv: 'mvn verify' }] } })).ok,
    false,
  );
  assert.equal(validateProjectProfile(profile({ token: 'secret' })).ok, false);
});

test('ProjectProfile accepts an optional frontend framework and Java preset and rejects invalid ones', () => {
  assert.deepEqual(validateProjectProfile(profile({ frontendFramework: 'vue' })), { ok: true });
  assert.deepEqual(validateProjectProfile(profile({ frontendFramework: 'react' })), { ok: true });
  assert.deepEqual(validateProjectProfile(profile({ javaPreset: 'jdk21-boot3.5' })), { ok: true });
  assert.equal(
    validateProjectProfile(profile({ frontendFramework: 'svelte' })).code,
    'PROJECT_CONVENTIONS_INVALID',
  );
  assert.equal(
    validateProjectProfile(profile({ frontendFramework: 'React' })).code,
    'PROJECT_CONVENTIONS_INVALID',
  );
  assert.equal(
    validateProjectProfile(profile({ javaPreset: 'not a preset' })).code,
    'PROJECT_CONVENTIONS_INVALID',
  );
});

test('ProjectBaseline permits adopted known failures but never allows an unknown start', () => {
  assert.deepEqual(validateProjectBaseline(baseline()), { ok: true });
  assert.deepEqual(
    validateProjectBaseline(
      baseline({
        status: 'known-failures',
        knownFailures: [
          {
            id: 'known-1',
            signature: 'legacy-test-timeout',
            commandId: 'test',
            scope: 'legacy task suite',
            evidence: 'evidence-1',
          },
        ],
      }),
    ),
    { ok: true },
  );
  assert.equal(validateProjectBaseline(baseline({ status: 'partial' })).ok, true);
  assert.equal(validateProjectBaseline(baseline({ status: 'unknown' })).ok, true);
  assert.equal(validateProjectBaseline(baseline({ status: 'red' })).ok, false);
  assert.equal(validateProjectBaseline(baseline({ commit: 'main' })).ok, false);
  assert.equal(
    validateProjectBaseline(baseline({ status: 'known-failures', knownFailures: [] })).ok,
    false,
  );
});

test('canStartChange requires a valid matching profile and a non-unknown baseline', () => {
  assert.deepEqual(canStartChange({ profile: profile(), baseline: baseline() }), { ok: true });
  assert.equal(
    canStartChange({
      profile: profile({ mode: 'adopted' }),
      baseline: baseline({ status: 'known-failures', knownFailures: [{ id: 'known-1' }] }),
    }).code,
    'KNOWN_FAILURE_INVALID',
  );
  assert.equal(
    canStartChange({ profile: profile(), baseline: baseline({ status: 'unknown' }) }).code,
    'BASELINE_NOT_READY',
  );
  assert.equal(
    canStartChange({
      profile: profile({ projectId: 'project-2' }),
      baseline: baseline(),
    }).code,
    'BASELINE_PROJECT_MISMATCH',
  );
});

test('ChangeContract allows only feature, modify and fix with observable acceptance IDs', () => {
  for (const type of ['feature', 'modify', 'fix']) {
    assert.deepEqual(validateChangeContract(contract({ type })), { ok: true });
  }
  assert.equal(validateChangeContract(contract({ type: 'delete' })).ok, false);
  assert.equal(validateChangeContract(contract({ acceptance: [] })).ok, false);
  assert.equal(validateChangeContract(contract({ scope: [] })).ok, false);
  assert.equal(validateChangeContract(contract({ parentDeliveryId: '../delivery' })).ok, false);
  assert.equal(validateChangeContract(contract({ request: 'password=plaintext' })).ok, false);
});

test('Evidence cannot convert skipped, not-run, timeout or cancelled into passed', () => {
  for (const status of ['passed', 'failed', 'skipped', 'not-run', 'timeout', 'cancelled']) {
    const result = validateEvidence(evidence({ status, exitCode: status === 'passed' ? 0 : null }));
    assert.equal(result.ok, true, status);
  }
  assert.equal(
    validateEvidence(evidence({ status: 'skipped', exitCode: 0, summary: 'passed' })).code,
    'EVIDENCE_STATUS_INVALID',
  );
  assert.equal(validateEvidence(evidence({ commit: 'dirty' })).ok, false);
  assert.equal(validateEvidence(evidence({ acIds: [] })).ok, false);
  assert.equal(
    validateEvidence(evidence({ summary: 'token=abcdefghijklmnop' })).code,
    'SENSITIVE_EVIDENCE',
  );
});

test('VerificationAssessment requires sufficient current evidence before H3', () => {
  assert.deepEqual(validateVerificationAssessment(assessment()), { ok: true });
  assert.equal(
    validateVerificationAssessment(
      assessment({
        acCoverage: [
          {
            acId: 'AC-1',
            evidenceIds: [],
            sufficiency: 'insufficient',
            summary: 'Only an unrelated unit test exists.',
          },
        ],
        evidence: [],
      }),
    ).code,
    'EVIDENCE_INSUFFICIENT',
  );
  assert.equal(
    validateVerificationAssessment(
      assessment({
        risk: 'red',
        reviewMode: 'evidence',
        independenceLevel: 'fresh-context',
      }),
    ).code,
    'HIGH_RISK_REVIEW_REQUIRED',
  );
  assert.equal(
    validateVerificationAssessment(assessment({ independenceLevel: 'self-report' })).code,
    'VERIFICATION_NOT_INDEPENDENT',
  );
});

test('VerificationAssessment records not-run, flaky and unresolved risk without claiming a pass', () => {
  const result = validateVerificationAssessment(
    assessment({
      evidence: ['evidence-1', 'evidence-2'],
      acCoverage: [
        {
          acId: 'AC-1',
          evidenceIds: ['evidence-1'],
          sufficiency: 'sufficient',
          summary: 'Regression passed after one retry.',
        },
        {
          acId: 'AC-2',
          evidenceIds: ['evidence-2'],
          sufficiency: 'insufficient',
          summary: 'Browser observation was not executed.',
        },
      ],
      openRisks: [
        {
          id: 'risk-1',
          severity: 'medium',
          text: 'Flaky history has a single prior pass.',
          evidence: 'evidence-2',
        },
      ],
      decision: 'blocked',
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(
    validateVerificationAssessment(
      assessment({
        acCoverage: [
          {
            acId: 'AC-1',
            evidenceIds: [],
            sufficiency: 'insufficient',
            summary: 'Not executed.',
          },
        ],
        evidence: [],
      }),
    ).ok,
    false,
  );
});

test('DeliveryRecord state never conflates verification, acceptance, push and deployment', () => {
  assert.deepEqual(validateDeliveryRecord(delivery()), { ok: true });
  assert.equal(validateDeliveryRecord(delivery({ state: 'pushed' })).code, 'PUSH_STATE_INVALID');
  assert.equal(
    validateDeliveryRecord(delivery({ state: 'deployed-verified', push: { requested: false } })).ok,
    false,
  );
  assert.equal(validateDeliveryRecord(delivery({ deliveryCommit: 'main' })).ok, false);
  assert.equal(validateDeliveryRecord(delivery({ acceptance: [] })).ok, false);
});

test('Delivery state transitions are append-only and require acceptance before push', () => {
  assert.deepEqual(validateDeliveryStateTransition('change-verified', 'delivery-accepted'), {
    ok: true,
  });
  assert.deepEqual(validateDeliveryStateTransition('delivery-accepted', 'pushed'), { ok: true });
  assert.deepEqual(validateDeliveryStateTransition('pushed', 'deployed-unknown'), { ok: true });
  assert.deepEqual(validateDeliveryStateTransition('deployed-unknown', 'deployed-verified'), {
    ok: true,
  });
  assert.equal(validateDeliveryStateTransition('change-verified', 'pushed').ok, false);
  assert.equal(validateDeliveryStateTransition('pushed', 'delivery-accepted').ok, false);
});
