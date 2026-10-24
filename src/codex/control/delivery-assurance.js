import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const CONTEXT = Symbol('delivery-assurance-context');
const MAX_TEST_FILES = 256;
const MAX_TEST_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_TEST_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const EVIDENCE_TTL_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_BUDGET = Object.freeze({
  maxToolCalls: 32,
  maxDurationMs: 15 * 60 * 1000,
});
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40,64}$/i;
const PASS_STATUSES = new Set(['pass', 'passed']);
const MAX_TEXT = 1024;

const failure = (code, message, extra = {}) => ({
  ok: false,
  code,
  message: redact(message),
  ...extra,
});

function assuranceError(code, message) {
  return Object.assign(new Error(redact(message)), { assuranceCode: code });
}

function redact(value) {
  return String(value ?? '')
    .replace(/[A-Za-z]:[\\/][^\s"'`]+/g, '<redacted-path>')
    .replace(
      /(^|[\s"'`])\/(?:Users|home|tmp|var|opt|root|private|mnt)\/[^\s"'`]*/g,
      '$1<redacted-path>',
    )
    .replace(
      /\b(password|passwd|secret|token|authorization|api[_-]?key)\b(\s*[:=]\s*)[^\s,;]+/gi,
      '$1$2<redacted>',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi, 'Bearer <redacted>')
    .slice(0, MAX_TEXT);
}

function safeText(value, maximum = MAX_TEXT) {
  return redact(value).slice(0, maximum);
}

function unsafePersistedText(value) {
  return (
    /[A-Za-z]:[\\/]/.test(value) ||
    /(^|[\s"'`])\/(?:Users|home|tmp|var|opt|root|private|mnt)\//.test(value) ||
    /\b(password|passwd|secret|token|authorization|api[_-]?key)\b\s*[:=]/i.test(value) ||
    /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i.test(value)
  );
}

function canonical(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return 'null';
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashValue(value) {
  return digest(Buffer.from(canonical(value), 'utf8'));
}

function normalizeHash(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/^sha256[:-]/i, '');
  return HASH.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizeCommit(value) {
  return typeof value === 'string' && COMMIT.test(value) ? value.toLowerCase() : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function attachContext(value, context) {
  Object.defineProperty(value, CONTEXT, {
    value: Object.freeze({ ...context }),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return deepFreeze(value);
}

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function normalizeRelative(value) {
  if (typeof value !== 'string' || !value || value.length > 400 || value.includes('\0'))
    throw assuranceError('UNSAFE_TEST_FILE', 'A frozen test path is invalid');
  const normalized = value.replace(/\\/g, '/');
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  )
    throw assuranceError('UNSAFE_TEST_FILE', 'A frozen test path must stay below the project');
  return normalized;
}

function ensureInside(parent, target) {
  if (!inside(parent, target))
    throw assuranceError('UNSAFE_TEST_FILE', 'A frozen test path escaped its project');
}

function ensureDirectory(base, target) {
  ensureInside(base, target);
  const relative = path.relative(base, target);
  let current = base;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw assuranceError('UNSAFE_STORAGE', 'Assurance storage contains an unsafe path');
  }
}

function inspectRegularFile(base, target, maximum) {
  ensureInside(base, target);
  const relative = path.relative(base, target);
  let current = base;
  const baseStat = fs.lstatSync(base);
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory())
    throw assuranceError('UNSAFE_STORAGE', 'Assurance storage root is unsafe');
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink())
      throw assuranceError('UNSAFE_STORAGE', 'Assurance storage contains a symlink');
    if (current !== target && !stat.isDirectory())
      throw assuranceError('UNSAFE_STORAGE', 'Assurance storage contains an unsafe parent');
  }
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.nlink > 1 || stat.size > maximum)
    throw assuranceError('UNSAFE_STORAGE', 'Assurance evidence is not a bounded regular file');
  return stat;
}

function writeImmutable(base, key, value) {
  const relative = normalizeRelative(key);
  const target = path.join(base, ...relative.split('/'));
  ensureInside(base, target);
  ensureDirectory(base, path.dirname(target));
  let fd;
  let created = false;
  try {
    fd = fs.openSync(target, 'wx', 0o600);
    created = true;
    fs.writeFileSync(fd, `${canonical(value)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } catch (error) {
    if (created) {
      try {
        fs.unlinkSync(target);
      } catch {
        // A partial immutable artifact is never returned as evidence.
      }
    }
    if (error.code === 'EEXIST')
      throw assuranceError('PACKAGE_ID_CONFLICT', 'Immutable output exists');
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function readImmutable(base, key, maximum = MAX_MANIFEST_BYTES) {
  const relative = normalizeRelative(key);
  const target = path.join(base, ...relative.split('/'));
  inspectRegularFile(base, target, maximum);
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    if (error.assuranceCode) throw error;
    throw assuranceError('IMMUTABLE_ARTIFACT_INVALID', 'Immutable assurance output is unreadable');
  }
}

function clockNow(clock) {
  const raw =
    typeof clock === 'function'
      ? clock()
      : typeof clock?.now === 'function'
        ? clock.now()
        : new Date();
  const value = raw instanceof Date ? raw : new Date(raw);
  if (!Number.isFinite(value.getTime()))
    throw new TypeError('The delivery assurance clock returned an invalid date');
  return value;
}

function normalizeBudget(budget) {
  if (budget === undefined || budget === null) return DEFAULT_BUDGET;
  if (Number.isSafeInteger(budget) && budget > 0)
    return { maxToolCalls: budget, maxDurationMs: DEFAULT_BUDGET.maxDurationMs };
  if (typeof budget !== 'object' || Array.isArray(budget)) return null;
  const maxToolCalls = budget.maxToolCalls ?? budget.toolCalls ?? DEFAULT_BUDGET.maxToolCalls;
  const maxDurationMs =
    budget.maxDurationMs ?? budget.timeMs ?? budget.deadlineMs ?? DEFAULT_BUDGET.maxDurationMs;
  if (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1) return null;
  if (!Number.isSafeInteger(maxDurationMs) || maxDurationMs < 1) return null;
  return Object.freeze({ maxToolCalls, maxDurationMs });
}

function normalizeUsage(usage) {
  if (usage === undefined) return { toolCalls: 0, durationMs: 0 };
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null;
  const toolCalls = usage.toolCalls ?? usage.calls ?? 0;
  const durationMs = usage.durationMs ?? usage.elapsedMs ?? 0;
  if (!Number.isSafeInteger(toolCalls) || toolCalls < 0) return null;
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) return null;
  return { toolCalls, durationMs };
}

function normalizeAttention(attention) {
  const attentionId =
    typeof attention === 'string'
      ? attention
      : (attention?.attentionId ?? attention?.id ?? attention?.workItemId);
  return {
    attentionId: typeof attentionId === 'string' && ID.test(attentionId) ? attentionId : null,
    requiresHuman: true,
  };
}

function isAiOrProvider(value) {
  if (typeof value === 'string')
    return /^(?:ai|model|provider|agent|codex|assistant)$/i.test(value);
  if (!value || typeof value !== 'object') return false;
  if (value.ai === true || value.provider === true || value.signedByAi === true) return true;
  return [value.kind, value.type, value.source, value.owner, value.signer]
    .filter(Boolean)
    .some((entry) => /^(?:ai|model|provider|agent|codex|assistant)$/i.test(String(entry)));
}

function timestamp(value, code, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw assuranceError(code, `${label} must be an ISO timestamp`);
  return new Date(value);
}

function validateFreshness(completedAt, frozenAt, now) {
  if (completedAt.getTime() < frozenAt.getTime())
    return failure('STALE_VERIFICATION', 'Verification predates the frozen tests');
  if (completedAt.getTime() - now.getTime() > CLOCK_SKEW_MS)
    return failure('INVALID_VERIFICATION_TIME', 'Verification is dated in the future');
  if (now.getTime() - completedAt.getTime() > EVIDENCE_TTL_MS)
    return failure('STALE_VERIFICATION', 'Verification evidence is outside its freshness window');
  return { ok: true };
}

function testSpecifications(testFiles) {
  if (!Array.isArray(testFiles) || testFiles.length === 0)
    throw assuranceError('TEST_FILES_REQUIRED', 'At least one frozen test file is required');
  if (testFiles.length > MAX_TEST_FILES)
    throw assuranceError('TOO_MANY_TEST_FILES', 'Too many frozen test files');
  const seen = new Set();
  const specifications = testFiles.map((entry) => {
    const source = typeof entry === 'string' ? { path: entry } : entry;
    if (!source || typeof source !== 'object' || Array.isArray(source))
      throw assuranceError('UNSAFE_TEST_FILE', 'A frozen test file entry is invalid');
    const relative = normalizeRelative(source.path);
    if (seen.has(relative))
      throw assuranceError('DUPLICATE_TEST_FILE', 'A frozen test file was declared twice');
    seen.add(relative);
    const caseIds = source.caseIds;
    if (
      caseIds !== undefined &&
      (!Array.isArray(caseIds) ||
        caseIds.length === 0 ||
        caseIds.some((caseId) => typeof caseId !== 'string' || !ID.test(caseId)))
    )
      throw assuranceError('INVALID_TEST_CASE', 'Frozen test case identifiers are invalid');
    return { path: relative, caseIds: caseIds ? [...new Set(caseIds)] : null };
  });
  return specifications.sort((left, right) => left.path.localeCompare(right.path));
}

function readBoundedTestFile(projectRoot, relative) {
  const target = path.resolve(projectRoot, ...relative.split('/'));
  ensureInside(projectRoot, target);
  let current = projectRoot;
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      throw assuranceError('TEST_FILE_UNAVAILABLE', 'A frozen test file is unavailable');
    }
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw assuranceError('UNSAFE_TEST_FILE', 'A frozen test parent is not an ordinary directory');
  }
  let initial;
  try {
    initial = fs.lstatSync(target);
  } catch {
    throw assuranceError('TEST_FILE_UNAVAILABLE', 'A frozen test file is unavailable');
  }
  if (initial.isSymbolicLink() || !initial.isFile() || initial.nlink > 1)
    throw assuranceError('UNSAFE_TEST_FILE', 'A frozen test must be an ordinary file');
  if (initial.size > MAX_TEST_FILE_BYTES)
    throw assuranceError('TEST_FILE_TOO_LARGE', 'A frozen test file exceeds the size limit');
  let fd;
  try {
    fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink > 1 ||
      opened.size !== initial.size ||
      opened.size > MAX_TEST_FILE_BYTES
    )
      throw assuranceError('UNSAFE_TEST_FILE', 'A frozen test changed while it was read');
    const content = fs.readFileSync(fd);
    const final = fs.fstatSync(fd);
    if (final.size !== opened.size || final.mtimeMs !== opened.mtimeMs)
      throw assuranceError('UNSAFE_TEST_FILE', 'A frozen test changed while it was read');
    if (content.includes(0))
      throw assuranceError('BINARY_TEST_FILE', 'Binary files cannot be frozen as tests');
    return { content, size: opened.size, sha256: digest(content) };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function manifestPayload(manifest) {
  return {
    schemaVersion: 1,
    kind: 'frozen-tests',
    changeId: manifest.changeId,
    testFiles: manifest.testFiles,
  };
}

function validateManifest(manifest) {
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.kind !== 'frozen-tests' ||
    typeof manifest.changeId !== 'string' ||
    !ID.test(manifest.changeId) ||
    typeof manifest.actorId !== 'string' ||
    !ID.test(manifest.actorId) ||
    !Number.isFinite(Date.parse(manifest.frozenAt)) ||
    !Array.isArray(manifest.testFiles) ||
    manifest.testFiles.length === 0 ||
    manifest.testFiles.length > MAX_TEST_FILES ||
    manifest.testFiles.reduce((sum, entry) => sum + (entry?.size || 0), 0) > MAX_TOTAL_TEST_BYTES ||
    !HASH.test(manifest.manifestHash || '')
  )
    return failure('MANIFEST_INVALID', 'The frozen test manifest is invalid');
  const seenPaths = new Set();
  const seenCases = new Set();
  for (const entry of manifest.testFiles) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      normalizeRelative(entry.path) !== entry.path ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > MAX_TEST_FILE_BYTES ||
      !HASH.test(entry.sha256 || '')
    )
      return failure('MANIFEST_INVALID', 'A frozen test file entry is invalid');
    if (seenPaths.has(entry.path))
      return failure('MANIFEST_INVALID', 'The frozen manifest contains duplicate files');
    seenPaths.add(entry.path);
    if (entry.caseIds !== undefined) {
      if (
        !Array.isArray(entry.caseIds) ||
        entry.caseIds.length === 0 ||
        entry.caseIds.some((caseId) => typeof caseId !== 'string' || !ID.test(caseId))
      )
        return failure('MANIFEST_INVALID', 'The frozen manifest contains invalid test cases');
      for (const caseId of entry.caseIds) {
        if (seenCases.has(caseId))
          return failure('MANIFEST_INVALID', 'The frozen manifest contains duplicate test cases');
        seenCases.add(caseId);
      }
    }
  }
  if (manifest.manifestHash !== hashValue(manifestPayload(manifest)))
    return failure('MANIFEST_TAMPERED', 'The frozen test manifest hash does not match its content');
  return { ok: true };
}

function currentTestFiles(projectRoot, manifest) {
  const total = manifest.testFiles.reduce((sum, entry) => sum + entry.size, 0);
  if (total > MAX_TOTAL_TEST_BYTES)
    return failure('TEST_FILES_TOO_LARGE', 'Frozen test files exceed the total size limit');
  const current = [];
  for (const entry of manifest.testFiles) {
    try {
      const file = readBoundedTestFile(projectRoot, entry.path);
      if (file.size !== entry.size || file.sha256 !== entry.sha256)
        return failure('FROZEN_TEST_CHANGED', 'A frozen verification test changed after freeze');
      current.push({
        path: entry.path,
        size: file.size,
        sha256: file.sha256,
        ...(entry.caseIds ? { caseIds: [...entry.caseIds] } : {}),
      });
    } catch (error) {
      if (error.assuranceCode === 'BINARY_TEST_FILE')
        return failure(
          'FROZEN_TEST_CHANGED',
          'A frozen verification test is no longer source text',
        );
      if (error.assuranceCode === 'TEST_FILE_UNAVAILABLE')
        return failure('FROZEN_TEST_CHANGED', 'A frozen verification test is unavailable');
      if (error.assuranceCode === 'TEST_FILE_TOO_LARGE')
        return failure('FROZEN_TEST_CHANGED', 'A frozen verification test changed size');
      return failure(error.assuranceCode || 'FROZEN_TEST_CHANGED', 'A frozen test is unsafe');
    }
  }
  return { ok: true, files: current };
}

function sameManifest(left, right) {
  return canonical(left) === canonical(right);
}

function normalizeCases(cases, manifest) {
  if (!Array.isArray(cases) || cases.length === 0)
    return failure('FROZEN_CASES_UNACCOUNTED', 'Verification must report every frozen test case');
  const files = new Set(manifest.testFiles.map((entry) => entry.path));
  const inferred = new Map();
  for (const entry of manifest.testFiles) {
    for (const caseId of entry.caseIds || []) inferred.set(caseId, entry.path);
  }
  const seen = new Set();
  const normalized = [];
  for (const entry of cases) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return failure('INVALID_VERIFICATION', 'A verification case is invalid');
    const caseId = entry.id;
    if (typeof caseId !== 'string' || !ID.test(caseId))
      return failure('INVALID_VERIFICATION', 'A verification case identifier is invalid');
    if (seen.has(caseId))
      return failure('EVIDENCE_TAMPERED', 'Verification evidence contains duplicate cases');
    seen.add(caseId);
    const declaredFile = entry.file ?? entry.path ?? entry.testFile ?? inferred.get(caseId);
    let relative = null;
    if (declaredFile === undefined && manifest.testFiles.length === 1)
      relative = manifest.testFiles[0].path;
    else if (declaredFile !== undefined) {
      try {
        relative = normalizeRelative(declaredFile);
      } catch {
        return failure('INVALID_VERIFICATION', 'A verification case path is unsafe');
      }
    }
    if (!relative || !files.has(relative))
      return failure(
        'FROZEN_CASES_UNACCOUNTED',
        'A verification case is not bound to a frozen file',
      );
    if (
      entry.skipped === true ||
      entry.notRun === true ||
      entry.cancelled === true ||
      entry.timedOut === true
    )
      return failure('INVALID_VERIFICATION', 'Verification case flags attempt to bypass execution');
    normalized.push({
      id: caseId,
      file: relative,
      status: typeof entry.status === 'string' ? entry.status.toLowerCase() : 'not-run',
    });
  }
  const covered = new Set(normalized.map((entry) => entry.file));
  if ([...files].some((file) => !covered.has(file)))
    return failure('FROZEN_CASES_UNACCOUNTED', 'A frozen test file has no verification result');
  const expected = manifest.testFiles.flatMap((entry) => entry.caseIds || []);
  if (expected.length) {
    const actual = new Set(normalized.map((entry) => entry.id));
    if (expected.length !== actual.size || expected.some((caseId) => !actual.has(caseId)))
      return failure('FROZEN_CASES_UNACCOUNTED', 'The frozen case set is not fully accounted for');
  }
  return { ok: true, cases: normalized };
}

function caseFailure(cases) {
  const nonPass = cases.find((entry) => !PASS_STATUSES.has(entry.status));
  if (!nonPass) return { ok: true };
  if (nonPass.status === 'skipped')
    return failure('FROZEN_TEST_SKIPPED', 'A frozen test was skipped');
  if (nonPass.status === 'not-run' || nonPass.status === 'not_run')
    return failure('FROZEN_TEST_NOT_RUN', 'A frozen test was not run');
  if (nonPass.status === 'cancelled' || nonPass.status === 'canceled')
    return failure('FROZEN_TEST_CANCELLED', 'A frozen test run was cancelled');
  if (nonPass.status === 'timeout' || nonPass.status === 'timed-out')
    return failure('FROZEN_TEST_TIMEOUT', 'A frozen test run timed out');
  return failure('FROZEN_TEST_FAILED', 'A frozen verification test did not pass');
}

function topLevelStatusFailure(value) {
  if (value?.skipped === true)
    return failure('FROZEN_TEST_SKIPPED', 'A frozen test run was skipped');
  if (value?.notRun === true)
    return failure('FROZEN_TEST_NOT_RUN', 'A frozen test run was not executed');
  if (value?.cancelled === true || value?.canceled === true)
    return failure('FROZEN_TEST_CANCELLED', 'A frozen test run was cancelled');
  if (value?.timedOut === true || value?.timeout === true)
    return failure('FROZEN_TEST_TIMEOUT', 'A frozen test run timed out');
  const status =
    typeof value?.status === 'string'
      ? value.status.toLowerCase()
      : typeof value?.outcome === 'string'
        ? value.outcome.toLowerCase()
        : null;
  if (!status || PASS_STATUSES.has(status)) return { ok: true };
  if (status === 'skipped') return failure('FROZEN_TEST_SKIPPED', 'A frozen test run was skipped');
  if (status === 'not-run' || status === 'not_run')
    return failure('FROZEN_TEST_NOT_RUN', 'A frozen test run was not executed');
  if (status === 'cancelled' || status === 'canceled')
    return failure('FROZEN_TEST_CANCELLED', 'A frozen test run was cancelled');
  if (status === 'timeout' || status === 'timed-out')
    return failure('FROZEN_TEST_TIMEOUT', 'A frozen test run timed out');
  return failure('FROZEN_TEST_FAILED', 'A frozen test run failed');
}

function evidenceHash(value) {
  return hashValue({
    evidenceId: value.evidenceId,
    artifactHash: value.artifactHash,
    commit: value.commit,
    completedAt: value.completedAt,
    cases: value.cases,
  });
}

function normalizeReference(value) {
  if (typeof value !== 'string' || !value || value.length > 512) return null;
  const safe = safeText(value, 512);
  return unsafePersistedText(safe) ? null : safe;
}

function normalizeReferenceList(values) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 64) return null;
  const normalized = values.map(normalizeReference);
  return normalized.some((entry) => entry === null) ? null : [...new Set(normalized)];
}

function normalizeRollback(value) {
  if (typeof value === 'string') {
    const summary = safeText(value);
    return summary && !unsafePersistedText(summary) ? summary : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rollback = {};
  for (const key of ['code', 'data', 'forwardFix', 'instructions']) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string') return null;
    const summary = safeText(value[key]);
    if (!summary || unsafePersistedText(summary)) return null;
    rollback[key] = summary;
  }
  return Object.keys(rollback).length ? rollback : null;
}

function normalizeAcList(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) return null;
  const normalized = value.map((entry) => (typeof entry === 'string' ? entry.trim() : ''));
  if (normalized.some((entry) => !ID.test(entry))) return null;
  return [...new Set(normalized)];
}

export function createDeliveryAssurance({
  clock,
  maxRepairRounds = 2,
  budget,
  artifactRoot = null,
} = {}) {
  if (!Number.isSafeInteger(maxRepairRounds) || maxRepairRounds < 1)
    throw new TypeError('maxRepairRounds must be a positive integer');
  const configuredBudget = normalizeBudget(budget);
  if (!configuredBudget) throw new TypeError('budget must contain positive integer limits');
  let storageRoot = null;
  if (artifactRoot !== null) {
    if (typeof artifactRoot !== 'string' || !artifactRoot)
      throw new TypeError('artifactRoot must be an absolute directory path');
    storageRoot = path.resolve(artifactRoot);
    fs.mkdirSync(storageRoot, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(storageRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new TypeError('artifactRoot must be an ordinary directory');
  }
  const manifests = new Map();
  const evidenceIds = new Set();
  const verifiedEvidence = new Map();
  const packages = new Map();

  function storageFor(projectRoot) {
    if (storageRoot) return storageRoot;
    const base = path.join(projectRoot, '.specgate', 'codex', 'assurance');
    if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    return base;
  }

  function freezeTests({ projectRoot, testFiles, changeId, actorId } = {}) {
    try {
      if (
        typeof projectRoot !== 'string' ||
        !projectRoot ||
        typeof changeId !== 'string' ||
        !ID.test(changeId) ||
        typeof actorId !== 'string' ||
        !ID.test(actorId)
      )
        return failure('INVALID_ARGUMENT', 'projectRoot, changeId and actorId are required');
      const root = fs.realpathSync(projectRoot);
      if (!fs.lstatSync(root).isDirectory())
        return failure('INVALID_PROJECT_ROOT', 'projectRoot must be a directory');
      const specifications = testSpecifications(testFiles);
      let totalBytes = 0;
      const frozenFiles = specifications.map((specification) => {
        const file = readBoundedTestFile(root, specification.path);
        totalBytes += file.size;
        if (totalBytes > MAX_TOTAL_TEST_BYTES)
          throw assuranceError('TEST_FILES_TOO_LARGE', 'Frozen tests exceed the total size limit');
        return {
          path: specification.path,
          size: file.size,
          sha256: file.sha256,
          ...(specification.caseIds ? { caseIds: specification.caseIds } : {}),
        };
      });
      const manifestBase = {
        schemaVersion: 1,
        kind: 'frozen-tests',
        changeId,
        testFiles: frozenFiles,
      };
      const manifestHash = hashValue(manifestBase);
      const manifest = {
        ...manifestBase,
        actorId,
        frozenAt: clockNow(clock).toISOString(),
        manifestHash,
      };
      const base = storageFor(root);
      const manifestKey = `frozen-tests/${changeId}/v1.json`;
      const manifestFile = path.join(base, ...manifestKey.split('/'));
      let stored = null;
      if (fs.existsSync(manifestFile)) stored = readImmutable(base, manifestKey);
      if (stored) {
        const checked = validateManifest(stored);
        if (!checked.ok) return checked;
        if (stored.manifestHash !== manifestHash)
          return failure(
            'FROZEN_TESTS_IMMUTABLE',
            'Frozen verification tests cannot be replaced after v1',
          );
        const context = { projectRoot: root, storageBase: base, manifestKey };
        manifests.set(stored.manifestHash, {
          manifest: canonical(stored),
          context,
        });
        return {
          ok: true,
          idempotent: true,
          manifest: attachContext({ ...stored }, context),
          manifestHash: stored.manifestHash,
          manifestKey,
        };
      }
      try {
        writeImmutable(base, manifestKey, manifest);
      } catch (error) {
        if (error.assuranceCode === 'PACKAGE_ID_CONFLICT') {
          const raced = readImmutable(base, manifestKey);
          if (raced.manifestHash !== manifestHash)
            return failure(
              'FROZEN_TESTS_IMMUTABLE',
              'Frozen verification tests cannot be replaced after v1',
            );
        } else throw error;
      }
      const persisted = readImmutable(base, manifestKey);
      const checkedPersisted = validateManifest(persisted);
      if (!checkedPersisted.ok) return checkedPersisted;
      const context = { projectRoot: root, storageBase: base, manifestKey };
      manifests.set(manifestHash, { manifest: canonical(persisted), context });
      return {
        ok: true,
        idempotent: false,
        manifest: attachContext({ ...persisted }, context),
        manifestHash,
        manifestKey,
      };
    } catch (error) {
      return failure(error.assuranceCode || 'FROZEN_TESTS_FAILED', error.message);
    }
  }

  function prepareRepair({ failure: repairFailure, round, usage, attention } = {}) {
    if (!Number.isSafeInteger(round) || round < 1)
      return failure('INVALID_ARGUMENT', 'Repair round must be a positive integer');
    const currentUsage = normalizeUsage(usage);
    if (!currentUsage) return failure('INVALID_ARGUMENT', 'Repair usage is invalid');
    const context = normalizeAttention(attention);
    const source =
      repairFailure?.message ??
      repairFailure?.summary ??
      repairFailure?.code ??
      (typeof repairFailure === 'string' ? repairFailure : 'Repair failed');
    const failureSummary = safeText(source);
    let stopReason = null;
    if (round > maxRepairRounds) stopReason = 'ROUND_LIMIT';
    else if (currentUsage.toolCalls >= configuredBudget.maxToolCalls)
      stopReason = 'TOOL_CALL_LIMIT';
    else if (currentUsage.durationMs >= configuredBudget.maxDurationMs) stopReason = 'TIME_LIMIT';
    if (stopReason) {
      return failure('REPAIR_LIMIT_REACHED', 'Repair reached its configured bound', {
        stopReason,
        attentionAction: 'ESCALATE',
        attention: {
          attentionId: context.attentionId,
          action: 'ESCALATE',
          requiresHuman: true,
          stopReason,
        },
      });
    }
    const limits = {
      maxToolCalls: configuredBudget.maxToolCalls - currentUsage.toolCalls,
      maxDurationMs: configuredBudget.maxDurationMs - currentUsage.durationMs,
    };
    const plan = attachContext(
      {
        schemaVersion: 1,
        kind: 'bounded-repair-plan',
        round,
        failureSummary,
        usage: currentUsage,
        limits,
        stopReason: null,
        nextAction: 'REPAIR',
      },
      { storageBase: storageRoot },
    );
    return {
      ok: true,
      allowed: true,
      plan,
      limits,
      attentionAction: null,
    };
  }

  async function verify({ manifest, artifactHash, verification, runner } = {}) {
    try {
      const checkedManifest = validateManifest(manifest);
      if (!checkedManifest.ok) return checkedManifest;
      const context = manifest?.[CONTEXT];
      if (!context || !context.storageBase || !context.projectRoot)
        return failure('MANIFEST_SOURCE_REQUIRED', 'Use a manifest returned by freezeTests');
      const stored = readImmutable(context.storageBase, context.manifestKey);
      if (!sameManifest(manifest, stored))
        return failure('MANIFEST_TAMPERED', 'The in-memory frozen manifest differs from storage');
      const registered = manifests.get(manifest.manifestHash);
      if (!registered || registered.manifest !== canonical(stored))
        return failure('MANIFEST_TAMPERED', 'The frozen manifest is not the immutable v1 artifact');
      const before = currentTestFiles(context.projectRoot, manifest);
      if (!before.ok) return before;

      if (!verification || typeof verification !== 'object' || Array.isArray(verification))
        return failure('INVALID_VERIFICATION', 'Verification evidence is required');
      if (
        isAiOrProvider(verification?.signer) ||
        verification?.signedByAi === true ||
        isAiOrProvider(verification?.runner)
      )
        return failure('AI_SIGNER_REJECTED', 'AI and provider signers cannot approve delivery');
      if (typeof runner !== 'function')
        return failure('SERVER_RUNNER_REQUIRED', 'A server-owned verification runner is required');
      if (isAiOrProvider(runner) || isAiOrProvider(runner.ownerKind))
        return failure(
          'SERVER_RUNNER_REQUIRED',
          'AI and provider runners cannot sign verification',
        );

      const expectedArtifact = normalizeHash(artifactHash);
      const expectedCommit = normalizeCommit(verification.commit);
      const claimedArtifact = normalizeHash(verification.artifactHash);
      const evidenceId = verification.evidenceId;
      if (!expectedArtifact || !expectedCommit || claimedArtifact !== expectedArtifact)
        return failure(
          'VERIFICATION_BINDING_MISMATCH',
          'Verification must bind fresh evidence to the artifact and commit',
        );
      if (typeof evidenceId !== 'string' || !ID.test(evidenceId))
        return failure('INVALID_VERIFICATION', 'A valid verification evidenceId is required');
      if (evidenceIds.has(evidenceId))
        return failure('EVIDENCE_REPLAYED', 'Verification evidence identifiers must be unique');
      evidenceIds.add(evidenceId);

      const completedAt = timestamp(
        verification.completedAt,
        'INVALID_VERIFICATION_TIME',
        'Verification completedAt',
      );
      const fresh = validateFreshness(completedAt, new Date(manifest.frozenAt), clockNow(clock));
      if (!fresh.ok) return fresh;
      const claimedStatus = topLevelStatusFailure(verification);
      if (!claimedStatus.ok) return claimedStatus;
      const claimedCases = normalizeCases(verification.cases, manifest);
      if (!claimedCases.ok) return claimedCases;
      const claimedHash = evidenceHash({
        evidenceId,
        artifactHash: expectedArtifact,
        commit: expectedCommit,
        completedAt,
        cases: claimedCases.cases,
      });
      if (
        verification.evidenceHash !== undefined &&
        normalizeHash(verification.evidenceHash) !== claimedHash
      )
        return failure(
          'EVIDENCE_TAMPERED',
          'Verification evidence hash does not match its content',
        );

      let runnerValue;
      try {
        runnerValue = await runner({
          manifest: JSON.parse(canonical(manifest)),
          artifactHash: expectedArtifact,
          commit: expectedCommit,
          evidenceId,
        });
      } catch {
        return failure('SERVER_RUNNER_FAILED', 'The server-owned verification runner failed');
      }
      const topLevel = topLevelStatusFailure(runnerValue);
      if (!topLevel.ok) return topLevel;
      const result = runnerValue?.verification ?? runnerValue;
      if (!result || typeof result !== 'object' || Array.isArray(result))
        return failure('SERVER_RUNNER_FAILED', 'The server runner returned no usable evidence');
      if (
        result.evidenceId !== evidenceId ||
        normalizeHash(result.artifactHash) !== expectedArtifact ||
        normalizeCommit(result.commit) !== expectedCommit
      )
        return failure('EVIDENCE_TAMPERED', 'Runner evidence is not bound to this verification');
      if (result.completedAt !== undefined) {
        const runnerCompletedAt = timestamp(
          result.completedAt,
          'INVALID_VERIFICATION_TIME',
          'Runner completedAt',
        );
        const runnerFresh = validateFreshness(
          runnerCompletedAt,
          new Date(manifest.frozenAt),
          clockNow(clock),
        );
        if (!runnerFresh.ok) return runnerFresh;
      }
      const runnerCases = normalizeCases(result.cases, manifest);
      if (!runnerCases.ok) return runnerCases;
      if (canonical(runnerCases.cases) !== canonical(claimedCases.cases))
        return failure('EVIDENCE_TAMPERED', 'Runner results differ from the supplied evidence');
      if (result.evidenceHash !== undefined && normalizeHash(result.evidenceHash) !== claimedHash)
        return failure('EVIDENCE_TAMPERED', 'Runner evidence hash does not match its content');
      const casesFailed = caseFailure(runnerCases.cases);
      if (!casesFailed.ok) return casesFailed;

      const after = currentTestFiles(context.projectRoot, manifest);
      if (!after.ok) return after;
      if (canonical(before.files) !== canonical(after.files))
        return failure(
          'FROZEN_TEST_CHANGED',
          'Frozen tests changed during independent verification',
        );

      const normalized = {
        schemaVersion: 1,
        kind: 'delivery-assurance-verification',
        evidenceId,
        artifactHash: expectedArtifact,
        commit: expectedCommit,
        manifestHash: manifest.manifestHash,
        completedAt: completedAt.toISOString(),
        status: 'passed',
        cases: runnerCases.cases,
        sourceReferences: [`manifest:${manifest.manifestHash}`],
      };
      const verificationFingerprint = hashValue(normalized);
      const evidence = attachContext(
        { ...normalized, verificationFingerprint },
        { storageBase: context.storageBase, projectRoot: context.projectRoot },
      );
      verifiedEvidence.set(verificationFingerprint, {
        evidence,
        canonical: canonical(evidence),
      });
      return {
        ok: true,
        verification: evidence,
        verificationFingerprint,
        artifactHash: expectedArtifact,
        commit: expectedCommit,
        manifestHash: manifest.manifestHash,
      };
    } catch (error) {
      return failure(error.assuranceCode || 'VERIFICATION_FAILED', error.message);
    }
  }

  function verifiedInput(verification, artifactHash, commit) {
    const fingerprint = verification?.verificationFingerprint;
    if (typeof fingerprint !== 'string' || !HASH.test(fingerprint))
      return failure('UNVERIFIED_EVIDENCE', 'Delivery packaging requires verified evidence');
    const record = verifiedEvidence.get(fingerprint);
    if (!record)
      return failure(
        'UNVERIFIED_EVIDENCE',
        'Verification evidence was not produced by this service',
      );
    if (canonical(verification) !== record.canonical)
      return failure(
        'EVIDENCE_TAMPERED',
        'Verification evidence changed after independent execution',
      );
    const expectedArtifact = normalizeHash(artifactHash);
    const expectedCommit = normalizeCommit(commit);
    if (
      !expectedArtifact ||
      !expectedCommit ||
      verification.artifactHash !== expectedArtifact ||
      verification.commit !== expectedCommit
    )
      return failure(
        'VERIFICATION_BINDING_MISMATCH',
        'Delivery package must use the verified artifact and commit',
      );
    return { ok: true, record, artifactHash: expectedArtifact, commit: expectedCommit };
  }

  function createPackage({
    verification,
    artifactHash,
    commit,
    unexecuted,
    rollback,
    parentDeliveryId = null,
    parentPackageId = null,
    affectedAc,
  } = {}) {
    const checked = verifiedInput(verification, artifactHash, commit);
    if (!checked.ok) return checked;
    if (!Array.isArray(unexecuted))
      return failure('UNEXECUTED_CHECKS_REQUIRED', 'Unexecuted checks must be an explicit array');
    if (unexecuted.length > 256)
      return failure('UNEXECUTED_CHECKS_INVALID', 'Too many unexecuted checks were declared');
    if (unexecuted.some((entry) => typeof entry !== 'string'))
      return failure('UNEXECUTED_CHECKS_INVALID', 'Unexecuted checks must be strings');
    const unexecutedChecks = [...new Set(unexecuted.map((entry) => safeText(entry)))];
    if (unexecutedChecks.some((entry) => !entry || unsafePersistedText(entry)))
      return failure('UNEXECUTED_CHECKS_INVALID', 'Unexecuted checks contain unsafe content');
    const rollbackInstructions = normalizeRollback(rollback);
    if (!rollbackInstructions)
      return failure('ROLLBACK_REQUIRED', 'A safe rollback instruction is required');
    const affected = normalizeAcList(affectedAc);
    if (!affected)
      return failure('INCREMENT_AC_INVALID', 'Affected acceptance criteria are invalid');
    if (
      parentDeliveryId !== null &&
      (typeof parentDeliveryId !== 'string' || !ID.test(parentDeliveryId))
    )
      return failure('PARENT_DELIVERY_MISMATCH', 'Parent delivery identifier is invalid');
    if (
      parentPackageId !== null &&
      (typeof parentPackageId !== 'string' || !ID.test(parentPackageId))
    )
      return failure('PARENT_DELIVERY_MISMATCH', 'Parent package identifier is invalid');
    const sourceReferences = normalizeReferenceList(verification.sourceReferences);
    if (!sourceReferences)
      return failure('EVIDENCE_TAMPERED', 'Verification source references are unsafe');
    const evidenceReferences = normalizeReferenceList([
      `evidence:${verification.evidenceId}`,
      `verification:${verification.verificationFingerprint}`,
    ]);
    if (!evidenceReferences)
      return failure('EVIDENCE_TAMPERED', 'Verification evidence references are unsafe');

    const stable = {
      schemaVersion: 1,
      kind: 'delivery-assurance-package',
      artifactHash: checked.artifactHash,
      commit: checked.commit,
      manifestHash: verification.manifestHash,
      verificationFingerprint: verification.verificationFingerprint,
      unexecuted: unexecutedChecks,
      rollback: rollbackInstructions,
      parentDeliveryId,
      parentPackageId,
      affectedAc: affected,
      sourceReferences,
      evidenceReferences,
    };
    const packageId = `pkg-${hashValue(stable).slice(0, 32)}`;
    const packageKey = `packages/${packageId}/package.json`;
    if (packages.has(packageId))
      return failure('PACKAGE_ID_CONFLICT', 'A delivery package with this identity already exists');
    const body = {
      ...stable,
      packageId,
      createdAt: clockNow(clock).toISOString(),
    };
    const deliveryPackage = { ...body, packageHash: hashValue(body) };
    const context = verification?.[CONTEXT] || checked.record.evidence[CONTEXT];
    if (!context?.storageBase)
      return failure('UNVERIFIED_EVIDENCE', 'Verified evidence has no immutable delivery store');
    try {
      const target = path.join(context.storageBase, ...packageKey.split('/'));
      if (fs.existsSync(target))
        return failure(
          'PACKAGE_ID_CONFLICT',
          'A delivery package with this identity already exists',
        );
      writeImmutable(context.storageBase, packageKey, deliveryPackage);
      const persisted = readImmutable(context.storageBase, packageKey);
      if (canonical(persisted) !== canonical(deliveryPackage))
        return failure('PACKAGE_TAMPERED', 'Persisted delivery package does not match its source');
      const immutable = attachContext({ ...deliveryPackage }, { storageBase: context.storageBase });
      packages.set(packageId, { package: immutable, packageHash: deliveryPackage.packageHash });
      return {
        ok: true,
        package: immutable,
        packageHash: deliveryPackage.packageHash,
        packageId,
        packageKey,
      };
    } catch (error) {
      return failure(error.assuranceCode || 'PACKAGE_WRITE_FAILED', error.message);
    }
  }

  function packageDelivery(args = {}) {
    return createPackage(args);
  }

  async function redeliver({
    parent,
    artifactHash,
    commit,
    verification,
    affectedAc,
    unexecuted,
    rollback,
  } = {}) {
    if (
      !parent ||
      typeof parent !== 'object' ||
      Array.isArray(parent) ||
      !(
        parent.accepted === true ||
        parent.state === 'delivery-accepted' ||
        parent.releaseState === 'customer-accepted' ||
        parent.acceptance === 'accepted'
      )
    )
      return failure('PARENT_DELIVERY_NOT_ACCEPTED', 'Redelivery requires an accepted parent');
    if (typeof parent.packageId !== 'string' || !ID.test(parent.packageId))
      return failure('PARENT_DELIVERY_MISMATCH', 'Parent package identifier is required');
    const parentArtifact = normalizeHash(parent.artifactHash);
    const nextArtifact = normalizeHash(artifactHash);
    if (!parentArtifact || !nextArtifact)
      return failure(
        'VERIFICATION_BINDING_MISMATCH',
        'Both parent and next artifact hashes are required',
      );
    if (parentArtifact === nextArtifact)
      return failure('REDELIVERY_ARTIFACT_REUSED', 'Redelivery must bind a new artifact hash');
    const knownParent = packages.get(parent.packageId);
    if (knownParent) {
      if (typeof parent.packageHash !== 'string' || knownParent.packageHash !== parent.packageHash)
        return failure('PARENT_DELIVERY_TAMPERED', 'Parent package hash does not match history');
      if (normalizeHash(knownParent.package.artifactHash) !== parentArtifact)
        return failure('PARENT_DELIVERY_TAMPERED', 'Parent artifact hash does not match history');
    }
    const affected = normalizeAcList(affectedAc);
    if (!affected)
      return failure('INCREMENT_AC_INVALID', 'Affected acceptance criteria are required');
    const parentDeliveryId =
      typeof parent.deliveryId === 'string' && ID.test(parent.deliveryId)
        ? parent.deliveryId
        : parent.packageId;
    return createPackage({
      verification,
      artifactHash: nextArtifact,
      commit,
      unexecuted,
      rollback,
      parentDeliveryId,
      parentPackageId: parent.packageId,
      affectedAc: affected,
    });
  }

  return Object.freeze({
    freezeTests,
    prepareRepair,
    verify,
    package: packageDelivery,
    redeliver,
  });
}
