import { createStorage } from './storage.js';
import { canonicalJson, createEvent } from './events.js';
import { makeCheckpoint, countFailure, RETRY_CATEGORIES } from './checkpoints.js';
import { randomUUID } from 'node:crypto';

export const MAIN_PHASES = Object.freeze([
  'REQ_INTAKE',
  'REQ_CLARIFYING',
  'REQ_CRITIQUE',
  'H1_PENDING',
  'REQ_FROZEN',
  'PLANNING',
  'TEST_DESIGN',
  'TEST_CASES_FROZEN',
  'DEVELOPING',
  'INTEGRATING',
  'TESTING',
  'FORMATTING',
  'REVIEWING',
  'H3_PENDING',
  'ARCHIVING',
  'ARCHIVED',
]);
export const SIDE_PHASES = Object.freeze([
  'BLOCKED',
  'PAUSED',
  'CANCELLED',
  'PUSH_FAILED',
  'ARCHIVED_NOT_PUSHED',
  'ROLLBACKING',
]);
export const PHASES = Object.freeze([...MAIN_PHASES, ...SIDE_PHASES]);
export const PUBLIC_PHASE_MAP = Object.freeze({
  REQ_INTAKE: 'CLARIFYING',
  REQ_CLARIFYING: 'CLARIFYING',
  REQ_CRITIQUE: 'CLARIFYING',
  H1_PENDING: 'H1_PENDING',
  REQ_FROZEN: 'PLANNED',
  PLANNING: 'PLANNED',
  TEST_DESIGN: 'TEST_DESIGNING',
  TEST_CASES_FROZEN: 'TESTS_FROZEN',
  DEVELOPING: 'IMPLEMENTING',
  INTEGRATING: 'IMPLEMENTING',
  TESTING: 'VERIFYING',
  FORMATTING: 'VERIFYING',
  REVIEWING: 'REVIEWING',
  H3_PENDING: 'H3_PENDING',
  ARCHIVING: 'DELIVERED',
  ARCHIVED: 'DELIVERED',
  BLOCKED: 'BLOCKED',
  PAUSED: 'PAUSED',
  CANCELLED: 'CANCELLED',
  PUSH_FAILED: 'BLOCKED',
  ARCHIVED_NOT_PUSHED: 'DELIVERED',
  ROLLBACKING: 'BLOCKED',
});
export function publicPhaseOf(phase) {
  if (phase === null) return null;
  if (!Object.hasOwn(PUBLIC_PHASE_MAP, phase)) throw new TypeError('Unknown workflow phase');
  return PUBLIC_PHASE_MAP[phase];
}
export function publicWorkflowView(value) {
  if (Array.isArray(value)) return value.map(publicWorkflowView);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      ['phase', 'resumePhase', 'from', 'to'].includes(key) &&
      typeof item === 'string' &&
      Object.hasOwn(PUBLIC_PHASE_MAP, item)
        ? publicPhaseOf(item)
        : publicWorkflowView(item),
    ]),
  );
}
const RESERVATION = Symbol('server approval reservation');
const DECISION = Symbol('server approval decision');
const TERMINAL = new Set(['ARCHIVED', 'ARCHIVED_NOT_PUSHED', 'CANCELLED']);
const table = Object.fromEntries(
  MAIN_PHASES.map((phase, index) => [
    phase,
    MAIN_PHASES[index + 1] ? [MAIN_PHASES[index + 1]] : [],
  ]),
);
table.H1_PENDING.push('REQ_CLARIFYING');
table.H3_PENDING.push('REVIEWING');
table.REVIEWING.push('DEVELOPING');
table.TESTING.push('DEVELOPING');
table.FORMATTING.push('DEVELOPING');
for (const phase of ['TEST_CASES_FROZEN', 'DEVELOPING', 'TESTING', 'REVIEWING'])
  table[phase].push('TEST_DESIGN');
table.ARCHIVING.push('ARCHIVED_NOT_PUSHED', 'PUSH_FAILED', 'ROLLBACKING');
table.PUSH_FAILED = ['ROLLBACKING'];
table.ROLLBACKING = ['CANCELLED'];
export const TRANSITIONS = Object.freeze(
  Object.fromEntries(Object.entries(table).map(([key, value]) => [key, Object.freeze(value)])),
);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => JSON.parse(canonicalJson(value));
const errorResult = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const initialState = () => ({
  schemaVersion: 1,
  version: 0,
  changeId: null,
  phase: null,
  context: {},
  checkpoint: null,
  retries: {},
  automaticFailures: 0,
  resumePhase: null,
});
const validVersion = (value) => Number.isSafeInteger(value) && value >= 0;
const validId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

export function createStateStore({
  projectRoot,
  authorizeGate,
  lockTimeoutMs,
  anchorRoot,
  approvalTimeoutMs = 30000,
} = {}) {
  if (
    !Number.isSafeInteger(approvalTimeoutMs) ||
    approvalTimeoutMs < 1 ||
    approvalTimeoutMs > 600000
  )
    throw new TypeError('approvalTimeoutMs must be bounded');
  const storage = createStorage(projectRoot, { lockTimeoutMs, anchorRoot });
  const protect = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      const known = new Set([
        'AUDIT_CORRUPT',
        'SNAPSHOT_AHEAD',
        'STORE_BUSY',
        'UNSAFE_PATH',
        'APPROVAL_IN_PROGRESS',
        'ANCHOR_MISSING',
        'ANCHOR_ROLLBACK',
        'ANCHOR_INVALID',
        'ANCHOR_BEHIND',
        'LEGACY_STATE_CHANGED',
      ]);
      return errorResult(
        known.has(error.code) ? error.code : 'STORAGE_ERROR',
        known.has(error.code) ? error.message : 'Cannot safely access state storage',
        known.has(error.code) || typeof error.code !== 'string'
          ? {}
          : {
              storageCode: /^[A-Z][A-Z0-9_]{1,63}$/.test(error.code) ? error.code : 'UNKNOWN',
            },
      );
    }
  };

  function validateState(state) {
    if (
      state.version > 0 &&
      !(state.changeId === null && state.phase === null) &&
      (!validId(state.changeId) || !PHASES.includes(state.phase))
    )
      throw Object.assign(new Error('Committed workflow state is invalid'), {
        code: 'AUDIT_CORRUPT',
      });
  }

  async function mutate(args, action) {
    if (!object(args) || !validVersion(args.expectedVersion))
      return errorResult(
        'INVALID_ARGUMENT',
        'expectedVersion is required and must be a nonnegative integer',
      );
    return protect(() =>
      storage.withLock(async () => {
        if (storage.approvalPending() && !storage.approvalOwnedBy(args[RESERVATION]))
          return errorResult('APPROVAL_IN_PROGRESS', 'A trusted gate authorization is in progress');
        const loaded = storage.read(initialState, { recover: true });
        validateState(loaded.state);
        if (loaded.state.version !== args.expectedVersion)
          return errorResult(
            'VERSION_CONFLICT',
            'State version changed; read it again before retrying',
            { actualVersion: loaded.state.version },
          );
        const state = clone(loaded.state);
        let headHash = loaded.headHash;
        let snapshotPending = false;
        const commit = (type, payload) => {
          const event = createEvent({
            state: clone(state),
            type,
            payload: {
              ...payload,
              ...(state.version === 1 ? { legacyHash: storage.legacyFingerprint() } : {}),
            },
            previousHash: headHash,
          });
          const persisted = storage.append(event);
          headHash = event.hash;
          snapshotPending = persisted.snapshotPending;
          return event;
        };
        const outcome = await action(state, null, loaded.events);
        if (!outcome.ok)
          return {
            ...outcome,
            ...(state.version !== args.expectedVersion
              ? { actualVersion: state.version, snapshotPending }
              : {}),
          };
        state.version++;
        if (outcome.checkpoint)
          state.checkpoint = makeCheckpoint(
            state,
            outcome.checkpoint === true ? undefined : outcome.checkpoint,
          );
        const event = commit(outcome.type, outcome.payload ?? {});
        return {
          ok: true,
          state: clone(state),
          event: clone(event),
          snapshotPending,
          ...(outcome.result ?? {}),
        };
      }),
    );
  }

  function active(state) {
    return state.changeId && !TERMINAL.has(state.phase);
  }
  function writable(state) {
    return active(state) && !['PAUSED', 'BLOCKED', 'PUSH_FAILED'].includes(state.phase);
  }

  const api = {
    inspect: () =>
      protect(() => {
        const { state, recovered } = storage.inspect(initialState);
        validateState(state);
        return { ok: true, state: clone(state), snapshotBehind: recovered };
      }),
    load: () =>
      protect(async () => {
        if (!storage.inspectDirectories()) {
          const { state } = storage.read(initialState);
          return { ok: true, state, recovered: false };
        }
        return storage.withLock(() => {
          const { state, recovered, snapshotPending } = storage.read(initialState, {
            recover: true,
          });
          validateState(state);
          return { ok: true, state: clone(state), recovered, snapshotPending };
        });
      }),
    create: (args) =>
      mutate(args, (state, _audit, events) => {
        if (!validId(args.changeId) || (args.context !== undefined && !object(args.context)))
          return errorResult(
            'INVALID_ARGUMENT',
            'A bounded changeId and JSON context object are required',
          );
        if (active(state))
          return errorResult('ACTIVE_CHANGE', 'Only one active change is permitted');
        if (
          events.some(
            (event) => event.type === 'change.created' && event.changeId === args.changeId,
          )
        )
          return errorResult('INVALID_ARGUMENT', 'A new change must use a new identifier');
        try {
          const context = clone(args.context ?? {});
          Object.assign(state, initialState(), {
            version: state.version,
            changeId: args.changeId,
            phase: 'REQ_INTAKE',
            context: {
              ...(state.context.projectFacts ? { projectFacts: state.context.projectFacts } : {}),
              ...context,
            },
          });
        } catch {
          return errorResult('INVALID_ARGUMENT', 'context must contain only JSON values');
        }
        return { ok: true, type: 'change.created', payload: {}, checkpoint: true };
      }),
    update: (args) =>
      mutate(args, (state) => {
        if (
          !object(args.patch) ||
          Object.keys(args.patch).some((key) => key !== 'context') ||
          !object(args.patch.context)
        )
          return errorResult('INVALID_ARGUMENT', 'Only a context object can be updated');
        if (!writable(state))
          return errorResult('INVALID_TRANSITION', 'This phase does not accept context updates');
        try {
          state.context = { ...state.context, ...clone(args.patch.context) };
        } catch {
          return errorResult('INVALID_ARGUMENT', 'context must contain only JSON values');
        }
        return {
          ok: true,
          type: 'state.updated',
          payload: { keys: Object.keys(args.patch.context) },
        };
      }),
    transition: (args) =>
      mutate(args, async (state, transactionalAudit) => {
        if (!PHASES.includes(args.to))
          return errorResult('INVALID_ARGUMENT', 'Unknown workflow phase');
        if (!(TRANSITIONS[state.phase] ?? []).includes(args.to))
          return errorResult(
            'INVALID_TRANSITION',
            'The requested workflow transition is not permitted',
          );
        if (state.phase === 'FORMATTING' && args.to === 'REVIEWING' && state.context.format) {
          const format = state.context.format;
          const quality = state.context.quality;
          if (
            format.status !== 'passed' ||
            quality?.status !== 'passed' ||
            quality.integrationCommit !== format.integrationAfter ||
            !quality.runId ||
            quality.runId === format.preQualityRunId
          )
            return errorResult(
              'POST_FORMAT_QUALITY_REQUIRED',
              'Review requires a fresh quality pass at the formatted integration commit',
            );
        }
        const from = state.phase;
        const gate =
          (from === 'H1_PENDING' && args.to === 'REQ_FROZEN') ||
          (['TEST_CASES_FROZEN', 'DEVELOPING', 'TESTING', 'REVIEWING'].includes(from) &&
            args.to === 'TEST_DESIGN')
            ? 'H1'
            : from === 'H3_PENDING' && args.to === 'ARCHIVING'
              ? 'H3'
              : null;
        let record;
        if (gate) {
          if (typeof authorizeGate !== 'function')
            return errorResult(
              'APPROVAL_REQUIRED',
              'A trusted server approval authority is required',
            );
          const decision = args[DECISION];
          if (!object(decision) || decision.ok !== true)
            return errorResult(
              decision?.code ?? 'APPROVAL_REQUIRED',
              decision?.message ?? 'Trusted approval is required',
            );
          try {
            record = clone(decision.record ?? {});
          } catch {
            return errorResult(
              'APPROVAL_REQUIRED',
              'The approval authority returned invalid evidence',
            );
          }
        }
        state.phase = args.to;
        state.resumePhase = null;
        const type =
          args.to === 'H1_PENDING' || args.to === 'H3_PENDING'
            ? 'gate.entered'
            : args.to === 'TESTING'
              ? 'test.started'
              : args.to === 'FORMATTING'
                ? 'format.started'
                : args.to === 'REVIEWING'
                  ? 'review.started'
                  : args.to === 'PUSH_FAILED'
                    ? 'push.failed'
                    : args.to === 'CANCELLED'
                      ? 'workflow.cancelled'
                      : TERMINAL.has(args.to)
                        ? 'archive.completed'
                        : 'state.transitioned';
        return {
          ok: true,
          type,
          payload: { from, to: args.to, ...(gate ? { gate, approval: record } : {}) },
          checkpoint: !['PUSH_FAILED', 'ROLLBACKING'].includes(args.to),
        };
      }),
    checkpoint: (args) =>
      mutate(args, (state) => {
        if (!writable(state))
          return errorResult('INVALID_TRANSITION', 'Cannot checkpoint this phase');
        if (args.label !== undefined && (typeof args.label !== 'string' || args.label.length > 512))
          return errorResult('INVALID_ARGUMENT', 'Checkpoint label must be bounded text');
        return { ok: true, type: 'checkpoint.saved', checkpoint: args.label || true };
      }),
    pause: (args) =>
      mutate(args, (state) => {
        if (!writable(state))
          return errorResult('INVALID_TRANSITION', 'This phase cannot be paused');
        const from = state.phase;
        state.resumePhase = from;
        state.phase = 'PAUSED';
        return {
          ok: true,
          type: 'workflow.paused',
          payload: { from, checkpoint: state.checkpoint.id },
        };
      }),
    resume: (args) =>
      mutate(args, (state) => {
        if (
          !['PAUSED', 'BLOCKED'].includes(state.phase) ||
          !state.checkpoint ||
          !PHASES.includes(state.checkpoint.phase)
        )
          return errorResult(
            'INVALID_TRANSITION',
            'No paused or blocked checkpoint can be resumed',
          );
        const from = state.phase;
        state.phase = state.checkpoint.phase;
        state.resumePhase = null;
        return {
          ok: true,
          type: 'workflow.resumed',
          payload: { from, checkpoint: state.checkpoint.id },
        };
      }),
    cancel: (args) =>
      mutate(args, (state) => {
        if (!active(state))
          return errorResult('INVALID_TRANSITION', 'No active change can be cancelled');
        if (
          args.reason !== undefined &&
          (typeof args.reason !== 'string' || args.reason.length > 2048)
        )
          return errorResult('INVALID_ARGUMENT', 'Cancellation reason must be bounded text');
        const from = state.phase;
        state.phase = 'CANCELLED';
        state.resumePhase = null;
        return {
          ok: true,
          type: 'workflow.cancelled',
          payload: { from, reason: args.reason ?? '' },
        };
      }),
    retry: (args) =>
      mutate(args, (state) => {
        if (!writable(state))
          return errorResult('INVALID_TRANSITION', 'This phase cannot retry automatically');
        if (
          !validId(args.taskId) ||
          !RETRY_CATEGORIES.includes(args.category) ||
          typeof args.error !== 'string' ||
          args.error.length > 4096
        )
          return errorResult(
            'INVALID_ARGUMENT',
            'A bounded taskId, failure text and supported retry category are required',
          );
        const previous = Object.hasOwn(state.retries, args.taskId)
          ? state.retries[args.taskId]
          : null;
        if (previous && previous.category !== args.category)
          return errorResult('INVALID_ARGUMENT', 'A task cannot change retry categories');
        const counted = countFailure(
          previous,
          args.category,
          args.error,
          (state.automaticFailures ||
            Object.values(state.retries).reduce((sum, entry) => sum + entry.failures, 0)) + 1,
        );
        state.automaticFailures = counted.totalFailures;
        Object.defineProperty(state.retries, args.taskId, {
          value: counted,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        if (!counted.retryAllowed) {
          state.resumePhase = state.phase;
          state.phase = 'BLOCKED';
        }
        return {
          ok: true,
          type: counted.retryAllowed ? 'task.failed' : 'workflow.blocked',
          payload: { taskId: args.taskId, ...counted },
          result: { retryAllowed: counted.retryAllowed },
        };
      }),
    recordEvent: (args) =>
      mutate(args, (state) => {
        if (!state.changeId)
          return errorResult('INVALID_TRANSITION', 'Create a change before recording its events');
        if (
          typeof args.type !== 'string' ||
          !/^[a-z][a-z0-9_.-]{0,95}$/.test(args.type) ||
          !object(args.payload ?? {})
        )
          return errorResult(
            'INVALID_ARGUMENT',
            'A bounded event type and JSON payload object are required',
          );
        try {
          return { ok: true, type: args.type, payload: clone(args.payload ?? {}) };
        } catch {
          return errorResult('INVALID_ARGUMENT', 'Event payload must contain only JSON values');
        }
      }),
  };
  const transition = api.transition;
  api.transition = (args) =>
    protect(async () => {
      if (!object(args) || !validVersion(args.expectedVersion)) return transition(args);
      const loaded = storage.inspect(initialState);
      const gate =
        (loaded.state.phase === 'H1_PENDING' && args.to === 'REQ_FROZEN') ||
        (['TEST_CASES_FROZEN', 'DEVELOPING', 'TESTING', 'REVIEWING'].includes(loaded.state.phase) &&
          args.to === 'TEST_DESIGN')
          ? 'H1'
          : loaded.state.phase === 'H3_PENDING' && args.to === 'ARCHIVING'
            ? 'H3'
            : null;
      if (!gate) return transition(args);
      if (typeof authorizeGate !== 'function')
        return errorResult('APPROVAL_REQUIRED', 'A trusted server approval authority is required');
      const token = randomUUID();
      const reserved = await storage.withLock(() => {
        const current = storage.read(initialState);
        if (current.state.version !== args.expectedVersion)
          return errorResult('VERSION_CONFLICT', 'State version changed', {
            actualVersion: current.state.version,
          });
        storage.reserveApproval(token);
        return { ok: true, state: current.state };
      });
      if (!reserved.ok) return reserved;
      let active = true;
      let timer;
      try {
        const audit = async (entry) => {
          if (!active || !object(entry) || !/^approval\.[a-z_]+$/.test(entry.type))
            throw new Error('Gate audit is no longer active or invalid');
          const current = storage.inspect(initialState);
          const { type, ...payload } = clone(entry);
          const result = await mutate(
            { expectedVersion: current.state.version, [RESERVATION]: token },
            () =>
              active
                ? { ok: true, type, payload }
                : errorResult('APPROVAL_TIMEOUT', 'Gate audit expired'),
          );
          if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
          return result.event;
        };
        const decision = await Promise.race([
          Promise.resolve().then(() =>
            authorizeGate({
              gate,
              state: clone(reserved.state),
              to: args.to,
              approval: args.approval,
              audit,
            }),
          ),
          new Promise((resolve) => {
            timer = setTimeout(
              () => resolve(errorResult('APPROVAL_TIMEOUT', 'Gate authorization timed out')),
              approvalTimeoutMs,
            );
          }),
        ]);
        const current = storage.inspect(initialState);
        if (!object(decision) || !decision.ok)
          return {
            ...errorResult(
              decision?.code || 'APPROVAL_REQUIRED',
              decision?.message || 'Trusted approval is required',
            ),
            ...(current.state.version !== args.expectedVersion
              ? { actualVersion: current.state.version }
              : {}),
          };
        return await transition({
          ...args,
          expectedVersion: current.state.version,
          [RESERVATION]: token,
          [DECISION]: decision,
        });
      } catch (error) {
        if (typeof error.code === 'string') throw error;
        return errorResult('APPROVAL_REQUIRED', 'The approval authority rejected the transition');
      } finally {
        active = false;
        clearTimeout(timer);
        storage.releaseApproval(token);
      }
    });
  return api;
}

// Bootstrap and verification facts use the same WAL/lock/anchor as Change state.
// They cannot mutate workflow phases, tasks or approvals through the legacy API.
export function readProjectFacts(projectRoot) {
  const storage = createStorage(projectRoot);
  return storage.inspect(initialState).state.context.projectFacts || null;
}
export function updateProjectFacts(projectRoot, mutateFacts) {
  try {
    const storage = createStorage(projectRoot);
    return storage.withLockSync(() => {
      if (storage.approvalPending())
        return errorResult('APPROVAL_IN_PROGRESS', 'Approval is in progress');
      const loaded = storage.read(initialState);
      const facts = clone(loaded.state.context.projectFacts || {});
      if (mutateFacts(facts) === false)
        return errorResult('PATCH_ABORTED', 'Project facts update was cancelled');
      const state = clone(loaded.state);
      state.context.projectFacts = facts;
      state.version++;
      const event = createEvent({
        state,
        type: 'project.facts.updated',
        payload: state.version === 1 ? { legacyHash: storage.legacyFingerprint() } : {},
        previousHash: loaded.headHash,
      });
      const persisted = storage.append(event);
      return { ok: true, facts, ...persisted };
    });
  } catch (error) {
    return errorResult(error.code || 'STORAGE_ERROR', error.message);
  }
}
