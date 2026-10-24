import { hashValue } from '../../../events.js';
import {
  boundedText,
  containsForbiddenCloudContent,
  failure,
  hasDangerousCommandFields,
  isPlainObject,
  validIso,
} from './worker-contract.js';

const WORKER_ID = /^worker-[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CALLBACK_FIELD =
  /^(?:callback|callbackUrl|webhook|webhookUrl|inboundUrl|endpointUrl|reconnectUrl)$/i;
const AVAILABLE_SKILL_STATES = new Set(['ACTIVE', 'AVAILABLE', 'ONLINE']);
const UNAVAILABLE_SKILL_STATES = new Set(['DISCONNECTED', 'OFFLINE', 'REVOKED']);
const WORKER_METADATA_FIELDS = new Set([
  'workerId',
  'displayName',
  'actorId',
  'version',
  'tokenHash',
  'lastSeenAt',
  'connectedAt',
  'disconnectedAt',
  'revokedAt',
  'updatedAt',
]);
const CAPABILITY_FIELDS = new Set([
  'projectIds',
  'projects',
  'toolchains',
  'skills',
  'labels',
  'maxConcurrency',
  'region',
  'priority',
  'lastAssignedAt',
  'skillStatuses',
]);

function positiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : null;
}

function asEntries(value) {
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) return Object.values(value);
  return [];
}

function timeValue(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(now) {
  return new Date(now).toISOString();
}

function boundedStringList(value, { maximum, allowEmpty = true } = {}) {
  if (value === undefined) return allowEmpty ? { ok: true, value: [] } : null;
  if (!Array.isArray(value) || value.length > maximum) return null;
  if (
    value.some((entry) => !boundedText(entry, 128) || !LABEL.test(entry.trim())) ||
    new Set(value.map((entry) => entry.trim())).size !== value.length
  )
    return null;
  const normalized = value.map((entry) => entry.trim());
  if (!allowEmpty && normalized.length === 0) return null;
  return { ok: true, value: normalized };
}

function unsafeField(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = unsafeField(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (CALLBACK_FIELD.test(key)) return key;
    const found = unsafeField(entry, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeSkillStatuses(value) {
  if (value === undefined) return { ok: true, value: {} };
  if (!isPlainObject(value) || Object.keys(value).length > 64)
    return failure('WORKER_CAPABILITY_INVALID', 'Worker skill status declaration is invalid');
  const normalized = {};
  for (const [skill, status] of Object.entries(value)) {
    if (!LABEL.test(skill) || typeof status !== 'string') {
      return failure('WORKER_CAPABILITY_INVALID', 'Worker skill status declaration is invalid');
    }
    const state = status.toUpperCase();
    if (!AVAILABLE_SKILL_STATES.has(state) && !UNAVAILABLE_SKILL_STATES.has(state)) {
      return failure('WORKER_CAPABILITY_INVALID', 'Worker skill status is unknown');
    }
    normalized[skill] = state;
  }
  return { ok: true, value: normalized };
}

export function normalizeWorkerCapabilities(input) {
  if (!isPlainObject(input))
    return failure('WORKER_CAPABILITY_INVALID', 'Worker capability declaration must be an object');
  if (hasDangerousCommandFields(input))
    return failure(
      'WORKER_CAPABILITY_SHELL_REJECTED',
      'Worker capabilities must not contain shell or executable fields',
    );
  const callback = unsafeField(input);
  if (callback)
    return failure(
      'WORKER_CAPABILITY_CALLBACK_REJECTED',
      'Worker capabilities must not contain callback or connection targets',
      { field: callback },
    );
  const allowedTopLevel = new Set([
    ...CAPABILITY_FIELDS,
    ...WORKER_METADATA_FIELDS,
    'capabilities',
    'status',
    'online',
    'revoked',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedTopLevel.has(key))
      return failure(
        'WORKER_CAPABILITY_INVALID',
        'Worker declaration contains unsupported fields',
        {
          field: key,
        },
      );
  }

  let capabilities = input.capabilities;
  if (Array.isArray(capabilities)) capabilities = { toolchains: capabilities };
  if (capabilities === undefined) capabilities = {};
  if (!isPlainObject(capabilities))
    return failure('WORKER_CAPABILITY_INVALID', 'Worker capabilities must be an object');
  for (const key of Object.keys(capabilities)) {
    if (!CAPABILITY_FIELDS.has(key))
      return failure(
        'WORKER_CAPABILITY_INVALID',
        'Worker capability declaration contains unsupported fields',
        { field: key },
      );
  }

  if (!WORKER_ID.test(input.workerId || ''))
    return failure('WORKER_ID_INVALID', 'Worker id is invalid');

  const projectInput =
    input.projectIds ?? input.projects ?? capabilities.projectIds ?? capabilities.projects;
  if (!Array.isArray(projectInput) || projectInput.length > 100)
    return failure('WORKER_PROJECTS_INVALID', 'Worker project whitelist is invalid');
  if (
    projectInput.some(
      (projectId) => !boundedText(projectId, 128) || !LABEL.test(projectId.trim()),
    ) ||
    new Set(projectInput.map((projectId) => projectId.trim())).size !== projectInput.length
  )
    return failure('WORKER_PROJECTS_INVALID', 'Worker project whitelist is invalid');
  const projectIds = projectInput.map((projectId) => projectId.trim());

  const declaredSkills = input.skills ?? capabilities.skills;
  const skillStatusInput = isPlainObject(declaredSkills) ? declaredSkills : {};
  const toolchainInput =
    input.toolchains ??
    capabilities.toolchains ??
    (isPlainObject(declaredSkills) ? Object.keys(declaredSkills) : declaredSkills);
  const toolchains = boundedStringList(toolchainInput, { maximum: 64 });
  if (!toolchains)
    return failure('WORKER_TOOLCHAINS_INVALID', 'Worker toolchain declaration is invalid');

  const labelInput = input.labels ?? capabilities.labels;
  const labels = boundedStringList(labelInput, { maximum: 64 });
  if (!labels) return failure('WORKER_LABELS_INVALID', 'Worker label declaration is invalid');

  const maxConcurrency = positiveInteger(
    input.maxConcurrency ?? capabilities.maxConcurrency,
    1,
    100,
  );
  if (maxConcurrency === null)
    return failure(
      'WORKER_CONCURRENCY_INVALID',
      'Worker maxConcurrency must be a positive bounded integer',
    );

  const regionValue = input.region ?? capabilities.region;
  if (regionValue !== undefined && (!boundedText(regionValue, 64) || !LABEL.test(regionValue))) {
    return failure('WORKER_REGION_INVALID', 'Worker region is invalid');
  }

  const priorityValue = input.priority ?? capabilities.priority;
  if (
    priorityValue !== undefined &&
    (!Number.isSafeInteger(priorityValue) || priorityValue < 0 || priorityValue > 1000)
  ) {
    return failure('WORKER_PRIORITY_INVALID', 'Worker priority is invalid');
  }

  const lastAssignedValue = input.lastAssignedAt ?? capabilities.lastAssignedAt;
  const lastAssignedAt =
    lastAssignedValue === undefined || lastAssignedValue === null
      ? null
      : typeof lastAssignedValue === 'number' && Number.isFinite(lastAssignedValue)
        ? iso(Math.trunc(lastAssignedValue))
        : validIso(lastAssignedValue);
  if (lastAssignedValue !== undefined && lastAssignedValue !== null && !lastAssignedAt)
    return failure('WORKER_TIMESTAMP_INVALID', 'Worker lastAssignedAt is invalid');

  if (
    (input.skillStatuses !== undefined && !isPlainObject(input.skillStatuses)) ||
    (capabilities.skillStatuses !== undefined && !isPlainObject(capabilities.skillStatuses))
  ) {
    return failure('WORKER_CAPABILITY_INVALID', 'Worker skill status declaration is invalid');
  }
  const skillStatuses = normalizeSkillStatuses({
    ...skillStatusInput,
    ...(isPlainObject(capabilities.skillStatuses) ? capabilities.skillStatuses : {}),
    ...(isPlainObject(input.skillStatuses) ? input.skillStatuses : {}),
  });
  if (!skillStatuses.ok) return skillStatuses;

  const declaredCapabilities = {
    projectIds,
    toolchains: toolchains.value,
    labels: labels.value,
    maxConcurrency,
    region: regionValue?.trim() ?? null,
    priority: priorityValue ?? 0,
    lastAssignedAt,
    skillStatuses: skillStatuses.value,
  };
  const forbidden = containsForbiddenCloudContent(declaredCapabilities);
  if (forbidden)
    return failure(
      'WORKER_CAPABILITY_SENSITIVE',
      'Worker capabilities contain credentials or local paths',
      { field: forbidden },
    );

  const rawStatus = typeof input.status === 'string' ? input.status.trim().toUpperCase() : 'ONLINE';
  if (
    !['ACTIVE', 'ONLINE', 'AVAILABLE', 'OFFLINE', 'DISCONNECTED', 'REVOKED'].includes(rawStatus)
  ) {
    return failure('WORKER_CAPABILITY_INVALID', 'Worker status is unknown');
  }
  const revoked = input.revoked === true || rawStatus === 'REVOKED';
  const online =
    !revoked && input.online !== false && !['OFFLINE', 'DISCONNECTED'].includes(rawStatus);

  return {
    ok: true,
    worker: {
      workerId: input.workerId,
      projectIds,
      toolchains: toolchains.value,
      labels: labels.value,
      maxConcurrency,
      region: declaredCapabilities.region,
      priority: declaredCapabilities.priority,
      lastAssignedAt,
      skillStatuses: skillStatuses.value,
      online,
      revoked,
      status: revoked ? 'REVOKED' : online ? 'ONLINE' : 'OFFLINE',
    },
  };
}

function normalizeWorkerForScheduling(input) {
  const normalized = normalizeWorkerCapabilities(input);
  if (!normalized.ok) return normalized;
  return {
    ok: true,
    worker: {
      ...normalized.worker,
      lastAssignedAt: normalized.worker.lastAssignedAt,
    },
  };
}

function priorityOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, 1000 - value);
  const normalized = typeof value === 'string' ? value.toLowerCase() : 'normal';
  if (['critical', 'urgent', 'p0'].includes(normalized)) return 3;
  if (['high', 'p1'].includes(normalized)) return 2;
  if (['normal', 'medium', 'p2'].includes(normalized)) return 1;
  if (['low', 'p3'].includes(normalized)) return 0;
  return 1;
}

function riskOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.min(3, value));
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (['critical', 'high', 'blocker', 'blocking'].includes(normalized)) return 3;
  if (['medium', 'warning'].includes(normalized)) return 2;
  if (['low', 'minor'].includes(normalized)) return 1;
  return 0;
}

function normalizeWorkItem(input, now) {
  if (!isPlainObject(input) || !RESOURCE_ID.test(input.workItemId || ''))
    return failure('WORK_ITEM_INVALID', 'Queued WorkItem is invalid');
  if (!boundedText(input.projectId, 128) || !LABEL.test(input.projectId.trim()))
    return failure('WORK_ITEM_PROJECT_INVALID', 'Queued WorkItem project is invalid');
  if (hasDangerousCommandFields(input))
    return failure(
      'WORK_ITEM_SHELL_REJECTED',
      'Queued WorkItem must not contain shell or executable fields',
      { workItemId: input.workItemId },
    );
  const callback = unsafeField(input);
  if (callback)
    return failure(
      'WORK_ITEM_CALLBACK_REJECTED',
      'Queued WorkItem must not contain callback or connection targets',
      { workItemId: input.workItemId, field: callback },
    );
  const stateValue = input.executionState ?? input.state;
  const executionState =
    typeof stateValue === 'string' ? stateValue.trim().toUpperCase() : 'QUEUED';
  if (executionState !== 'QUEUED') return { ok: true, item: null };

  const requirements = isPlainObject(input.requirements) ? input.requirements : {};
  const rawToolchains =
    input.requiredToolchains ??
    input.requiredCapabilities ??
    (input.requiredToolchain === undefined ? requirements.toolchains : [input.requiredToolchain]) ??
    [];
  const requiredToolchains = boundedStringList(rawToolchains, { maximum: 64 });
  if (!requiredToolchains)
    return failure('WORK_ITEM_CAPABILITY_INVALID', 'WorkItem toolchain requirement is invalid', {
      workItemId: input.workItemId,
    });
  const rawLabels = input.requiredLabels ?? requirements.labels ?? [];
  const requiredLabels = boundedStringList(rawLabels, { maximum: 64 });
  if (!requiredLabels)
    return failure('WORK_ITEM_CAPABILITY_INVALID', 'WorkItem label requirement is invalid', {
      workItemId: input.workItemId,
    });

  const regionValue = input.requiredRegion ?? input.region ?? requirements.region;
  const region =
    regionValue === undefined || regionValue === null
      ? null
      : boundedText(regionValue, 64) && LABEL.test(regionValue.trim())
        ? regionValue.trim()
        : undefined;
  if (region === undefined)
    return failure('WORK_ITEM_REGION_INVALID', 'WorkItem region is invalid', {
      workItemId: input.workItemId,
    });
  const regionRequired =
    input.regionRequired === true ||
    input.requireRegion === true ||
    input.requiredRegion !== undefined;

  const queueAgeMs =
    Number.isSafeInteger(input.queueAgeMs) && input.queueAgeMs >= 0 ? input.queueAgeMs : null;
  const queuedAtValue =
    queueAgeMs === null
      ? (input.queuedAt ?? input.enqueuedAt ?? input.createdAt ?? input.queueSequence ?? now)
      : now - queueAgeMs;
  const queuedAt = timeValue(queuedAtValue, now);
  if (queuedAt === null || queuedAt > now + 60_000)
    return failure('WORK_ITEM_QUEUE_TIME_INVALID', 'WorkItem queue time is invalid', {
      workItemId: input.workItemId,
    });
  const deadlineValue = input.deadlineAt ?? input.deadline ?? input.dueAt ?? input.slaDeadlineAt;
  const deadlineAt = timeValue(deadlineValue, null);
  if (deadlineValue !== undefined && deadlineValue !== null && deadlineAt === null)
    return failure('WORK_ITEM_DEADLINE_INVALID', 'WorkItem deadline is invalid', {
      workItemId: input.workItemId,
    });
  const riskSource =
    input.risk ??
    input.riskLevel ??
    input.riskScore ??
    (Array.isArray(input.risks) ? Math.min(input.risks.length, 3) : 0);
  const queueSequence = Number.isSafeInteger(input.queueSequence)
    ? input.queueSequence
    : Number.MAX_SAFE_INTEGER;

  return {
    ok: true,
    item: {
      workItemId: input.workItemId,
      projectId: input.projectId.trim(),
      priority: priorityOf(input.priority),
      risk: riskOf(riskSource),
      deadlineAt,
      queuedAt,
      queueSequence,
      requiredToolchains: requiredToolchains.value,
      requiredLabels: requiredLabels.value,
      region,
      regionRequired,
    },
  };
}

function normalizeLease(input, now) {
  if (!isPlainObject(input)) return null;
  const projectId = input.projectId;
  const workItemId = input.workItemId;
  if (
    !boundedText(projectId, 128) ||
    !boundedText(workItemId, 128) ||
    !boundedText(input.leaseId ?? input.runId ?? input.leaseToken, 256)
  )
    return null;
  const expiresAt = timeValue(input.expiresAt, null);
  const acquiredAt = timeValue(input.acquiredAt ?? input.issuedAt, now);
  if (expiresAt === null || acquiredAt === null) return null;
  const releasedAt = timeValue(input.releasedAt, null);
  if (input.releasedAt !== undefined && input.releasedAt !== null && releasedAt === null)
    return null;
  const fencingValue = input.fencingToken;
  const fencingToken =
    fencingValue === undefined
      ? 0
      : Number.isSafeInteger(fencingValue) && fencingValue > 0
        ? fencingValue
        : null;
  if (fencingToken === null) return null;
  return {
    leaseId: input.leaseId ?? input.runId ?? `lease-${workItemId}`,
    projectId: projectId.trim(),
    workItemId,
    workerId: input.workerId ?? input.ownerId ?? null,
    runId: input.runId ?? null,
    leaseToken: input.leaseToken ?? input.token ?? null,
    acquiredAt,
    expiresAt,
    releasedAt,
    fencingToken,
  };
}

function deadlineUrgency(item, now) {
  if (item.deadlineAt === null) return 0;
  const remaining = item.deadlineAt - now;
  if (remaining <= 0) return 3;
  if (remaining <= 15 * 60_000) return 2;
  if (remaining <= 60 * 60_000) return 1;
  return 0;
}

function skillAvailable(worker, skill) {
  const declared = worker.toolchains.includes(skill) || worker.labels.includes(skill);
  if (!declared) return false;
  const status = worker.skillStatuses[skill];
  return status === undefined || AVAILABLE_SKILL_STATES.has(status);
}

function workerEligibility(worker, item) {
  if (worker.revoked) return 'WORKER_REVOKED';
  if (!worker.online) return 'WORKER_OFFLINE';
  if (!worker.projectIds.includes(item.projectId)) return 'PROJECT_OUTSIDE_WHITELIST';
  if (item.requiredToolchains.some((toolchain) => !skillAvailable(worker, toolchain)))
    return 'TOOLCHAIN_UNAVAILABLE';
  if (item.requiredLabels.some((label) => !skillAvailable(worker, label)))
    return 'CAPABILITY_UNAVAILABLE';
  if (item.region && item.regionRequired && worker.region !== item.region) return 'REGION_MISMATCH';
  return null;
}

function countActiveByWorker(leases, now) {
  const counts = new Map();
  for (const lease of leases) {
    if (lease.releasedAt !== null || lease.expiresAt <= now || !lease.workerId) continue;
    counts.set(lease.workerId, (counts.get(lease.workerId) ?? 0) + 1);
  }
  return counts;
}

function activeLeaseIndexes(leases, now) {
  const projects = new Map();
  const workItems = new Map();
  for (const lease of leases) {
    if (lease.releasedAt !== null || lease.expiresAt <= now) continue;
    projects.set(lease.projectId, lease);
    workItems.set(lease.workItemId, lease);
  }
  return { projects, workItems };
}

function itemScore(item, fairnessAt, now, fairnessWindowMs) {
  const age = Math.max(0, now - item.queuedAt);
  const fairnessAge =
    fairnessAt === null
      ? fairnessWindowMs
      : Math.min(fairnessWindowMs, Math.max(0, now - fairnessAt));
  return (
    item.priority * 1_000_000_000_000 +
    deadlineUrgency(item, now) * 10_000_000_000 +
    Math.round(item.risk * 1_000_000_000) +
    Math.round(fairnessAge * 1000) +
    Math.min(age, 999_999_999)
  );
}

function compareWorkers(left, right, item, leases, now) {
  const leftRegion = item.region && left.worker.region === item.region ? 1 : 0;
  const rightRegion = item.region && right.worker.region === item.region ? 1 : 0;
  const assignmentTime = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const parsed = value ? Date.parse(value) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return (
    rightRegion - leftRegion ||
    left.load - right.load ||
    right.worker.priority - left.worker.priority ||
    assignmentTime(left.lastAssignedAt) - assignmentTime(right.lastAssignedAt) ||
    left.worker.workerId.localeCompare(right.worker.workerId)
  );
}

function explainItem(item, now) {
  const labels = {
    3: 'critical',
    2: 'high',
    1: 'normal',
    0: 'low',
  };
  const ageSeconds = Math.max(0, Math.floor((now - item.queuedAt) / 1000));
  const deadline = deadlineUrgency(item, now);
  const risk = ['none', 'low', 'medium', 'high'][item.risk] ?? 'unknown';
  return `priority ${labels[item.priority]}, queued ${ageSeconds}s, deadline urgency ${deadline}, risk ${risk}`;
}

function boundedMapSet(map, key, value, maximum) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > maximum) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

export function createWorkerScheduler({
  clock = Date.now,
  maxWorkers = 100,
  maxQueued = 10_000,
  fairnessWindowMs = 30_000,
} = {}) {
  if (typeof clock !== 'function') throw new TypeError('Worker scheduler clock must be a function');
  if (!Number.isSafeInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 10_000)
    throw new TypeError('Worker scheduler maxWorkers is invalid');
  if (!Number.isSafeInteger(maxQueued) || maxQueued < 1 || maxQueued > 100_000)
    throw new TypeError('Worker scheduler maxQueued is invalid');
  if (!Number.isSafeInteger(fairnessWindowMs) || fairnessWindowMs < 1)
    throw new TypeError('Worker scheduler fairnessWindowMs is invalid');

  const workers = new Map();
  const activeLeases = new Map();
  const leaseByToken = new Map();
  const fencingByWorkItem = new Map();
  const fencingByProject = new Map();
  const fairness = new Map();
  const workerAssigned = new Map();
  const audits = [];
  const syncState = new Map();
  let leaseSequence = 0;
  let tokenSequence = 0;
  const maxAudit = Math.min(maxQueued, 2000);
  const maxSyncEvents = Math.min(maxQueued, 2000);

  function resolvedNow(value) {
    if (value === undefined) return Math.trunc(clock());
    const resolved = timeValue(value, null);
    return resolved === null ? null : resolved;
  }

  function recordAudit({
    action,
    workerId = null,
    projectId = null,
    outcome = 'success',
    detail = {},
    now,
  }) {
    audits.push({
      auditId: `scheduler-audit-${audits.length + 1}`,
      action,
      workerId,
      projectId,
      outcome,
      detail: JSON.parse(JSON.stringify(detail)),
      createdAt: iso(now),
    });
    if (audits.length > maxAudit) audits.splice(0, audits.length - maxAudit);
  }

  function readWorkers(inputWorkers) {
    const entries = inputWorkers === undefined ? [...workers.values()] : asEntries(inputWorkers);
    if (entries.length > maxWorkers)
      return failure('WORKER_LIMIT_EXCEEDED', 'Worker scheduling input exceeds its bound');
    const normalized = new Map();
    const denied = [];
    for (const entry of entries) {
      const checked = normalizeWorkerForScheduling(entry);
      if (!checked.ok) {
        denied.push({
          workerId:
            isPlainObject(entry) && typeof entry.workerId === 'string' ? entry.workerId : null,
          code: checked.code,
          reason: checked.message,
        });
        continue;
      }
      const stored = workers.get(checked.worker.workerId);
      const assigned = workerAssigned.get(checked.worker.workerId);
      const worker = {
        ...checked.worker,
        online: stored ? stored.online : checked.worker.online,
        revoked: stored ? stored.revoked : checked.worker.revoked,
        lastAssignedAt: assigned ?? checked.worker.lastAssignedAt,
      };
      normalized.set(worker.workerId, worker);
    }
    return { ok: true, workers: normalized, denied };
  }

  function readLeases(inputLeases, now) {
    const entries = inputLeases === undefined ? [] : asEntries(inputLeases);
    const normalized = [];
    const seen = new Set();
    for (const entry of [...entries, ...activeLeases.values()]) {
      const lease = normalizeLease(entry, now);
      if (!lease) continue;
      const key = lease.leaseId ?? `${lease.workItemId}\u0000${lease.acquiredAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(lease);
    }
    return normalized;
  }

  function projectFairness(projectId) {
    const assignedAt = fairness.get(projectId);
    return assignedAt === undefined ? null : assignedAt;
  }

  function bestWorkerForItem(item, workerMap, leases, now) {
    const counts = countActiveByWorker(leases, now);
    const eligible = [];
    const denied = [];
    for (const worker of workerMap.values()) {
      const code = workerEligibility(worker, item);
      if (code) {
        denied.push({ workerId: worker.workerId, code });
        continue;
      }
      const load = counts.get(worker.workerId) ?? 0;
      if (load >= worker.maxConcurrency) {
        denied.push({ workerId: worker.workerId, code: 'WORKER_CONCURRENCY_FULL' });
        continue;
      }
      eligible.push({
        worker,
        load,
        lastAssignedAt: workerAssigned.get(worker.workerId) ?? worker.lastAssignedAt,
      });
    }
    eligible.sort((left, right) => compareWorkers(left, right, item, leases, now));
    return { best: eligible[0] ?? null, eligible, denied };
  }

  function selection({ requestingWorkerId, workers: inputWorkers, workItems, leases, now }) {
    const at = resolvedNow(now);
    if (at === null) return failure('WORKER_SCHEDULER_TIME_INVALID', 'Scheduling time is invalid');
    if (!WORKER_ID.test(requestingWorkerId || ''))
      return failure('WORKER_ID_INVALID', 'Requesting worker id is invalid');
    const workerInput = readWorkers(inputWorkers);
    if (!workerInput.ok) return workerInput;
    const requestingWorker = workerInput.workers.get(requestingWorkerId);
    if (!requestingWorker) {
      const audit = {
        action: 'worker.claim.deny',
        workerId: requestingWorkerId,
        outcome: 'failure',
        detail: { reason: 'WORKER_NOT_FOUND' },
      };
      recordAudit({ ...audit, now: at });
      return {
        ok: false,
        idle: true,
        code: 'WORKER_NOT_FOUND',
        reason: 'Requesting worker is not registered',
        alternatives: [],
        audit,
      };
    }
    if (requestingWorker.revoked || !requestingWorker.online) {
      const code = requestingWorker.revoked ? 'WORKER_REVOKED' : 'WORKER_OFFLINE';
      const audit = {
        action: 'worker.claim.deny',
        workerId: requestingWorkerId,
        outcome: 'failure',
        detail: { reason: code },
      };
      recordAudit({ ...audit, now: at });
      return {
        ok: false,
        idle: true,
        code,
        reason: requestingWorker.revoked
          ? 'Revoked worker cannot claim work'
          : 'Offline worker cannot claim work',
        alternatives: [],
        audit,
      };
    }

    const workEntries = asEntries(workItems);
    if (workEntries.length > maxQueued)
      return failure('WORK_ITEM_LIMIT_EXCEEDED', 'Queued WorkItems exceed the scheduler bound');
    const leaseRecords = readLeases(leases, at);
    const active = activeLeaseIndexes(leaseRecords, at);
    const items = [];
    const invalidItems = [];
    for (const entry of workEntries) {
      const checked = normalizeWorkItem(entry, at);
      if (!checked.ok) {
        invalidItems.push({
          workItemId: isPlainObject(entry) ? (entry.workItemId ?? null) : null,
          reason: checked.message,
          code: checked.code,
        });
        recordAudit({
          action: 'worker.claim.deny',
          workerId: requestingWorkerId,
          projectId:
            isPlainObject(entry) && boundedText(entry.projectId, 128)
              ? entry.projectId.trim()
              : null,
          outcome: 'failure',
          detail: {
            reason: checked.code,
            workItemId: isPlainObject(entry) ? (entry.workItemId ?? null) : null,
          },
          now: at,
        });
        continue;
      }
      if (!checked.item) continue;
      if (
        active.projects.has(checked.item.projectId) ||
        active.workItems.has(checked.item.workItemId)
      )
        continue;
      items.push(checked.item);
    }
    items.sort(
      (left, right) =>
        right.priority - left.priority ||
        deadlineUrgency(right, at) - deadlineUrgency(left, at) ||
        right.risk - left.risk ||
        (projectFairness(left.projectId) ?? 0) - (projectFairness(right.projectId) ?? 0) ||
        left.queuedAt - right.queuedAt ||
        left.queueSequence - right.queueSequence ||
        left.projectId.localeCompare(right.projectId) ||
        left.workItemId.localeCompare(right.workItemId),
    );

    const candidates = [];
    const rejected = [...invalidItems];
    for (const item of items) {
      const workerChoice = bestWorkerForItem(item, workerInput.workers, leaseRecords, at);
      if (!workerChoice.best) {
        rejected.push({
          workItemId: item.workItemId,
          projectId: item.projectId,
          code: 'NO_ELIGIBLE_WORKER',
          reason: 'No online worker satisfies project, capability, region and concurrency limits',
          deniedWorkers: workerChoice.denied.slice(0, 10),
        });
        continue;
      }
      const score = itemScore(item, projectFairness(item.projectId), at, fairnessWindowMs);
      candidates.push({
        projectId: item.projectId,
        workItemId: item.workItemId,
        workerId: workerChoice.best.worker.workerId,
        score,
        reason: `${explainItem(item, at)}; least-recently-assigned project first; worker ${workerChoice.best.worker.workerId} selected by region/concurrency/fairness`,
        workerLoad: workerChoice.best.load,
        alternatives: workerChoice.eligible.slice(0, 10).map((entry) => ({
          workerId: entry.worker.workerId,
          load: entry.load,
          regionMatch: item.region ? entry.worker.region === item.region : false,
          priority: entry.worker.priority,
          lastAssignedAt: entry.lastAssignedAt,
        })),
      });
    }
    candidates.sort(
      (left, right) =>
        right.score - left.score ||
        left.projectId.localeCompare(right.projectId) ||
        left.workItemId.localeCompare(right.workItemId) ||
        left.workerId.localeCompare(right.workerId),
    );
    // Pull-based workers claim for themselves. Choose the best item for which
    // the requesting worker is eligible; otherwise an idle worker waits for a
    // later tick instead of being denied while other workers remain busy.
    const requestedCandidate = candidates.find(
      (candidate) => candidate.workerId === requestingWorkerId,
    );
    const best = requestedCandidate ?? candidates[0] ?? null;
    const publicAlternatives = candidates.slice(0, 5).map(({ alternatives, ...candidate }) => ({
      ...candidate,
      workerAlternatives: alternatives,
    }));
    if (!best) {
      if (items.length > 0) {
        recordAudit({
          action: 'worker.claim.deny',
          workerId: requestingWorkerId,
          outcome: 'failure',
          detail: {
            reason: 'NO_ELIGIBLE_WORKER',
            rejected: rejected.slice(0, 10).map((entry) => ({
              workItemId: entry.workItemId ?? null,
              projectId: entry.projectId ?? null,
              code: entry.code ?? null,
            })),
          },
          now: at,
        });
      }
      return {
        ok: true,
        idle: true,
        projectId: null,
        workItemId: null,
        workerId: null,
        score: null,
        reason:
          items.length === 0
            ? rejected.length > 0
              ? 'No schedulable queued WorkItem'
              : 'No queued WorkItem is available'
            : 'No eligible worker for queued WorkItems',
        alternatives: rejected.slice(0, 5),
      };
    }
    if (best.workerId !== requestingWorkerId) {
      const audit = {
        action: 'worker.claim.deny',
        workerId: requestingWorkerId,
        projectId: best.projectId,
        outcome: 'failure',
        detail: {
          reason: 'NOT_BEST_ELIGIBLE_WORKER',
          selectedWorkerId: best.workerId,
          workItemId: best.workItemId,
        },
      };
      recordAudit({ ...audit, now: at });
      return {
        ok: true,
        idle: true,
        projectId: best.projectId,
        workItemId: best.workItemId,
        workerId: requestingWorkerId,
        score: best.score,
        reason: `Requesting worker is not the best eligible candidate; ${best.workerId} is preferred`,
        alternatives: publicAlternatives,
        audit,
      };
    }
    return {
      ok: true,
      idle: false,
      projectId: best.projectId,
      workItemId: best.workItemId,
      workerId: best.workerId,
      score: best.score,
      reason: best.reason,
      alternatives: publicAlternatives,
      item: items.find((item) => item.workItemId === best.workItemId),
      leaseRecords,
    };
  }

  function maxFencingFor(item, leases = []) {
    let maximum = Math.max(
      fencingByWorkItem.get(item.workItemId) ?? 0,
      fencingByProject.get(item.projectId) ?? 0,
    );
    for (const lease of [...leases, ...activeLeases.values()]) {
      if (lease.workItemId === item.workItemId || lease.projectId === item.projectId)
        maximum = Math.max(maximum, lease.fencingToken);
    }
    return maximum;
  }

  function registerWorker(input, options = {}) {
    const at = resolvedNow(options.now ?? input?.now);
    if (at === null) return failure('WORKER_SCHEDULER_TIME_INVALID', 'Scheduling time is invalid');
    const checked = normalizeWorkerCapabilities(input);
    if (!checked.ok) {
      recordAudit({
        action: 'worker.capability.deny',
        workerId: isPlainObject(input) ? (input.workerId ?? null) : null,
        outcome: 'failure',
        detail: { code: checked.code, reason: checked.message },
        now: at,
      });
      return checked;
    }
    const existing = workers.get(checked.worker.workerId);
    if (!existing && workers.size >= maxWorkers)
      return failure('WORKER_LIMIT_EXCEEDED', 'Worker scheduler capacity is exhausted');
    if (existing?.revoked) {
      checked.worker.revoked = true;
      checked.worker.online = false;
      checked.worker.status = 'REVOKED';
    }
    workers.set(checked.worker.workerId, checked.worker);
    recordAudit({
      action: existing ? 'worker.capability.update' : 'worker.register',
      workerId: checked.worker.workerId,
      outcome: 'success',
      detail: {
        projects: checked.worker.projectIds.length,
        toolchains: checked.worker.toolchains.length,
        maxConcurrency: checked.worker.maxConcurrency,
      },
      now: at,
    });
    return { ok: true, worker: JSON.parse(JSON.stringify(checked.worker)) };
  }

  function updateWorkerCapabilities(input, options = {}) {
    return registerWorker(input, options);
  }

  function disconnectWorker({ workerId, now, eventId = null } = {}) {
    const at = resolvedNow(now);
    if (at === null || !WORKER_ID.test(workerId || ''))
      return failure('WORKER_SCHEDULER_INPUT_INVALID', 'Worker disconnect input is invalid');
    const worker = workers.get(workerId);
    if (!worker) return failure('WORKER_NOT_FOUND', 'Worker was not found');
    worker.online = false;
    worker.status = 'OFFLINE';
    worker.disconnectedAt = iso(at);
    recordAudit({
      action: 'worker.disconnect',
      workerId,
      outcome: 'success',
      detail: { eventId: boundedText(eventId, 128) ? eventId : null },
      now: at,
    });
    return { ok: true, worker: JSON.parse(JSON.stringify(worker)) };
  }

  function normalizeSyncEvent(workerId, input, at, sequence) {
    if (!isPlainObject(input))
      return failure('WORKER_SYNC_EVENT_INVALID', 'Worker sync event must be an object');
    if (hasDangerousCommandFields(input))
      return failure(
        'WORKER_SYNC_EVENT_SHELL_REJECTED',
        'Worker sync event must not contain shell fields',
      );
    const callback = unsafeField(input);
    if (callback)
      return failure('WORKER_SYNC_EVENT_CALLBACK_REJECTED', 'Callback targets are not allowed', {
        field: callback,
      });
    if (containsForbiddenCloudContent(input))
      return failure(
        'WORKER_SYNC_EVENT_SENSITIVE',
        'Worker sync event contains credentials or local paths',
      );
    const eventId = input.eventId ?? input.id;
    const eventKey = input.eventKey ?? input.key ?? input.dedupeKey ?? eventId;
    if (!RESOURCE_ID.test(eventId || '') || !boundedText(eventKey, 128))
      return failure('WORKER_SYNC_EVENT_INVALID', 'Worker sync event id or key is invalid');
    const occurredAt = input.occurredAt === undefined ? iso(at) : validIso(input.occurredAt);
    if (!occurredAt)
      return failure('WORKER_SYNC_EVENT_INVALID', 'Worker sync event time is invalid');
    const payload = input.payload ?? {};
    if (!isPlainObject(payload))
      return failure('WORKER_SYNC_EVENT_INVALID', 'Worker sync event payload is invalid');
    let serializedPayload;
    try {
      serializedPayload = JSON.stringify(payload);
    } catch {
      return failure('WORKER_SYNC_EVENT_INVALID', 'Worker sync event payload is invalid');
    }
    if (serializedPayload.length > 64 * 1024)
      return failure('WORKER_SYNC_EVENT_INVALID', 'Worker sync event payload exceeds its bound');
    return {
      ok: true,
      event: {
        sequence,
        eventId,
        eventKey,
        type: boundedText(input.type, 128) ? input.type : 'worker.sync',
        workerId,
        occurredAt,
        receivedAt: iso(at),
        payload: JSON.parse(serializedPayload),
        fingerprint: hashValue({
          eventId,
          eventKey,
          type: input.type ?? 'worker.sync',
          occurredAt,
          payload,
        }),
      },
    };
  }

  function ensureSyncState(workerId) {
    let state = syncState.get(workerId);
    if (!state) {
      state = {
        sequence: 0,
        ids: new Map(),
        keys: new Map(),
        events: [],
      };
      syncState.set(workerId, state);
    }
    return state;
  }

  function syncEvents({ workerId, events = [], cursor, now } = {}) {
    const at = resolvedNow(now);
    if (at === null || !WORKER_ID.test(workerId || ''))
      return failure('WORKER_SYNC_INPUT_INVALID', 'Worker sync input is invalid');
    const worker = workers.get(workerId);
    if (!worker) return failure('WORKER_NOT_FOUND', 'Worker was not found');
    if (worker.revoked) return failure('WORKER_REVOKED', 'Revoked worker cannot synchronize');
    if (!Array.isArray(events) || events.length > 1000)
      return failure('WORKER_SYNC_INPUT_INVALID', 'Worker sync events are invalid');
    const state = ensureSyncState(workerId);
    if (
      cursor !== undefined &&
      (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > state.sequence)
    )
      return failure('WORKER_SYNC_CURSOR_INVALID', 'Worker replay cursor is invalid');
    const accepted = [];
    const duplicates = [];
    const pending = [];
    const stagedIds = new Map(state.ids);
    const stagedKeys = new Map(state.keys);
    let nextSequence = state.sequence;
    for (const input of events) {
      const checked = normalizeSyncEvent(workerId, input, at, nextSequence + 1);
      if (!checked.ok) return checked;
      const event = checked.event;
      const byId = stagedIds.get(event.eventId);
      const byKey = stagedKeys.get(event.eventKey);
      const existing = byId ?? byKey;
      if (existing) {
        if (existing.fingerprint !== event.fingerprint)
          return failure(
            'WORKER_SYNC_EVENT_CONFLICT',
            'Event id or key was reused with different content',
            {
              eventId: event.eventId,
              existingEventId: existing.eventId,
            },
          );
        duplicates.push(event.eventId);
        continue;
      }
      nextSequence += 1;
      event.sequence = nextSequence;
      pending.push(event);
      stagedIds.set(event.eventId, event);
      stagedKeys.set(event.eventKey, event);
    }
    for (const event of pending) {
      state.sequence += 1;
      state.ids.set(event.eventId, event);
      state.keys.set(event.eventKey, event);
      state.events.push(event);
      while (state.events.length > maxSyncEvents) {
        const removed = state.events.shift();
        if (state.ids.get(removed.eventId) === removed) state.ids.delete(removed.eventId);
        if (state.keys.get(removed.eventKey) === removed) state.keys.delete(removed.eventKey);
      }
      accepted.push(JSON.parse(JSON.stringify(event)));
    }
    recordAudit({
      action: 'worker.sync',
      workerId,
      outcome: 'success',
      detail: { accepted: accepted.length, duplicates: duplicates.length, cursor: state.sequence },
      now: at,
    });
    return {
      ok: true,
      accepted,
      duplicates,
      cursor: state.sequence,
      replayCursor: state.sequence,
    };
  }

  function replayEvents({ workerId, after, cursor: requestedCursor, limit = 100 } = {}) {
    const replayAfter = after ?? requestedCursor ?? 0;
    if (!WORKER_ID.test(workerId || '') || !Number.isSafeInteger(replayAfter) || replayAfter < 0)
      return failure('WORKER_SYNC_INPUT_INVALID', 'Worker replay input is invalid');
    const maximum = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 1000) : 100;
    const state = syncState.get(workerId);
    if (!state) return { ok: true, events: [], cursor: 0 };
    if (replayAfter > state.sequence)
      return failure('WORKER_SYNC_CURSOR_INVALID', 'Replay cursor is ahead');
    const events = state.events
      .filter((event) => event.sequence > replayAfter)
      .slice(0, maximum)
      .map((event) => JSON.parse(JSON.stringify(event)));
    return {
      ok: true,
      events,
      cursor: events.at(-1)?.sequence ?? replayAfter,
      serverCursor: state.sequence,
    };
  }

  function reconnectWorker({ workerId, now, events = [], cursor = 0 } = {}) {
    const at = resolvedNow(now);
    if (at === null || !WORKER_ID.test(workerId || ''))
      return failure('WORKER_SYNC_INPUT_INVALID', 'Worker reconnect input is invalid');
    const worker = workers.get(workerId);
    if (!worker) return failure('WORKER_NOT_FOUND', 'Worker was not found');
    if (worker.revoked) return failure('WORKER_REVOKED', 'Revoked worker cannot reconnect');
    const synced = syncEvents({ workerId, events, cursor, now: at });
    if (!synced.ok) return synced;
    worker.online = true;
    worker.status = 'ONLINE';
    worker.connectedAt = iso(at);
    const replay = replayEvents({ workerId, after: cursor });
    recordAudit({
      action: 'worker.reconnect',
      workerId,
      outcome: 'success',
      detail: { cursor: synced.cursor, replayed: replay.events.length },
      now: at,
    });
    return {
      ok: true,
      worker: JSON.parse(JSON.stringify(worker)),
      ...synced,
      replay: replay.events,
    };
  }

  function revokeWorker({ workerId, now, reason = 'REVOKED' } = {}) {
    const at = resolvedNow(now);
    if (at === null || !WORKER_ID.test(workerId || ''))
      return failure('WORKER_SCHEDULER_INPUT_INVALID', 'Worker revocation input is invalid');
    const worker = workers.get(workerId);
    if (!worker) return failure('WORKER_NOT_FOUND', 'Worker was not found');
    worker.revoked = true;
    worker.online = false;
    worker.status = 'REVOKED';
    const invalidated = [];
    for (const [leaseId, lease] of activeLeases) {
      if (lease.workerId !== workerId) continue;
      lease.releasedAt = at;
      lease.invalidatedAt = at;
      activeLeases.delete(leaseId);
      if (lease.leaseToken) leaseByToken.delete(lease.leaseToken);
      invalidated.push(leaseId);
    }
    recordAudit({
      action: 'worker.revoke',
      workerId,
      outcome: 'success',
      detail: {
        reason: boundedText(reason, 128) ? reason : 'REVOKED',
        invalidatedLeases: invalidated.length,
      },
      now: at,
    });
    return {
      ok: true,
      worker: JSON.parse(JSON.stringify(worker)),
      invalidatedLeases: invalidated,
    };
  }

  function assign({
    requestingWorkerId,
    workers: inputWorkers,
    workItems,
    leases,
    now,
    leaseMs = 60_000,
  } = {}) {
    const at = resolvedNow(now);
    if (at === null || !Number.isSafeInteger(leaseMs) || leaseMs <= 0 || leaseMs > 86_400_000)
      return failure('WORKER_ASSIGN_INVALID', 'Worker assignment input is invalid');
    if (activeLeases.size >= maxQueued)
      return failure('WORKER_CAPACITY_EXCEEDED', 'Worker scheduler lease capacity is exhausted');
    const selected = selection({
      requestingWorkerId,
      workers: inputWorkers,
      workItems,
      leases,
      now: at,
    });
    if (!selected.ok || selected.idle) return selected;
    if (
      [...activeLeases.values()].some(
        (lease) =>
          lease.projectId === selected.projectId || lease.workItemId === selected.workItemId,
      )
    )
      return failure('WORKER_ASSIGN_CONFLICT', 'WorkItem or project is already assigned');
    const item = selected.item;
    const fencingToken = maxFencingFor(item, selected.leaseRecords) + 1;
    leaseSequence += 1;
    tokenSequence += 1;
    const leaseId = `lease-${String(leaseSequence).padStart(12, '0')}`;
    const leaseToken = `lease-token-${tokenSequence}-${fencingToken}`;
    const lease = {
      leaseId,
      leaseToken,
      fencingToken,
      projectId: item.projectId,
      workItemId: item.workItemId,
      workerId: selected.workerId,
      runId: `run-${item.workItemId}-${fencingToken}`,
      acquiredAt: at,
      expiresAt: at + leaseMs,
      releasedAt: null,
    };
    activeLeases.set(leaseId, lease);
    leaseByToken.set(leaseToken, lease);
    boundedMapSet(fencingByWorkItem, item.workItemId, fencingToken, maxQueued);
    boundedMapSet(fencingByProject, item.projectId, fencingToken, maxQueued);
    boundedMapSet(fairness, item.projectId, at, maxQueued);
    boundedMapSet(workerAssigned, selected.workerId, at, maxWorkers);
    const storedWorker = workers.get(selected.workerId);
    if (storedWorker) storedWorker.lastAssignedAt = at;
    recordAudit({
      action: 'worker.claim',
      workerId: selected.workerId,
      projectId: item.projectId,
      outcome: 'success',
      detail: { workItemId: item.workItemId, leaseId, fencingToken },
      now: at,
    });
    return {
      ok: true,
      idle: false,
      projectId: item.projectId,
      workItemId: item.workItemId,
      workerId: selected.workerId,
      score: selected.score,
      reason: selected.reason,
      alternatives: selected.alternatives,
      lease: {
        ...JSON.parse(JSON.stringify(lease)),
        acquiredAt: iso(lease.acquiredAt),
        expiresAt: iso(lease.expiresAt),
      },
    };
  }

  function resolveLeaseToken({ workerId, leaseToken, token, leaseId }) {
    const provided = leaseToken ?? token;
    if (boundedText(provided, 256)) return provided;
    if (!boundedText(leaseId, 256)) return null;
    const lease = activeLeases.get(leaseId);
    return lease && (!workerId || lease.workerId === workerId) ? lease.leaseToken : null;
  }

  function validateLeaseToken({ workerId, leaseToken, token, leaseId, now } = {}) {
    const at = resolvedNow(now);
    const resolvedToken = resolveLeaseToken({ workerId, leaseToken, token, leaseId });
    if (at === null || !WORKER_ID.test(workerId || '') || !resolvedToken)
      return failure('LEASE_INVALID', 'Lease token input is invalid');
    const worker = workers.get(workerId);
    if (!worker || worker.revoked) return failure('WORKER_REVOKED', 'Lease owner is not active');
    const lease = leaseByToken.get(resolvedToken);
    if (!lease || lease.workerId !== workerId || lease.releasedAt !== null)
      return failure('LEASE_INVALID', 'Execution lease is no longer valid');
    if (lease.expiresAt <= at) return failure('LEASE_EXPIRED', 'Execution lease has expired');
    return {
      ok: true,
      lease: {
        ...JSON.parse(JSON.stringify(lease)),
        acquiredAt: iso(lease.acquiredAt),
        expiresAt: iso(lease.expiresAt),
      },
    };
  }

  function renew({ workerId, leaseToken, token, leaseId, now, ttlMs = 60_000 } = {}) {
    const at = resolvedNow(now);
    if (at === null || !Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > 86_400_000)
      return failure('LEASE_RENEW_INVALID', 'Lease renewal input is invalid');
    const resolvedToken = resolveLeaseToken({ workerId, leaseToken, token, leaseId });
    const checked = validateLeaseToken({ workerId, leaseToken: resolvedToken, now: at });
    if (!checked.ok) return checked;
    const lease = leaseByToken.get(resolvedToken);
    lease.expiresAt = at + ttlMs;
    recordAudit({
      action: 'worker.lease.renew',
      workerId,
      projectId: lease.projectId,
      outcome: 'success',
      detail: { leaseId: lease.leaseId, fencingToken: lease.fencingToken },
      now: at,
    });
    return {
      ok: true,
      lease: {
        ...JSON.parse(JSON.stringify(lease)),
        acquiredAt: iso(lease.acquiredAt),
        expiresAt: iso(lease.expiresAt),
      },
    };
  }

  function release({ workerId, leaseToken, token, leaseId, now, reason = 'RELEASED' } = {}) {
    const at = resolvedNow(now);
    if (at === null) return failure('LEASE_RELEASE_INVALID', 'Lease release input is invalid');
    const resolvedToken = resolveLeaseToken({ workerId, leaseToken, token, leaseId });
    const checked = validateLeaseToken({ workerId, leaseToken: resolvedToken, now: at });
    if (!checked.ok) return checked;
    const lease = leaseByToken.get(resolvedToken);
    lease.releasedAt = at;
    activeLeases.delete(lease.leaseId);
    leaseByToken.delete(resolvedToken);
    recordAudit({
      action: 'worker.lease.release',
      workerId,
      projectId: lease.projectId,
      outcome: 'success',
      detail: {
        leaseId: lease.leaseId,
        reason: boundedText(reason, 128) ? reason : 'RELEASED',
      },
      now: at,
    });
    return {
      ok: true,
      lease: {
        ...JSON.parse(JSON.stringify(lease)),
        acquiredAt: iso(lease.acquiredAt),
        expiresAt: iso(lease.expiresAt),
        releasedAt: iso(at),
      },
    };
  }

  function expire({ now } = {}) {
    const at = resolvedNow(now);
    if (at === null) return failure('LEASE_EXPIRE_INVALID', 'Lease expiration input is invalid');
    const expired = [];
    for (const [leaseId, lease] of activeLeases) {
      if (lease.expiresAt > at) continue;
      lease.expiredAt = at;
      activeLeases.delete(leaseId);
      if (lease.leaseToken) leaseByToken.delete(lease.leaseToken);
      expired.push({
        ...JSON.parse(JSON.stringify(lease)),
        acquiredAt: iso(lease.acquiredAt),
        expiresAt: iso(lease.expiresAt),
        expiredAt: iso(at),
      });
    }
    if (expired.length > 0)
      recordAudit({
        action: 'worker.lease.expire',
        outcome: 'success',
        detail: { count: expired.length },
        now: at,
      });
    return { ok: true, expired };
  }

  function listAudit({ limit = 100 } = {}) {
    const maximum = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), maxAudit) : 100;
    return {
      ok: true,
      audits: audits.slice(-maximum).map((audit) => JSON.parse(JSON.stringify(audit))),
    };
  }

  function inspect() {
    return {
      ok: true,
      workers: [...workers.values()].map((worker) => JSON.parse(JSON.stringify(worker))),
      activeLeases: [...activeLeases.values()].map((lease) => ({
        ...JSON.parse(JSON.stringify(lease)),
        acquiredAt: iso(lease.acquiredAt),
        expiresAt: iso(lease.expiresAt),
      })),
      fairnessProjects: [...fairness.keys()],
      auditCount: audits.length,
    };
  }

  return Object.freeze({
    registerWorker,
    updateWorkerCapabilities,
    selectClaim: selection,
    assign,
    claim: assign,
    renew,
    release,
    expire,
    expireLeases: expire,
    validateLeaseToken,
    disconnect: disconnectWorker,
    disconnectWorker,
    reconnect: reconnectWorker,
    reconnectWorker,
    syncEvents,
    sync: syncEvents,
    syncWorkerEvents: syncEvents,
    replayEvents,
    revokeWorker,
    revoke: revokeWorker,
    listAudit,
    inspect,
  });
}
