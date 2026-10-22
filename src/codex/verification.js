import { hashValue } from './events.js';
import { validateEvidence, validateVerificationAssessment } from './project-model.js';

const failure = (code, message) => ({ ok: false, code, message });

export function assessVerification({
  risk,
  independenceLevel,
  reviewMode,
  commit,
  environmentFingerprint,
  acceptanceCriteria,
  evidenceRequirements,
  evidence,
  openRisks = [],
  verificationId = `verify-${hashValue({ commit, risk }).slice(0, 16)}`,
} = {}) {
  if (['self-check', 'self-report'].includes(independenceLevel))
    return failure('VERIFICATION_NOT_INDEPENDENT', 'Independent verification is required');
  if (
    risk === 'red' &&
    (independenceLevel !== 'strict-review' || reviewMode !== 'full-code-review')
  )
    return failure('HIGH_RISK_REVIEW_REQUIRED', 'Red risk requires fixed-commit full review');
  if (
    !Array.isArray(acceptanceCriteria) ||
    !Array.isArray(evidenceRequirements) ||
    !Array.isArray(evidence)
  )
    return failure(
      'VERIFICATION_INVALID',
      'Acceptance criteria, requirements and evidence are required',
    );
  const validEvidence = [];
  for (const entry of evidence) {
    const checked = validateEvidence(entry);
    if (!checked.ok) return checked;
    if (entry.commit !== commit)
      return failure('VERIFICATION_COMMIT_MISMATCH', 'Evidence is not from the current commit');
    if (entry.environmentFingerprint !== environmentFingerprint)
      return failure(
        'VERIFICATION_ENVIRONMENT_MISMATCH',
        'Evidence was produced in a different verification environment',
      );
    validEvidence.push(entry);
  }
  const coverage = acceptanceCriteria.map((criterion) => {
    const requirement = evidenceRequirements.find((entry) => entry.acId === criterion.id) || {
      acId: criterion.id,
      allowedTypes: [],
    };
    const matched = validEvidence.filter(
      (entry) =>
        entry.acIds.includes(criterion.id) &&
        entry.status === 'passed' &&
        (requirement.allowedTypes.length === 0 || requirement.allowedTypes.includes(entry.type)),
    );
    return {
      acId: criterion.id,
      evidenceIds: matched.map((entry) => entry.evidenceId),
      sufficiency: matched.length > 0 ? 'sufficient' : 'insufficient',
      summary:
        matched.length > 0
          ? `Passing evidence covers ${criterion.id}.`
          : `No passing evidence of the required type covers ${criterion.id}.`,
    };
  });
  const blocking = openRisks.some((entry) => entry.severity === 'blocking');
  const assessment = {
    schemaVersion: 2,
    verificationId,
    risk,
    independenceLevel,
    acCoverage: coverage,
    evidence: [...new Set(validEvidence.map((entry) => entry.evidenceId))],
    reviewMode,
    environmentFingerprint,
    openRisks,
    decision:
      blocking || coverage.some((entry) => entry.sufficiency === 'insufficient')
        ? 'blocked'
        : 'requires-h3',
  };
  const checked = validateVerificationAssessment(assessment);
  return checked.ok ? { ok: true, assessment } : checked;
}
