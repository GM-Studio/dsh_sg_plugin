import fs from 'node:fs';
import path from 'node:path';
import { hashValue } from '../events.js';
import {
  attentionNeedsStepUp,
  canonicalControlState,
  projectWorkItemSummary,
  validateAttentionInput,
  validateDecisionInput,
  validateWorkItemInput,
} from '../core/control/domain.js';

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const clone = (value) => JSON.parse(JSON.stringify(value));
const text = (value, maximum = 16000) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const id = (prefix, randomId, value) =>
  `${prefix}-${hashValue({ randomId: randomId(), value, at: Date.now() })
    .slice(0, 16)
    .replace(/[^A-Za-z0-9]/g, '')}`;
const projectIdForRoot = (root) => `project-${hashValue({ root }).slice(0, 16)}`;
const priorityRank = { high: 0, normal: 1, low: 2 };

function checkedProjectRoot(value) {
  try {
    if (typeof value !== 'string' || !path.isAbsolute(value))
      return failure('PROJECT_ROOT_INVALID', 'Project root must be absolute');
    const root = fs.realpathSync(value);
    if (!fs.lstatSync(root).isDirectory())
      return failure('PROJECT_ROOT_INVALID', 'Project root must be a directory');
    return { ok: true, root };
  } catch {
    return failure('PROJECT_ROOT_MISSING', 'Project root is unavailable');
  }
}

function itemVersionConflict(workItem) {
  return failure('VERSION_CONFLICT', 'WorkItem revision changed', {
    actualVersion: workItem?.revision ?? null,
  });
}

function prepareProject(state, root, name, now) {
  const projectId = projectIdForRoot(root);
  if (!state.projects[projectId]) {
    state.projects[projectId] = {
      schemaVersion: 1,
      projectId,
      name: name || path.basename(root),
      projectRoot: root,
      status: 'READY',
      createdAt: now,
      updatedAt: now,
    };
  }
  return projectId;
}

export function createControlService({
  store,
  clock = Date.now,
  randomId = () => crypto.randomUUID(),
  ownerId = 'local-owner',
  readinessChecker = null,
  heartbeatSuspectMs = 45000,
  heartbeatOfflineMs = 90000,
  defaultLeaseMs = 60000,
} = {}) {
  if (!store || typeof store.inspect !== 'function' || typeof store.mutate !== 'function')
    throw new TypeError('A control store is required');
  for (const value of [heartbeatSuspectMs, heartbeatOfflineMs, defaultLeaseMs]) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError('Control timing values must be positive integers');
  }
  const nowIso = () => new Date(clock()).toISOString();

  async function createWorkItem(input) {
    const checked = validateWorkItemInput(input);
    if (!checked.ok) return checked;
    const project = checkedProjectRoot(checked.value.projectRoot);
    if (!project.ok) return project;
    if (typeof readinessChecker === 'function') {
      const readiness = await readinessChecker({ projectRoot: project.root });
      if (!readiness?.ok)
        return failure(
          readiness?.code || 'PROJECT_NOT_READY',
          readiness?.message || 'Project is not ready for a WorkItem',
        );
    }
    const workItemId = id('work', randomId, checked.value.title);
    const result = await store.mutate((state) => {
      const now = nowIso();
      const projectId = prepareProject(state, project.root, null, now);
      state.workSequence += 1;
      state.workItems[workItemId] = {
        schemaVersion: 1,
        workItemId,
        projectId,
        projectRoot: project.root,
        title: checked.value.title,
        request: checked.value.request,
        priority: checked.value.priority,
        queueSequence: state.workSequence,
        changeId: null,
        businessMilestone: 'PROJECT_READY',
        executionState: 'QUEUED',
        hostHealth: 'ONLINE',
        revision: 1,
        currentRunId: null,
        currentAttentionId: null,
        resume: null,
        outcome: null,
        budget: checked.value.budget,
        budgetUsage: {
          elapsedMs: 0,
          modelTokens: 0,
          toolCalls: 0,
          repairRounds: 0,
          evidenceBytes: 0,
        },
        humanDecisionCount: 0,
        nextAction: 'AI execution will start',
        nextOwner: 'system',
        createdAt: now,
        updatedAt: now,
        lastHeartbeatAt: null,
        completedAt: null,
      };
      return {
        ok: true,
        type: 'work_item.created',
        payload: { workItemId, projectId },
        result: { workItemId, projectId },
      };
    });
    if (!result.ok) return result;
    return {
      ok: true,
      workItem: clone(result.state.workItems[workItemId]),
      project: clone(result.state.projects[result.projectId]),
      version: result.state.version,
    };
  }

  async function updateWorkItem({ workItemId, expectedVersion, patch } = {}) {
    if (!text(workItemId, 128) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0)
      return failure('INVALID_ARGUMENT', 'A WorkItem id and current revision are required');
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      Object.keys(patch).some((key) => !['title', 'priority', 'nextAction'].includes(key))
    )
      return failure('INVALID_ARGUMENT', 'Only bounded WorkItem metadata may be updated');
    return store.mutate((state) => {
      const item = state.workItems[workItemId];
      if (!item) return failure('WORK_ITEM_NOT_FOUND', 'WorkItem does not exist');
      if (item.revision !== expectedVersion) return itemVersionConflict(item);
      if (patch.title !== undefined) {
        if (!text(patch.title, 256)) return failure('INVALID_ARGUMENT', 'Title is invalid');
        item.title = patch.title;
      }
      if (patch.priority !== undefined) {
        if (!(patch.priority in priorityRank))
          return failure('INVALID_ARGUMENT', 'Priority is invalid');
        item.priority = patch.priority;
      }
      if (patch.nextAction !== undefined) {
        if (!text(patch.nextAction, 4000))
          return failure('INVALID_ARGUMENT', 'nextAction is invalid');
        item.nextAction = patch.nextAction;
      }
      item.revision += 1;
      item.updatedAt = nowIso();
      return {
        ok: true,
        type: 'work_item.updated',
        payload: { workItemId, keys: Object.keys(patch) },
        result: { workItem: clone(item) },
      };
    });
  }

  async function requestAttention(input) {
    const checked = validateAttentionInput(input);
    if (!checked.ok) return checked;
    return store.mutate((state) => {
      const item = state.workItems[checked.value.workItemId];
      if (!item) return failure('WORK_ITEM_NOT_FOUND', 'WorkItem does not exist');
      if (item.revision !== checked.value.expectedVersion) return itemVersionConflict(item);
      const scope = checked.value.scope || item.changeId || item.workItemId;
      if (item.changeId && item.changeId !== scope)
        return failure(
          'WORK_ITEM_SCOPE_MISMATCH',
          'AttentionRequest scope does not match the WorkItem Change',
        );
      const revisions = Object.values(state.attention)
        .filter(
          (entry) =>
            entry.workItemId === item.workItemId &&
            entry.attentionKey === checked.value.attentionKey,
        )
        .sort((left, right) => right.revision - left.revision);
      const latest = revisions[0] || null;
      const previous = revisions.find((entry) =>
        ['OPEN', 'DELIVERED', 'REMINDED'].includes(entry.status),
      );
      const requestId = id('attention', randomId, {
        workItemId: item.workItemId,
        key: checked.value.attentionKey,
      });
      const now = nowIso();
      const expiresAt =
        checked.value.expiresAt || new Date(clock() + 24 * 60 * 60 * 1000).toISOString();
      if (previous) {
        previous.status = 'SUPERSEDED';
        previous.supersededAt = now;
        previous.supersededBy = requestId;
      }
      const attention = {
        schemaVersion: 1,
        requestId,
        workItemId: item.workItemId,
        projectId: item.projectId,
        scope,
        attentionKey: checked.value.attentionKey,
        revision: (latest?.revision || 0) + 1,
        previousAttentionId: latest?.requestId || null,
        type: checked.value.type,
        status: 'OPEN',
        reason: checked.value.reason,
        question: checked.value.question,
        actions: [...checked.value.actions],
        summary: checked.value.summary,
        risks: [...checked.value.risks],
        evidence: [...checked.value.evidence],
        artifactHash: checked.value.artifactHash,
        workItemVersion: item.revision + 1,
        expiresAt,
        notificationId: null,
        resolutionNotificationId: null,
        decisionId: null,
        decisionAction: null,
        decidedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      state.attention[requestId] = attention;
      const run = item.currentRunId ? state.runs[item.currentRunId] : null;
      if (run && !['COMPLETED', 'CANCELLED', 'INTERRUPTED'].includes(run.executionState)) {
        run.executionState = 'WAITING_FOR_USER';
        run.currentAttentionId = requestId;
        run.revision += 1;
        run.updatedAt = now;
        const lease = state.leases[item.projectId];
        if (lease?.runId === run.runId) delete state.leases[item.projectId];
      }
      item.executionState = 'WAITING_FOR_USER';
      item.changeId ||= scope;
      item.currentAttentionId = requestId;
      item.nextOwner = 'user';
      item.nextAction = checked.value.question;
      item.revision += 1;
      item.updatedAt = now;
      return {
        ok: true,
        type: 'attention.opened',
        payload: {
          requestId,
          workItemId: item.workItemId,
          revision: attention.revision,
          type: attention.type,
        },
        result: {
          attention: clone(attention),
          workItem: clone(item),
          run: run ? clone(run) : null,
        },
      };
    });
  }

  function inspectDecision(state, command) {
    const duplicate = Object.values(state.decisions).find(
      (entry) => entry.idempotencyKey === command.idempotencyKey,
    );
    if (duplicate) {
      const comparable = {
        workItemId: duplicate.workItemId,
        attentionId: duplicate.attentionId,
        attentionRevision: duplicate.attentionRevision,
        action: duplicate.action,
        artifactHash: duplicate.artifactHash,
      };
      const requested = {
        workItemId: command.workItemId,
        attentionId: command.attentionId,
        attentionRevision: command.attentionRevision,
        action: command.action,
        artifactHash: command.artifactHash,
      };
      if (hashValue(comparable) !== hashValue(requested))
        return failure('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another Decision');
      return {
        ok: true,
        duplicate,
        item: state.workItems[duplicate.workItemId] || null,
        attention: state.attention[duplicate.attentionId] || null,
        run: null,
      };
    }
    const item = state.workItems[command.workItemId];
    if (!item) return failure('WORK_ITEM_NOT_FOUND', 'WorkItem does not exist');
    const attention = state.attention[command.attentionId];
    if (!attention || attention.workItemId !== item.workItemId)
      return failure('ATTENTION_NOT_FOUND', 'AttentionRequest does not belong to this WorkItem');
    if (item.revision !== command.expectedWorkItemVersion) return itemVersionConflict(item);
    if (attention.revision !== command.attentionRevision)
      return failure('ATTENTION_REVISION_CONFLICT', 'AttentionRequest revision changed', {
        actualRevision: attention.revision,
      });
    if (
      !['OPEN', 'DELIVERED', 'REMINDED'].includes(attention.status) ||
      attention.workItemVersion !== command.expectedWorkItemVersion
    )
      return failure('ATTENTION_NOT_OPEN', 'AttentionRequest is no longer open');
    if (Date.parse(attention.expiresAt) <= clock())
      return failure('ATTENTION_EXPIRED', 'AttentionRequest has expired');
    if (attention.artifactHash !== command.artifactHash)
      return failure('ARTIFACT_MISMATCH', 'Decision target artifact changed');
    if (!attention.actions.includes(command.action))
      return failure('ACTION_NOT_ALLOWED', 'Action is not allowed for this AttentionRequest');
    if (attentionNeedsStepUp(attention.type, command.action) && command.authLevel !== 'step-up')
      return failure('STEP_UP_REQUIRED', 'This Decision requires step-up authentication');
    return {
      ok: true,
      duplicate: null,
      item,
      attention,
      run: item.currentRunId ? state.runs[item.currentRunId] : null,
    };
  }

  async function previewDecision(input) {
    const checked = validateDecisionInput(input);
    if (!checked.ok) return checked;
    const stored = await store.inspect();
    if (!stored.ok) return stored;
    const inspected = inspectDecision(stored.state, checked.value);
    if (!inspected.ok) return inspected;
    return {
      ok: true,
      duplicate: Boolean(inspected.duplicate),
      decision: inspected.duplicate ? clone(inspected.duplicate) : null,
      workItem: inspected.item ? clone(inspected.item) : null,
      attention: inspected.attention ? clone(inspected.attention) : null,
      run: inspected.run ? clone(inspected.run) : null,
    };
  }

  async function decide(input) {
    const checked = validateDecisionInput(input);
    if (!checked.ok) return checked;
    const command = checked.value;
    return store.mutate((state) => {
      const inspected = inspectDecision(state, command);
      if (!inspected.ok) return inspected;
      if (inspected.duplicate)
        return {
          ok: true,
          type: 'decision.duplicate',
          payload: { decisionId: inspected.duplicate.decisionId },
          result: {
            duplicate: true,
            decision: clone(inspected.duplicate),
            workItem: inspected.item ? clone(inspected.item) : null,
            attention: inspected.attention ? clone(inspected.attention) : null,
          },
        };
      const { item, attention, run } = inspected;
      const now = nowIso();
      const decisionId = id('decision', randomId, command.idempotencyKey);
      const decision = {
        schemaVersion: 1,
        decisionId,
        workItemId: item.workItemId,
        attentionId: attention.requestId,
        scope: attention.scope,
        attentionRevision: attention.revision,
        expectedWorkItemVersion: command.expectedWorkItemVersion,
        artifactHash: command.artifactHash,
        action: command.action,
        idempotencyKey: command.idempotencyKey,
        actor: { id: command.actorId, source: command.source },
        authLevel: command.authLevel,
        payload: clone(command.payload || {}),
        status: 'CONSUMED',
        createdAt: now,
        consumedAt: now,
      };
      state.decisions[decisionId] = decision;
      attention.status = 'DECIDED';
      attention.decidedAt = now;
      attention.decisionId = decisionId;
      attention.decisionAction = command.action;
      attention.updatedAt = now;
      if (run) {
        run.executionState = command.action === 'pause' ? 'PAUSED' : 'COMPLETED';
        run.decisionId = decisionId;
        run.revision += 1;
        run.updatedAt = now;
      }
      item.currentAttentionId = null;
      item.currentRunId = null;
      item.humanDecisionCount += 1;
      item.revision += 1;
      item.updatedAt = now;
      if (command.action === 'cancel') {
        item.executionState = 'CANCELLED';
        item.nextOwner = 'none';
        item.nextAction = 'WorkItem cancelled';
        item.completedAt = now;
      } else if (command.action === 'pause') {
        item.executionState = 'PAUSED';
        item.nextOwner = 'user';
        item.nextAction = 'Resume when ready';
      } else if (command.action === 'accept_delivery') {
        item.executionState = 'COMPLETED';
        item.businessMilestone = 'DELIVERY_ACCEPTED';
        item.nextOwner = 'none';
        item.nextAction = 'Delivery accepted';
        item.completedAt = now;
      } else {
        item.executionState = 'QUEUED';
        item.hostHealth = 'ONLINE';
        item.nextOwner = 'system';
        item.nextAction = 'AI execution will resume';
        item.resume = {
          decisionId,
          action: command.action,
          payload: clone(command.payload || {}),
          source: command.source,
          sessionId: run?.sessionId || null,
          createdAt: now,
        };
      }
      return {
        ok: true,
        type: 'decision.consumed',
        payload: {
          decisionId,
          action: command.action,
          workItemId: item.workItemId,
          attentionId: attention.requestId,
        },
        result: {
          decision: clone(decision),
          workItem: clone(item),
          attention: clone(attention),
          duplicate: false,
        },
      };
    });
  }

  async function expireAttention({ attentionId, now = clock() } = {}) {
    if (!text(attentionId, 128))
      return failure('INVALID_ARGUMENT', 'AttentionRequest id is required');
    return store.mutate((state) => {
      const attention = state.attention[attentionId];
      if (!attention) return failure('ATTENTION_NOT_FOUND', 'AttentionRequest does not exist');
      if (!['OPEN', 'DELIVERED', 'REMINDED'].includes(attention.status))
        return {
          ok: true,
          type: 'attention.expire_noop',
          payload: { attentionId },
          result: { attention: clone(attention) },
        };
      if (Date.parse(attention.expiresAt) > now)
        return {
          ok: true,
          type: 'attention.expire_noop',
          payload: { attentionId },
          result: { attention: clone(attention) },
        };
      const expiredAt = new Date(now).toISOString();
      attention.status = 'EXPIRED';
      attention.expiredAt = expiredAt;
      attention.updatedAt = expiredAt;
      const item = state.workItems[attention.workItemId];
      if (item?.currentAttentionId === attention.requestId) {
        item.nextAction = 'AttentionRequest expired';
        item.nextOwner = 'user';
        item.revision += 1;
        item.updatedAt = expiredAt;
      }
      return {
        ok: true,
        type: 'attention.expired',
        payload: { attentionId },
        result: { attention: clone(attention) },
      };
    });
  }

  async function markDecisionApplied({ decisionId, workItemId, consumer } = {}) {
    if (!text(decisionId, 128) || !text(workItemId, 128) || !text(consumer, 256))
      return failure('INVALID_ARGUMENT', 'Decision id, WorkItem id and consumer are required');
    return store.mutate((state) => {
      const decision = state.decisions[decisionId];
      if (!decision || decision.workItemId !== workItemId)
        return failure('DECISION_NOT_FOUND', 'Decision does not belong to this WorkItem');
      const attention = state.attention[decision.attentionId];
      if (!attention || Date.parse(attention.expiresAt) <= clock())
        return failure('DECISION_EXPIRED', 'Decision binding has expired');
      if (decision.appliedAt)
        return failure('DECISION_ALREADY_APPLIED', 'Decision was already applied');
      if (decision.status !== 'CONSUMED')
        return failure('DECISION_NOT_CONSUMED', 'Decision has not been consumed');
      decision.appliedAt = nowIso();
      decision.appliedBy = consumer;
      return {
        ok: true,
        type: 'decision.applied',
        payload: { decisionId, workItemId, consumer },
        result: { decision: clone(decision) },
      };
    });
  }

  async function claimNext({ ownerId: claimOwner = ownerId, leaseMs = defaultLeaseMs } = {}) {
    if (!text(claimOwner, 256) || !Number.isSafeInteger(leaseMs) || leaseMs <= 0)
      return failure('INVALID_ARGUMENT', 'A bounded lease owner and duration are required');
    return store.mutate((state) => {
      const now = clock();
      const nowText = new Date(now).toISOString();
      for (const [projectId, lease] of Object.entries(state.leases)) {
        if (Date.parse(lease.expiresAt) > now || !lease.runId) continue;
        const run = state.runs[lease.runId];
        const item = Object.values(state.workItems).find(
          (entry) => entry.currentRunId === lease.runId,
        );
        if (run && ['RUNNING', 'WAITING_FOR_USER'].includes(run.executionState)) {
          run.executionState = 'INTERRUPTED';
          run.interruptedAt = nowText;
          run.revision += 1;
        }
        if (item && item.executionState === 'RUNNING') {
          item.executionState = 'BLOCKED';
          item.hostHealth = 'INTERRUPTED';
          item.nextAction = 'Reconcile interrupted execution';
          item.nextOwner = 'user';
          item.revision += 1;
          item.updatedAt = nowText;
        }
        delete state.leases[projectId];
      }
      const ordered = Object.values(state.workItems)
        .filter((item) => item.executionState === 'QUEUED')
        .sort(
          (left, right) =>
            priorityRank[left.priority] - priorityRank[right.priority] ||
            left.queueSequence - right.queueSequence ||
            Date.parse(left.createdAt) - Date.parse(right.createdAt),
        );
      const item = ordered.find((entry) => !state.leases[entry.projectId]);
      if (!item)
        return {
          ok: true,
          type: 'supervisor.idle',
          payload: {},
          result: { workItem: null, run: null, lease: null, idle: true },
        };
      const runId = id('run', randomId, {
        workItemId: item.workItemId,
        attempt: item.humanDecisionCount + 1,
      });
      const leaseToken = id('lease-token', randomId, runId);
      const run = {
        schemaVersion: 1,
        runId,
        workItemId: item.workItemId,
        projectId: item.projectId,
        executionState: 'RUNNING',
        revision: 1,
        ownerId: claimOwner,
        sessionId: item.resume?.sessionId || null,
        pid: null,
        currentPhase: 'STARTING',
        currentCommand: null,
        retryCount: 0,
        budgetUsage: clone(item.budgetUsage),
        checkpoint: null,
        decisionId: null,
        currentAttentionId: null,
        startedAt: nowText,
        updatedAt: nowText,
        lastHeartbeatAt: nowText,
        finishedAt: null,
        error: null,
      };
      const lease = {
        schemaVersion: 1,
        leaseId: id('lease', randomId, { projectId: item.projectId, runId }),
        token: leaseToken,
        projectId: item.projectId,
        workItemId: item.workItemId,
        runId,
        ownerId: claimOwner,
        acquiredAt: nowText,
        expiresAt: new Date(now + leaseMs).toISOString(),
      };
      state.runs[runId] = run;
      state.leases[item.projectId] = lease;
      item.currentRunId = runId;
      item.executionState = 'RUNNING';
      item.hostHealth = 'ONLINE';
      item.nextOwner = 'ai';
      item.nextAction = 'AI execution in progress';
      item.revision += 1;
      item.updatedAt = nowText;
      return {
        ok: true,
        type: 'run.claimed',
        payload: { workItemId: item.workItemId, runId, projectId: item.projectId },
        result: {
          workItem: clone(item),
          run: clone(run),
          lease: clone(lease),
          idle: false,
        },
      };
    });
  }

  async function heartbeat({ runId, leaseToken, expectedRunVersion, updates = {} } = {}) {
    if (
      !text(runId, 128) ||
      !text(leaseToken, 256) ||
      !Number.isSafeInteger(expectedRunVersion) ||
      expectedRunVersion < 1 ||
      !updates ||
      typeof updates !== 'object' ||
      Array.isArray(updates)
    )
      return failure('INVALID_ARGUMENT', 'Run, lease and current Run version are required');
    return store.mutate((state) => {
      const run = state.runs[runId];
      if (!run) return failure('RUN_NOT_FOUND', 'ExecutionRun does not exist');
      const lease = state.leases[run.projectId];
      if (
        !lease ||
        lease.runId !== runId ||
        lease.token !== leaseToken ||
        Date.parse(lease.expiresAt) < clock()
      )
        return failure('LEASE_INVALID', 'Execution lease is no longer valid');
      if (run.executionState !== 'RUNNING')
        return failure('RUN_STOPPED', 'ExecutionRun is no longer running');
      if (run.revision !== expectedRunVersion)
        return failure('VERSION_CONFLICT', 'ExecutionRun changed', {
          actualVersion: run.revision,
        });
      const now = nowIso();
      for (const key of ['sessionId', 'pid', 'currentPhase', 'currentCommand', 'checkpoint']) {
        if (updates[key] !== undefined) run[key] = clone(updates[key]);
      }
      if (
        updates.budgetUsage !== undefined &&
        updates.budgetUsage &&
        typeof updates.budgetUsage === 'object'
      )
        run.budgetUsage = { ...run.budgetUsage, ...clone(updates.budgetUsage) };
      run.lastHeartbeatAt = now;
      run.updatedAt = now;
      run.revision += 1;
      lease.expiresAt = new Date(clock() + defaultLeaseMs).toISOString();
      const item = state.workItems[run.workItemId];
      if (item) {
        item.lastHeartbeatAt = now;
        item.hostHealth = 'ONLINE';
        item.budgetUsage = { ...item.budgetUsage, ...run.budgetUsage };
        item.revision += 1;
        item.updatedAt = now;
      }
      return {
        ok: true,
        type: 'run.heartbeat',
        payload: { runId, workItemId: run.workItemId },
        result: { run: clone(run), workItem: item ? clone(item) : null },
      };
    });
  }

  async function finishRun({
    runId,
    leaseToken,
    status = 'COMPLETED',
    outcome = null,
    error = null,
  } = {}) {
    if (!['COMPLETED', 'FAILED'].includes(status))
      return failure('INVALID_ARGUMENT', 'Run must finish as COMPLETED or FAILED');
    return store.mutate((state) => {
      const run = state.runs[runId];
      if (!run) return failure('RUN_NOT_FOUND', 'ExecutionRun does not exist');
      const lease = state.leases[run.projectId];
      if (!lease || lease.runId !== runId || lease.token !== leaseToken)
        return failure('LEASE_INVALID', 'Execution lease is no longer valid');
      const now = nowIso();
      run.executionState = status;
      run.outcome = clone(outcome);
      run.error = error;
      run.finishedAt = now;
      run.updatedAt = now;
      run.revision += 1;
      delete state.leases[run.projectId];
      const item = state.workItems[run.workItemId];
      if (item) {
        item.currentRunId = null;
        item.executionState = status === 'COMPLETED' ? 'COMPLETED' : 'FAILED';
        item.nextOwner = status === 'COMPLETED' ? 'none' : 'user';
        item.nextAction =
          status === 'COMPLETED' ? 'Execution completed' : 'Choose retry, changes or cancellation';
        item.outcome = clone(outcome);
        if (status === 'COMPLETED' && outcome?.delivery?.deliveryId) {
          item.businessMilestone =
            outcome.delivery.customerAccepted === true ? 'DELIVERY_ACCEPTED' : 'RELEASE_APPROVED';
        }
        item.completedAt = status === 'COMPLETED' ? now : null;
        item.revision += 1;
        item.updatedAt = now;
      }
      return {
        ok: true,
        type: status === 'COMPLETED' ? 'run.completed' : 'run.failed',
        payload: { runId, workItemId: run.workItemId, error },
        result: { run: clone(run), workItem: item ? clone(item) : null },
      };
    });
  }

  async function interruptRun({ runId, leaseToken, reason = 'SYSTEM_STOP' } = {}) {
    if (!text(runId, 128) || !text(leaseToken, 256) || !text(reason, 500))
      return failure('INVALID_ARGUMENT', 'Run and lease are required');
    return store.mutate((state) => {
      const run = state.runs[runId];
      if (!run) return failure('RUN_NOT_FOUND', 'ExecutionRun does not exist');
      const lease = state.leases[run.projectId];
      if (!lease || lease.runId !== runId || lease.token !== leaseToken)
        return failure('LEASE_INVALID', 'Execution lease is no longer valid');
      const now = nowIso();
      run.executionState = 'INTERRUPTED';
      run.interruptedAt = now;
      run.error = reason;
      run.revision += 1;
      run.updatedAt = now;
      delete state.leases[run.projectId];
      const item = state.workItems[run.workItemId];
      if (item) {
        item.currentRunId = null;
        item.executionState = 'BLOCKED';
        item.hostHealth = 'INTERRUPTED';
        item.nextOwner = 'user';
        item.nextAction = 'Reconcile interrupted execution';
        item.revision += 1;
        item.updatedAt = now;
      }
      return {
        ok: true,
        type: 'run.interrupted',
        payload: { runId, workItemId: run.workItemId, reason },
        result: { run: clone(run), workItem: item ? clone(item) : null },
      };
    });
  }

  async function reconcile({ now = clock() } = {}) {
    return store.mutate((state) => {
      const reconciledAt = new Date(now).toISOString();
      let changed = 0;
      for (const run of Object.values(state.runs)) {
        if (run.executionState !== 'RUNNING') continue;
        const age = now - Date.parse(run.lastHeartbeatAt);
        const item = state.workItems[run.workItemId];
        if (age >= heartbeatOfflineMs) {
          run.executionState = 'INTERRUPTED';
          run.interruptedAt = reconciledAt;
          run.error = 'HEARTBEAT_TIMEOUT';
          run.revision += 1;
          if (item) {
            item.currentRunId = null;
            item.executionState = 'WAITING_FOR_USER';
            item.hostHealth = 'INTERRUPTED';
            item.nextOwner = 'user';
            item.nextAction = 'Reconcile interrupted execution';
            item.revision += 1;
            item.updatedAt = reconciledAt;
            if (!item.currentAttentionId) {
              const requestId = id('attention', randomId, {
                workItemId: item.workItemId,
                type: 'OFFLINE',
                runId: run.runId,
              });
              const artifactHash = hashValue({
                runId: run.runId,
                interruptedAt: reconciledAt,
              });
              const scope = item.changeId || item.workItemId;
              state.attention[requestId] = {
                schemaVersion: 1,
                requestId,
                workItemId: item.workItemId,
                projectId: item.projectId,
                scope,
                attentionKey: hashValue({ workItemId: item.workItemId, type: 'OFFLINE', scope }),
                revision: 1,
                previousAttentionId: null,
                type: 'OFFLINE',
                status: 'OPEN',
                reason: 'The execution host stopped sending heartbeat.',
                question: 'Check the host and decide whether to resume or reconcile the WorkItem.',
                actions: ['resume', 'cancel'],
                summary: 'Execution was interrupted after a heartbeat timeout.',
                risks: ['External side effects may require manual verification.'],
                evidence: [],
                artifactHash,
                workItemVersion: item.revision,
                expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
                notificationId: null,
                createdAt: reconciledAt,
                updatedAt: reconciledAt,
              };
              item.currentAttentionId = requestId;
              item.changeId ||= scope;
            }
          }
          const lease = state.leases[run.projectId];
          if (lease?.runId === run.runId) delete state.leases[run.projectId];
          changed += 1;
        } else if (age >= heartbeatSuspectMs && item?.hostHealth !== 'SUSPECT') {
          if (item) {
            item.hostHealth = 'OFFLINE';
            item.revision += 1;
            item.updatedAt = reconciledAt;
            changed += 1;
          }
        }
      }
      return {
        ok: true,
        type: changed ? 'control.reconciled' : 'control.reconcile_noop',
        payload: { changed, now: reconciledAt },
        result: { changed },
      };
    });
  }

  async function pause({
    workItemId,
    expectedVersion,
    actorId,
    source = 'web',
    idempotencyKey,
  } = {}) {
    return directAction({
      workItemId,
      expectedVersion,
      actorId,
      source,
      action: 'pause',
      authLevel: 'session',
      idempotencyKey,
    });
  }

  async function resume({
    workItemId,
    expectedVersion,
    actorId,
    source = 'web',
    idempotencyKey,
  } = {}) {
    return directAction({
      workItemId,
      expectedVersion,
      actorId,
      source,
      action: 'resume',
      authLevel: 'session',
      idempotencyKey,
    });
  }

  async function retry({
    workItemId,
    expectedVersion,
    actorId,
    source = 'web',
    idempotencyKey,
  } = {}) {
    return directAction({
      workItemId,
      expectedVersion,
      actorId,
      source,
      action: 'retry',
      authLevel: 'session',
      idempotencyKey,
    });
  }

  async function cancel({
    workItemId,
    expectedVersion,
    actorId,
    source = 'web',
    authLevel,
    idempotencyKey,
  } = {}) {
    return directAction({
      workItemId,
      expectedVersion,
      actorId,
      source,
      action: 'cancel',
      authLevel: authLevel || 'session',
      requireStepUp: true,
      idempotencyKey,
    });
  }

  async function requestChanges({
    workItemId,
    expectedVersion,
    actorId,
    source = 'web',
    payload,
    idempotencyKey,
  } = {}) {
    if (!payload || typeof payload !== 'object' || !text(payload.comment, 16000))
      return failure('INVALID_ARGUMENT', 'A bounded change request comment is required');
    return directAction({
      workItemId,
      expectedVersion,
      actorId,
      source,
      action: 'request_changes',
      authLevel: 'session',
      payload,
      idempotencyKey,
    });
  }

  async function directAction({
    workItemId,
    expectedVersion,
    actorId,
    source,
    action,
    authLevel,
    payload = {},
    requireStepUp = false,
    idempotencyKey = null,
  }) {
    if (
      !text(workItemId, 128) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1 ||
      !text(actorId, 256) ||
      !['web', 'feishu', 'cli', 'api'].includes(source)
    )
      return failure('INVALID_ARGUMENT', 'A WorkItem, version and actor are required');
    if (requireStepUp && authLevel !== 'step-up')
      return failure('STEP_UP_REQUIRED', 'This action requires step-up authentication');
    return store.mutate((state) => {
      const stableKey =
        idempotencyKey ||
        id('decision', randomId, { workItemId, action, actorId, expectedVersion });
      const duplicate = Object.values(state.decisions).find(
        (entry) => entry.idempotencyKey === stableKey,
      );
      if (duplicate) {
        if (
          duplicate.workItemId !== workItemId ||
          duplicate.action !== action ||
          duplicate.expectedWorkItemVersion !== expectedVersion
        )
          return failure('IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another action');
        return {
          ok: true,
          type: 'decision.duplicate',
          payload: { decisionId: duplicate.decisionId },
          result: {
            duplicate: true,
            decision: clone(duplicate),
            workItem: clone(state.workItems[workItemId]),
          },
        };
      }
      const item = state.workItems[workItemId];
      if (!item) return failure('WORK_ITEM_NOT_FOUND', 'WorkItem does not exist');
      if (item.revision !== expectedVersion) return itemVersionConflict(item);
      const allowed = {
        pause: ['RUNNING', 'QUEUED', 'WAITING_FOR_USER'],
        resume: ['PAUSED', 'BLOCKED'],
        retry: ['FAILED', 'BLOCKED', 'PAUSED'],
        cancel: ['QUEUED', 'RUNNING', 'WAITING_FOR_USER', 'PAUSED', 'BLOCKED', 'FAILED'],
        request_changes: ['WAITING_FOR_USER', 'COMPLETED', 'BLOCKED', 'FAILED'],
      };
      if (!allowed[action]?.includes(item.executionState))
        return failure('INVALID_TRANSITION', 'Action is not valid in the current WorkItem state');
      const now = nowIso();
      const decisionId = id('decision', randomId, { workItemId, action, at: now, stableKey });
      const decision = {
        schemaVersion: 1,
        decisionId,
        workItemId,
        attentionId: item.currentAttentionId,
        attentionRevision: item.currentAttentionId
          ? state.attention[item.currentAttentionId]?.revision || 0
          : null,
        expectedWorkItemVersion: expectedVersion,
        artifactHash: null,
        action,
        idempotencyKey: stableKey,
        actor: { id: actorId, source },
        authLevel,
        payload: clone(payload),
        status: 'CONSUMED',
        createdAt: now,
        consumedAt: now,
      };
      state.decisions[decisionId] = decision;
      const run = item.currentRunId ? state.runs[item.currentRunId] : null;
      if (action === 'pause') {
        item.executionState = 'PAUSED';
        item.nextOwner = 'user';
        item.nextAction = 'Resume when ready';
        if (run) {
          run.executionState = 'PAUSED';
          run.revision += 1;
        }
        const lease = state.leases[item.projectId];
        if (lease?.workItemId === workItemId) delete state.leases[item.projectId];
      } else if (action === 'cancel') {
        item.executionState = 'CANCELLED';
        item.nextOwner = 'none';
        item.nextAction = 'WorkItem cancelled';
        item.completedAt = now;
        if (run) {
          run.executionState = 'CANCELLED';
          run.revision += 1;
        }
        const lease = state.leases[item.projectId];
        if (lease?.workItemId === workItemId) delete state.leases[item.projectId];
      } else {
        item.executionState = 'QUEUED';
        item.hostHealth = 'ONLINE';
        item.nextOwner = 'system';
        item.nextAction = 'AI execution will resume';
        item.resume = {
          decisionId,
          action,
          payload: clone(payload),
          source,
          sessionId: run?.sessionId || null,
          createdAt: now,
        };
        if (run) {
          run.executionState = 'COMPLETED';
          run.finishedAt = now;
          run.revision += 1;
        }
        const lease = state.leases[item.projectId];
        if (lease?.workItemId === workItemId) delete state.leases[item.projectId];
        item.currentRunId = null;
      }
      if (action === 'cancel') item.currentRunId = null;
      item.humanDecisionCount += 1;
      item.revision += 1;
      item.updatedAt = now;
      return {
        ok: true,
        type: `work_item.${action}`,
        payload: { workItemId, decisionId },
        result: { decision: clone(decision), workItem: clone(item) },
      };
    });
  }

  async function enqueueNotification(record) {
    if (
      !record ||
      typeof record !== 'object' ||
      Array.isArray(record) ||
      !text(record.notificationId, 128) ||
      !text(record.workItemId, 128) ||
      !text(record.attentionId, 128) ||
      !text(record.dedupeKey, 512) ||
      !record.message ||
      typeof record.message !== 'object' ||
      Array.isArray(record.message)
    )
      return failure('NOTIFICATION_INVALID', 'Notification record is invalid');
    return store.mutate((state) => {
      const duplicate = Object.values(state.notifications).find(
        (entry) => entry.dedupeKey === record.dedupeKey,
      );
      if (duplicate)
        return {
          ok: true,
          type: 'notification.duplicate',
          payload: { notificationId: duplicate.notificationId },
          result: { duplicate: true, notification: clone(duplicate) },
        };
      const notification = {
        schemaVersion: 1,
        notificationId: record.notificationId,
        workItemId: record.workItemId,
        attentionId: record.attentionId,
        kind: record.kind === 'resolution' ? 'resolution' : 'attention',
        dedupeKey: record.dedupeKey,
        message: clone(record.message),
        status: 'pending',
        attemptCount: 0,
        maxAttempts: record.maxAttempts || 8,
        nextAttemptAt: record.nextAttemptAt || nowIso(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        receipt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      state.notifications[notification.notificationId] = notification;
      const attention = state.attention[record.attentionId];
      if (attention) {
        if (notification.kind === 'resolution')
          attention.resolutionNotificationId = notification.notificationId;
        else attention.notificationId = notification.notificationId;
        attention.updatedAt = nowIso();
      }
      return {
        ok: true,
        type: 'notification.enqueued',
        payload: { notificationId: notification.notificationId },
        result: { duplicate: false, notification: clone(notification) },
      };
    });
  }

  async function claimPendingNotifications({ now = clock(), limit = 10, owner = ownerId } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      return failure('INVALID_ARGUMENT', 'Notification claim limit is invalid');
    return store.mutate((state) => {
      const claimed = [];
      for (const notification of Object.values(state.notifications)
        .filter(
          (entry) =>
            ['pending', 'failed', 'sending'].includes(entry.status) &&
            Date.parse(entry.nextAttemptAt) <= now &&
            (entry.status !== 'sending' ||
              !entry.leaseExpiresAt ||
              Date.parse(entry.leaseExpiresAt) <= now),
        )
        .sort((left, right) => Date.parse(left.nextAttemptAt) - Date.parse(right.nextAttemptAt))
        .slice(0, limit)) {
        notification.status = 'sending';
        notification.attemptCount += 1;
        notification.leaseOwner = owner;
        notification.leaseExpiresAt = new Date(now + 60000).toISOString();
        notification.updatedAt = new Date(now).toISOString();
        claimed.push(clone(notification));
      }
      return {
        ok: true,
        type: claimed.length ? 'notification.claimed' : 'notification.claim_noop',
        payload: { count: claimed.length },
        result: { notifications: claimed },
      };
    });
  }

  async function markNotificationSent({ notificationId, owner = ownerId, receipt = null } = {}) {
    return store.mutate((state) => {
      const notification = state.notifications[notificationId];
      if (!notification) return failure('NOTIFICATION_NOT_FOUND', 'Notification does not exist');
      if (notification.leaseOwner !== owner)
        return failure('NOTIFICATION_LEASE_INVALID', 'Notification lease changed');
      notification.status = 'sent';
      notification.receipt = clone(receipt);
      notification.leaseOwner = null;
      notification.leaseExpiresAt = null;
      notification.updatedAt = nowIso();
      const attention = state.attention[notification.attentionId];
      if (attention && notification.kind === 'resolution') {
        attention.resolutionNotificationStatus = 'sent';
        attention.updatedAt = nowIso();
      } else if (attention && attention.status === 'OPEN') {
        attention.status = 'DELIVERED';
        attention.updatedAt = nowIso();
      }
      return {
        ok: true,
        type: 'notification.sent',
        payload: { notificationId },
        result: { notification: clone(notification) },
      };
    });
  }

  async function markNotificationFailed({
    notificationId,
    owner = ownerId,
    code,
    message,
    nextAttemptAt,
  } = {}) {
    return store.mutate((state) => {
      const notification = state.notifications[notificationId];
      if (!notification) return failure('NOTIFICATION_NOT_FOUND', 'Notification does not exist');
      if (notification.leaseOwner !== owner)
        return failure('NOTIFICATION_LEASE_INVALID', 'Notification lease changed');
      notification.status =
        notification.attemptCount >= notification.maxAttempts ? 'failed' : 'pending';
      notification.lastError = {
        code: code || 'NOTIFICATION_FAILED',
        message: String(message || 'Notification delivery failed').slice(0, 1000),
      };
      notification.nextAttemptAt =
        nextAttemptAt || new Date(clock() + 1000 * 2 ** notification.attemptCount).toISOString();
      notification.leaseOwner = null;
      notification.leaseExpiresAt = null;
      notification.updatedAt = nowIso();
      return {
        ok: true,
        type: 'notification.failed',
        payload: { notificationId, code: notification.lastError.code },
        result: { notification: clone(notification) },
      };
    });
  }

  async function listPendingNotifications() {
    const inspected = await store.inspect();
    if (!inspected.ok) return inspected;
    return {
      ok: true,
      notifications: Object.values(inspected.state.notifications)
        .filter((entry) => ['pending', 'failed', 'sending'].includes(entry.status))
        .map(clone),
    };
  }

  async function getNotification(notificationId) {
    const inspected = await store.inspect();
    if (!inspected.ok) return inspected;
    const notification = inspected.state.notifications[notificationId];
    return notification
      ? { ok: true, notification: clone(notification) }
      : failure('NOTIFICATION_NOT_FOUND', 'Notification does not exist');
  }

  async function requeueNotification({ notificationId, actorId = ownerId } = {}) {
    if (!text(notificationId, 128) || !text(actorId, 256))
      return failure('INVALID_ARGUMENT', 'Notification id and actor are required');
    return store.mutate((state) => {
      const notification = state.notifications[notificationId];
      if (!notification) return failure('NOTIFICATION_NOT_FOUND', 'Notification does not exist');
      notification.status = 'pending';
      notification.attemptCount = 0;
      notification.nextAttemptAt = nowIso();
      notification.leaseOwner = null;
      notification.leaseExpiresAt = null;
      notification.lastError = null;
      notification.requeuedBy = actorId;
      notification.requeuedAt = nowIso();
      notification.updatedAt = nowIso();
      return {
        ok: true,
        type: 'notification.requeued',
        payload: { notificationId, actorId },
        result: { notification: clone(notification) },
      };
    });
  }

  async function projectionOverview() {
    const inspected = await store.inspect();
    if (!inspected.ok) return inspected;
    const state = inspected.state;
    const workItems = Object.values(state.workItems);
    const attention = Object.values(state.attention);
    const notifications = Object.values(state.notifications);
    return {
      ok: true,
      generatedAt: nowIso(),
      projects: Object.values(state.projects).map(clone),
      counts: {
        workItems: workItems.length,
        attentionOpen: attention.filter((entry) =>
          ['OPEN', 'DELIVERED', 'REMINDED'].includes(entry.status),
        ).length,
        running: workItems.filter((entry) => entry.executionState === 'RUNNING').length,
        waiting: workItems.filter((entry) => entry.executionState === 'WAITING_FOR_USER').length,
        failed: workItems.filter((entry) => entry.executionState === 'FAILED').length,
        notificationsFailed: notifications.filter((entry) => entry.status === 'failed').length,
      },
      attention: attention
        .filter((entry) => ['OPEN', 'DELIVERED', 'REMINDED'].includes(entry.status))
        .sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))
        .map(clone),
      workItems: workItems
        .map((entry) => ({
          ...clone(entry),
          summary: projectWorkItemSummary(entry),
        }))
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
    };
  }

  async function listWorkItems() {
    const inspected = await projectionOverview();
    return inspected.ok ? { ok: true, workItems: inspected.workItems } : inspected;
  }

  async function getWorkItem(workItemId) {
    const inspected = await store.inspect();
    if (!inspected.ok) return inspected;
    const item = inspected.state.workItems[workItemId];
    if (!item) return failure('WORK_ITEM_NOT_FOUND', 'WorkItem does not exist');
    return {
      ok: true,
      stateVersion: inspected.state.version,
      workItem: {
        ...clone(item),
        summary: projectWorkItemSummary(item),
      },
      project: clone(inspected.state.projects[item.projectId]),
      run: item.currentRunId ? clone(inspected.state.runs[item.currentRunId]) : null,
      attention: item.currentAttentionId
        ? clone(inspected.state.attention[item.currentAttentionId])
        : null,
      decisions: Object.values(inspected.state.decisions)
        .filter((entry) => entry.workItemId === workItemId)
        .map(clone),
      notifications: Object.values(inspected.state.notifications)
        .filter((entry) => entry.workItemId === workItemId)
        .map(clone),
    };
  }

  async function getRun(runId) {
    const inspected = await store.inspect();
    if (!inspected.ok) return inspected;
    const run = inspected.state.runs[runId];
    return run
      ? {
          ok: true,
          run: clone(run),
          workItem: clone(inspected.state.workItems[run.workItemId]),
        }
      : failure('RUN_NOT_FOUND', 'ExecutionRun does not exist');
  }

  async function listAttention() {
    const inspected = await store.inspect();
    if (!inspected.ok) return inspected;
    return {
      ok: true,
      attention: Object.values(inspected.state.attention)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .map(clone),
    };
  }

  async function listNotifications() {
    const inspected = await store.inspect();
    if (!inspected.ok) return inspected;
    return {
      ok: true,
      notifications: Object.values(inspected.state.notifications)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .map(clone),
    };
  }

  async function health() {
    const inspected = await store.inspect();
    return inspected.ok
      ? {
          ok: true,
          status: 'healthy',
          stateVersion: inspected.state.version,
          controlRoot: store.root,
          lastEventAt: inspected.state.version
            ? Object.values(inspected.state.workItems)
                .map((entry) => entry.updatedAt)
                .sort()
                .at(-1) || null
            : null,
        }
      : inspected;
  }

  return Object.freeze({
    createWorkItem,
    updateWorkItem,
    requestAttention,
    decide,
    expireAttention,
    markDecisionApplied,
    claimNext,
    heartbeat,
    finishRun,
    interruptRun,
    reconcile,
    pause,
    resume,
    retry,
    cancel,
    requestChanges,
    enqueueNotification,
    claimPendingNotifications,
    markNotificationSent,
    markNotificationFailed,
    listPendingNotifications,
    getNotification,
    requeueNotification,
    getWorkItem,
    getRun,
    projection: Object.freeze({
      overview: projectionOverview,
      listWorkItems,
      getWorkItem,
      getRun,
      listAttention,
      listNotifications,
      health,
    }),
    decisions: Object.freeze({
      create: decide,
      preview: previewDecision,
      pause,
      resume,
      retry,
      cancel,
      requestChanges,
    }),
    inspect: async () => {
      const inspected = await store.inspect();
      return inspected.ok
        ? {
            ok: true,
            state: canonicalControlState(inspected.state),
            version: inspected.state.version,
          }
        : inspected;
    },
  });
}
