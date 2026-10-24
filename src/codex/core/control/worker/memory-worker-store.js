import {
  COMMAND_KINDS,
  boundedText,
  cloneWorkerValue,
  failure,
  isPlainObject,
  validIso,
  validWorkerEventRecord,
  validWorkerRecord,
} from './worker-contract.js';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function commandKey(workerId, dedupeKey) {
  return `${workerId}\u0000${dedupeKey}`;
}

export function createMemoryWorkerStore({ clock = Date.now } = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const workers = new Map();
  const workersByTokenHash = new Map();
  const commands = new Map();
  const commandsByDedupe = new Map();
  const events = new Map();
  const eventsByDedupe = new Map();
  const leases = new Map();
  const commandSequences = new Map();
  const audits = [];
  let auditSequence = 0;
  let queue = Promise.resolve();

  const atomic = (operation) => {
    const current = queue.then(operation, operation);
    queue = current.catch(() => {});
    return current;
  };
  const timestamp = () => new Date(clock()).toISOString();
  const copyWorker = (worker) => cloneWorkerValue(worker);

  function leaseKey(workerId, runId) {
    return `${workerId}\u0000${runId}`;
  }

  function getWorker(workerId) {
    return atomic(() => {
      if (!boundedText(workerId, 128)) return failure('WORKER_ID_INVALID', 'Worker id is invalid');
      const worker = workers.get(workerId);
      return worker
        ? { ok: true, worker: copyWorker(worker) }
        : failure('WORKER_NOT_FOUND', 'Worker was not found');
    });
  }

  function getWorkerByTokenHash(tokenHash) {
    return atomic(() => {
      if (!HASH.test(tokenHash || ''))
        return failure('WORKER_TOKEN_HASH_INVALID', 'Worker token hash is invalid');
      const workerId = workersByTokenHash.get(tokenHash);
      const worker = workerId ? workers.get(workerId) : null;
      return worker
        ? { ok: true, worker: copyWorker(worker) }
        : failure('WORKER_AUTH_INVALID', 'Worker token is invalid');
    });
  }

  function createWorker(input = {}) {
    return atomic(() => {
      const at = input.createdAt ? validIso(input.createdAt) : timestamp();
      const worker = {
        workerId: input.workerId,
        displayName: input.displayName,
        tokenHash: input.tokenHash,
        status: input.status ?? 'ACTIVE',
        capabilities: cloneWorkerValue(input.capabilities ?? []),
        projectIds: cloneWorkerValue(input.projectIds ?? []),
        lastSeenAt: input.lastSeenAt ?? null,
        revokedAt: null,
        createdAt: at,
        updatedAt: at,
        version: 1,
      };
      if (!validWorkerRecord(worker))
        return failure('WORKER_RECORD_INVALID', 'Worker record is invalid');
      if (workers.has(worker.workerId)) return failure('WORKER_EXISTS', 'Worker id already exists');
      if (workersByTokenHash.has(worker.tokenHash))
        return failure('WORKER_TOKEN_EXISTS', 'Worker token already exists');
      workers.set(worker.workerId, worker);
      workersByTokenHash.set(worker.tokenHash, worker.workerId);
      return { ok: true, worker: copyWorker(worker) };
    });
  }

  function updateWorker({ workerId, expectedVersion, patch } = {}) {
    return atomic(() => {
      const current = workers.get(workerId);
      if (!current) return failure('WORKER_NOT_FOUND', 'Worker was not found');
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion !== current.version)
        return failure('WORKER_VERSION_CONFLICT', 'Worker record changed', {
          actualVersion: current.version,
        });
      if (!isPlainObject(patch))
        return failure('WORKER_RECORD_INVALID', 'Worker patch must be an object');
      const allowed = new Set([
        'displayName',
        'tokenHash',
        'status',
        'capabilities',
        'projectIds',
        'lastSeenAt',
        'revokedAt',
      ]);
      if (Object.keys(patch).some((key) => !allowed.has(key)))
        return failure('WORKER_RECORD_INVALID', 'Worker patch contains unsupported fields');
      const next = {
        ...current,
        ...cloneWorkerValue(patch),
        updatedAt: timestamp(),
        version: current.version + 1,
      };
      if (!validWorkerRecord(next))
        return failure('WORKER_RECORD_INVALID', 'Worker record is invalid');
      if (
        next.tokenHash !== current.tokenHash &&
        workersByTokenHash.has(next.tokenHash) &&
        workersByTokenHash.get(next.tokenHash) !== workerId
      )
        return failure('WORKER_TOKEN_EXISTS', 'Worker token already exists');
      if (next.tokenHash !== current.tokenHash) {
        workersByTokenHash.delete(current.tokenHash);
        workersByTokenHash.set(next.tokenHash, workerId);
      }
      workers.set(workerId, next);
      return { ok: true, worker: copyWorker(next) };
    });
  }

  function listWorkers() {
    return atomic(() => ({
      ok: true,
      workers: [...workers.values()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(copyWorker),
    }));
  }

  function enqueueCommand(input = {}) {
    return atomic(() => {
      const worker = workers.get(input.workerId);
      if (!worker) return failure('WORKER_NOT_FOUND', 'Worker was not found');
      if (worker.status === 'REVOKED') return failure('WORKER_REVOKED', 'Worker has been revoked');
      if (
        !ID.test(input.commandId || '') ||
        !COMMAND_KINDS.includes(input.kind) ||
        !boundedText(input.dedupeKey, 256) ||
        !boundedText(input.actorId, 256) ||
        !isPlainObject(input.payload) ||
        !HASH.test(input.fingerprint || '')
      )
        return failure('WORKER_COMMAND_INVALID', 'Command record is invalid');
      const at = input.at ? validIso(input.at) : timestamp();
      if (!at) return failure('WORKER_COMMAND_INVALID', 'Command time is invalid');
      const dedupe = commandKey(input.workerId, input.dedupeKey);
      const existingId = commandsByDedupe.get(dedupe);
      if (existingId) {
        const existing = commands.get(existingId);
        if (existing.fingerprint !== input.fingerprint)
          return failure(
            'WORKER_COMMAND_DEDUPE_CONFLICT',
            'Command dedupe key was reused with different content',
            { commandId: existing.commandId },
          );
        return { ok: true, command: cloneWorkerValue(existing), duplicate: true };
      }
      if (commands.has(input.commandId))
        return failure('WORKER_COMMAND_EXISTS', 'Command id already exists');
      const commandSequence = (commandSequences.get(input.workerId) ?? 0) + 1;
      commandSequences.set(input.workerId, commandSequence);
      const command = {
        commandId: input.commandId,
        workerId: input.workerId,
        sequence: commandSequence,
        kind: input.kind,
        payload: cloneWorkerValue(input.payload),
        dedupeKey: input.dedupeKey,
        fingerprint: input.fingerprint,
        issuedBy: input.actorId,
        issuedAt: at,
        ackedAt: null,
      };
      commands.set(command.commandId, command);
      commandsByDedupe.set(dedupe, command.commandId);
      return { ok: true, command: cloneWorkerValue(command), duplicate: false };
    });
  }

  function listCommands({ workerId, after = 0, limit = 50, includeAcked = false } = {}) {
    return atomic(() => {
      if (!workers.has(workerId)) return failure('WORKER_NOT_FOUND', 'Worker was not found');
      if (!Number.isSafeInteger(after) || after < 0)
        return failure('WORKER_CURSOR_INVALID', 'Command cursor is invalid');
      const maximum = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
      const selected = [...commands.values()]
        .filter(
          (command) =>
            command.workerId === workerId &&
            command.sequence > after &&
            (includeAcked || !command.ackedAt),
        )
        .sort((left, right) => left.sequence - right.sequence)
        .slice(0, maximum)
        .map(cloneWorkerValue);
      return {
        ok: true,
        commands: selected,
        cursor: selected.length > 0 ? selected.at(-1).sequence : after,
      };
    });
  }

  function ackCommand({ workerId, commandId, at } = {}) {
    return atomic(() => {
      const command = commands.get(commandId);
      if (!command || command.workerId !== workerId)
        return failure('WORKER_COMMAND_NOT_FOUND', 'Command was not found');
      const acknowledgedAt = at ? validIso(at) : timestamp();
      if (!acknowledgedAt)
        return failure('WORKER_COMMAND_INVALID', 'Command acknowledgement time is invalid');
      if (command.ackedAt)
        return {
          ok: true,
          command: cloneWorkerValue(command),
          duplicate: true,
        };
      command.ackedAt = acknowledgedAt;
      commands.set(command.commandId, command);
      return {
        ok: true,
        command: cloneWorkerValue(command),
        duplicate: false,
      };
    });
  }

  function appendEvents({ workerId, events: incoming = [] } = {}) {
    return atomic(() => {
      if (!workers.has(workerId)) return failure('WORKER_NOT_FOUND', 'Worker was not found');
      if (!Array.isArray(incoming) || incoming.length < 1 || incoming.length > 100)
        return failure('WORKER_EVENT_INVALID', 'Event batch is invalid');
      if (incoming.some((event) => !validWorkerEventRecord(event)))
        return failure('WORKER_EVENT_INVALID', 'Event record is invalid');
      const accepted = [];
      const duplicates = [];
      const conflicts = [];
      for (const event of incoming) {
        const existing =
          events.get(event.eventId) ??
          events.get(eventsByDedupe.get(commandKey(workerId, event.dedupeKey)));
        if (existing) {
          if (
            existing.workerId === workerId &&
            existing.eventId === event.eventId &&
            existing.dedupeKey === event.dedupeKey &&
            existing.fingerprint === event.fingerprint
          )
            duplicates.push(cloneWorkerValue(existing));
          else
            conflicts.push({
              eventId: event.eventId,
              dedupeKey: event.dedupeKey,
              existingEventId: existing.eventId,
            });
          continue;
        }
        accepted.push(event);
      }
      if (conflicts.length > 0)
        return failure(
          'WORKER_EVENT_CONFLICT',
          'Event id or dedupe key was reused with different content',
          { conflicts },
        );
      const stored = accepted.map((event) => {
        const copy = cloneWorkerValue(event);
        events.set(copy.eventId, copy);
        eventsByDedupe.set(commandKey(workerId, copy.dedupeKey), copy.eventId);
        return cloneWorkerValue(copy);
      });
      return {
        ok: true,
        accepted: stored,
        duplicates: duplicates.map((event) => event.eventId),
        duplicateEvents: duplicates,
      };
    });
  }

  function appendAudit(entry = {}) {
    return atomic(() => {
      const at = entry.createdAt ? validIso(entry.createdAt) : timestamp();
      if (!at) return failure('WORKER_AUDIT_INVALID', 'Audit time is invalid');
      auditSequence += 1;
      const audit = {
        auditId: `worker-audit-${auditSequence}`,
        sequence: auditSequence,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId,
        outcome: entry.outcome === 'failure' ? 'failure' : 'success',
        detail: cloneWorkerValue(entry.detail ?? {}),
        createdAt: at,
      };
      audits.push(audit);
      return { ok: true, audit: cloneWorkerValue(audit) };
    });
  }

  function listAudit({ action, workerId, limit = 1000 } = {}) {
    return atomic(() => {
      const maximum = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 1000) : 1000;
      return {
        ok: true,
        audits: audits
          .filter(
            (audit) =>
              (!boundedText(action, 128) || audit.action === action) &&
              (!boundedText(workerId, 128) ||
                audit.objectId === workerId ||
                audit.actorId === workerId),
          )
          .slice(-maximum)
          .map(cloneWorkerValue),
      };
    });
  }

  function setLease({ workerId, lease } = {}) {
    return atomic(() => {
      if (!workers.has(workerId)) return failure('WORKER_NOT_FOUND', 'Worker was not found');
      if (
        !isPlainObject(lease) ||
        !boundedText(lease.runId, 128) ||
        !boundedText(lease.leaseToken, 256) ||
        !boundedText(lease.projectId, 128) ||
        !boundedText(lease.workItemId, 128) ||
        !validIso(lease.expiresAt)
      )
        return failure('WORKER_LEASE_INVALID', 'Lease record is invalid');
      leases.set(leaseKey(workerId, lease.runId), cloneWorkerValue(lease));
      return { ok: true, lease: cloneWorkerValue(lease) };
    });
  }

  function getLease({ workerId, runId } = {}) {
    return atomic(() => {
      const lease = leases.get(leaseKey(workerId, runId));
      return lease
        ? { ok: true, lease: cloneWorkerValue(lease) }
        : failure('WORKER_LEASE_NOT_FOUND', 'Worker lease was not found');
    });
  }

  function deleteLease({ workerId, runId } = {}) {
    return atomic(() => {
      const deleted = leases.delete(leaseKey(workerId, runId));
      return { ok: true, deleted };
    });
  }

  function inspect() {
    return atomic(() => ({
      ok: true,
      state: cloneWorkerValue({
        workers: Object.fromEntries(workers),
        commands: Object.fromEntries(commands),
        events: Object.fromEntries(events),
        leases: Object.fromEntries(leases),
        audits,
      }),
    }));
  }

  return Object.freeze({
    getWorker,
    getWorkerByTokenHash,
    findWorkerByTokenHash: getWorkerByTokenHash,
    createWorker,
    updateWorker,
    listWorkers,
    enqueueCommand,
    listCommands,
    ackCommand,
    appendEvents,
    appendAudit,
    appendWorkerAudit: appendAudit,
    listAudit,
    setLease,
    getLease,
    deleteLease,
    inspect,
  });
}
