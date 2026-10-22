import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildChangeContract, normalizeChangeInput, validateChangeInput } from './change-policy.js';
import { canonicalJson, hashValue } from './events.js';
import { readDeliveryRecord } from './delivery.js';
import { loadProjectReadiness, PROJECT_PROFILE_PATH } from './project-state.js';

const SOURCE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TERMINAL = new Set(['ARCHIVED', 'ARCHIVED_NOT_PUSHED', 'CANCELLED']);
const CATEGORIES = new Set([
  'functional',
  'non-functional',
  'constraint',
  'acceptance',
  'boundary',
  'failure',
  'security',
  'performance',
  'concurrency',
  'compatibility',
]);
const FINDINGS = [
  'ambiguities',
  'contradictions',
  'infeasibleItems',
  'nonFunctionalRisks',
  'securityPerformanceConcurrencyRisks',
  'testBlindSpots',
  'suggestedQuestions',
];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const text = (value, max = 16000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const keys = (value, allowed) =>
  object(value) && Object.keys(value).every((key) => allowed.includes(key));
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const secret = (value) =>
  /(?:\bBearer\s+[A-Za-z0-9._~+/-]{12,}|\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*[^\s,;]{6,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i.test(
    canonicalJson(value),
  );

export function stableChangeName(request) {
  const slug = request
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 55)
    .replace(/-$/, '');
  return `${slug || 'change'}-${hashValue(request).slice(0, 12)}`;
}

const abortError = () => Object.assign(new Error('Operation cancelled'), { code: 'CANCELLED' });

// Providers may ignore AbortSignal. Stop awaiting them and never apply their
// late answer; Promise.race also observes any later provider rejection.
async function raceAbort(operation, signal) {
  if (!signal) return operation();
  if (signal.aborted) throw abortError();
  let aborted;
  const cancellation = new Promise((_, reject) => {
    aborted = () => reject(abortError());
    signal.addEventListener('abort', aborted, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (signal.aborted) throw abortError();
        return operation();
      }),
      cancellation,
    ]);
  } finally {
    signal.removeEventListener('abort', aborted);
  }
}

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function checkedFile(root, relative) {
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('Unsafe workflow artifact path');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (
      stat.isSymbolicLink() ||
      (current === target
        ? !stat.isFile() || stat.nlink > 1 || stat.size > 4 * 1024 * 1024
        : !stat.isDirectory())
    )
      throw new Error('Unsafe workflow artifact');
  }
  return target;
}

function readJson(root, relative) {
  return JSON.parse(fs.readFileSync(checkedFile(root, relative), 'utf8'));
}

function writeImmutable(root, relative, value) {
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('Unsafe snapshot path');
  let current = root;
  for (const part of path.relative(root, path.dirname(target)).split(path.sep)) {
    current = path.join(current, part);
    try {
      fs.mkdirSync(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe snapshot directory');
  }
  const content = canonicalJson(value) + '\n';
  if (Buffer.byteLength(content) > 4 * 1024 * 1024)
    throw new Error('Snapshot exceeds the artifact size limit');
  let descriptor;
  try {
    descriptor = fs.openSync(target, 'wx', 0o600);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (error.code !== 'EEXIST' || fs.readFileSync(checkedFile(root, relative), 'utf8') !== content)
      throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  if (process.platform !== 'win32') {
    const directory = fs.openSync(path.dirname(target), 'r');
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  }
  return relative;
}

function validDraft(args) {
  if (
    !Array.isArray(args.requirements) ||
    !args.requirements.length ||
    args.requirements.length > 200 ||
    !Array.isArray(args.assumptions) ||
    !Array.isArray(args.openIssues) ||
    args.assumptions.length > 200 ||
    args.openIssues.length > 200
  )
    return false;
  const reqIds = new Set();
  const acIds = new Set();
  for (const req of args.requirements) {
    if (
      !keys(req, ['id', 'category', 'text', 'acceptanceCriteria']) ||
      !id(req.id) ||
      reqIds.has(req.id) ||
      !CATEGORIES.has(req.category) ||
      !text(req.text) ||
      !Array.isArray(req.acceptanceCriteria) ||
      !req.acceptanceCriteria.length ||
      req.acceptanceCriteria.length > 100
    )
      return false;
    reqIds.add(req.id);
    for (const ac of req.acceptanceCriteria) {
      if (!keys(ac, ['id', 'text']) || !id(ac.id) || acIds.has(ac.id) || !text(ac.text))
        return false;
      acIds.add(ac.id);
    }
  }
  const assumptionIds = new Set();
  for (const assumption of args.assumptions) {
    if (
      !keys(assumption, ['id', 'text', 'risk', 'pendingConfirmation']) ||
      !id(assumption.id) ||
      assumptionIds.has(assumption.id) ||
      !text(assumption.text) ||
      !text(assumption.risk) ||
      assumption.pendingConfirmation !== true
    )
      return false;
    assumptionIds.add(assumption.id);
  }
  const issueIds = new Set();
  return args.openIssues.every((issue) => {
    const valid =
      keys(issue, ['id', 'text', 'blocking', 'assumptionId']) &&
      id(issue.id) &&
      !issueIds.has(issue.id) &&
      text(issue.text) &&
      typeof issue.blocking === 'boolean' &&
      (issue.blocking || assumptionIds.has(issue.assumptionId));
    issueIds.add(issue?.id);
    return valid;
  });
}

function validCritique(report, requirements) {
  if (
    !keys(report, ['restatement', ...FINDINGS]) ||
    Object.keys(report).length !== FINDINGS.length + 1 ||
    !Array.isArray(report.restatement)
  )
    return false;
  const reqIds = new Set(requirements.map((req) => req.id));
  const covered = new Set();
  for (const item of report.restatement) {
    if (
      !keys(item, ['requirementId', 'text']) ||
      !reqIds.has(item.requirementId) ||
      covered.has(item.requirementId) ||
      !text(item.text)
    )
      return false;
    covered.add(item.requirementId);
  }
  if (covered.size !== reqIds.size) return false;
  const findingIds = new Set();
  return FINDINGS.every(
    (category) =>
      Array.isArray(report[category]) &&
      report[category].every((finding) => {
        const valid =
          keys(finding, ['id', 'requirementIds', 'text', 'severity', 'suggestion']) &&
          id(finding.id) &&
          !findingIds.has(finding.id) &&
          Array.isArray(finding.requirementIds) &&
          finding.requirementIds.length > 0 &&
          finding.requirementIds.every((ref) => reqIds.has(ref)) &&
          text(finding.text) &&
          ['blocking', 'non-blocking'].includes(finding.severity) &&
          text(finding.suggestion);
        findingIds.add(finding?.id);
        return valid;
      }),
  );
}

function snapshot(state, data) {
  const revision = data.revisions.at(-1);
  return {
    schemaVersion: 1,
    changeId: state.changeId,
    revision: revision.revision,
    request: data.request,
    requirements: revision.requirements,
    assumptions: revision.assumptions,
    openIssues: revision.openIssues,
    clarifications: data.rounds,
    critique: data.critique,
    change: data.change,
    changeContract: data.changeContract,
  };
}

/** Dependencies are server-owned closures. No user identity, answers, receipt or
 * approval handle can be submitted through a workflow method's tool arguments.
 * This is a controlled proposal/recording core, not an autonomous LLM runner. */
export function createChangeAddService({
  projectRoot,
  store,
  approvalAuthority,
  userInputProvider,
  verifyPrerequisites = async ({ root }) =>
    (await import('./verify.js')).validateVerificationEvidence({ root }),
} = {}) {
  const root = fs.realpathSync(projectRoot);
  if (!store || typeof store.inspect !== 'function')
    throw new TypeError('A server state store is required');
  const safeRoot =
    !inside(path.resolve(SOURCE_ROOT), root) && !inside(root, path.resolve(SOURCE_ROOT));
  const now = () => new Date().toISOString();
  const gitEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
    ),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  };
  const git = (args) =>
    spawnSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.hooksPath=' + path.join(root, '.specgate/codex/disabled-hooks'),
        ...args,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
        env: gitEnv,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      },
    );

  async function inspectPrerequisites() {
    if (!safeRoot)
      return failure(
        'SOURCE_REPOSITORY_FORBIDDEN',
        'The plugin source repository cannot host an active product change',
      );
    let project = null;
    let verification = null;
    if (fs.existsSync(path.join(root, PROJECT_PROFILE_PATH))) {
      const readiness = loadProjectReadiness({ projectRoot: root });
      if (!readiness.ok) return readiness;
      project = {
        mode: readiness.profile.mode,
        projectId: readiness.profile.projectId,
        baselineId: readiness.baseline.baselineId,
        baselineStatus: readiness.baseline.status,
        environmentFingerprint: readiness.baseline.environmentFingerprint,
      };
    } else {
      let init;
      try {
        init = readJson(root, '.specgate/init-report.json');
        checkedFile(root, '.specgate/config.yaml');
        readJson(root, '.specgate/monorepo.json');
      } catch {
        return failure(
          'PROJECT_NOT_READY',
          'Adopt or initialize and verify the project before adding a change',
        );
      }
      if (init.initializationComplete !== true || init.phase === 'GENERATED_ONLY')
        return failure(
          'INITIALIZATION_NOT_VERIFIED',
          'Generation alone is insufficient; real verification must pass',
        );
      try {
        verification = await verifyPrerequisites({ root });
      } catch {
        return failure(
          'VERIFICATION_EVIDENCE_INVALID',
          'Real verification evidence could not be validated',
        );
      }
      if (verification?.ok !== true)
        return failure(
          verification?.code || 'VERIFICATION_EVIDENCE_INVALID',
          verification?.message || 'Real verification evidence is required',
        );
    }
    const repository = git(['rev-parse', '--show-toplevel']);
    if (repository.status !== 0 || path.resolve(repository.stdout.trim()) !== root)
      return failure(
        'GIT_REPOSITORY_REQUIRED',
        'A Git repository rooted at the project is required',
      );
    const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
    if (status.status !== 0)
      return failure('GIT_STATUS_UNAVAILABLE', 'Cannot inspect the project Git state');
    if (status.stdout.trim())
      return failure(
        'GIT_NOT_CLEAN',
        'Tracked changes and untracked files must be resolved before adding a change',
      );
    const loaded = await store.inspect();
    if (!loaded.ok) return loaded;
    if (loaded.state.changeId && !TERMINAL.has(loaded.state.phase))
      return failure('ACTIVE_CHANGE', 'Only one active change is permitted');
    return {
      ok: true,
      state: loaded.state,
      project,
      verification: verification
        ? { sourceHash: verification.sourceHash, runId: verification.runId ?? null }
        : null,
    };
  }

  async function current(args, allowed) {
    if (!safeRoot)
      return failure(
        'SOURCE_REPOSITORY_FORBIDDEN',
        'The plugin source repository cannot host an active product change',
      );
    if (!Number.isSafeInteger(args.expectedVersion) || args.expectedVersion < 0)
      return failure('INVALID_ARGUMENT', 'A nonnegative expectedVersion is required');
    const loaded = await store.load();
    if (!loaded.ok) return loaded;
    if (loaded.state.version !== args.expectedVersion)
      return failure('VERSION_CONFLICT', 'Read the current state before retrying', {
        actualVersion: loaded.state.version,
      });
    if (!allowed.includes(loaded.state.phase) || !loaded.state.context.changeAdd)
      return failure(
        'INVALID_TRANSITION',
        'This requirements operation is not permitted in the current phase',
      );
    return loaded;
  }

  const update = (state, data, artifact = null) =>
    store.update({
      expectedVersion: state.version,
      patch: {
        context: {
          changeAdd: data,
          artifacts: { ...state.context.artifacts, requirements: artifact },
        },
      },
    });

  async function startCommon(args, type, details, parentDeliveryId = null) {
    const validation = validateChangeInput({ type, request: args.request, details });
    if (!validation.ok) return validation;
    const ready = await inspectPrerequisites();
    if (!ready.ok) return ready;
    if (parentDeliveryId) {
      if (!ready.project)
        return failure(
          'PARENT_DELIVERY_PROJECT_REQUIRED',
          'Incremental delivery requires a ProjectProfile-backed project',
        );
      const parent = readDeliveryRecord({
        projectRoot: root,
        deliveryId: parentDeliveryId,
      });
      if (!parent.ok) return parent;
      if (parent.delivery.projectId !== ready.project.projectId)
        return failure(
          'PARENT_DELIVERY_PROJECT_MISMATCH',
          'Parent delivery belongs to another project',
        );
      if (parent.delivery.state !== 'delivery-accepted')
        return failure('PARENT_DELIVERY_NOT_ACCEPTED', 'Parent delivery is not accepted');
    }
    return store.create({
      expectedVersion: args.expectedVersion,
      changeId: args.name ?? stableChangeName(args.request),
      context: {
        changeAdd: {
          request: { text: args.request, source: 'command-input', at: now() },
          change: {
            type,
            details: clone(details),
            parentDeliveryId,
            baselineId: ready.project?.baselineId ?? 'baseline-legacy',
          },
          revisions: [],
          rounds: [],
          critique: null,
          candidate: null,
          frozen: null,
          changeContract: null,
        },
        project: ready.project,
        prerequisiteVerification: ready.verification,
      },
    });
  }

  async function start(args = {}) {
    if (
      !keys(args, ['name', 'request', 'expectedVersion']) ||
      !text(args.request) ||
      (args.name !== undefined && !id(args.name))
    )
      return failure(
        'INVALID_ARGUMENT',
        'A bounded request and optional valid change name are required',
      );
    if (secret(args.request))
      return failure('SENSITIVE_INPUT', 'Remove credentials from the change request');
    return startCommon(args, 'feature', {}, null);
  }

  async function startTyped(args = {}) {
    if (
      !keys(args, ['name', 'request', 'expectedVersion', 'type', 'details', 'parentDeliveryId']) ||
      !text(args.request) ||
      (args.name !== undefined && !id(args.name))
    )
      return failure(
        'INVALID_ARGUMENT',
        'A bounded request, type and optional valid change name are required',
      );
    const normalized = normalizeChangeInput({
      request: args.request,
      type: args.type,
      details: args.details ?? {},
    });
    if (!normalized.ok) return normalized;
    return startCommon(args, normalized.type, normalized.details, args.parentDeliveryId ?? null);
  }

  async function cancelled() {
    const inspected = await store.inspect();
    return failure(
      'CANCELLED',
      'The server cancelled this requirements operation',
      inspected.ok ? { actualVersion: inspected.state.version } : {},
    );
  }

  async function propose(args = {}) {
    if (!keys(args, ['expectedVersion', 'requirements', 'assumptions', 'openIssues']))
      return failure('INVALID_ARGUMENT', 'Only a requirements proposal may be submitted');
    const loaded = await current(args, ['REQ_INTAKE', 'REQ_CLARIFYING', 'H1_PENDING']);
    if (!loaded.ok) return loaded;
    if (!validDraft(args))
      return failure(
        'REQUIREMENTS_INVALID',
        'Requirements, acceptance criteria, assumptions and unresolved issues must be structured and referenced',
      );
    if (secret(args))
      return failure('SENSITIVE_INPUT', 'Remove credentials from the requirements proposal');
    let state = loaded.state;
    if (state.phase !== 'REQ_CLARIFYING') {
      const moved = await store.transition({
        expectedVersion: state.version,
        to: 'REQ_CLARIFYING',
      });
      if (!moved.ok) return moved;
      state = moved.state;
    }
    const data = clone(state.context.changeAdd);
    data.revisions.push({
      revision: data.revisions.length + 1,
      at: now(),
      source: 'model-proposal',
      requirements: args.requirements,
      assumptions: args.assumptions,
      openIssues: args.openIssues,
    });
    data.critique = null;
    data.candidate = null;
    data.frozen = null;
    data.changeContract = null;
    return update(state, data);
  }

  async function askQuestions(args = {}, { signal } = {}) {
    if (!keys(args, ['expectedVersion', 'questions', 'round']))
      return failure(
        'INVALID_ARGUMENT',
        'Answers and user provenance cannot be submitted as tool arguments',
      );
    if (signal?.aborted) return cancelled();
    const loaded = await current(args, ['REQ_CLARIFYING']);
    if (!loaded.ok) return loaded;
    const data = clone(loaded.state.context.changeAdd);
    const resume = args.round !== undefined;
    if (
      resume &&
      (args.questions !== undefined ||
        !Number.isSafeInteger(args.round) ||
        args.round < 1 ||
        args.round > data.rounds.length ||
        data.rounds[args.round - 1].status !== 'pending')
    )
      return failure('INVALID_ARGUMENT', 'Only an existing unanswered round may be resumed');
    if (!resume && data.rounds.some((round) => round.status === 'pending'))
      return failure(
        'CLARIFICATION_PENDING',
        'Resume the unanswered clarification round before opening another',
      );
    const questions = resume ? data.rounds[args.round - 1].questions : args.questions;
    if (
      !Array.isArray(questions) ||
      questions.length < 1 ||
      questions.length > 5 ||
      (!resume && data.rounds.length >= 3)
    )
      return failure(
        'QUESTION_LIMIT',
        'At most three rounds with at most five questions are permitted',
      );
    const seen = new Set();
    if (
      !questions.every((q) => {
        const valid =
          keys(q, ['id', 'category', 'text']) &&
          id(q.id) &&
          !seen.has(q.id) &&
          CATEGORIES.has(q.category) &&
          text(q.text, 2000);
        seen.add(q?.id);
        return valid;
      })
    )
      return failure('INVALID_ARGUMENT', 'Questions require unique IDs, categories and text');
    if (secret(questions))
      return failure('SENSITIVE_INPUT', 'Remove credentials from clarification questions');
    const identity = userInputProvider?.trustedUserIdentity;
    if (
      typeof userInputProvider?.request !== 'function' ||
      !object(identity) ||
      identity.kind !== 'user' ||
      !text(identity.id) ||
      !text(identity.source) ||
      /(?:client[-_ ]?info|capabilit)|^(?:client|mcp-client)$/i.test(identity.source)
    )
      return failure(
        'TRUSTED_USER_INPUT_UNAVAILABLE',
        'A proven native user interaction source is required for answers',
      );
    const actor = { id: identity.id, source: identity.source, kind: 'user' };
    let saved = loaded;
    const roundIndex = resume ? args.round - 1 : data.rounds.length;
    if (!resume) {
      data.rounds.push({
        round: roundIndex + 1,
        at: now(),
        status: 'pending',
        questions: clone(questions),
        source: 'model-proposal',
        answers: [],
      });
      data.critique = null;
      data.candidate = null;
      if (signal?.aborted) return cancelled();
      saved = await update(loaded.state, data);
      if (!saved.ok) return saved;
    }
    let response;
    try {
      response = await raceAbort(
        () =>
          userInputProvider.request(
            {
              changeId: saved.state.changeId,
              round: roundIndex + 1,
              questions: clone(questions),
            },
            { signal },
          ),
        signal,
      );
    } catch {
      if (signal?.aborted) return cancelled();
      return failure('USER_INPUT_FAILED', 'Native clarification did not complete', {
        actualVersion: saved.state.version,
      });
    }
    if (signal?.aborted) return cancelled();
    if (
      !keys(response, ['answers']) ||
      !Array.isArray(response.answers) ||
      response.answers.length !== questions.length ||
      new Set(response.answers.map((a) => a?.questionId)).size !== questions.length ||
      !response.answers.every(
        (a) => keys(a, ['questionId', 'answer']) && seen.has(a.questionId) && text(a.answer, 8000),
      )
    )
      return failure('USER_INPUT_INVALID', 'Native answers did not match the pending questions', {
        actualVersion: saved.state.version,
      });
    if (secret(response))
      return failure(
        'SENSITIVE_INPUT',
        'Native answers contain apparent credentials and were not recorded',
        { actualVersion: saved.state.version },
      );
    data.rounds[roundIndex].status = 'answered';
    data.rounds[roundIndex].answers = response.answers.map((a) => ({
      ...a,
      source: 'native-user-provider',
      actor,
      at: now(),
    }));
    if (signal?.aborted) return cancelled();
    saved = await update(saved.state, data);
    return saved;
  }

  async function critique(args = {}) {
    if (!keys(args, ['expectedVersion', 'report']))
      return failure('INVALID_ARGUMENT', 'Only a structured critique report may be submitted');
    const loaded = await current(args, ['REQ_CLARIFYING', 'REQ_CRITIQUE']);
    if (!loaded.ok) return loaded;
    const revision = loaded.state.context.changeAdd.revisions.at(-1);
    if (!revision || !validCritique(args.report, revision.requirements))
      return failure(
        'CRITIQUE_INVALID',
        'Critique must cover every requirement and reference valid requirement IDs in every finding',
      );
    if (secret(args.report))
      return failure('SENSITIVE_INPUT', 'Remove credentials from the critique report');
    let state = loaded.state;
    if (state.phase !== 'REQ_CRITIQUE') {
      const moved = await store.transition({ expectedVersion: state.version, to: 'REQ_CRITIQUE' });
      if (!moved.ok) return moved;
      state = moved.state;
    }
    const data = clone(state.context.changeAdd);
    data.critique = { source: 'model-proposal', at: now(), report: clone(args.report) };
    const contract = buildChangeContract({
      changeId: state.changeId,
      parentDeliveryId: data.change?.parentDeliveryId ?? null,
      type: data.change?.type,
      request: data.request.text,
      details: data.change?.details ?? {},
      requirements: revision.requirements,
      baselineId: data.change?.baselineId,
      status: 'H1_PENDING',
    });
    if (!contract.ok) return contract;
    data.changeContract = contract.contract;
    const artifact = snapshot(state, data);
    const artifactHash = 'sha256:' + hashValue(artifact);
    data.candidate = { hash: artifactHash, snapshot: artifact };
    const saved = await update(state, data, { hash: artifactHash, revision: revision.revision });
    if (!saved.ok) return saved;
    return store.transition({ expectedVersion: saved.state.version, to: 'H1_PENDING' });
  }

  async function requestH1(args = {}, { signal } = {}) {
    if (!keys(args, ['expectedVersion']))
      return failure(
        'INVALID_ARGUMENT',
        'Approval credentials cannot be submitted as tool arguments',
      );
    if (signal?.aborted) return cancelled();
    const loaded = await current(args, ['H1_PENDING']);
    if (!loaded.ok) return loaded;
    const data = clone(loaded.state.context.changeAdd);
    const revision = data.revisions.at(-1);
    if (
      !data.candidate ||
      !data.critique ||
      data.candidate.hash !== 'sha256:' + hashValue(snapshot(loaded.state, data))
    )
      return failure(
        'REQUIREMENTS_CHANGED',
        'Requirements changed; run a fresh critique before requesting H1',
      );
    if (
      revision.openIssues.some((issue) => issue.blocking) ||
      FINDINGS.some((category) =>
        data.critique.report[category].some((finding) => finding.severity === 'blocking'),
      ) ||
      data.rounds.some((round) => round.status !== 'answered')
    )
      return failure(
        'REQUIREMENTS_BLOCKED',
        'Resolve blocking requirements, critique findings and unanswered clarification rounds before H1',
      );
    if (typeof approvalAuthority?.requestApproval !== 'function')
      return failure('TRUSTED_APPROVAL_UNAVAILABLE', 'A native approval authority is required');
    const base = `.specgate/codex/changes/${loaded.state.changeId}/requirements/`;
    const fingerprint = data.candidate.hash.replace(/^sha256:/, '');
    const candidatePath = base + 'candidate-' + fingerprint + '.json';
    if (signal?.aborted) return cancelled();
    try {
      writeImmutable(root, candidatePath, data.candidate.snapshot);
    } catch {
      return failure(
        'SNAPSHOT_CONFLICT',
        'An immutable requirements artifact could not be safely written',
      );
    }
    let artifactPath = candidatePath;
    const approved = await approvalAuthority.requestApproval({
      gate: 'H1',
      scope: loaded.state.changeId,
      artifactHash: data.candidate.hash,
      readArtifactHash: async () => {
        if (signal?.aborted) throw abortError();
        return 'sha256:' + hashValue(readJson(root, artifactPath));
      },
      summary: canonicalJson(data.candidate.snapshot),
      signal,
    });
    const fresh = await store.load();
    if (!fresh.ok) return fresh;
    if (
      fresh.state.phase !== 'H1_PENDING' ||
      fresh.state.context.changeAdd?.candidate?.hash !== data.candidate.hash
    )
      return failure(
        'REQUIREMENTS_CHANGED',
        'Requirements changed during H1; request new approval',
      );
    if (!approved.ok) {
      if (approved.record?.decision === 'cancel') {
        const cancelled = await store.cancel({
          expectedVersion: fresh.state.version,
          reason: 'Native user cancelled H1',
        });
        if (!cancelled.ok) return cancelled;
        return { ...approved, state: cancelled.state, actualVersion: cancelled.state?.version };
      }
      if (approved.record?.decision === 'modify') {
        const moved = await store.transition({
          expectedVersion: fresh.state.version,
          to: 'REQ_CLARIFYING',
        });
        if (!moved.ok) return moved;
        return { ...approved, state: moved.state, actualVersion: moved.state?.version };
      }
      return { ...approved, actualVersion: fresh.state.version };
    }
    if (signal?.aborted) return cancelled();
    const frozenPath = base + `revision-${revision.revision}-${fingerprint}.json`;
    try {
      writeImmutable(root, frozenPath, data.candidate.snapshot);
    } catch {
      return failure(
        'SNAPSHOT_CONFLICT',
        'The immutable approved revision could not be safely written',
      );
    }
    artifactPath = frozenPath;
    // The phase plus the gate transition's consumed approval is authoritative.
    // A prepared file or this locator alone never claims requirements are frozen.
    data.frozen = {
      path: frozenPath,
      hash: data.candidate.hash,
      revision: revision.revision,
      authority: 'REQ_FROZEN-gate-transition',
    };
    const saved = await update(fresh.state, data, fresh.state.context.artifacts.requirements);
    if (!saved.ok) return saved;
    if (signal?.aborted) return cancelled();
    return store.transition({
      expectedVersion: saved.state.version,
      to: 'REQ_FROZEN',
      approval: approved.approval,
    });
  }

  return Object.freeze({
    inspectPrerequisites,
    start,
    startTyped,
    propose,
    askQuestions,
    critique,
    requestH1,
  });
}
