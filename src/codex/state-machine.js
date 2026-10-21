import { createStorage } from './storage.js';
import { canonicalJson, createEvent } from './events.js';
import { makeCheckpoint, countFailure, RETRY_CATEGORIES } from './checkpoints.js';

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
  resumePhase: null,
});
const validVersion = (value) => Number.isSafeInteger(value) && value >= 0;
const validId = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

export function createStateStore({ projectRoot, authorizeGate, lockTimeoutMs } = {}) {
  const storage = createStorage(projectRoot, { lockTimeoutMs });
  const protect = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      const known = new Set(['AUDIT_CORRUPT', 'SNAPSHOT_AHEAD', 'STORE_BUSY', 'UNSAFE_PATH']);
      return errorResult(
        known.has(error.code) ? error.code : 'STORAGE_ERROR',
        known.has(error.code) ? error.message : 'Cannot safely access state storage',
      );
    }
  };

  function validateState(state) {
    if (state.version > 0 && (!validId(state.changeId) || !PHASES.includes(state.phase)))
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
          const event = createEvent({ state: clone(state), type, payload, previousHash: headHash });
          const persisted = storage.append(event);
          headHash = event.hash;
          snapshotPending = persisted.snapshotPending;
          return event;
        };
        const transactionalAudit = async (entry) => {
          if (
            !object(entry) ||
            typeof entry.type !== 'string' ||
            !/^approval\.[a-z_]+$/.test(entry.type)
          )
            throw new TypeError('Only approval audit events belong in a gate transaction');
          const { type, ...payload } = clone(entry);
          state.version++;
          try {
            return commit(type, payload);
          } catch (error) {
            state.version--;
            throw error;
          }
        };
        const outcome = await action(state, transactionalAudit, loaded.events);
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

  return {
    inspect: () =>
      protect(() => {
        const { state, recovered } = storage.inspect(initialState);
        validateState(state);
        return { ok: true, state: clone(state), snapshotBehind: recovered };
      }),
    load: () =>
      protect(async () => {
        if (!storage.inspectDirectories())
          return { ok: true, state: initialState(), recovered: false };
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
            context,
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
        const from = state.phase;
        const gate =
          from === 'H1_PENDING' && args.to === 'REQ_FROZEN'
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
          let decision;
          try {
            decision = await authorizeGate({
              gate,
              state: clone(state),
              to: args.to,
              approval: args.approval,
              audit: transactionalAudit,
            });
          } catch {
            return errorResult(
              'APPROVAL_REQUIRED',
              'The approval authority rejected the transition',
            );
          }
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
        const counted = countFailure(previous, args.category, args.error);
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
}
