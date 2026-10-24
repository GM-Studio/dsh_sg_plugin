import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { hashValue } from '../events.js';
import { extractSessionId } from './codex-execution-adapter.js';
import { parseWaitingMarker } from './supervisor.js';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_PROMPT_LENGTH = 64_000;
const MAX_DECISION_PAYLOAD_LENGTH = 8_000;
const MAX_REQUEST_LENGTH = 32_000;
const MAX_EVIDENCE_PHASES = 40;
const MAX_WAITING_EVENTS = 200;
const SENSITIVE_FIELD =
  /^(?:authorization|cookie|password|passwd|secret|token|tokenHash|credential|private[_-]?key|api[_-]?key)$/i;
const HASH = /^[a-f0-9]{64}$/i;
const FATAL_HEARTBEAT_CODES = new Set([
  'WORKER_AUTHENTICATION_FAILED',
  'WORKER_REVOKED',
  'LEASE_INVALID',
  'RUN_STOPPED',
  'WORKER_OFFLINE',
]);

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function boundedText(value, maximum = 256) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function boundedString(value, maximum) {
  return String(value ?? '').slice(0, maximum);
}

function sanitizeMessage(value, projectRoots = [], maximum = 1000) {
  let result = String(value || 'Worker execution failed');
  for (const root of projectRoots) {
    if (!root) continue;
    result = result.split(root).join('<local-path>');
    result = result.split(root.replaceAll('\\', '/')).join('<local-path>');
  }
  return result
    .replace(/[A-Za-z]:[\\/][^\s"'`]+/g, '<local-path>')
    .replace(/\/(?:tmp|home|Users|opt|var|private)\/[^\s"'`]+/g, '<local-path>')
    .replace(
      /(?:\bBearer\s+[A-Za-z0-9._~+/-]{12,}|\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]{6,})/gi,
      '<redacted>',
    )
    .slice(0, maximum);
}

function sanitizeFailureValue(value, projectRoots, depth = 0, seen = new Set()) {
  if (value === undefined) return undefined;
  if (depth > 6) return '<truncated>';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return sanitizeMessage(value, projectRoots, 4000);
  if (typeof value !== 'object') return '<invalid>';
  if (seen.has(value)) return '<cycle>';
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value
      .slice(0, 50)
      .map((entry) => sanitizeFailureValue(entry, projectRoots, depth + 1, seen));
  } else if (isPlainObject(value)) {
    result = {};
    for (const [key, entry] of Object.entries(value).slice(0, 50)) {
      if (SENSITIVE_FIELD.test(key)) continue;
      result[key] = sanitizeFailureValue(entry, projectRoots, depth + 1, seen);
    }
  } else {
    result = '<invalid>';
  }
  seen.delete(value);
  return result;
}

function safeCode(value, fallback) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(value) ? value : fallback;
}

function normalizeProjectRoots(value) {
  if (!isPlainObject(value)) throw new TypeError('projectRoots must be a plain object');
  const normalized = Object.create(null);
  for (const [projectId, projectRoot] of Object.entries(value)) {
    if (!boundedText(projectId, 128) || !boundedText(projectRoot, 4096)) {
      throw new TypeError('Project ids and roots must be bounded nonempty strings');
    }
    if (!path.isAbsolute(projectRoot)) {
      throw new TypeError('Project roots must be absolute local paths');
    }
    let resolved;
    try {
      const stats = statSync(projectRoot);
      if (!stats.isDirectory()) throw new TypeError('Project root is not a directory');
      resolved = realpathSync(projectRoot);
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw new TypeError('Project root must reference an existing directory', { cause: error });
    }
    normalized[projectId] = resolved;
  }
  return Object.freeze(normalized);
}

function responseData(result) {
  return isPlainObject(result?.data) ? result.data : result;
}

function resultOk(result) {
  return result?.ok === true;
}

function runRevisionFrom(result, fallback) {
  const data = responseData(result);
  const revision =
    data?.run?.revision ?? data?.result?.run?.revision ?? data?.revision ?? result?.run?.revision;
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : fallback + 1;
}

function decisionInput(decision, { error = null, attention = null } = {}) {
  return {
    decisionId: decision.decisionId,
    workItemId: decision.workItemId,
    ...(error ? { error } : {}),
    ...(attention ? { attention } : {}),
  };
}

function parseDecisionList(decisions) {
  if (!Array.isArray(decisions)) return [];
  return decisions.filter(
    (decision) =>
      isPlainObject(decision) &&
      boundedText(decision.decisionId, 128) &&
      boundedText(decision.workItemId, 128),
  );
}

function eventPhase(event) {
  const type = event?.type;
  return typeof type === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(type) ? type : null;
}

function eventIdPart(value) {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9._:-]/g, '')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 80);
}

function promptPayload(payload) {
  const serialized = JSON.stringify(payload ?? {});
  return serialized.length <= MAX_DECISION_PAYLOAD_LENGTH
    ? serialized
    : `${serialized.slice(0, MAX_DECISION_PAYLOAD_LENGTH)}<truncated>`;
}

function buildPrompt(item, mode, decision) {
  const action = decision?.action ?? item.resume?.action ?? null;
  const payload = decision?.payload ?? item.resume?.payload ?? {};
  const request = boundedString(
    item.request || item.title || 'Continue the recorded SpecGate WorkItem.',
    MAX_REQUEST_LENGTH,
  );
  const lines = [
    mode === 'resume'
      ? 'Resume the exact persisted Codex session for this SpecGate WorkItem.'
      : 'Execute this SpecGate WorkItem autonomously.',
    `WorkItem: ${boundedString(item.workItemId, 128)}`,
    `Project: ${boundedString(item.projectId, 128)}`,
    `Request: ${request}`,
    ...(action
      ? [
          `Decision action: ${boundedString(action, 128)}`,
          `Decision payload: ${promptPayload(payload)}`,
        ]
      : []),
    mode === 'resume'
      ? 'Continue from the recorded checkpoint. Do not create a replacement session.'
      : 'Use the configured project instructions and SpecGate tools.',
    'If a gate tool returns WAITING_FOR_USER, stop immediately and preserve the wait.',
    'If a human gate is reached, emit one final line in this exact form:',
    'SPECGATE_WAITING_FOR_USER:{"type":"H1_APPROVAL","reason":"...","question":"...","actions":["approve","request_changes"],"artifactHash":"<64 hex>"}',
    'Never invent approval and never finish a human gate as successful delivery.',
  ];
  return lines.join('\n').slice(0, MAX_PROMPT_LENGTH);
}

export function createRemoteWorkerSupervisor({
  workerClient,
  adapter,
  projectRoots,
  clock = Date.now,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  logger = () => {},
} = {}) {
  if (!workerClient || typeof workerClient !== 'object') {
    throw new TypeError('A worker client is required');
  }
  for (const method of [
    'connect',
    'sync',
    'claim',
    'heartbeat',
    'reportEvents',
    'reportWaiting',
    'finishRun',
    'completeDecisionApply',
    'failDecisionApply',
  ]) {
    if (typeof workerClient[method] !== 'function') {
      throw new TypeError(`Worker client must implement ${method}`);
    }
  }
  if (!adapter || typeof adapter !== 'object') throw new TypeError('A Codex adapter is required');
  if (
    typeof adapter.run !== 'function' &&
    typeof adapter.start !== 'function' &&
    typeof adapter.resume !== 'function'
  ) {
    throw new TypeError('A Codex run, start or resume adapter is required');
  }
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
    throw new TypeError('heartbeatIntervalMs must be a positive integer');
  }
  if (typeof logger !== 'function') throw new TypeError('logger must be a function');

  const rootsByProject = normalizeProjectRoots(projectRoots);
  const roots = Object.values(rootsByProject);
  const pendingDecisions = new Map();
  const controllers = new Map();
  let cursor = null;
  let stopped = false;

  function sanitized(value, maximum = 1000) {
    return sanitizeMessage(value, roots, maximum);
  }

  async function invoke(method, input) {
    try {
      const result = await workerClient[method](input);
      if (!isPlainObject(result)) {
        return failure('WORKER_PROTOCOL_ERROR', `Worker ${method} returned an invalid response`);
      }
      if (resultOk(result)) return result;
      const sanitizedResult = sanitizeFailureValue(result, roots);
      return {
        ...sanitizedResult,
        message:
          sanitizedResult.message || sanitizedResult.error?.message || `Worker ${method} failed`,
      };
    } catch (error) {
      return failure(
        safeCode(error?.code, 'WORKER_CLIENT_FAILED'),
        sanitized(error?.message || `Worker ${method} failed`),
        { retryable: error?.retryable === true },
      );
    }
  }

  function localProjectRoot(projectId) {
    if (!boundedText(projectId, 128) || !Object.hasOwn(rootsByProject, projectId)) {
      return failure(
        'WORKER_PROJECT_ROOT_UNKNOWN',
        'The claimed project has no local project-root mapping',
      );
    }
    const configured = rootsByProject[projectId];
    try {
      const stats = statSync(configured);
      if (!stats.isDirectory()) {
        return failure(
          'WORKER_PROJECT_ROOT_INVALID',
          'The local project-root mapping is not a directory',
        );
      }
      return { ok: true, projectRoot: realpathSync(configured) };
    } catch {
      return failure(
        'WORKER_PROJECT_ROOT_INVALID',
        'The local project-root mapping is unavailable',
      );
    }
  }

  function rememberDecisions(decisions) {
    for (const decision of parseDecisionList(decisions)) {
      pendingDecisions.set(decision.decisionId, Object.freeze({ ...decision }));
    }
  }

  function matchingDecision(item) {
    const decisionId = item?.resume?.decisionId;
    if (boundedText(decisionId, 128) && pendingDecisions.has(decisionId)) {
      return pendingDecisions.get(decisionId);
    }
    const candidates = [...pendingDecisions.values()]
      .filter((decision) => decision.workItemId === item?.workItemId)
      .sort((left, right) => {
        const leftCreated = Date.parse(left.createdAt || '') || 0;
        const rightCreated = Date.parse(right.createdAt || '') || 0;
        return leftCreated - rightCreated;
      });
    if (candidates.length > 0) return candidates.at(-1);
    if (boundedText(decisionId, 128)) {
      return {
        decisionId,
        workItemId: item.workItemId,
        action: item.resume?.action ?? null,
        payload: item.resume?.payload ?? {},
        artifactHash: item.resume?.artifactHash ?? null,
        expectedWorkItemVersion: item.resume?.expectedWorkItemVersion ?? null,
      };
    }
    return null;
  }

  function explicitFailureAttention(reason, { workItemId, runId, code }) {
    return {
      type: 'FAILED',
      reason,
      question: 'Retry, request changes, or cancel this WorkItem?',
      actions: ['retry', 'request_changes', 'cancel'],
      summary: reason,
      risks: ['The original Codex session may no longer be recoverable.'],
      evidence: [code],
      artifactHash: hashValue({ workItemId, runId, code, reason }),
    };
  }

  async function markDecisionFailed(decision, { error, attention }) {
    if (!decision) return null;
    const failed = await invoke('failDecisionApply', decisionInput(decision, { error, attention }));
    if (resultOk(failed)) pendingDecisions.delete(decision.decisionId);
    return failed;
  }

  async function finishFailed({
    item,
    run,
    leaseToken,
    decision,
    code,
    message,
    attention = null,
    taskState = {},
  }) {
    const boundedMessage = sanitized(message || 'Remote Codex execution failed');
    const boundedCode = safeCode(code, 'CODEX_EXECUTION_FAILED');
    const boundedAttention = attention
      ? {
          ...attention,
          type: 'FAILED',
          ...(attention.reason ? { reason: sanitized(attention.reason) } : {}),
          ...(attention.question ? { question: sanitized(attention.question) } : {}),
          ...(attention.summary ? { summary: sanitized(attention.summary, 4000) } : {}),
          ...(Array.isArray(attention.risks)
            ? { risks: attention.risks.slice(0, 100).map((risk) => sanitized(risk, 1000)) }
            : {}),
          ...(Array.isArray(attention.evidence)
            ? {
                evidence: attention.evidence.slice(0, 200).map((entry) => sanitized(entry, 1000)),
              }
            : {}),
          ...(HASH.test(attention.artifactHash || '')
            ? { artifactHash: attention.artifactHash.toLowerCase() }
            : {
                artifactHash: hashValue({
                  workItemId: item.workItemId,
                  runId: run.runId,
                  code: boundedCode,
                  reason: boundedMessage,
                }),
              }),
        }
      : explicitFailureAttention(boundedMessage, {
          workItemId: item.workItemId,
          runId: run.runId,
          code: boundedCode,
        });
    const decisionFailure = await markDecisionFailed(decision, {
      error: boundedMessage,
      attention: boundedAttention,
    });
    const finished = await invoke('finishRun', {
      runId: run.runId,
      leaseToken,
      status: 'FAILED',
      error: boundedCode,
      outcome: {
        summary: boundedMessage,
        status: 'FAILED',
        delivery: null,
        ...(decisionFailure
          ? {
              decisionApply: {
                ok: decisionFailure.ok === true,
                code: decisionFailure.code ?? null,
                message: sanitized(decisionFailure.message || 'Decision apply failed'),
              },
            }
          : {}),
      },
      attention: boundedAttention,
    });
    const result = {
      ...failure(boundedCode, boundedMessage, {
        status: 'failed',
        workItemId: item.workItemId,
        runId: run.runId,
        attention: boundedAttention,
      }),
      ...taskState,
      decisionFailure: !decisionFailure || resultOk(decisionFailure) ? null : decisionFailure,
      finishFailure: resultOk(finished) ? null : finished,
    };
    logger({
      event: 'work_item.failed',
      workItemId: item.workItemId,
      runId: run.runId,
      code: boundedCode,
    });
    return result;
  }

  async function completeCancelDecisions() {
    const completed = [];
    for (const decision of [...pendingDecisions.values()]) {
      if (String(decision.action || '').toLowerCase() !== 'cancel') continue;
      const result = await invoke('completeDecisionApply', decisionInput(decision));
      if (!resultOk(result)) return { ok: false, result, completed };
      pendingDecisions.delete(decision.decisionId);
      completed.push({
        decisionId: decision.decisionId,
        workItemId: decision.workItemId,
      });
    }
    return { ok: true, completed };
  }

  async function completeDecision(decision) {
    if (!decision) return { ok: true, decision: null };
    const result = await invoke('completeDecisionApply', decisionInput(decision));
    if (resultOk(result)) pendingDecisions.delete(decision.decisionId);
    return { ok: resultOk(result), result, decision };
  }

  async function reportExecutionEvidence({ item, run, mode, execution, startedAt, phases }) {
    const occurredAt = new Date(clock()).toISOString();
    const event = {
      eventId:
        `execution:${eventIdPart(run.runId)}:${eventIdPart(mode)}:${eventIdPart(startedAt)}`.slice(
          0,
          128,
        ),
      type: 'execution.summary',
      projectId: item.projectId,
      workItemId: item.workItemId,
      runId: run.runId,
      occurredAt,
      dedupeKey: `execution:${boundedString(run.runId, 128)}:${mode}`,
      payload: {
        mode,
        ok: execution.ok === true,
        code: execution.ok ? null : safeCode(execution.code, 'CODEX_EXECUTION_FAILED'),
        exitCode: Number.isInteger(execution.exitCode) ? execution.exitCode : null,
        parsedEvents: Number.isSafeInteger(execution.parsedEvents)
          ? Math.max(0, execution.parsedEvents)
          : phases.length,
        phases: phases.slice(0, MAX_EVIDENCE_PHASES),
        durationMs: Math.max(0, clock() - startedAt),
      },
    };
    return invoke('reportEvents', [event]);
  }

  async function runOnce({ signal } = {}) {
    if (stopped) return failure('SUPERVISOR_STOPPED', 'Remote worker supervisor is stopped');

    const connected = await invoke('connect');
    if (!resultOk(connected)) return connected;

    const synced = await invoke('sync', { cursor });
    if (!resultOk(synced)) return synced;
    if (!Array.isArray(synced.pendingDecisions)) {
      return failure('WORKER_PROTOCOL_ERROR', 'Worker sync did not return pending decisions');
    }
    cursor = Object.hasOwn(synced, 'cursor') ? synced.cursor : cursor;
    rememberDecisions(synced.pendingDecisions);

    const cancelled = await completeCancelDecisions();
    if (!cancelled.ok) return cancelled.result;

    const claimedResult = await invoke('claim');
    if (!resultOk(claimedResult)) return claimedResult;
    const claim = responseData(claimedResult);
    if (claim?.idle === true || !claim?.workItem || !claim?.run || !claim?.lease) {
      return {
        ok: true,
        status: 'idle',
        idle: true,
        cursor,
        cancelled: cancelled.completed,
      };
    }

    const item = claim.workItem;
    const run = claim.run;
    const leaseToken = claim.lease.token ?? claim.lease.leaseToken;
    if (
      !boundedText(item.workItemId, 128) ||
      !boundedText(item.projectId, 128) ||
      !boundedText(run.runId, 128) ||
      !boundedText(leaseToken, 256)
    ) {
      return failure('WORKER_PROTOCOL_ERROR', 'Worker claim is missing required execution ids');
    }

    const decision = matchingDecision(item);
    const local = localProjectRoot(item.projectId);
    if (!local.ok) {
      return finishFailed({
        item,
        run,
        leaseToken,
        decision,
        code: local.code,
        message: local.message,
        taskState: { cursor },
      });
    }

    const persistedSessionId =
      (boundedText(run.sessionId, 256) && run.sessionId) ||
      (boundedText(item.resume?.sessionId, 256) && item.resume.sessionId) ||
      null;
    if (item.resume && !persistedSessionId) {
      return finishFailed({
        item,
        run,
        leaseToken,
        decision,
        code: 'RESUME_SESSION_REQUIRED',
        message:
          'The Decision can only be applied by resuming its original Codex session, but that session is unavailable.',
        taskState: { cursor },
      });
    }

    const mode = persistedSessionId ? 'resume' : 'start';
    const controller = new AbortController();
    controllers.set(run.runId, controller);
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });

    let runRevision = Number.isSafeInteger(run.revision) && run.revision >= 1 ? run.revision : 1;
    let sessionId = persistedSessionId;
    let currentPhase = mode === 'resume' ? 'RESUMING' : 'STARTING';
    let heartbeatFailure = null;
    let heartbeatChain = Promise.resolve();
    const phases = [];
    const events = [];
    const startedAt = clock();

    const requestHeartbeat = () => {
      heartbeatChain = heartbeatChain.then(async () => {
        if (heartbeatFailure) return heartbeatFailure;
        const result = await invoke('heartbeat', {
          runId: run.runId,
          leaseToken,
          expectedRunVersion: runRevision,
          updates: {
            currentPhase,
            ...(sessionId ? { sessionId } : {}),
          },
        });
        if (!resultOk(result)) {
          heartbeatFailure = result;
          if (FATAL_HEARTBEAT_CODES.has(result.code)) controller.abort();
          return result;
        }
        runRevision = runRevisionFrom(result, runRevision);
        return result;
      });
      return heartbeatChain;
    };

    const heartbeatTimer = setInterval(() => {
      void requestHeartbeat();
    }, heartbeatIntervalMs);
    heartbeatTimer.unref?.();

    const initialHeartbeat = await requestHeartbeat();
    if (!resultOk(initialHeartbeat)) {
      clearInterval(heartbeatTimer);
      controllers.delete(run.runId);
      signal?.removeEventListener('abort', abort);
      return finishFailed({
        item,
        run,
        leaseToken,
        decision,
        code: initialHeartbeat.code || 'WORKER_HEARTBEAT_FAILED',
        message: initialHeartbeat.message || 'Remote execution lease heartbeat failed',
        taskState: { cursor, sessionId },
      });
    }

    const executionInput = {
      mode,
      projectRoot: local.projectRoot,
      sessionId,
      prompt: buildPrompt(item, mode, decision),
      signal: controller.signal,
      environment: { SPECGATE_WORK_ITEM_ID: item.workItemId },
      onSession: (value) => {
        if (!boundedText(value, 256)) return;
        sessionId = value;
        currentPhase = mode === 'resume' ? 'RESUMING' : 'RUNNING';
        void requestHeartbeat();
      },
      onEvent: (event) => {
        if (events.length < MAX_WAITING_EVENTS) events.push(event);
        currentPhase = eventPhase(event) || currentPhase;
        if (phases.at(-1) !== currentPhase && phases.length < MAX_EVIDENCE_PHASES) {
          phases.push(currentPhase);
        }
        sessionId ||= extractSessionId(event);
      },
    };

    let execution;
    try {
      if (typeof adapter.run === 'function') execution = await adapter.run(executionInput);
      else if (mode === 'resume' && typeof adapter.resume === 'function') {
        execution = await adapter.resume(executionInput);
      } else if (typeof adapter.start === 'function') {
        execution = await adapter.start(executionInput);
      } else {
        execution = failure('CODEX_ADAPTER_UNAVAILABLE', 'Codex adapter cannot run this mode');
      }
    } catch (error) {
      execution = failure(
        safeCode(error?.code, 'CODEX_EXECUTION_FAILED'),
        sanitized(error?.message || 'Codex execution failed'),
      );
    } finally {
      clearInterval(heartbeatTimer);
      await heartbeatChain;
      controllers.delete(run.runId);
      signal?.removeEventListener('abort', abort);
    }
    if (!isPlainObject(execution)) {
      execution = failure('CODEX_EXECUTION_FAILED', 'Codex adapter returned an invalid result');
    }
    if (boundedText(execution.sessionId, 256)) sessionId = execution.sessionId;

    const resultEvents =
      isPlainObject(execution) && Array.isArray(execution.events) ? execution.events : [];
    const parsedMarker = parseWaitingMarker([...events, ...resultEvents]);

    if (parsedMarker) {
      const completed = await completeDecision(decision);
      if (!completed.ok) {
        return finishFailed({
          item,
          run,
          leaseToken,
          decision: completed.decision,
          code: completed.result?.code || 'DECISION_APPLY_FAILED',
          message: completed.result?.message || 'Decision could not be applied before waiting',
          taskState: { cursor, sessionId },
        });
      }
      const reported = await invoke('reportWaiting', {
        runId: run.runId,
        leaseToken,
        sessionId,
        waiting: parsedMarker,
      });
      if (!resultOk(reported)) return reported;
      logger({
        event: 'work_item.waiting',
        workItemId: item.workItemId,
        runId: run.runId,
        type: parsedMarker.type || 'WAITING_FOR_USER',
      });
      return {
        ok: true,
        status: 'waiting',
        workItemId: item.workItemId,
        runId: run.runId,
        sessionId,
        attention: responseData(reported).attention ?? null,
        cursor,
      };
    }

    if (!resultOk(execution)) {
      return finishFailed({
        item,
        run,
        leaseToken,
        decision,
        code: execution.code || 'CODEX_EXECUTION_FAILED',
        message: execution.message || 'Codex execution failed',
        taskState: { cursor, sessionId },
      });
    }

    if (heartbeatFailure) {
      return finishFailed({
        item,
        run,
        leaseToken,
        decision,
        code: heartbeatFailure.code || 'WORKER_HEARTBEAT_FAILED',
        message: heartbeatFailure.message || 'Remote execution lease heartbeat failed',
        taskState: { cursor, sessionId },
      });
    }
    if (controller.signal.aborted) {
      return finishFailed({
        item,
        run,
        leaseToken,
        decision,
        code: 'CODEX_EXECUTION_INTERRUPTED',
        message: 'Remote Codex execution was interrupted before completion',
        taskState: { cursor, sessionId },
      });
    }

    const completedDecision = await completeDecision(decision);
    if (!completedDecision.ok) {
      return finishFailed({
        item,
        run,
        leaseToken,
        decision: completedDecision.decision,
        code: completedDecision.result?.code || 'DECISION_APPLY_FAILED',
        message: completedDecision.result?.message || 'Decision apply could not be completed',
        taskState: { cursor, sessionId },
      });
    }

    const evidence = await reportExecutionEvidence({
      item,
      run,
      mode,
      execution,
      startedAt,
      phases,
    });
    if (!resultOk(evidence)) {
      return finishFailed({
        item,
        run,
        leaseToken,
        decision: null,
        code: evidence.code || 'EXECUTION_EVIDENCE_FAILED',
        message: evidence.message || 'Execution evidence could not be reported',
        taskState: { cursor, sessionId },
      });
    }

    const outcome = {
      summary: 'Remote Codex execution completed and requires human delivery review.',
      status: 'COMPLETED',
      delivery: null,
      reviewRequired: true,
      sessionId,
    };
    const finished = await invoke('finishRun', {
      runId: run.runId,
      leaseToken,
      status: 'COMPLETED',
      outcome,
    });
    if (!resultOk(finished)) return finished;
    logger({ event: 'work_item.completed', workItemId: item.workItemId, runId: run.runId });
    return {
      ok: true,
      status: 'completed',
      workItemId: item.workItemId,
      runId: run.runId,
      sessionId,
      cursor,
      delivery: null,
    };
  }

  return Object.freeze({
    runOnce,
    stop() {
      stopped = true;
      for (const controller of controllers.values()) controller.abort();
    },
    activeCount: () => controllers.size,
    status: () => ({
      stopped,
      cursor,
      pendingDecisionCount: pendingDecisions.size,
      projects: Object.keys(rootsByProject),
    }),
  });
}
