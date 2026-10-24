import { randomBytes } from 'node:crypto';
import {
  AUTHENTICATED_WORKER_STATUSES,
  boundedText,
  cloneWorkerValue,
  commandFingerprint,
  containsForbiddenCloudContent,
  eventFingerprint,
  failure,
  hasDangerousCommandFields,
  hashWorkerToken,
  isPlainObject,
  normalizeCapabilities,
  normalizeCommand,
  normalizeProjectIds,
  normalizeWorkerEvent,
  normalizeWorkerRegistration,
  sanitizeWorkerAuditDetail,
  validIso,
} from './worker-contract.js';

const INPUT_INVALID = (message) => failure('WORKER_INPUT_INVALID', message);

function exactInput(input, allowed) {
  return (
    isPlainObject(input) &&
    Object.keys(input).length <= allowed.size &&
    Object.keys(input).every((key) => allowed.has(key))
  );
}

function commandCursor(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (isPlainObject(value)) {
    if (Number.isSafeInteger(value.commands) && value.commands >= 0) return value.commands;
    if (Number.isSafeInteger(value.command) && value.command >= 0) return value.command;
    return 0;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return 0;
}

function decisionCursor(value) {
  if (typeof value === 'string') return value;
  if (!isPlainObject(value)) return '';
  return typeof value.decisions === 'string'
    ? value.decisions
    : typeof value.decision === 'string'
      ? value.decision
      : '';
}

function controlResult(result) {
  return result?.result && isPlainObject(result.result) ? result.result : result;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createWorkerGateway({
  store,
  controlService,
  clock = Date.now,
  tokenFactory = () => `sgw_${randomBytes(32).toString('base64url')}`,
  leaseMs = 60000,
  heartbeatIntervalMs = 15000,
  offlineAfterMs = 45000,
  waitMs = 0,
  audit = async () => {},
} = {}) {
  if (!store || typeof store.findWorkerByTokenHash !== 'function')
    throw new TypeError('A worker store is required');
  if (typeof store.appendWorkerAudit !== 'function')
    throw new TypeError('A worker audit store is required');
  if (!controlService || typeof controlService.claimNext !== 'function')
    throw new TypeError('A control service is required');
  if (
    typeof clock !== 'function' ||
    typeof tokenFactory !== 'function' ||
    typeof audit !== 'function'
  )
    throw new TypeError('Worker gateway dependencies are invalid');
  for (const value of [leaseMs, heartbeatIntervalMs, offlineAfterMs]) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError('Worker timing values must be positive integers');
  }
  if (!Number.isSafeInteger(waitMs) || waitMs < 0)
    throw new TypeError('Worker waitMs must be a non-negative integer');

  const nowIso = () => new Date(clock()).toISOString();

  async function writeAudit({
    actorType,
    actorId,
    action,
    objectType,
    objectId,
    outcome = 'success',
    detail = {},
  }) {
    const entry = {
      actorType,
      actorId: boundedText(actorId, 256) ? actorId : 'unknown',
      action,
      objectType,
      objectId: boundedText(objectId, 128) ? objectId : 'unknown',
      outcome,
      detail: sanitizeWorkerAuditDetail(detail),
      createdAt: nowIso(),
    };
    await store.appendWorkerAudit(entry);
    try {
      await audit(cloneWorkerValue(entry));
    } catch {
      // The worker audit ledger remains the authoritative in-process record.
    }
    return entry;
  }

  async function issueRawToken() {
    const token = await tokenFactory();
    if (!boundedText(token, 512))
      throw new TypeError('tokenFactory must return a non-empty bounded string');
    return token;
  }

  async function updateWorkerWithRetry(workerId, updater) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const found = await store.getWorker(workerId);
      if (!found.ok) return found;
      const patch = updater(cloneWorkerValue(found.worker));
      if (!patch) return { ok: true, worker: found.worker };
      const updated = await store.updateWorker({
        workerId,
        expectedVersion: found.worker.version,
        patch,
      });
      if (updated.ok) return updated;
      if (updated.code !== 'WORKER_VERSION_CONFLICT') return updated;
    }
    return failure('WORKER_VERSION_CONFLICT', 'Worker record changed during update');
  }

  async function markOffline(worker) {
    if (worker.status !== 'ONLINE' || !worker.lastSeenAt) return worker;
    const lastSeen = Date.parse(worker.lastSeenAt);
    if (!Number.isFinite(lastSeen) || clock() - lastSeen < offlineAfterMs) return worker;
    const updated = await updateWorkerWithRetry(worker.workerId, (current) => {
      if (current.status !== 'ONLINE') return null;
      if (current.lastSeenAt && clock() - Date.parse(current.lastSeenAt) < offlineAfterMs)
        return null;
      return { status: 'OFFLINE' };
    });
    if (updated.ok && updated.worker.status === 'OFFLINE') {
      await writeAudit({
        actorType: 'system',
        actorId: 'worker-gateway',
        action: 'worker.offline',
        objectType: 'worker',
        objectId: worker.workerId,
        detail: { reason: 'HEARTBEAT_TIMEOUT' },
      });
    }
    return updated.ok ? updated.worker : worker;
  }

  async function authenticateWorker(token, { allowOffline = false } = {}) {
    if (!boundedText(token, 512))
      return failure('WORKER_AUTH_INVALID', 'Worker authentication failed');
    const found = await store.findWorkerByTokenHash(hashWorkerToken(token));
    if (!found.ok) return failure('WORKER_AUTH_INVALID', 'Worker authentication failed');
    let worker = await markOffline(found.worker);
    if (worker.status === 'REVOKED') return failure('WORKER_REVOKED', 'Worker has been revoked');
    if (worker.status === 'OFFLINE' && !allowOffline)
      return failure('WORKER_OFFLINE', 'Worker is offline');
    if (
      !AUTHENTICATED_WORKER_STATUSES.includes(worker.status) &&
      !(allowOffline && worker.status === 'OFFLINE')
    )
      return failure('WORKER_AUTH_INVALID', 'Worker authentication failed');
    const touched = await updateWorkerWithRetry(worker.workerId, (current) => {
      if (current.status === 'REVOKED') return null;
      return { lastSeenAt: nowIso() };
    });
    if (!touched.ok) return touched;
    worker = touched.worker;
    if (worker.status === 'REVOKED') return failure('WORKER_REVOKED', 'Worker has been revoked');
    return { ok: true, worker };
  }

  async function register(input) {
    const checked = normalizeWorkerRegistration(input);
    if (!checked.ok) return checked;
    const token = await issueRawToken();
    const tokenHash = hashWorkerToken(token);
    const workerId = `worker-${tokenHash.slice(0, 24)}`;
    const created = await store.createWorker({
      workerId,
      displayName: checked.value.displayName,
      tokenHash,
      capabilities: checked.value.capabilities,
      projectIds: checked.value.projectIds,
      status: 'ACTIVE',
    });
    if (!created.ok) return created;
    await writeAudit({
      actorType: 'user',
      actorId: checked.value.actorId,
      action: 'worker.register',
      objectType: 'worker',
      objectId: workerId,
      detail: {
        displayName: checked.value.displayName,
        projectIds: checked.value.projectIds,
        capabilities: checked.value.capabilities,
      },
    });
    return { ok: true, worker: created.worker, token };
  }

  async function rotateToken(input) {
    const allowed = new Set(['workerId', 'actorId']);
    if (
      !exactInput(input, allowed) ||
      !boundedText(input.workerId, 128) ||
      !boundedText(input.actorId, 256)
    )
      return INPUT_INVALID('Worker id and actor are required');
    const found = await store.getWorker(input.workerId);
    if (!found.ok) return found;
    if (found.worker.status === 'REVOKED')
      return failure('WORKER_REVOKED', 'Worker has been revoked');
    const token = await issueRawToken();
    const tokenHash = hashWorkerToken(token);
    if (tokenHash === found.worker.tokenHash)
      return failure('WORKER_TOKEN_ROTATION_INVALID', 'A new token is required');
    const updated = await store.updateWorker({
      workerId: input.workerId,
      expectedVersion: found.worker.version,
      patch: { tokenHash },
    });
    if (!updated.ok) return updated;
    await writeAudit({
      actorType: 'user',
      actorId: input.actorId,
      action: 'worker.token.rotate',
      objectType: 'worker',
      objectId: input.workerId,
      detail: { previousTokenInvalidated: true },
    });
    return { ok: true, worker: updated.worker, token };
  }

  async function revoke(input) {
    const allowed = new Set(['workerId', 'actorId']);
    if (
      !exactInput(input, allowed) ||
      !boundedText(input.workerId, 128) ||
      !boundedText(input.actorId, 256)
    )
      return INPUT_INVALID('Worker id and actor are required');
    const found = await store.getWorker(input.workerId);
    if (!found.ok) return found;
    if (found.worker.status === 'REVOKED')
      return { ok: true, worker: found.worker, duplicate: true };
    const updated = await store.updateWorker({
      workerId: input.workerId,
      expectedVersion: found.worker.version,
      patch: { status: 'REVOKED', revokedAt: nowIso() },
    });
    if (!updated.ok) return updated;
    await writeAudit({
      actorType: 'user',
      actorId: input.actorId,
      action: 'worker.revoke',
      objectType: 'worker',
      objectId: input.workerId,
      detail: { allAccessInvalidated: true },
    });
    return { ok: true, worker: updated.worker, duplicate: false };
  }

  async function listWorkers() {
    const listed = await store.listWorkers();
    if (!listed.ok) return listed;
    for (const worker of listed.workers) {
      if (worker.status === 'ONLINE') await markOffline(worker);
    }
    return store.listWorkers();
  }

  async function setProjects(input) {
    const allowed = new Set(['workerId', 'projectIds', 'actorId']);
    if (
      !exactInput(input, allowed) ||
      !boundedText(input.workerId, 128) ||
      !boundedText(input.actorId, 256)
    )
      return INPUT_INVALID('Worker id, project whitelist and actor are required');
    const projects = normalizeProjectIds(input.projectIds);
    if (!projects.ok) return projects;
    const found = await store.getWorker(input.workerId);
    if (!found.ok) return found;
    if (found.worker.status === 'REVOKED')
      return failure('WORKER_REVOKED', 'Worker has been revoked');
    const updated = await store.updateWorker({
      workerId: input.workerId,
      expectedVersion: found.worker.version,
      patch: { projectIds: projects.value },
    });
    if (!updated.ok) return updated;
    await writeAudit({
      actorType: 'user',
      actorId: input.actorId,
      action: 'worker.projects.update',
      objectType: 'worker',
      objectId: input.workerId,
      detail: { projectIds: projects.value },
    });
    return { ok: true, worker: updated.worker };
  }

  async function authenticate(input) {
    const allowed = new Set(['token']);
    if (!exactInput(input, allowed)) return INPUT_INVALID('Worker authentication input is invalid');
    return authenticateWorker(input.token);
  }

  async function connect(input) {
    const allowed = new Set(['token', 'capabilities']);
    if (!exactInput(input, allowed)) return INPUT_INVALID('Worker connection input is invalid');
    const authenticated = await authenticateWorker(input.token, { allowOffline: true });
    if (!authenticated.ok) return authenticated;
    let capabilities;
    if (input.capabilities !== undefined) {
      const checked = normalizeCapabilities(input.capabilities);
      if (!checked.ok) return checked;
      capabilities = checked.value;
    }
    const updated = await updateWorkerWithRetry(authenticated.worker.workerId, () => ({
      status: 'ONLINE',
      lastSeenAt: nowIso(),
      ...(capabilities === undefined ? {} : { capabilities }),
    }));
    if (!updated.ok) return updated;
    await writeAudit({
      actorType: 'worker',
      actorId: authenticated.worker.workerId,
      action: 'worker.connect',
      objectType: 'worker',
      objectId: authenticated.worker.workerId,
      detail: { capabilities: updated.worker.capabilities },
    });
    return {
      ok: true,
      worker: updated.worker,
      heartbeatIntervalMs,
      serverTime: nowIso(),
    };
  }

  function pendingDecisionsFromState(state, worker, after = '') {
    const decisions = Array.isArray(state?.decisions)
      ? state.decisions
      : isPlainObject(state?.decisions)
        ? Object.values(state.decisions)
        : [];
    const workItems = Array.isArray(state?.workItems)
      ? state.workItems
      : isPlainObject(state?.workItems)
        ? Object.values(state.workItems)
        : [];
    const whitelist = new Set(worker.projectIds);
    const rows = [];
    for (const decision of decisions) {
      if (
        !isPlainObject(decision) ||
        !['RECORDED', 'PENDING_APPLY'].includes(decision.status) ||
        !boundedText(decision.decisionId, 128)
      )
        continue;
      const workItem = workItems.find((entry) => entry?.workItemId === decision.workItemId);
      const projectId = decision.projectId ?? workItem?.projectId;
      if (!whitelist.has(projectId)) continue;
      const createdAt = validIso(decision.createdAt);
      if (!createdAt) continue;
      const cursor = `${createdAt}|${decision.decisionId}`;
      if (cursor <= after) continue;
      rows.push({
        cursor,
        value: {
          decisionId: decision.decisionId,
          workItemId: decision.workItemId,
          projectId,
          attentionId: decision.attentionId,
          action: decision.action,
          artifactHash: decision.artifactHash,
          expectedWorkItemVersion: decision.expectedWorkItemVersion,
          attentionRevision: decision.attentionRevision,
          status: decision.status,
          createdAt,
        },
      });
    }
    rows.sort((left, right) => left.cursor.localeCompare(right.cursor));
    const selected = rows.slice(0, 50);
    return {
      pendingDecisions: selected.map((row) => row.value),
      cursor: selected.length > 0 ? selected.at(-1).cursor : after,
    };
  }

  async function readSyncSnapshot(worker, cursor) {
    const commands = await store.listCommands({
      workerId: worker.workerId,
      after: commandCursor(cursor),
      limit: 50,
    });
    if (!commands.ok) return commands;
    let pending = { pendingDecisions: [], cursor: decisionCursor(cursor) };
    if (typeof controlService.inspect === 'function') {
      let inspected;
      try {
        inspected = await controlService.inspect();
      } catch {
        return failure('WORKER_CONTROL_UNAVAILABLE', 'Control state is unavailable');
      }
      if (!inspected?.ok)
        return failure(
          inspected?.code || 'WORKER_CONTROL_UNAVAILABLE',
          inspected?.message || 'Control state is unavailable',
        );
      pending = pendingDecisionsFromState(
        inspected.state ?? inspected,
        worker,
        decisionCursor(cursor),
      );
    }
    return {
      ok: true,
      commands: commands.commands,
      commandCursor: commands.cursor,
      pendingDecisions: pending.pendingDecisions,
      decisionCursor: pending.cursor,
    };
  }

  async function sync(input) {
    const allowed = new Set(['token', 'cursor', 'waitMs']);
    if (!exactInput(input, allowed)) return INPUT_INVALID('Worker sync input is invalid');
    const authenticated = await authenticateWorker(input.token);
    if (!authenticated.ok) return authenticated;
    const requestedWait = input.waitMs === undefined ? waitMs : input.waitMs;
    if (!Number.isSafeInteger(requestedWait) || requestedWait < 0 || requestedWait > 60000)
      return INPUT_INVALID('Worker wait time is invalid');
    let snapshot = await readSyncSnapshot(authenticated.worker, input.cursor);
    if (!snapshot.ok) return snapshot;
    if (
      requestedWait > 0 &&
      snapshot.commands.length === 0 &&
      snapshot.pendingDecisions.length === 0
    ) {
      await delay(requestedWait);
      const touched = await updateWorkerWithRetry(authenticated.worker.workerId, () => ({
        lastSeenAt: nowIso(),
      }));
      if (!touched.ok) return touched;
      if (touched.worker.status !== 'ONLINE') return failure('WORKER_OFFLINE', 'Worker is offline');
      snapshot = await readSyncSnapshot(touched.worker, input.cursor);
      if (!snapshot.ok) return snapshot;
    }
    return {
      ok: true,
      commands: snapshot.commands,
      pendingDecisions: snapshot.pendingDecisions,
      decisions: snapshot.pendingDecisions,
      cursor: {
        commands: snapshot.commandCursor,
        decisions: snapshot.decisionCursor,
      },
      serverTime: nowIso(),
      waitMs: requestedWait,
    };
  }

  async function claim(input) {
    const allowed = new Set(['token', 'leaseMs']);
    if (!exactInput(input, allowed))
      return INPUT_INVALID('Workers may not supply project ids or connection targets');
    const authenticated = await authenticateWorker(input.token);
    if (!authenticated.ok) return authenticated;
    const requestedLease = input.leaseMs === undefined ? leaseMs : input.leaseMs;
    if (
      !Number.isSafeInteger(requestedLease) ||
      requestedLease <= 0 ||
      requestedLease > 24 * 60 * 60 * 1000
    )
      return INPUT_INVALID('Lease duration is invalid');
    const result = await controlService.claimNext({
      ownerId: authenticated.worker.workerId,
      projectIds: [...authenticated.worker.projectIds],
      leaseMs: requestedLease,
    });
    const claimed = controlResult(result);
    if (!result?.ok) {
      await writeAudit({
        actorType: 'worker',
        actorId: authenticated.worker.workerId,
        action: 'worker.claim.deny',
        objectType: 'worker',
        objectId: authenticated.worker.workerId,
        outcome: 'failure',
        detail: { reason: result?.code ?? 'CONTROL_REJECTED' },
      });
      return result;
    }
    if (claimed?.idle === true || !claimed?.workItem || !claimed?.lease || !claimed?.run) {
      await writeAudit({
        actorType: 'worker',
        actorId: authenticated.worker.workerId,
        action: 'worker.claim.deny',
        objectType: 'worker',
        objectId: authenticated.worker.workerId,
        outcome: 'failure',
        detail: { reason: 'IDLE' },
      });
      return {
        ok: true,
        idle: true,
        workItem: null,
        run: null,
        lease: null,
      };
    }
    const projectId =
      claimed.workItem?.projectId ?? claimed.run?.projectId ?? claimed.lease?.projectId;
    if (!authenticated.worker.projectIds.includes(projectId)) {
      if (typeof controlService.releaseLease === 'function') {
        await controlService.releaseLease({
          runId: claimed.run.runId,
          leaseToken: claimed.lease.token,
          ownerId: authenticated.worker.workerId,
        });
      }
      await writeAudit({
        actorType: 'worker',
        actorId: authenticated.worker.workerId,
        action: 'worker.claim.deny',
        objectType: 'worker',
        objectId: authenticated.worker.workerId,
        outcome: 'failure',
        detail: { reason: 'PROJECT_OUTSIDE_WHITELIST', projectId },
      });
      return failure(
        'WORKER_PROJECT_DENIED',
        'Control service returned a WorkItem outside the worker whitelist',
      );
    }
    await store.setLease({
      workerId: authenticated.worker.workerId,
      lease: {
        runId: claimed.run.runId,
        leaseToken: claimed.lease.token,
        projectId,
        workItemId: claimed.workItem.workItemId,
        expiresAt: claimed.lease.expiresAt,
      },
    });
    await writeAudit({
      actorType: 'worker',
      actorId: authenticated.worker.workerId,
      action: 'worker.claim',
      objectType: 'run',
      objectId: claimed.run.runId,
      detail: {
        workItemId: claimed.workItem.workItemId,
        projectId,
        leaseMs: requestedLease,
      },
    });
    return {
      ok: true,
      idle: false,
      workItem: cloneWorkerValue(claimed.workItem),
      run: cloneWorkerValue(claimed.run),
      lease: cloneWorkerValue(claimed.lease),
      heartbeatIntervalMs,
    };
  }

  async function heartbeat(input) {
    const allowed = new Set(['token', 'runId', 'leaseToken', 'expectedRunVersion', 'updates']);
    if (!exactInput(input, allowed)) return INPUT_INVALID('Worker heartbeat input is invalid');
    if (
      !boundedText(input.runId, 128) ||
      !boundedText(input.leaseToken, 256) ||
      !Number.isSafeInteger(input.expectedRunVersion) ||
      input.expectedRunVersion < 1 ||
      (input.updates !== undefined && !isPlainObject(input.updates))
    )
      return INPUT_INVALID('Run, lease and current Run version are required');
    const updates = input.updates ?? {};
    const allowedUpdates = new Set([
      'sessionId',
      'pid',
      'currentPhase',
      'currentCommand',
      'checkpoint',
      'budgetUsage',
    ]);
    if (Object.keys(updates).some((key) => !allowedUpdates.has(key)))
      return failure('WORKER_HEARTBEAT_INVALID', 'Heartbeat updates contain unsupported fields');
    if (hasDangerousCommandFields(updates))
      return failure(
        'WORKER_HEARTBEAT_INVALID',
        'Heartbeat updates must not carry shell commands or executables',
      );
    if (containsForbiddenCloudContent(updates))
      return failure(
        'WORKER_HEARTBEAT_SENSITIVE',
        'Heartbeat updates contain credentials, callbacks or local paths',
      );
    const authenticated = await authenticateWorker(input.token);
    if (!authenticated.ok) return authenticated;
    const localLease = await store.getLease({
      workerId: authenticated.worker.workerId,
      runId: input.runId,
    });
    if (localLease.ok && localLease.lease.leaseToken !== input.leaseToken) {
      await writeAudit({
        actorType: 'worker',
        actorId: authenticated.worker.workerId,
        action: 'worker.heartbeat',
        objectType: 'run',
        objectId: input.runId,
        outcome: 'failure',
        detail: { reason: 'LEASE_OWNER_MISMATCH' },
      });
      return failure('LEASE_INVALID', 'Execution lease is no longer valid');
    }
    if (typeof controlService.heartbeat !== 'function')
      return failure('WORKER_CONTROL_UNAVAILABLE', 'Control service cannot accept heartbeats');
    const result = await controlService.heartbeat({
      runId: input.runId,
      leaseToken: input.leaseToken,
      expectedRunVersion: input.expectedRunVersion,
      updates: cloneWorkerValue(updates),
    });
    if (!result?.ok && result?.code === 'LEASE_INVALID')
      await store.deleteLease({
        workerId: authenticated.worker.workerId,
        runId: input.runId,
      });
    await writeAudit({
      actorType: 'worker',
      actorId: authenticated.worker.workerId,
      action: 'worker.heartbeat',
      objectType: 'run',
      objectId: input.runId,
      outcome: result?.ok ? 'success' : 'failure',
      detail: { code: result?.ok ? null : (result?.code ?? 'CONTROL_ERROR') },
    });
    return result;
  }

  async function release(input) {
    const allowed = new Set(['token', 'runId', 'leaseToken']);
    if (!exactInput(input, allowed)) return INPUT_INVALID('Worker release input is invalid');
    if (!boundedText(input.runId, 128) || !boundedText(input.leaseToken, 256))
      return INPUT_INVALID('Run and lease are required');
    const authenticated = await authenticateWorker(input.token);
    if (!authenticated.ok) return authenticated;
    const localLease = await store.getLease({
      workerId: authenticated.worker.workerId,
      runId: input.runId,
    });
    if (localLease.ok && localLease.lease.leaseToken !== input.leaseToken) {
      await writeAudit({
        actorType: 'worker',
        actorId: authenticated.worker.workerId,
        action: 'worker.release',
        objectType: 'run',
        objectId: input.runId,
        outcome: 'failure',
        detail: { reason: 'LEASE_OWNER_MISMATCH' },
      });
      return failure('LEASE_INVALID', 'Execution lease is no longer valid');
    }
    const releaseOperation =
      controlService.releaseLease ?? controlService.release ?? controlService.releaseRun;
    if (typeof releaseOperation !== 'function')
      return failure('WORKER_RELEASE_UNSUPPORTED', 'Control service cannot release leases');
    const result = await releaseOperation.call(controlService, {
      runId: input.runId,
      leaseToken: input.leaseToken,
      ownerId: authenticated.worker.workerId,
    });
    if (result?.ok)
      await store.deleteLease({
        workerId: authenticated.worker.workerId,
        runId: input.runId,
      });
    await writeAudit({
      actorType: 'worker',
      actorId: authenticated.worker.workerId,
      action: 'worker.release',
      objectType: 'run',
      objectId: input.runId,
      outcome: result?.ok ? 'success' : 'failure',
      detail: { code: result?.ok ? null : (result?.code ?? 'CONTROL_ERROR') },
    });
    return result;
  }

  async function reportEvents(input) {
    const allowed = new Set(['token', 'events']);
    if (!exactInput(input, allowed)) return INPUT_INVALID('Worker event input is invalid');
    if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > 100)
      return INPUT_INVALID('Worker event batch is invalid');
    const authenticated = await authenticateWorker(input.token);
    if (!authenticated.ok) return authenticated;
    const receivedAt = nowIso();
    const normalized = [];
    for (const value of input.events) {
      const checked = normalizeWorkerEvent(value, { receivedAt });
      if (!checked.ok) {
        await writeAudit({
          actorType: 'worker',
          actorId: authenticated.worker.workerId,
          action: 'worker.event.rejected',
          objectType: 'worker',
          objectId: authenticated.worker.workerId,
          outcome: 'failure',
          detail: { code: checked.code, field: checked.field ?? null },
        });
        return checked;
      }
      if (!authenticated.worker.projectIds.includes(checked.value.projectId)) {
        await writeAudit({
          actorType: 'worker',
          actorId: authenticated.worker.workerId,
          action: 'worker.event.rejected',
          objectType: 'worker',
          objectId: authenticated.worker.workerId,
          outcome: 'failure',
          detail: { reason: 'PROJECT_OUTSIDE_WHITELIST', projectId: checked.value.projectId },
        });
        return failure(
          'WORKER_PROJECT_DENIED',
          'Worker event references a project outside its whitelist',
        );
      }
      normalized.push({
        ...checked.value,
        workerId: authenticated.worker.workerId,
        source: 'worker',
        fingerprint: eventFingerprint(checked.value),
      });
    }
    const stored = await store.appendEvents({
      workerId: authenticated.worker.workerId,
      events: normalized,
    });
    if (!stored.ok) {
      await writeAudit({
        actorType: 'worker',
        actorId: authenticated.worker.workerId,
        action: 'worker.event.rejected',
        objectType: 'worker',
        objectId: authenticated.worker.workerId,
        outcome: 'failure',
        detail: { code: stored.code },
      });
      return stored;
    }
    if (typeof controlService.appendEvidence === 'function') {
      for (const event of [...stored.accepted, ...stored.duplicateEvents]) {
        const appended = await controlService.appendEvidence(cloneWorkerValue(event));
        if (!appended?.ok) {
          await writeAudit({
            actorType: 'worker',
            actorId: authenticated.worker.workerId,
            action: 'worker.event.rejected',
            objectType: 'worker',
            objectId: authenticated.worker.workerId,
            outcome: 'failure',
            detail: { code: appended?.code ?? 'EVIDENCE_APPEND_FAILED' },
          });
          return appended;
        }
      }
    }
    await writeAudit({
      actorType: 'worker',
      actorId: authenticated.worker.workerId,
      action: 'worker.event.accepted',
      objectType: 'worker',
      objectId: authenticated.worker.workerId,
      detail: {
        acceptedCount: stored.accepted.length,
        duplicateCount: stored.duplicates.length,
      },
    });
    if (stored.duplicates.length > 0) {
      await writeAudit({
        actorType: 'worker',
        actorId: authenticated.worker.workerId,
        action: 'worker.event.replay',
        objectType: 'worker',
        objectId: authenticated.worker.workerId,
        detail: { eventIds: stored.duplicates },
      });
    }
    return {
      ok: true,
      accepted: stored.accepted,
      duplicates: stored.duplicates,
      events: [...stored.accepted, ...stored.duplicateEvents],
    };
  }

  async function issueCommand(input) {
    const allowed = new Set(['workerId', 'kind', 'payload', 'dedupeKey', 'actorId']);
    if (!exactInput(input, allowed)) return INPUT_INVALID('Worker command input is invalid');
    if (!boundedText(input.workerId, 128) || !boundedText(input.actorId, 256))
      return INPUT_INVALID('Worker command target and actor are required');
    const checked = normalizeCommand(input);
    if (!checked.ok) {
      await writeAudit({
        actorType: 'user',
        actorId: input.actorId,
        action: 'worker.command.rejected',
        objectType: 'worker',
        objectId: input.workerId,
        outcome: 'failure',
        detail: { code: checked.code, kind: input.kind },
      });
      return checked;
    }
    const found = await store.getWorker(input.workerId);
    if (!found.ok) return found;
    if (found.worker.status === 'REVOKED')
      return failure('WORKER_REVOKED', 'Worker has been revoked');
    const fingerprint = commandFingerprint({
      kind: input.kind,
      payload: checked.value,
    });
    const dedupeKey =
      input.dedupeKey === undefined
        ? `command-${fingerprint}`
        : boundedText(input.dedupeKey, 256)
          ? input.dedupeKey
          : null;
    if (!dedupeKey) return failure('WORKER_COMMAND_INVALID', 'Command dedupe key is invalid');
    const result = await store.enqueueCommand({
      workerId: input.workerId,
      commandId: `command-${hashWorkerToken(`${input.workerId}\u0000${dedupeKey}`).slice(0, 24)}`,
      kind: input.kind,
      payload: checked.value,
      dedupeKey,
      fingerprint,
      actorId: input.actorId,
      at: nowIso(),
    });
    if (!result.ok) {
      await writeAudit({
        actorType: 'user',
        actorId: input.actorId,
        action: 'worker.command.rejected',
        objectType: 'worker',
        objectId: input.workerId,
        outcome: 'failure',
        detail: { code: result.code, kind: input.kind },
      });
      return result;
    }
    await writeAudit({
      actorType: 'user',
      actorId: input.actorId,
      action: 'worker.command.issue',
      objectType: 'command',
      objectId: result.command.commandId,
      detail: { kind: input.kind, duplicate: result.duplicate },
    });
    return result;
  }

  async function pullCommands(input) {
    const allowed = new Set(['token', 'after', 'limit']);
    if (!exactInput(input, allowed)) return INPUT_INVALID('Worker command pull input is invalid');
    const after = input.after ?? 0;
    const limit = input.limit ?? 50;
    if (!Number.isSafeInteger(after) || after < 0)
      return INPUT_INVALID('Command cursor is invalid');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      return INPUT_INVALID('Command limit is invalid');
    const authenticated = await authenticateWorker(input.token);
    if (!authenticated.ok) return authenticated;
    return store.listCommands({
      workerId: authenticated.worker.workerId,
      after,
      limit,
    });
  }

  async function ackCommand(input) {
    const allowed = new Set(['token', 'commandId', 'at']);
    if (!exactInput(input, allowed) || !boundedText(input.commandId, 128))
      return INPUT_INVALID('Command acknowledgement input is invalid');
    const at = input.at === undefined ? nowIso() : validIso(input.at);
    if (!at) return INPUT_INVALID('Command acknowledgement time is invalid');
    const authenticated = await authenticateWorker(input.token);
    if (!authenticated.ok) return authenticated;
    const result = await store.ackCommand({
      workerId: authenticated.worker.workerId,
      commandId: input.commandId,
      at,
    });
    await writeAudit({
      actorType: 'worker',
      actorId: authenticated.worker.workerId,
      action: 'worker.command.ack',
      objectType: 'command',
      objectId: input.commandId,
      outcome: result.ok ? 'success' : 'failure',
      detail: { duplicate: result.duplicate ?? false, code: result.code ?? null },
    });
    return result;
  }

  return Object.freeze({
    register,
    rotateToken,
    revoke,
    listWorkers,
    setProjects,
    authenticate,
    connect,
    sync,
    heartbeat,
    reportEvents,
    pullCommands,
    ackCommand,
    release,
    claim,
    issueCommand,
  });
}
