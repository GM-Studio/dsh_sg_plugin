const failure = (code, message) => ({ ok: false, code, message });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 16000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const clone = (value) => JSON.parse(JSON.stringify(value));

function evidenceIndex(evidence) {
  return new Map(
    (Array.isArray(evidence) ? evidence : [])
      .filter((entry) => object(entry) && typeof entry.evidenceId === 'string')
      .map((entry) => [entry.evidenceId, entry]),
  );
}

function normalizeIssue(value, index) {
  if (typeof value === 'string')
    return {
      id: `ISSUE-${index + 1}`,
      severity: 'info',
      text: value,
      evidence: 'structured-input',
    };
  if (!object(value) || !text(value.text || value.summary, 4000)) return null;
  return {
    id: text(value.id, 128) ? value.id : `ISSUE-${index + 1}`,
    severity: text(value.severity, 64) ? value.severity : 'info',
    text: value.text || value.summary,
    evidence: text(value.evidence, 1024) ? value.evidence : 'structured-input',
  };
}

export function buildOutcome({
  contract,
  commit,
  verification,
  evidence = [],
  review = null,
  delivery = null,
  modelSummary = null,
} = {}) {
  if (!object(contract) || !object(verification) || !text(commit, 128))
    return failure('OUTCOME_INPUT_INVALID', 'Contract, verification and commit are required');
  if (!Array.isArray(verification.acCoverage))
    return failure('OUTCOME_INPUT_INVALID', 'Verification AC coverage is required');
  const evidenceMap = evidenceIndex(evidence);
  const acceptance = verification.acCoverage.map((entry) => ({
    acId: entry.acId,
    status:
      entry.sufficiency === 'sufficient' &&
      entry.evidenceIds?.some((id) => evidenceMap.get(id)?.status === 'passed')
        ? 'passed'
        : 'insufficient',
    evidenceIds: [...(entry.evidenceIds || [])],
    summary: entry.summary,
  }));
  const issueMap = new Map();
  for (const [index, entry] of [
    ...(verification.openRisks || []),
    ...(contract.risks || []),
  ].entries()) {
    const issue = normalizeIssue(entry, index);
    if (issue && !issueMap.has(issue.text)) issueMap.set(issue.text, issue);
  }
  const knownIssues = [...issueMap.values()];
  const blocking = knownIssues.some((entry) => entry.severity === 'blocking');
  const deliverable =
    !blocking &&
    acceptance.length > 0 &&
    acceptance.every((entry) => entry.status === 'passed') &&
    ['requires-h3', 'verified-awaiting-acceptance'].includes(verification.decision);
  const decisionText = deliverable
    ? 'Evidence is sufficient for the next human release gate; delivery is not customer-accepted.'
    : 'Evidence is insufficient or blocked; delivery is not deliverable.';
  const summaryConflict =
    typeof modelSummary === 'string' &&
    modelSummary.length > 0 &&
    ((!deliverable && /\b(passed|complete|deliverable|ready)\b/i.test(modelSummary)) ||
      (blocking && /\bno (?:known )?(?:issues|risks)\b/i.test(modelSummary)));
  return {
    ok: true,
    outcome: {
      schemaVersion: 1,
      changeId: contract.changeId,
      commit,
      verificationId: verification.verificationId,
      risk: verification.risk,
      acceptance,
      evidence: [...new Set(acceptance.flatMap((entry) => entry.evidenceIds))],
      knownIssues,
      deliverable,
      customerAccepted:
        delivery?.releaseState === 'customer-accepted' &&
        delivery?.customerAcceptance?.status === 'accepted',
      summaryConflict,
      summary: decisionText,
      modelSummary:
        typeof modelSummary === 'string' && modelSummary.length <= 16000 ? modelSummary : null,
      review: review ? clone(review) : null,
      delivery: delivery ? clone(delivery) : null,
    },
  };
}
