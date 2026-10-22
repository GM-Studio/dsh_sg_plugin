import path from 'node:path';
import { hashValue } from '../events.js';

/**
 * Multi-project registry and aggregate projections for the control plane.
 *
 * These are pure, side-effect-free helpers over the append-only control state
 * defined by `src/codex/core/control/domain.js` (`createInitialControlState`) and
 * filled in by `src/codex/control/service.js`. Nothing here performs I/O and
 * nothing reads a wall clock: ordering derives only from the ISO timestamps the
 * state already carries, so callers inject time through the state itself.
 *
 * This module is deliberately self-contained groundwork. The daemon, service,
 * runtime and CLI are wired to it: `service.registerProject` writes the durable
 * registry rows, `config.resolveControlEnvironment` derives the aggregate or
 * isolated control home/port, and `daemon.js` registers its project and clamps
 * the aggregate global concurrency here.
 */

/** Control-plane operating modes: one shared daemon, or one control home per project. */
export const CONTROL_MODES = Object.freeze(['aggregate', 'isolated']);

/** AttentionRequest statuses that still require or await a human decision. */
export const OPEN_ATTENTION_STATUSES = Object.freeze(['OPEN', 'DELIVERED', 'REMINDED']);

/** WorkItem states that are either claimable or already in flight for the supervisor. */
export const QUEUED_OR_RUNNING_STATES = Object.freeze(['QUEUED', 'RUNNING']);

/** Bounds and default enforced for the aggregate global concurrency limit. */
export const GLOBAL_CONCURRENCY_BOUNDS = Object.freeze({ min: 1, max: 8, default: 2 });

/** Default management port, matching `localControlEnvironment` in config.js. */
export const DEFAULT_MANAGEMENT_PORT = 43120;

/** Width of the deterministic per-project port window used in isolated mode. */
const ISOLATED_PORT_RANGE = 1000;

/** Priority ordering mirrors `service.js`'s `claimNext` ranking. */
const PRIORITY_RANK = Object.freeze({ high: 0, normal: 1, low: 2 });

/** WorkItem execution states that contribute to a registry row. */
const EXECUTION_STATE_COUNTERS = Object.freeze({
  RUNNING: 'running',
  WAITING_FOR_USER: 'waitingForUser',
  BLOCKED: 'blocked',
  FAILED: 'failed',
});

/**
 * Default attention severity, lower first. High-risk human gates precede
 * blocking/failure escalations, which precede routine clarifications and the
 * terminal completion notice.
 */
const ATTENTION_SEVERITY = Object.freeze({
  H1_APPROVAL: 0,
  H3_APPROVAL: 1,
  BLOCKED: 2,
  FAILED: 3,
  BUDGET: 4,
  CUSTOMER_ACCEPTANCE: 5,
  CLARIFICATION: 6,
  OFFLINE: 7,
  COMPLETION: 8,
});
const UNKNOWN_ATTENTION_SEVERITY = 99;

const failure = (code, message) => ({ ok: false, code, message });
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 32768) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const values = (collection) => (isObject(collection) ? Object.values(collection) : []);
const clone = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};
const timeValue = (value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const projectIdForRoot = (root) => `project-${hashValue({ root }).slice(0, 16)}`;

function priorityRank(priority) {
  const rank = PRIORITY_RANK[priority];
  return Number.isSafeInteger(rank) ? rank : PRIORITY_RANK.normal;
}

function counterKey(executionState) {
  return Object.prototype.hasOwnProperty.call(EXECUTION_STATE_COUNTERS, executionState)
    ? EXECUTION_STATE_COUNTERS[executionState]
    : null;
}

function attentionSeverity(type) {
  const rank = ATTENTION_SEVERITY[type];
  return Number.isSafeInteger(rank) ? rank : UNKNOWN_ATTENTION_SEVERITY;
}

function queueOrderValue(item) {
  return Number.isSafeInteger(item?.queueSequence) ? item.queueSequence : Number.MAX_SAFE_INTEGER;
}

function ordered(list, comparator, fallback) {
  try {
    return [...list].sort(comparator);
  } catch {
    return [...list].sort(fallback);
  }
}

function defaultAttentionRank(left, right) {
  return (
    attentionSeverity(left?.type) - attentionSeverity(right?.type) ||
    timeValue(left?.createdAt) - timeValue(right?.createdAt) ||
    String(left?.requestId ?? '').localeCompare(String(right?.requestId ?? ''))
  );
}

function claimComparator(left, right) {
  return (
    priorityRank(left?.priority) - priorityRank(right?.priority) ||
    queueOrderValue(left) - queueOrderValue(right) ||
    timeValue(left?.createdAt) - timeValue(right?.createdAt) ||
    String(left?.workItemId ?? '').localeCompare(String(right?.workItemId ?? ''))
  );
}

/**
 * Accepts either a two-argument Array.prototype.sort comparator or a
 * single-argument ranker returning a numeric rank per AttentionRequest.
 */
function attentionComparator(rankAttention) {
  if (typeof rankAttention !== 'function') return defaultAttentionRank;
  if (rankAttention.length >= 2) return rankAttention;
  return (left, right) =>
    numericRank(rankAttention(left)) - numericRank(rankAttention(right)) ||
    defaultAttentionRank(left, right);
}

function numericRank(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function concurrencyBounds(state) {
  const configured = isObject(state?.concurrency) ? state.concurrency : null;
  let min = GLOBAL_CONCURRENCY_BOUNDS.min;
  let max = GLOBAL_CONCURRENCY_BOUNDS.max;
  let fallback = GLOBAL_CONCURRENCY_BOUNDS.default;
  if (configured) {
    if (Number.isSafeInteger(configured.min) && configured.min >= 1) min = configured.min;
    if (Number.isSafeInteger(configured.max) && configured.max >= min) max = configured.max;
    if (Number.isSafeInteger(configured.default)) fallback = configured.default;
  }
  if (max < min) max = min;
  return { min, max, default: Math.min(max, Math.max(min, fallback)) };
}

function isolatedPort(basePort, projectRoot) {
  const digest = hashValue({ projectRoot }).slice(0, 8);
  const offset = (parseInt(digest, 16) % (ISOLATED_PORT_RANGE - 1)) + 1;
  const candidate = basePort + offset;
  return candidate > 65535 ? ((candidate - 1) % 65535) + 1 : candidate;
}

/**
 * Registry projection: one row per registered project, with WorkItem counts
 * derived from the existing state. Tolerates an empty, partial or malformed
 * state and never throws.
 */
export function projectRegistry(state) {
  const itemsByProject = new Map();
  for (const item of values(state?.workItems)) {
    if (!isObject(item) || typeof item.projectId !== 'string') continue;
    const bucket = itemsByProject.get(item.projectId);
    if (bucket) bucket.push(item);
    else itemsByProject.set(item.projectId, [item]);
  }
  return values(state?.projects)
    .filter(isObject)
    .map((project) => {
      const projectId = typeof project.projectId === 'string' ? project.projectId : null;
      const items = projectId ? itemsByProject.get(projectId) || [] : [];
      const counters = { running: 0, waitingForUser: 0, blocked: 0, failed: 0 };
      let lastActivity = timeValue(project.updatedAt);
      for (const item of items) {
        const key = counterKey(item.executionState);
        if (key) counters[key] += 1;
        lastActivity = Math.max(lastActivity, timeValue(item.updatedAt));
      }
      return {
        projectId,
        projectRoot: typeof project.projectRoot === 'string' ? project.projectRoot : null,
        mode: registeredMode(project, state),
        workItemCount: items.length,
        ...counters,
        lastActivityAt: lastActivity > 0 ? new Date(lastActivity).toISOString() : null,
      };
    })
    .sort((left, right) => String(left.projectId).localeCompare(String(right.projectId)));
}

/**
 * Effective control mode for a registry row. A valid per-project `mode` wins,
 * then the home-wide `state.controlMode`, then the 'aggregate' default. This
 * mirrors `selectControlMode` so a projection row never reports a mode the
 * daemon would not honour.
 */
export function registeredMode(project, state) {
  if (isObject(project) && CONTROL_MODES.includes(project.mode)) return project.mode;
  if (CONTROL_MODES.includes(state?.controlMode)) return state.controlMode;
  return 'aggregate';
}

/**
 * Cross-project aggregate projection.
 *
 * `attention` is the open (OPEN/DELIVERED/REMINDED) AttentionRequest list,
 * ordered by the supplied `rankAttention` comparator/ranker, defaulting to
 * severity then oldest. `queue` is the queued/running WorkItem order, sorted by
 * the same keys `claimNext` uses: priority rank, then queue sequence, then
 * createdAt. The queued subset therefore matches exactly what the supervisor
 * would claim next. `concurrency` is the effective aggregate global concurrency
 * limit (`resolveGlobalConcurrency`) that a single aggregate daemon enforces
 * across every registered project.
 */
export function aggregatePortfolio(state, options = {}) {
  const rankAttention = options && options.rankAttention;
  const openAttention = values(state?.attention).filter(
    (entry) => isObject(entry) && OPEN_ATTENTION_STATUSES.includes(entry.status),
  );
  const queueItems = values(state?.workItems).filter(
    (item) => isObject(item) && QUEUED_OR_RUNNING_STATES.includes(item.executionState),
  );
  return {
    projects: projectRegistry(state),
    concurrency: resolveGlobalConcurrency(state, options && options.limit),
    attention: ordered(openAttention, attentionComparator(rankAttention), defaultAttentionRank).map(
      clone,
    ),
    queue: ordered(queueItems, claimComparator, claimComparator).map(clone),
  };
}

/**
 * Selects the control mode for a project. A per-project `mode` on the registry
 * record wins, then a global `controlMode`/`mode` on the state, then the
 * 'aggregate' default. Returns an ok:false failure for an invalid projectRoot.
 */
export function selectControlMode(state, options = {}) {
  const { projectRoot } = options || {};
  if (!text(projectRoot))
    return failure('PROJECT_ROOT_INVALID', 'projectRoot must be a non-empty string');
  const project = values(state?.projects).find(
    (entry) => isObject(entry) && entry.projectRoot === projectRoot,
  );
  const projectMode = project && CONTROL_MODES.includes(project.mode) ? project.mode : null;
  let globalMode = null;
  if (CONTROL_MODES.includes(state?.controlMode)) globalMode = state.controlMode;
  else if (CONTROL_MODES.includes(state?.mode)) globalMode = state.mode;
  return {
    ok: true,
    mode: projectMode || globalMode || 'aggregate',
    projectId: (project && project.projectId) || projectIdForRoot(projectRoot),
    projectRoot,
    registered: Boolean(project),
  };
}

/**
 * Derives the effective control home and management port for a mode. Aggregate
 * mode shares one control home and port; isolated mode gives the project its own
 * control home under `<controlRoot>/projects/<projectId>` and a deterministic
 * per-project port. Returns an ok:false failure on invalid input.
 */
export function modeConfig(mode, options = {}) {
  const { projectRoot, controlRoot, managementPort } = options || {};
  if (!CONTROL_MODES.includes(mode))
    return failure('MODE_INVALID', `Control mode must be one of: ${CONTROL_MODES.join(', ')}`);
  if (!text(projectRoot))
    return failure('PROJECT_ROOT_INVALID', 'projectRoot must be a non-empty string');
  if (!text(controlRoot))
    return failure('CONTROL_ROOT_INVALID', 'controlRoot must be a non-empty string');
  const basePort = managementPort === undefined ? DEFAULT_MANAGEMENT_PORT : managementPort;
  if (!Number.isSafeInteger(basePort) || basePort < 1 || basePort > 65535)
    return failure(
      'MANAGEMENT_PORT_INVALID',
      'managementPort must be an integer between 1 and 65535',
    );
  const projectId = projectIdForRoot(projectRoot);
  const resolvedRoot = path.resolve(controlRoot);
  if (mode === 'aggregate')
    return {
      ok: true,
      mode,
      projectId,
      projectRoot,
      controlRoot: resolvedRoot,
      managementPort: basePort,
      shared: true,
    };
  return {
    ok: true,
    mode,
    projectId,
    projectRoot,
    controlRoot: path.join(resolvedRoot, 'projects', projectId),
    managementPort: isolatedPort(basePort, projectRoot),
    shared: false,
  };
}

/**
 * Clamps a requested global concurrency limit into the configured bounds and
 * reports the effective value. Bounds come from `GLOBAL_CONCURRENCY_BOUNDS`,
 * optionally narrowed or widened by `state.concurrency = { min, max, default }`.
 * An absent limit uses the configured default; a non-finite limit is invalid.
 */
export function resolveGlobalConcurrency(state, limit) {
  const bounds = concurrencyBounds(state);
  const requested = limit === undefined || limit === null ? bounds.default : limit;
  if (typeof requested !== 'number' || !Number.isFinite(requested))
    return failure('CONCURRENCY_INVALID', 'Requested global concurrency must be a finite number');
  const effective = Math.min(bounds.max, Math.max(bounds.min, Math.floor(requested)));
  return {
    ok: true,
    requested,
    effective,
    min: bounds.min,
    max: bounds.max,
    bounds: { min: bounds.min, max: bounds.max },
    clamped: effective !== requested,
  };
}
