const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const COMMIT = /^[a-f0-9]{40,64}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const JAVA_PACKAGE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){2,127}$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const FRONTEND_FRAMEWORKS = ['vue', 'react'];
const DELIVERY_STATES = [
  'change-verified',
  'delivery-accepted',
  'pushed',
  'deployed-unknown',
  'deployed-verified',
];
const EVIDENCE_STATES = ['passed', 'failed', 'skipped', 'not-run', 'timeout', 'cancelled'];
const EVIDENCE_TYPES = [
  'automated-test',
  'command',
  'http-observation',
  'browser-observation',
  'manual-demo',
  'database-migration-check',
  'user-acceptance',
];
const riskValues = new Set(['green', 'yellow', 'red']);
const independenceValues = new Set([
  'self-check',
  'self-report',
  'evidence-review',
  'fresh-context',
  'strict-review',
]);

const failure = (code, message) => ({ ok: false, code, message });
const ok = () => ({ ok: true });
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value, maximum = 32768) =>
  typeof value === 'string' && value.length > 0 && value.length <= maximum;
const id = (value) => typeof value === 'string' && ID.test(value);
const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const listOfText = (value, maximumItems = 200) =>
  Array.isArray(value) &&
  value.length <= maximumItems &&
  value.every((entry) => nonEmpty(entry, 4000));
const safeRelative = (value) =>
  nonEmpty(value, 1024) &&
  !value.includes('\0') &&
  !value.startsWith('/') &&
  !/^[A-Za-z]:/.test(value) &&
  value.split(/[\\/]/).every((part) => part && part !== '.' && part !== '..');
const safeCwd = (value) => value === '.' || safeRelative(value);
const exactKeys = (value, keys) =>
  object(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const sensitive = (value) =>
  /(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/i.test(
    JSON.stringify(value),
  );

function command(value) {
  return (
    exactKeys(
      value,
      Object.hasOwn(value || {}, 'timeoutMs')
        ? ['id', 'cwd', 'argv', 'timeoutMs']
        : ['id', 'cwd', 'argv'],
    ) &&
    id(value.id) &&
    safeCwd(value.cwd) &&
    Array.isArray(value.argv) &&
    value.argv.length > 0 &&
    value.argv.length <= 128 &&
    value.argv.every(
      (argument) =>
        nonEmpty(argument, 8192) && !argument.includes('\0') && !/[\r\n]/.test(argument),
    ) &&
    (value.timeoutMs === undefined ||
      (Number.isSafeInteger(value.timeoutMs) &&
        value.timeoutMs >= 1000 &&
        value.timeoutMs <= 1800000))
  );
}

function optionalRemote(value) {
  if (value === null) return true;
  if (!nonEmpty(value, 4096) || /[\r\n\0]/.test(value)) return false;
  if (/^[^/@\s]+:[^/@\s]+@/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (
      ['http:', 'https:', 'ssh:', 'git:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/.test(value);
  }
}

export function validateProjectProfile(value) {
  const baseKeys = [
    'schemaVersion',
    'projectId',
    'mode',
    'stack',
    'root',
    'targetBranch',
    'remoteUrl',
    'pushApproved',
    'commands',
    'protectedPaths',
    'createdAt',
    'updatedAt',
  ];
  const conventionKeys = [
    'backendPackage',
    'frontendDefaultLocale',
    'frontendLocales',
    'frontendFramework',
    'javaPreset',
  ];
  const keys = [...baseKeys, ...conventionKeys.filter((key) => Object.hasOwn(value || {}, key))];
  if (!exactKeys(value, keys))
    return failure('PROJECT_PROFILE_INVALID', 'ProjectProfile fields are invalid');
  if (
    value.schemaVersion !== 2 ||
    !id(value.projectId) ||
    !['new', 'adopted'].includes(value.mode) ||
    value.stack !== 'java-vue' ||
    !nonEmpty(value.root) ||
    !nonEmpty(value.targetBranch, 255) ||
    !optionalRemote(value.remoteUrl) ||
    typeof value.pushApproved !== 'boolean' ||
    !date(value.createdAt) ||
    !date(value.updatedAt)
  )
    return failure('PROJECT_PROFILE_INVALID', 'ProjectProfile identity or mode is invalid');
  if (
    !exactKeys(value.commands, ['install', 'build', 'test', 'lint', 'format', 'runtime']) ||
    Object.values(value.commands).some(
      (commands) =>
        !Array.isArray(commands) ||
        commands.length > 100 ||
        commands.some((entry) => !command(entry)),
    )
  )
    return failure('PROJECT_COMMANDS_INVALID', 'Project commands must be bounded argv records');
  if (
    !Array.isArray(value.protectedPaths) ||
    value.protectedPaths.length > 500 ||
    !value.protectedPaths.every(safeRelative)
  )
    return failure('PROJECT_PROFILE_INVALID', 'Protected paths must be project-relative');
  if (
    (value.backendPackage !== undefined &&
      (typeof value.backendPackage !== 'string' || !JAVA_PACKAGE.test(value.backendPackage))) ||
    (value.frontendDefaultLocale !== undefined &&
      (typeof value.frontendDefaultLocale !== 'string' ||
        !LOCALE.test(value.frontendDefaultLocale))) ||
    (value.frontendLocales !== undefined &&
      (!Array.isArray(value.frontendLocales) ||
        value.frontendLocales.length === 0 ||
        value.frontendLocales.length > 20 ||
        !value.frontendLocales.every(
          (locale) => typeof locale === 'string' && LOCALE.test(locale),
        ) ||
        new Set(value.frontendLocales).size !== value.frontendLocales.length)) ||
    (value.frontendDefaultLocale !== undefined &&
      value.frontendLocales !== undefined &&
      !value.frontendLocales.includes(value.frontendDefaultLocale)) ||
    (value.frontendFramework !== undefined &&
      !FRONTEND_FRAMEWORKS.includes(value.frontendFramework)) ||
    (value.javaPreset !== undefined &&
      (typeof value.javaPreset !== 'string' || !id(value.javaPreset)))
  )
    return failure(
      'PROJECT_CONVENTIONS_INVALID',
      'Project package, locale, framework and preset conventions are invalid',
    );
  return ok();
}

function knownFailure(value) {
  return (
    exactKeys(value, ['id', 'signature', 'commandId', 'scope', 'evidence']) &&
    id(value.id) &&
    nonEmpty(value.signature, 4000) &&
    id(value.commandId) &&
    nonEmpty(value.scope, 4000) &&
    nonEmpty(value.evidence, 1024)
  );
}

function unverifiedArea(value) {
  return (
    exactKeys(value, ['id', 'description', 'risk']) &&
    id(value.id) &&
    nonEmpty(value.description, 4000) &&
    nonEmpty(value.risk, 2000)
  );
}

export function validateProjectBaseline(value) {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'baselineId',
      'projectId',
      'commit',
      'status',
      'knownFailures',
      'unverifiedAreas',
      'commands',
      'evidence',
      'environmentFingerprint',
      'createdAt',
    ])
  )
    return failure('BASELINE_INVALID', 'ProjectBaseline fields are invalid');
  if (
    value.schemaVersion !== 2 ||
    !id(value.baselineId) ||
    !id(value.projectId) ||
    !COMMIT.test(value.commit || '') ||
    !['green', 'known-failures', 'partial', 'unknown'].includes(value.status) ||
    !HASH.test(value.environmentFingerprint || '') ||
    !date(value.createdAt)
  )
    return failure('BASELINE_INVALID', 'ProjectBaseline identity or status is invalid');
  if (!Array.isArray(value.knownFailures) || !value.knownFailures.every(knownFailure))
    return failure('KNOWN_FAILURE_INVALID', 'Known failures require stable identity and evidence');
  if (value.status === 'known-failures' && value.knownFailures.length === 0)
    return failure('KNOWN_FAILURE_INVALID', 'Known-failure baseline requires a failure record');
  if (value.status !== 'known-failures' && value.knownFailures.length > 0)
    return failure('BASELINE_INVALID', 'Only known-failure baselines may contain knownFailures');
  if (!Array.isArray(value.unverifiedAreas) || !value.unverifiedAreas.every(unverifiedArea))
    return failure('BASELINE_INVALID', 'Unverified areas require an explicit risk');
  if (!listOfText(value.commands, 500) || !listOfText(value.evidence, 1000))
    return failure('BASELINE_INVALID', 'Baseline command and evidence references are invalid');
  return ok();
}

export function canStartChange({ profile, baseline } = {}) {
  const profileCheck = validateProjectProfile(profile);
  if (!profileCheck.ok) return profileCheck;
  const baselineCheck = validateProjectBaseline(baseline);
  if (!baselineCheck.ok) return baselineCheck;
  if (profile.projectId !== baseline.projectId)
    return failure(
      'BASELINE_PROJECT_MISMATCH',
      'ProjectProfile and Baseline belong to different projects',
    );
  if (baseline.status === 'unknown')
    return failure('BASELINE_NOT_READY', 'An unknown baseline cannot start a change');
  return ok();
}

export function validateChangeContract(value) {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'changeId',
      'parentDeliveryId',
      'type',
      'request',
      'scope',
      'nonGoals',
      'acceptance',
      'assumptions',
      'risks',
      'baselineId',
      'status',
    ])
  )
    return failure('CHANGE_CONTRACT_INVALID', 'ChangeContract fields are invalid');
  if (
    value.schemaVersion !== 2 ||
    !id(value.changeId) ||
    (value.parentDeliveryId !== null && !id(value.parentDeliveryId)) ||
    !['feature', 'modify', 'fix'].includes(value.type) ||
    !nonEmpty(value.request) ||
    !listOfText(value.scope) ||
    value.scope.length === 0 ||
    !listOfText(value.nonGoals) ||
    !Array.isArray(value.acceptance) ||
    value.acceptance.length === 0 ||
    value.acceptance.length > 200 ||
    !value.acceptance.every(id) ||
    new Set(value.acceptance).size !== value.acceptance.length ||
    !listOfText(value.assumptions) ||
    !listOfText(value.risks) ||
    !id(value.baselineId) ||
    !nonEmpty(value.status, 128)
  )
    return failure('CHANGE_CONTRACT_INVALID', 'ChangeContract identity or acceptance is invalid');
  if (sensitive(value))
    return failure('SENSITIVE_CONTRACT', 'ChangeContract contains apparent credentials');
  return ok();
}

function artifactValue(value) {
  return (
    exactKeys(value, ['path', 'sha256']) &&
    safeRelative(value.path) &&
    HASH.test(value.sha256 || '')
  );
}

export function validateEvidence(value) {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'evidenceId',
      'type',
      'acIds',
      'executor',
      'command',
      'cwd',
      'commit',
      'startedAt',
      'finishedAt',
      'status',
      'exitCode',
      'artifacts',
      'summary',
      'environmentFingerprint',
    ])
  )
    return failure('EVIDENCE_INVALID', 'Evidence fields are invalid');
  if (
    value.schemaVersion !== 2 ||
    !id(value.evidenceId) ||
    !EVIDENCE_TYPES.includes(value.type) ||
    !Array.isArray(value.acIds) ||
    value.acIds.length === 0 ||
    !value.acIds.every(id) ||
    !nonEmpty(value.executor, 256) ||
    !Array.isArray(value.command) ||
    !value.command.every((entry) => nonEmpty(entry, 8192)) ||
    !safeCwd(value.cwd) ||
    !COMMIT.test(value.commit || '') ||
    !date(value.startedAt) ||
    !date(value.finishedAt) ||
    !EVIDENCE_STATES.includes(value.status) ||
    (value.exitCode !== null && !Number.isSafeInteger(value.exitCode)) ||
    !Array.isArray(value.artifacts) ||
    !value.artifacts.every(artifactValue) ||
    !nonEmpty(value.summary, 16000) ||
    !HASH.test(value.environmentFingerprint || '')
  )
    return failure('EVIDENCE_INVALID', 'Evidence identity, command or timing is invalid');
  if (value.status !== 'passed' && value.exitCode === 0)
    return failure('EVIDENCE_STATUS_INVALID', 'Only passed evidence may use exit code zero');
  if (value.status === 'passed' && value.exitCode !== 0)
    return failure('EVIDENCE_STATUS_INVALID', 'Passed evidence requires exit code zero');
  if (sensitive(value))
    return failure('SENSITIVE_EVIDENCE', 'Evidence contains apparent credentials');
  return ok();
}

function coverageEntry(value) {
  return (
    exactKeys(value, ['acId', 'evidenceIds', 'sufficiency', 'summary']) &&
    id(value.acId) &&
    Array.isArray(value.evidenceIds) &&
    value.evidenceIds.every(id) &&
    ['sufficient', 'insufficient'].includes(value.sufficiency) &&
    nonEmpty(value.summary, 4000)
  );
}

function openRisk(value) {
  return (
    exactKeys(value, ['id', 'severity', 'text', 'evidence']) &&
    id(value.id) &&
    nonEmpty(value.severity, 64) &&
    nonEmpty(value.text, 4000) &&
    nonEmpty(value.evidence, 1024)
  );
}

export function validateVerificationAssessment(value) {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'verificationId',
      'risk',
      'independenceLevel',
      'acCoverage',
      'evidence',
      'reviewMode',
      'environmentFingerprint',
      'openRisks',
      'decision',
    ])
  )
    return failure('VERIFICATION_INVALID', 'VerificationAssessment fields are invalid');
  if (
    value.schemaVersion !== 2 ||
    !id(value.verificationId) ||
    !riskValues.has(value.risk) ||
    !independenceValues.has(value.independenceLevel) ||
    !['evidence', 'evidence-and-diff', 'full-code-review'].includes(value.reviewMode) ||
    !HASH.test(value.environmentFingerprint || '') ||
    ![
      'blocked',
      'requires-risk-confirmation',
      'requires-h3',
      'verified-awaiting-acceptance',
    ].includes(value.decision) ||
    !Array.isArray(value.acCoverage) ||
    value.acCoverage.length === 0 ||
    !value.acCoverage.every(coverageEntry) ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every(id) ||
    !Array.isArray(value.openRisks) ||
    !value.openRisks.every(openRisk)
  )
    return failure(
      'VERIFICATION_INVALID',
      'VerificationAssessment identity or decision is invalid',
    );
  if (['self-check', 'self-report'].includes(value.independenceLevel))
    return failure(
      'VERIFICATION_NOT_INDEPENDENT',
      'Self-check cannot satisfy independent verification',
    );
  if (
    value.risk === 'red' &&
    (value.independenceLevel !== 'strict-review' || value.reviewMode !== 'full-code-review')
  )
    return failure('HIGH_RISK_REVIEW_REQUIRED', 'Red risk requires fixed-commit code review');
  const evidenceIds = new Set(value.evidence);
  if (
    value.acCoverage.some((entry) => entry.evidenceIds.some((entryId) => !evidenceIds.has(entryId)))
  )
    return failure('VERIFICATION_INVALID', 'AC coverage references missing evidence');
  if (['requires-h3', 'verified-awaiting-acceptance'].includes(value.decision)) {
    if (
      value.acCoverage.some(
        (entry) => entry.sufficiency !== 'sufficient' || entry.evidenceIds.length === 0,
      )
    )
      return failure('EVIDENCE_INSUFFICIENT', 'H3 requires sufficient evidence for every AC');
    if (value.openRisks.some((entry) => entry.severity === 'blocking'))
      return failure('VERIFICATION_RISK_OPEN', 'Blocking risk prevents H3');
  }
  return ok();
}

function rollback(value) {
  return (
    exactKeys(value, ['code', 'data', 'forwardFix']) &&
    nonEmpty(value.code, 8000) &&
    nonEmpty(value.data, 8000) &&
    nonEmpty(value.forwardFix, 8000)
  );
}

function pushState(value) {
  return (
    exactKeys(value, ['requested', 'remoteUrl', 'status']) &&
    typeof value.requested === 'boolean' &&
    (value.remoteUrl === null || optionalRemote(value.remoteUrl)) &&
    nonEmpty(value.status, 128)
  );
}

export function validateDeliveryRecord(value) {
  if (
    !exactKeys(value, [
      'schemaVersion',
      'deliveryId',
      'projectId',
      'changeId',
      'parentDeliveryId',
      'baselineCommit',
      'deliveryCommit',
      'tag',
      'state',
      'environmentFingerprint',
      'reviewMode',
      'acceptedAt',
      'acceptance',
      'evidence',
      'knownIssues',
      'rollback',
      'push',
    ])
  )
    return failure('DELIVERY_INVALID', 'DeliveryRecord fields are invalid');
  if (
    value.schemaVersion !== 2 ||
    !id(value.deliveryId) ||
    !id(value.projectId) ||
    !id(value.changeId) ||
    (value.parentDeliveryId !== null && !id(value.parentDeliveryId)) ||
    !COMMIT.test(value.baselineCommit || '') ||
    !COMMIT.test(value.deliveryCommit || '') ||
    !nonEmpty(value.tag, 255) ||
    !DELIVERY_STATES.includes(value.state) ||
    !HASH.test(value.environmentFingerprint || '') ||
    !['evidence', 'evidence-and-diff', 'full-code-review'].includes(value.reviewMode) ||
    !date(value.acceptedAt) ||
    !Array.isArray(value.acceptance) ||
    value.acceptance.length === 0 ||
    !value.acceptance.every(id) ||
    !listOfText(value.evidence, 1000) ||
    value.evidence.length === 0 ||
    !listOfText(value.knownIssues) ||
    !rollback(value.rollback) ||
    !pushState(value.push)
  )
    return failure('DELIVERY_INVALID', 'DeliveryRecord identity or acceptance is invalid');
  if (value.push.requested && value.push.remoteUrl === null)
    return failure('PUSH_STATE_INVALID', 'Requested push requires a remote URL');
  if (value.push.status === 'passed' && (!value.push.requested || value.push.remoteUrl === null))
    return failure('PUSH_STATE_INVALID', 'A passed push requires an explicit remote request');
  if (['pushed', 'deployed-unknown', 'deployed-verified'].includes(value.state)) {
    if (!value.push.requested || value.push.status !== 'passed')
      return failure('PUSH_STATE_INVALID', 'Pushed and deployed records require a passed push');
  }
  if (sensitive(value))
    return failure('SENSITIVE_DELIVERY', 'DeliveryRecord contains apparent credentials');
  return ok();
}

export function validateDeliveryStateTransition(from, to) {
  const allowed = {
    'change-verified': new Set(['delivery-accepted']),
    'delivery-accepted': new Set(['pushed']),
    pushed: new Set(['deployed-unknown']),
    'deployed-unknown': new Set(['deployed-verified']),
    'deployed-verified': new Set(),
  };
  if (!allowed[from]?.has(to))
    return failure('DELIVERY_TRANSITION_INVALID', 'Delivery state transition is not append-only');
  return ok();
}
