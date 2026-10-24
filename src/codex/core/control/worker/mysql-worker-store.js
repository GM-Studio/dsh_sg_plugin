import { randomUUID } from 'node:crypto';
import { clone, failure, nonEmpty, sha256 } from '../persistence/repository-contract.js';
import {
  COMMAND_KINDS,
  commandFingerprint,
  eventFingerprint,
  normalizeCommand,
} from './worker-contract.js';

export const WORKER_STATUSES = Object.freeze([
  'ONLINE',
  'OFFLINE',
  'INTERRUPTED',
  'SUSPECT',
  'REVOKED',
]);

export const WORKER_COMMAND_KINDS = COMMAND_KINDS;

export const WORKER_AUDIT_EVENTS = Object.freeze([
  'WORKER_CREATED',
  'WORKER_UPDATED',
  'WORKER_TOKEN_ROTATED',
  'WORKER_REVOKED',
  'WORKER_PROJECTS_CHANGED',
  'WORKER_SEEN',
  'WORKER_OFFLINE',
  'WORKER_COMMAND_ENQUEUED',
  'WORKER_COMMAND_ACKED',
  'WORKER_COMMAND_REJECTED',
  'WORKER_EVENT_ACCEPTED',
  'WORKER_EVENT_REJECTED',
  'worker.offline',
  'worker.register',
  'worker.token.rotate',
  'worker.revoke',
  'worker.projects.update',
  'worker.connect',
  'worker.claim.deny',
  'worker.claim',
  'worker.heartbeat',
  'worker.release',
  'worker.event.rejected',
  'worker.event.accepted',
  'worker.event.replay',
  'worker.command.rejected',
  'worker.command.issue',
  'worker.command.ack',
]);

const STATUSES = new Set(WORKER_STATUSES);
const AUDIT_EVENTS = new Set(WORKER_AUDIT_EVENTS);
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_EVENT_STRING = 2048;
const MAX_AUDIT_STRING = 512;
const AUDITED_FAILURE = Symbol('auditedFailure');
const SENSITIVE_KEY =
  /(?:password|passwd|secret|token|csrf|proof|nonce|seed|cipher|confirmation.?code|totp.?code|authorization|api.?key|private.?key|credential|cookie)/i;
const RAW_EVENT_KEY =
  /(?:stdout|stderr|raw.?log|logs?|output|patch|diff|content|prompt|command|cmd|shell|argv|script|environment|env)$/i;
const SENSITIVE_AUDIT_KEY =
  /(?:password|passwd|secret|token|csrf|proof|nonce|seed|cipher|confirmation.?code|totp.?code|authorization|api.?key|private.?key|credential|cookie|payload|command|cmd|shell|argv|script|stdout|stderr|logs?)/i;

const normalizedHash = (value) => {
  if (typeof value !== 'string') return null;
  const hash = value.toLowerCase();
  return HASH.test(hash) ? hash : null;
};
const normalizedDedupe = (value) => {
  const hash = normalizedHash(value);
  if (hash) return hash;
  return nonEmpty(value, 256) ? sha256({ dedupeKey: value }) : null;
};
const normalizedIso = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
};
const sqlDate = (value) => normalizedIso(value)?.replace('T', ' ').slice(0, 23) ?? null;
const dbDate = (value) => {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`).toISOString();
};
const parseJson = (value) => {
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  return typeof value === 'string' ? JSON.parse(value) : clone(value ?? {});
};
const json = (value) => JSON.stringify(value ?? {});
const integer = (value) => (Number.isSafeInteger(Number(value)) ? Number(value) : null);
const fullId = (value) => (typeof value === 'string' && ID.test(value) ? value : null);
const validProjectId = (value) => nonEmpty(value, 128);
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function boundedJson(value, { maxString = MAX_EVENT_STRING, redact = false } = {}) {
  const seen = new WeakSet();
  const visit = (current, depth) => {
    if (depth > 6) throw new TypeError('JSON depth exceeds limit');
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('JSON number is invalid');
      return current;
    }
    if (typeof current === 'string') {
      if (current.length > maxString) throw new TypeError('JSON string exceeds limit');
      return current;
    }
    if (typeof current !== 'object') throw new TypeError('JSON value is not serializable');
    if (seen.has(current)) throw new TypeError('JSON value is circular');
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.length > 100) throw new TypeError('JSON array exceeds limit');
      return current.map((entry) => visit(entry, depth + 1));
    }
    const entries = Object.entries(current);
    if (entries.length > 64) throw new TypeError('JSON object exceeds limit');
    const output = {};
    for (const [key, entry] of entries) {
      if (!key || key.length > 128) throw new TypeError('JSON key is invalid');
      if (redact && (SENSITIVE_KEY.test(key) || RAW_EVENT_KEY.test(key))) continue;
      output[key] = visit(entry, depth + 1);
    }
    return output;
  };
  const output = visit(value, 0);
  if (Buffer.byteLength(json(output)) > MAX_PAYLOAD_BYTES)
    throw new TypeError('JSON payload exceeds limit');
  return output;
}

function sanitizedEventPayload(value) {
  if (!plainObject(value)) return failure('EVENT_INVALID', 'Event payload must be a JSON object');
  try {
    return { ok: true, payload: boundedJson(value, { redact: true }) };
  } catch (error) {
    return failure('EVENT_INVALID', 'Event payload is invalid or exceeds the size limit');
  }
}

function sanitizedAuditDetail(value) {
  if (!plainObject(value)) return {};
  const seen = new WeakSet();
  const visit = (current, depth) => {
    if (depth > 3) return '[truncated]';
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'number') return Number.isFinite(current) ? current : null;
    if (typeof current === 'string') return current.slice(0, MAX_AUDIT_STRING);
    if (!current || typeof current !== 'object') return null;
    if (seen.has(current)) return '[CIRCULAR]';
    seen.add(current);
    if (Array.isArray(current)) return current.slice(0, 32).map((entry) => visit(entry, depth + 1));
    const output = {};
    for (const [key, entry] of Object.entries(current).slice(0, 32)) {
      if (!key || SENSITIVE_AUDIT_KEY.test(key)) continue;
      output[key] = visit(entry, depth + 1);
    }
    return output;
  };
  return visit(value, 0);
}

function workerRecord(row, projectIds = []) {
  return {
    workerId: row.worker_id,
    id: row.worker_id,
    displayName: row.display_name,
    tokenHash: row.token_hash,
    status: row.status,
    capabilities: parseJson(row.capabilities_json),
    projectIds: clone(projectIds),
    lastSeenAt: dbDate(row.last_heartbeat_at),
    lastHeartbeatAt: dbDate(row.last_heartbeat_at),
    tokenRotatedAt: dbDate(row.token_rotated_at),
    revokedAt: dbDate(row.revoked_at),
    createdAt: dbDate(row.created_at),
    updatedAt: dbDate(row.updated_at),
    version: Number(row.version),
  };
}

function projectRecord(row) {
  return {
    projectId: row.project_id,
    workerId: row.worker_id,
    createdAt: dbDate(row.created_at),
  };
}

function commandRecord(row) {
  return {
    commandId: row.command_id,
    workerId: row.worker_id,
    sequence: Number(row.sequence),
    kind: row.kind,
    payload: parseJson(row.payload_json),
    payloadHash: row.payload_hash,
    fingerprint: row.payload_hash,
    dedupeKey: row.dedupe_key,
    issuedBy: row.issued_by,
    issuedAt: dbDate(row.created_at),
    ackedAt: dbDate(row.acked_at),
    createdAt: dbDate(row.created_at),
    updatedAt: dbDate(row.updated_at),
  };
}

function eventRecord(row) {
  return {
    eventId: row.event_id,
    workerId: row.worker_id,
    dedupeKey: row.dedupe_key,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    runId: row.run_id,
    eventType: row.event_type,
    type: row.event_type,
    source: row.source ?? 'worker',
    payload: parseJson(
      row.sanitized_payload_json === undefined ? row.payload_json : row.sanitized_payload_json,
    ),
    payloadHash: row.worker_fingerprint ?? row.payload_hash,
    fingerprint: row.worker_fingerprint ?? row.payload_hash,
    occurredAt: dbDate(row.occurred_at),
    receivedAt: dbDate(row.received_at),
  };
}

function auditRecord(row) {
  return {
    workerAuditId: row.worker_audit_id,
    auditId: row.worker_audit_id,
    sequence: Number(row.sequence),
    workerId: row.worker_id,
    event: row.event,
    action: row.event,
    outcome: row.outcome,
    actorType: row.actor_type,
    actorId: row.actor_id,
    objectType: row.object_type,
    objectId: row.object_id,
    commandId: row.command_id,
    detail: parseJson(row.detail_json),
    createdAt: dbDate(row.created_at),
  };
}

function requestObject(identifier, patch = {}) {
  return identifier && typeof identifier === 'object' && !Array.isArray(identifier)
    ? identifier
    : { ...patch, workerId: identifier };
}

function explicitTime(input, fallback) {
  return normalizedIso(input?.at ?? input?.createdAt ?? fallback) ?? fallback;
}

export function createMysqlWorkerStore({ pool, clock = Date.now } = {}) {
  if (!pool || typeof pool.getConnection !== 'function' || typeof clock !== 'function')
    throw new TypeError('A MySQL pool and a clock function are required');

  const now = () => new Date(clock()).toISOString();
  const one = async (db, sql, parameters = []) => (await db.execute(sql, parameters))[0][0];
  const activeLeaseTokens = new Map();
  const leaseKey = (workerId, runId) => `${workerId}\u0000${runId}`;

  async function run(work, { write = false, duplicateCode = 'WORKER_CONFLICT' } = {}) {
    let db;
    let started = false;
    try {
      db = await pool.getConnection();
      if (write) {
        await db.beginTransaction();
        started = true;
      }
      const result = await work(db);
      if (write) {
        if (result?.ok || result?.[AUDITED_FAILURE]) await db.commit();
        else await db.rollback();
        started = false;
      }
      if (result?.[AUDITED_FAILURE]) {
        const { [AUDITED_FAILURE]: _ignored, ...detached } = result;
        return detached;
      }
      return result;
    } catch (error) {
      if (started && db) {
        try {
          await db.rollback();
        } catch {
          db.destroy();
          db = null;
        }
      }
      if (error.code === 'ER_DUP_ENTRY')
        return failure(duplicateCode, 'A worker record already exists');
      if (error.code === 'ER_NO_REFERENCED_ROW_2')
        return failure('WORKER_REFERENCE_NOT_FOUND', 'A referenced worker record was not found');
      return failure('WORKER_PERSISTENCE_FAILED', 'Worker persistence failed', {
        cause: error.code ?? null,
      });
    } finally {
      db?.release();
    }
  }

  const workerById = (db, workerId) =>
    one(db, 'SELECT * FROM worker WHERE worker_id = ?', [workerId]);
  const workerByIdForUpdate = (db, workerId) =>
    one(db, 'SELECT * FROM worker WHERE worker_id = ? FOR UPDATE', [workerId]);
  const commandById = (db, commandId) =>
    one(db, 'SELECT * FROM worker_command WHERE command_id = ?', [commandId]);
  const auditById = (db, auditId) =>
    one(db, 'SELECT * FROM worker_audit WHERE worker_audit_id = ?', [auditId]);

  async function insertAudit(
    db,
    {
      workerId = null,
      event,
      outcome = 'success',
      actorType = 'system',
      actorId = 'system',
      objectType = 'worker',
      objectId = workerId ?? 'unknown',
      commandId = null,
      detail = {},
      at = now(),
      auditId = `worker-audit-${randomUUID()}`,
    },
  ) {
    if (
      !AUDIT_EVENTS.has(event) ||
      !['success', 'failure'].includes(outcome) ||
      !['user', 'worker', 'system', 'channel'].includes(actorType) ||
      !nonEmpty(actorId, 256) ||
      !nonEmpty(objectType, 64) ||
      !nonEmpty(objectId, 128) ||
      !normalizedIso(at) ||
      (workerId != null && !fullId(workerId)) ||
      (commandId != null && !fullId(commandId))
    )
      throw Object.assign(new Error('Worker audit entry is invalid'), {
        code: 'WORKER_AUDIT_INVALID',
      });
    await db.execute(
      `INSERT INTO worker_audit (
         worker_audit_id, worker_id, event, outcome, actor_type, actor_id,
         object_type, object_id, command_id, detail_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        workerId,
        event,
        outcome,
        actorType,
        actorId,
        objectType,
        objectId,
        commandId,
        json(sanitizedAuditDetail(detail)),
        sqlDate(at),
      ],
    );
    return auditRecord(await auditById(db, auditId));
  }

  async function auditedFailure(db, result, audit) {
    await insertAudit(db, audit);
    return Object.assign(result, { [AUDITED_FAILURE]: true });
  }

  async function projectIdsFor(db, workerId) {
    const [rows] = await db.execute(
      'SELECT * FROM project_worker WHERE worker_id = ? ORDER BY project_id',
      [workerId],
    );
    return rows.map(projectRecord);
  }

  async function workerRecordWithProjects(db, row) {
    if (!row) return null;
    return workerRecord(
      row,
      (await projectIdsFor(db, row.worker_id)).map((project) => project.projectId),
    );
  }

  async function workerRecordsWithProjects(db, rows) {
    if (!rows.length) return [];
    const workerIds = rows.map((row) => row.worker_id);
    const [projects] = await db.execute(
      `SELECT project_id, worker_id FROM project_worker
       WHERE worker_id IN (${workerIds.map(() => '?').join(', ')})
       ORDER BY project_id`,
      workerIds,
    );
    const byWorker = new Map();
    for (const project of projects) {
      if (!byWorker.has(project.worker_id)) byWorker.set(project.worker_id, []);
      byWorker.get(project.worker_id).push(project.project_id);
    }
    return rows.map((row) => workerRecord(row, byWorker.get(row.worker_id) ?? []));
  }

  async function replaceWorkerProjects(db, workerId, rawProjectIds, at) {
    if (
      !Array.isArray(rawProjectIds) ||
      rawProjectIds.length > 100 ||
      rawProjectIds.some((projectId) => !validProjectId(projectId)) ||
      new Set(rawProjectIds).size !== rawProjectIds.length
    )
      return failure('WORKER_PROJECTS_INVALID', 'Worker project whitelist is invalid');
    const projectIds = [...rawProjectIds].sort();
    if (projectIds.length) {
      const [rows] = await db.execute(
        `SELECT project_id FROM project WHERE project_id IN (${projectIds.map(() => '?').join(', ')})
         FOR UPDATE`,
        projectIds,
      );
      const found = new Set(rows.map((row) => row.project_id));
      const missing = projectIds.filter((projectId) => !found.has(projectId));
      if (missing.length)
        return failure('WORKER_PROJECT_NOT_FOUND', 'A worker project was not found', {
          projectIds: missing,
        });
    }
    await db.execute('DELETE FROM project_worker WHERE worker_id = ?', [workerId]);
    for (const projectId of projectIds)
      await db.execute(
        'INSERT INTO project_worker (project_id, worker_id, created_at) VALUES (?, ?, ?)',
        [projectId, workerId, sqlDate(at)],
      );
    return { ok: true, projectIds };
  }

  async function findWorkerByTokenHash(tokenHash) {
    const normalized = normalizedHash(tokenHash);
    if (!normalized)
      return failure('WORKER_TOKEN_INVALID', 'A valid worker token hash is required');
    return run(async (db) => {
      const row = await one(
        db,
        "SELECT * FROM worker WHERE token_hash = ? AND status <> 'REVOKED'",
        [normalized],
      );
      if (!row) return failure('WORKER_AUTH_INVALID', 'Worker token is invalid');
      return {
        ok: true,
        worker: await workerRecordWithProjects(db, row),
      };
    });
  }

  const api = Object.freeze({
    clock,

    async createWorker(input = {}) {
      const workerId = fullId(input.workerId ?? input.id);
      const tokenHash = normalizedHash(input.tokenHash);
      const requestedStatus = input.status ?? 'OFFLINE';
      const status = requestedStatus === 'ACTIVE' ? 'OFFLINE' : requestedStatus;
      const projectIds = input.projectIds ?? [];
      if (
        !workerId ||
        !nonEmpty(input.displayName, 256) ||
        !tokenHash ||
        !STATUSES.has(status) ||
        status === 'REVOKED' ||
        !Array.isArray(projectIds) ||
        projectIds.length > 100 ||
        projectIds.some((projectId) => !validProjectId(projectId)) ||
        new Set(projectIds).size !== projectIds.length ||
        (input.capabilities !== undefined &&
          !Array.isArray(input.capabilities) &&
          !plainObject(input.capabilities))
      )
        return failure('WORKER_INVALID', 'Worker configuration is invalid');
      let capabilities;
      try {
        capabilities = boundedJson(input.capabilities ?? [], { maxString: 512 });
      } catch {
        return failure('WORKER_INVALID', 'Worker capabilities are invalid or too large');
      }
      const at = explicitTime(input, now());
      if (!normalizedIso(at)) return failure('WORKER_INVALID', 'Worker timestamp is invalid');
      return run(
        async (db) => {
          if (await workerById(db, workerId))
            return failure('WORKER_EXISTS', 'Worker id already exists');
          const sameToken = await one(db, 'SELECT worker_id FROM worker WHERE token_hash = ?', [
            tokenHash,
          ]);
          if (sameToken) return failure('WORKER_TOKEN_CONFLICT', 'Worker token already exists');
          await db.execute(
            `INSERT INTO worker (
               worker_id, display_name, token_hash, token_rotated_at, status,
               capabilities_json, last_heartbeat_at, revoked_at, created_at, updated_at, version
             ) VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, 1)`,
            [
              workerId,
              input.displayName,
              tokenHash,
              status,
              json(capabilities),
              sqlDate(input.lastHeartbeatAt),
              sqlDate(at),
              sqlDate(at),
            ],
          );
          const projects = await replaceWorkerProjects(db, workerId, projectIds, at);
          if (!projects.ok) return projects;
          await insertAudit(db, {
            workerId,
            event: 'WORKER_CREATED',
            actorType: input.actorType ?? 'system',
            actorId: input.actorId ?? 'system',
            objectType: 'worker',
            objectId: workerId,
            detail: { status, projectCount: projectIds.length },
            at,
          });
          return {
            ok: true,
            worker: await workerRecordWithProjects(db, await workerById(db, workerId)),
          };
        },
        { write: true, duplicateCode: 'WORKER_EXISTS' },
      );
    },

    findWorkerByTokenHash,
    getWorkerByTokenHash: findWorkerByTokenHash,

    async getWorker(workerId) {
      if (!fullId(workerId)) return failure('WORKER_ID_INVALID', 'A worker id is required');
      return run(async (db) => {
        const row = await workerById(db, workerId);
        if (!row) return failure('WORKER_NOT_FOUND', 'Worker was not found');
        return { ok: true, worker: await workerRecordWithProjects(db, row) };
      });
    },

    async updateWorker(workerIdOrInput, patch = {}) {
      const request = requestObject(workerIdOrInput, patch);
      const input = request.patch ?? request.worker ?? request;
      const workerId = fullId(request.workerId ?? input.workerId ?? input.id);
      const expectedVersion = request.expectedVersion ?? input.expectedVersion;
      const allowed = new Set([
        'workerId',
        'id',
        'expectedVersion',
        'displayName',
        'tokenHash',
        'status',
        'capabilities',
        'projectIds',
        'lastSeenAt',
        'lastHeartbeatAt',
        'revokedAt',
        'actorId',
        'actorType',
        'updatedAt',
      ]);
      if (
        !workerId ||
        !plainObject(input) ||
        Object.keys(input).some((key) => !allowed.has(key)) ||
        (input.displayName !== undefined && !nonEmpty(input.displayName, 256)) ||
        (input.status !== undefined &&
          !STATUSES.has(input.status === 'ACTIVE' ? 'OFFLINE' : input.status)) ||
        (input.tokenHash !== undefined && !normalizedHash(input.tokenHash)) ||
        (input.capabilities !== undefined &&
          !Array.isArray(input.capabilities) &&
          !plainObject(input.capabilities)) ||
        (input.lastSeenAt !== undefined && !normalizedIso(input.lastSeenAt)) ||
        (input.lastHeartbeatAt !== undefined && !normalizedIso(input.lastHeartbeatAt)) ||
        (input.revokedAt !== undefined && !normalizedIso(input.revokedAt)) ||
        (input.projectIds !== undefined &&
          (!Array.isArray(input.projectIds) ||
            input.projectIds.length > 100 ||
            input.projectIds.some((projectId) => !validProjectId(projectId)) ||
            new Set(input.projectIds).size !== input.projectIds.length))
      )
        return failure('WORKER_INVALID', 'Worker update is invalid');
      let capabilities;
      if (input.capabilities !== undefined) {
        try {
          capabilities = boundedJson(input.capabilities, { maxString: 512 });
        } catch {
          return failure('WORKER_INVALID', 'Worker capabilities are invalid or too large');
        }
      }
      const at = explicitTime(input, now());
      const tokenHash = input.tokenHash === undefined ? null : normalizedHash(input.tokenHash);
      return run(
        async (db) => {
          const current = await workerByIdForUpdate(db, workerId);
          if (!current) return failure('WORKER_NOT_FOUND', 'Worker was not found');
          if (expectedVersion !== undefined && Number(expectedVersion) !== Number(current.version))
            return failure('WORKER_VERSION_CONFLICT', 'Worker version changed');
          const rawStatus = input.status ?? current.status;
          const nextStatus = rawStatus === 'ACTIVE' ? 'OFFLINE' : rawStatus;
          if (!STATUSES.has(nextStatus))
            return failure('WORKER_INVALID', 'Worker status is invalid');
          if (current.status === 'REVOKED' && nextStatus !== 'REVOKED')
            return failure('WORKER_REVOKED', 'A revoked worker cannot be updated');
          if (tokenHash && tokenHash !== current.token_hash) {
            const collision = await one(db, 'SELECT worker_id FROM worker WHERE token_hash = ?', [
              tokenHash,
            ]);
            if (collision) return failure('WORKER_TOKEN_EXISTS', 'Worker token already exists');
          }
          if (input.projectIds !== undefined) {
            const projects = await replaceWorkerProjects(db, workerId, input.projectIds, at);
            if (!projects.ok) return projects;
          }
          const tokenChanged = tokenHash !== null && tokenHash !== current.token_hash;
          const lastSeen =
            input.lastSeenAt ??
            input.lastHeartbeatAt ??
            (current.last_heartbeat_at == null ? null : dbDate(current.last_heartbeat_at));
          const revokedAt =
            nextStatus === 'REVOKED' ? (input.revokedAt ?? dbDate(current.revoked_at) ?? at) : null;
          const [updated] = await db.execute(
            `UPDATE worker
             SET display_name = ?, token_hash = ?, token_rotated_at = ?, status = ?,
                 capabilities_json = ?, last_heartbeat_at = ?, revoked_at = ?,
                 updated_at = ?, version = version + 1
             WHERE worker_id = ? AND version = ?`,
            [
              input.displayName ?? current.display_name,
              tokenChanged ? tokenHash : current.token_hash,
              tokenChanged ? sqlDate(at) : sqlDate(dbDate(current.token_rotated_at)),
              nextStatus,
              capabilities === undefined ? current.capabilities_json : json(capabilities),
              sqlDate(lastSeen),
              sqlDate(revokedAt),
              sqlDate(at),
              workerId,
              Number(current.version),
            ],
          );
          if (updated.affectedRows !== 1)
            return failure('WORKER_VERSION_CONFLICT', 'Worker version changed');
          await insertAudit(db, {
            workerId,
            event:
              nextStatus === 'REVOKED'
                ? 'WORKER_REVOKED'
                : tokenChanged
                  ? 'WORKER_TOKEN_ROTATED'
                  : 'WORKER_UPDATED',
            actorType: input.actorType ?? 'system',
            actorId: input.actorId ?? 'system',
            detail: {
              status: nextStatus,
              tokenRotated: tokenChanged,
              projectCount: input.projectIds?.length ?? undefined,
            },
            at,
          });
          return {
            ok: true,
            worker: await workerRecordWithProjects(db, await workerById(db, workerId)),
          };
        },
        { write: true, duplicateCode: 'WORKER_VERSION_CONFLICT' },
      );
    },

    async rotateWorkerToken(workerIdOrInput, tokenHashArgument, options = {}) {
      const input =
        workerIdOrInput && typeof workerIdOrInput === 'object'
          ? workerIdOrInput
          : { ...options, workerId: workerIdOrInput, tokenHash: tokenHashArgument };
      const workerId = fullId(input.workerId ?? input.id);
      const tokenHash = normalizedHash(input.tokenHash ?? input.newTokenHash);
      if (!workerId || !tokenHash)
        return failure('WORKER_TOKEN_INVALID', 'A worker id and token hash are required');
      const at = explicitTime(input, now());
      return run(
        async (db) => {
          const current = await workerByIdForUpdate(db, workerId);
          if (!current) return failure('WORKER_NOT_FOUND', 'Worker was not found');
          if (current.status === 'REVOKED')
            return failure('WORKER_REVOKED', 'A revoked worker cannot rotate credentials');
          if (
            input.expectedVersion !== undefined &&
            Number(input.expectedVersion) !== Number(current.version)
          )
            return failure('WORKER_VERSION_CONFLICT', 'Worker version changed');
          if (current.token_hash === tokenHash)
            return failure('WORKER_TOKEN_UNCHANGED', 'The replacement token hash is unchanged');
          const collision = await one(db, 'SELECT worker_id FROM worker WHERE token_hash = ?', [
            tokenHash,
          ]);
          if (collision) return failure('WORKER_TOKEN_CONFLICT', 'Worker token already exists');
          const [updated] = await db.execute(
            `UPDATE worker
             SET token_hash = ?, token_rotated_at = ?, status = 'OFFLINE',
                 updated_at = ?, version = version + 1
             WHERE worker_id = ? AND version = ? AND status <> 'REVOKED'`,
            [tokenHash, sqlDate(at), sqlDate(at), workerId, Number(current.version)],
          );
          if (updated.affectedRows !== 1)
            return failure('WORKER_VERSION_CONFLICT', 'Worker version changed');
          await insertAudit(db, {
            workerId,
            event: 'WORKER_TOKEN_ROTATED',
            actorId: input.actorId ?? 'system',
            detail: { status: 'OFFLINE' },
            at,
          });
          return {
            ok: true,
            worker: await workerRecordWithProjects(db, await workerById(db, workerId)),
            previousTokenRevoked: true,
          };
        },
        { write: true, duplicateCode: 'WORKER_TOKEN_CONFLICT' },
      );
    },

    async revokeWorker(workerIdOrInput, options = {}) {
      const input = requestObject(workerIdOrInput, options);
      const workerId = fullId(input.workerId ?? input.id);
      if (!workerId) return failure('WORKER_ID_INVALID', 'A worker id is required');
      const at = explicitTime(input, now());
      return run(
        async (db) => {
          const current = await workerByIdForUpdate(db, workerId);
          if (!current) return failure('WORKER_NOT_FOUND', 'Worker was not found');
          if (current.status === 'REVOKED')
            return {
              ok: true,
              worker: await workerRecordWithProjects(db, current),
              revoked: false,
              duplicate: true,
            };
          if (
            input.expectedVersion !== undefined &&
            Number(input.expectedVersion) !== Number(current.version)
          )
            return failure('WORKER_VERSION_CONFLICT', 'Worker version changed');
          const [updated] = await db.execute(
            `UPDATE worker
           SET status = 'REVOKED', revoked_at = ?, updated_at = ?, version = version + 1
           WHERE worker_id = ? AND version = ?`,
            [sqlDate(at), sqlDate(at), workerId, Number(current.version)],
          );
          if (updated.affectedRows !== 1)
            return failure('WORKER_VERSION_CONFLICT', 'Worker version changed');
          await insertAudit(db, {
            workerId,
            event: 'WORKER_REVOKED',
            actorId: input.actorId ?? 'system',
            detail: { previousStatus: current.status },
            at,
          });
          return {
            ok: true,
            worker: await workerRecordWithProjects(db, await workerById(db, workerId)),
            revoked: true,
            duplicate: false,
          };
        },
        { write: true },
      );
    },

    async setWorkerProjects(workerIdOrInput, projectIdsArgument, options = {}) {
      const input =
        workerIdOrInput && typeof workerIdOrInput === 'object'
          ? workerIdOrInput
          : { ...options, workerId: workerIdOrInput, projectIds: projectIdsArgument };
      const workerId = fullId(input.workerId ?? input.id);
      const source = input.projectIds ?? input.projects;
      if (!workerId || !Array.isArray(source) || source.length > 100)
        return failure('WORKER_PROJECTS_INVALID', 'Worker project whitelist is invalid');
      const projectIds = [...new Set(source)];
      if (projectIds.some((projectId) => !validProjectId(projectId)))
        return failure('WORKER_PROJECTS_INVALID', 'Worker project id is invalid');
      projectIds.sort();
      const at = explicitTime(input, now());
      return run(
        async (db) => {
          const current = await workerByIdForUpdate(db, workerId);
          if (!current) return failure('WORKER_NOT_FOUND', 'Worker was not found');
          if (current.status === 'REVOKED')
            return failure('WORKER_REVOKED', 'A revoked worker cannot receive project access');
          if (
            input.expectedVersion !== undefined &&
            Number(input.expectedVersion) !== Number(current.version)
          )
            return failure('WORKER_VERSION_CONFLICT', 'Worker version changed');
          if (projectIds.length) {
            const placeholders = projectIds.map(() => '?').join(', ');
            const [rows] = await db.execute(
              `SELECT project_id FROM project WHERE project_id IN (${placeholders}) FOR UPDATE`,
              projectIds,
            );
            const found = new Set(rows.map((row) => row.project_id));
            const missing = projectIds.filter((projectId) => !found.has(projectId));
            if (missing.length)
              return failure('WORKER_PROJECT_NOT_FOUND', 'A worker project was not found', {
                projectIds: missing,
              });
          }
          await db.execute('DELETE FROM project_worker WHERE worker_id = ?', [workerId]);
          for (const projectId of projectIds)
            await db.execute(
              'INSERT INTO project_worker (project_id, worker_id, created_at) VALUES (?, ?, ?)',
              [projectId, workerId, sqlDate(at)],
            );
          const [updated] = await db.execute(
            `UPDATE worker SET updated_at = ?, version = version + 1
           WHERE worker_id = ? AND version = ?`,
            [sqlDate(at), workerId, Number(current.version)],
          );
          if (updated.affectedRows !== 1)
            return failure('WORKER_VERSION_CONFLICT', 'Worker version changed');
          await insertAudit(db, {
            workerId,
            event: 'WORKER_PROJECTS_CHANGED',
            actorId: input.actorId ?? 'system',
            detail: { projectCount: projectIds.length, projectIds },
            at,
          });
          return {
            ok: true,
            projectIds,
            projects: await projectIdsFor(db, workerId),
            worker: await workerRecordWithProjects(db, await workerById(db, workerId)),
          };
        },
        { write: true },
      );
    },

    async listWorkerProjects(workerId) {
      if (!fullId(workerId)) return failure('WORKER_ID_INVALID', 'A worker id is required');
      return run(async (db) => {
        if (!(await workerById(db, workerId)))
          return failure('WORKER_NOT_FOUND', 'Worker was not found');
        const projects = await projectIdsFor(db, workerId);
        return {
          ok: true,
          projectIds: projects.map((project) => project.projectId),
          projects,
        };
      });
    },

    async listWorkers(filter = {}) {
      const limit = integer(filter.limit) ?? 200;
      if (limit < 1 || limit > 1000 || (filter.status != null && !STATUSES.has(filter.status)))
        return failure('WORKER_FILTER_INVALID', 'Worker filter is invalid');
      if (filter.projectId != null && !validProjectId(filter.projectId))
        return failure('WORKER_FILTER_INVALID', 'Worker project filter is invalid');
      const clauses = [];
      const parameters = [];
      if (filter.status) {
        clauses.push('w.status = ?');
        parameters.push(filter.status);
      }
      if (filter.projectId) {
        clauses.push(
          'EXISTS (SELECT 1 FROM project_worker pw WHERE pw.worker_id = w.worker_id AND pw.project_id = ?)',
        );
        parameters.push(filter.projectId);
      }
      parameters.push(limit);
      return run(async (db) => {
        const [rows] = await db.execute(
          `SELECT w.* FROM worker w
           ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
           ORDER BY w.created_at, w.worker_id LIMIT ?`,
          parameters,
        );
        return { ok: true, workers: await workerRecordsWithProjects(db, rows) };
      });
    },

    async enqueueCommand(input = {}) {
      const workerId = fullId(input.workerId);
      const commandId = fullId(input.commandId ?? `cmd-${randomUUID()}`);
      const kind = typeof input.kind === 'string' ? input.kind : null;
      const dedupeKey = normalizedDedupe(input.dedupeKey);
      if (!workerId || !commandId || !kind || !dedupeKey)
        return failure('WORKER_COMMAND_INVALID', 'Worker command is invalid');
      const checked = normalizeCommand({ kind, payload: input.payload ?? {} });
      if (!checked.ok) {
        return run(
          async (db) => {
            const worker = await workerByIdForUpdate(db, workerId);
            return auditedFailure(db, checked, {
              workerId: worker ? workerId : null,
              event: 'WORKER_COMMAND_REJECTED',
              outcome: 'failure',
              actorType: input.actorType ?? 'system',
              actorId: input.actorId ?? 'system',
              objectType: 'worker',
              objectId: workerId,
              detail: { reason: checked.code, kind: kind.slice(0, 64) },
              at: explicitTime(input, now()),
            });
          },
          { write: true },
        );
      }
      const payload = checked.value;
      const payloadHash =
        normalizedHash(input.fingerprint) ?? commandFingerprint({ kind, payload });
      const at = explicitTime(input, now());
      return run(
        async (db) => {
          const worker = await workerByIdForUpdate(db, workerId);
          if (!worker) return failure('WORKER_NOT_FOUND', 'Worker was not found');
          if (worker.status === 'REVOKED')
            return failure('WORKER_REVOKED', 'A revoked worker cannot receive commands');
          const existing = await one(
            db,
            `SELECT * FROM worker_command
             WHERE worker_id = ? AND dedupe_key = ? FOR UPDATE`,
            [workerId, dedupeKey],
          );
          if (existing) {
            if (existing.kind === kind && existing.payload_hash === payloadHash)
              return {
                ok: true,
                command: commandRecord(existing),
                duplicate: true,
              };
            return failure(
              'WORKER_COMMAND_DEDUPE_CONFLICT',
              'Command dedupe key was reused with different content',
            );
          }
          if (await commandById(db, commandId))
            return failure('WORKER_COMMAND_EXISTS', 'Worker command id already exists');
          const next = await one(
            db,
            `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
             FROM worker_command WHERE worker_id = ?`,
            [workerId],
          );
          const sequence = Number(next.sequence);
          if (input.sequence !== undefined && Number(input.sequence) !== sequence)
            return failure('WORKER_COMMAND_SEQUENCE_CONFLICT', 'Worker command sequence is stale');
          await db.execute(
            `INSERT INTO worker_command (
               command_id, worker_id, sequence, kind, payload_json, payload_hash,
               dedupe_key, issued_by, acked_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
            [
              commandId,
              workerId,
              sequence,
              kind,
              json(payload),
              payloadHash,
              dedupeKey,
              input.actorId ?? 'system',
              sqlDate(at),
              sqlDate(at),
            ],
          );
          await insertAudit(db, {
            workerId,
            event: 'WORKER_COMMAND_ENQUEUED',
            actorType: input.actorType ?? 'system',
            actorId: input.actorId ?? 'system',
            objectType: 'command',
            objectId: commandId,
            commandId,
            detail: { kind, sequence },
            at,
          });
          return {
            ok: true,
            command: commandRecord(await commandById(db, commandId)),
            duplicate: false,
          };
        },
        { write: true, duplicateCode: 'WORKER_COMMAND_CONFLICT' },
      );
    },

    async listCommands(filter = {}) {
      if (!fullId(filter.workerId))
        return failure('COMMAND_FILTER_INVALID', 'A worker id is required');
      const limit = integer(filter.limit) ?? 50;
      const after = filter.after ?? filter.afterSequence ?? 0;
      if (limit < 1 || limit > 100 || !Number.isSafeInteger(after) || after < 0)
        return failure('WORKER_CURSOR_INVALID', 'Command filter is invalid');
      const clauses = ['worker_id = ?'];
      const parameters = [filter.workerId];
      if (after > 0) {
        clauses.push('sequence > ?');
        parameters.push(after);
      }
      if (filter.includeAcked !== true) clauses.push('acked_at IS NULL');
      parameters.push(limit);
      return run(async (db) => {
        if (!(await workerById(db, filter.workerId)))
          return failure('WORKER_NOT_FOUND', 'Worker was not found');
        const [rows] = await db.execute(
          `SELECT * FROM worker_command
           WHERE ${clauses.join(' AND ')}
           ORDER BY sequence LIMIT ?`,
          parameters,
        );
        const commands = rows.map(commandRecord);
        return {
          ok: true,
          commands,
          cursor: commands.length ? commands.at(-1).sequence : after,
        };
      });
    },

    async ackCommand(workerIdOrInput, commandIdArgument, options = {}) {
      const input =
        workerIdOrInput && typeof workerIdOrInput === 'object'
          ? workerIdOrInput
          : { ...options, workerId: workerIdOrInput, commandId: commandIdArgument };
      const workerId = fullId(input.workerId);
      const commandId = fullId(input.commandId);
      if (!workerId || !commandId)
        return failure('WORKER_COMMAND_INVALID', 'Worker and command ids are required');
      const at = explicitTime(input, now());
      return run(
        async (db) => {
          const worker = await workerByIdForUpdate(db, workerId);
          if (!worker) return failure('WORKER_NOT_FOUND', 'Worker was not found');
          if (worker.status === 'REVOKED')
            return failure('WORKER_REVOKED', 'A revoked worker cannot acknowledge commands');
          const command = await one(
            db,
            'SELECT * FROM worker_command WHERE command_id = ? FOR UPDATE',
            [commandId],
          );
          if (!command || command.worker_id !== workerId)
            return failure('WORKER_COMMAND_NOT_FOUND', 'Worker command was not found');
          if (command.acked_at != null)
            return {
              ok: true,
              command: commandRecord(command),
              acked: false,
              duplicate: true,
            };
          await db.execute(
            `UPDATE worker_command SET acked_at = ?, updated_at = ?
           WHERE command_id = ? AND acked_at IS NULL`,
            [sqlDate(at), sqlDate(at), commandId],
          );
          await insertAudit(db, {
            workerId,
            event: 'WORKER_COMMAND_ACKED',
            actorType: 'worker',
            actorId: input.actorId ?? workerId,
            objectType: 'command',
            objectId: commandId,
            commandId,
            detail: { kind: command.kind, sequence: Number(command.sequence) },
            at,
          });
          return {
            ok: true,
            command: commandRecord(await commandById(db, commandId)),
            acked: true,
            duplicate: false,
          };
        },
        { write: true },
      );
    },

    async appendEvent(input = {}) {
      const workerId = fullId(input.workerId);
      const eventId = fullId(input.eventId);
      const projectId = validProjectId(input.projectId) ? input.projectId : null;
      const rawDedupeKey = input.dedupeKey ?? input.eventId;
      const dedupeKey = normalizedDedupe(rawDedupeKey);
      const eventType = input.eventType ?? input.type;
      const occurredAt = normalizedIso(input.occurredAt);
      const receivedAt = normalizedIso(input.receivedAt ?? input.at);
      if (
        !workerId ||
        !eventId ||
        !projectId ||
        !dedupeKey ||
        !nonEmpty(eventType, 128) ||
        !occurredAt ||
        !receivedAt ||
        (input.workItemId != null && !fullId(input.workItemId)) ||
        (input.runId != null && !fullId(input.runId))
      )
        return failure('EVENT_INVALID', 'Worker event is invalid');
      const sanitized = sanitizedEventPayload(input.payload ?? {});
      if (!sanitized.ok) return sanitized;
      const payloadHash =
        normalizedHash(input.fingerprint) ??
        eventFingerprint({
          eventId,
          dedupeKey: rawDedupeKey,
          type: eventType,
          projectId,
          workItemId: input.workItemId ?? null,
          runId: input.runId ?? null,
          occurredAt,
          payload: sanitized.payload,
        });
      const evidenceHash = sha256({
        eventId,
        projectId,
        workItemId: input.workItemId ?? null,
        runId: input.runId ?? null,
        eventType,
        source: 'worker',
        payload: sanitized.payload,
        occurredAt,
        receivedAt,
      });
      return run(
        async (db) => {
          const worker = await workerByIdForUpdate(db, workerId);
          if (!worker) return failure('WORKER_NOT_FOUND', 'Worker was not found');
          if (worker.status === 'REVOKED')
            return failure('WORKER_REVOKED', 'A revoked worker cannot submit events');
          const authorized = await one(
            db,
            'SELECT project_id FROM project_worker WHERE worker_id = ? AND project_id = ?',
            [workerId, projectId],
          );
          if (!authorized)
            return auditedFailure(
              db,
              failure('WORKER_PROJECT_FORBIDDEN', 'Worker is not authorized for this project'),
              {
                workerId,
                event: 'WORKER_EVENT_REJECTED',
                outcome: 'failure',
                actorId: workerId,
                detail: { reason: 'PROJECT_FORBIDDEN', eventType },
                at: receivedAt,
              },
            );
          const existing = await one(
            db,
            'SELECT * FROM worker_event WHERE worker_id = ? AND dedupe_key = ? FOR UPDATE',
            [workerId, dedupeKey],
          );
          if (existing) {
            if (existing.event_id === eventId && existing.payload_hash === payloadHash) {
              const row = await one(
                db,
                `SELECT e.*, we.worker_id, we.dedupe_key,
                      we.payload_hash AS worker_fingerprint,
                      we.sanitized_payload_json
               FROM evidence_event e JOIN worker_event we USING (event_id)
               WHERE e.event_id = ?`,
                [eventId],
              );
              return { ok: true, event: eventRecord(row), duplicate: true };
            }
            return failure(
              'EVENT_DEDUPE_CONFLICT',
              'Event dedupe key was reused with different content',
            );
          }
          if (await one(db, 'SELECT event_id FROM evidence_event WHERE event_id = ?', [eventId]))
            return failure('EVENT_CONFLICT', 'Event id was reused with different content');
          if (input.workItemId) {
            const workItem = await one(
              db,
              'SELECT project_id FROM work_item WHERE work_item_id = ?',
              [input.workItemId],
            );
            if (!workItem) return failure('WORK_ITEM_NOT_FOUND', 'WorkItem was not found');
            if (workItem.project_id !== projectId)
              return failure('EVENT_PROJECT_MISMATCH', 'Event project does not match WorkItem');
          }
          if (input.runId) {
            const execution = await one(
              db,
              'SELECT work_item_id FROM execution_run WHERE run_id = ?',
              [input.runId],
            );
            if (!execution) return failure('RUN_NOT_FOUND', 'Execution run was not found');
            if (execution.work_item_id !== input.workItemId)
              return failure('EVENT_RUN_MISMATCH', 'Event run does not match WorkItem');
          }
          await db.execute(
            `INSERT INTO evidence_event (
             event_id, project_id, work_item_id, run_id, event_type, source,
             payload_json, payload_hash, occurred_at, received_at
           ) VALUES (?, ?, ?, ?, ?, 'worker', ?, ?, ?, ?)`,
            [
              eventId,
              projectId,
              input.workItemId ?? null,
              input.runId ?? null,
              eventType,
              json(sanitized.payload),
              evidenceHash,
              sqlDate(occurredAt),
              sqlDate(receivedAt),
            ],
          );
          await db.execute(
            `INSERT INTO worker_event (
             event_id, worker_id, dedupe_key, event_type, payload_hash,
             sanitized_payload_json, occurred_at, received_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              eventId,
              workerId,
              dedupeKey,
              eventType,
              payloadHash,
              json(sanitized.payload),
              sqlDate(occurredAt),
              sqlDate(receivedAt),
            ],
          );
          await insertAudit(db, {
            workerId,
            event: 'WORKER_EVENT_ACCEPTED',
            actorType: 'worker',
            actorId: workerId,
            objectType: 'worker',
            objectId: workerId,
            detail: { eventType },
            at: receivedAt,
          });
          const row = await one(
            db,
            `SELECT e.*, we.worker_id, we.dedupe_key,
                  we.payload_hash AS worker_fingerprint,
                  we.sanitized_payload_json
           FROM evidence_event e JOIN worker_event we USING (event_id)
           WHERE e.event_id = ?`,
            [eventId],
          );
          return { ok: true, event: eventRecord(row), duplicate: false };
        },
        { write: true, duplicateCode: 'EVENT_CONFLICT' },
      );
    },

    async appendEvents({ workerId, events } = {}) {
      if (!fullId(workerId) || !Array.isArray(events) || events.length < 1 || events.length > 100)
        return failure('WORKER_EVENT_INVALID', 'Event batch is invalid');
      const accepted = [];
      const duplicateEvents = [];
      for (const event of events) {
        const stored = await api.appendEvent({
          ...event,
          workerId,
          eventType: event.eventType ?? event.type,
          receivedAt: event.receivedAt ?? now(),
        });
        if (!stored.ok) return stored;
        if (stored.duplicate) duplicateEvents.push(stored.event);
        else accepted.push(stored.event);
      }
      return {
        ok: true,
        accepted,
        duplicates: duplicateEvents.map((event) => event.eventId),
        duplicateEvents,
        events: [...accepted, ...duplicateEvents],
      };
    },

    async listEvents(filter = {}) {
      if (!fullId(filter.workerId))
        return failure('EVENT_FILTER_INVALID', 'A worker id is required');
      const limit = integer(filter.limit) ?? 500;
      if (
        limit < 1 ||
        limit > 1000 ||
        (filter.projectId != null && !validProjectId(filter.projectId))
      )
        return failure('EVENT_FILTER_INVALID', 'Event filter is invalid');
      const clauses = ['we.worker_id = ?'];
      const parameters = [filter.workerId];
      if (filter.projectId) {
        clauses.push('e.project_id = ?');
        parameters.push(filter.projectId);
      }
      if (filter.since != null) {
        if (!normalizedIso(filter.since))
          return failure('EVENT_FILTER_INVALID', 'Event since filter is invalid');
        clauses.push('e.received_at >= ?');
        parameters.push(sqlDate(filter.since));
      }
      parameters.push(limit);
      return run(async (db) => {
        const [rows] = await db.execute(
          `SELECT e.*, we.worker_id, we.dedupe_key,
                  we.payload_hash AS worker_fingerprint,
                  we.sanitized_payload_json
           FROM worker_event we JOIN evidence_event e USING (event_id)
           WHERE ${clauses.join(' AND ')}
           ORDER BY e.received_at, e.event_id LIMIT ?`,
          parameters,
        );
        return { ok: true, events: rows.map(eventRecord) };
      });
    },

    async appendWorkerAudit(input = {}) {
      let workerId = input.workerId == null ? null : fullId(input.workerId);
      const commandId = input.commandId == null ? null : fullId(input.commandId);
      const event = input.event ?? input.action;
      const outcome = input.outcome === 'failure' ? 'failure' : 'success';
      const actorType =
        input.actorType ??
        (input.objectType === 'worker' ? 'user' : workerId == null ? 'system' : 'worker');
      const actorId = input.actorId ?? workerId ?? 'system';
      const objectType = input.objectType ?? (workerId ? 'worker' : 'system');
      const objectId = input.objectId ?? workerId ?? 'unknown';
      const at = explicitTime(input, now());
      if (!workerId && objectType === 'worker' && fullId(objectId)) workerId = objectId;
      if (!workerId && actorType === 'worker' && fullId(actorId)) workerId = actorId;
      if (
        (input.workerId != null && !workerId) ||
        (input.commandId != null && !commandId) ||
        !AUDIT_EVENTS.has(event) ||
        !['user', 'worker', 'system', 'channel'].includes(actorType) ||
        !nonEmpty(actorId, 256) ||
        !nonEmpty(objectType, 64) ||
        !nonEmpty(objectId, 128) ||
        !normalizedIso(at)
      )
        return failure('WORKER_AUDIT_INVALID', 'Worker audit entry is invalid');
      return run(
        async (db) => {
          if (workerId && !(await workerById(db, workerId)))
            return failure('WORKER_NOT_FOUND', 'Worker was not found');
          if (commandId) {
            const command = await commandById(db, commandId);
            if (!command || (workerId && command.worker_id !== workerId))
              return failure('WORKER_COMMAND_NOT_FOUND', 'Worker command was not found');
            workerId ??= command.worker_id;
          }
          if (!workerId && objectType === 'command' && fullId(objectId)) {
            const command = await commandById(db, objectId);
            workerId = command?.worker_id ?? null;
          }
          return {
            ok: true,
            audit: await insertAudit(db, {
              workerId,
              event,
              outcome,
              actorType,
              actorId,
              objectType,
              objectId,
              commandId,
              detail: input.detail,
              at,
              auditId: input.workerAuditId ?? input.auditId ?? undefined,
            }),
          };
        },
        { write: true, duplicateCode: 'WORKER_AUDIT_DUPLICATE' },
      );
    },

    async listWorkerAudit(filter = {}) {
      const limit = integer(filter.limit) ?? 500;
      const action = filter.action ?? filter.event;
      if (
        limit < 1 ||
        limit > 1000 ||
        (filter.workerId != null && !fullId(filter.workerId)) ||
        (action != null && !AUDIT_EVENTS.has(action))
      )
        return failure('WORKER_AUDIT_FILTER_INVALID', 'Worker audit filter is invalid');
      const clauses = [];
      const parameters = [];
      if (filter.workerId) {
        clauses.push('(worker_id = ? OR object_id = ? OR actor_id = ?)');
        parameters.push(filter.workerId, filter.workerId, filter.workerId);
      }
      if (action) {
        clauses.push('event = ?');
        parameters.push(action);
      }
      if (filter.since != null) {
        if (!normalizedIso(filter.since))
          return failure('WORKER_AUDIT_FILTER_INVALID', 'Worker audit since filter is invalid');
        clauses.push('created_at >= ?');
        parameters.push(sqlDate(filter.since));
      }
      if (filter.until != null) {
        if (!normalizedIso(filter.until))
          return failure('WORKER_AUDIT_FILTER_INVALID', 'Worker audit until filter is invalid');
        clauses.push('created_at <= ?');
        parameters.push(sqlDate(filter.until));
      }
      parameters.push(limit);
      return run(async (db) => {
        const [rows] = await db.execute(
          `SELECT * FROM (
             SELECT * FROM worker_audit
             ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
             ORDER BY sequence DESC LIMIT ?
           ) recent_worker_audit ORDER BY sequence`,
          parameters,
        );
        return { ok: true, audits: rows.map(auditRecord) };
      });
    },

    async markWorkerSeen(workerIdOrInput, options = {}) {
      const input = requestObject(workerIdOrInput, options);
      const workerId = fullId(input.workerId ?? input.id);
      if (!workerId) return failure('WORKER_ID_INVALID', 'A worker id is required');
      const at = explicitTime(input, now());
      return run(
        async (db) => {
          const current = await workerByIdForUpdate(db, workerId);
          if (!current) return failure('WORKER_NOT_FOUND', 'Worker was not found');
          if (current.status === 'REVOKED')
            return failure('WORKER_REVOKED', 'A revoked worker cannot reconnect');
          if (
            input.expectedVersion !== undefined &&
            Number(input.expectedVersion) !== Number(current.version)
          )
            return failure('WORKER_VERSION_CONFLICT', 'Worker version changed');
          const [updated] = await db.execute(
            `UPDATE worker
           SET status = 'ONLINE', last_heartbeat_at = ?, updated_at = ?, version = version + 1
           WHERE worker_id = ? AND version = ? AND status <> 'REVOKED'`,
            [sqlDate(at), sqlDate(at), workerId, Number(current.version)],
          );
          if (updated.affectedRows !== 1)
            return failure('WORKER_VERSION_CONFLICT', 'Worker version changed');
          await insertAudit(db, {
            workerId,
            event: 'WORKER_SEEN',
            actorType: 'worker',
            actorId: input.actorId ?? workerId,
            objectType: 'worker',
            objectId: workerId,
            detail: { previousStatus: current.status },
            at,
          });
          return {
            ok: true,
            worker: await workerRecordWithProjects(db, await workerById(db, workerId)),
          };
        },
        { write: true, duplicateCode: 'WORKER_VERSION_CONFLICT' },
      );
    },

    async markOfflineBefore(input = {}) {
      const cutoff = normalizedIso(input.before ?? input.at);
      if (!cutoff) return failure('WORKER_OFFLINE_INVALID', 'An offline cutoff is required');
      const at = explicitTime(input, now());
      return run(
        async (db) => {
          const [rows] = await db.execute(
            `SELECT * FROM worker
           WHERE status IN ('ONLINE','INTERRUPTED','SUSPECT')
             AND (last_heartbeat_at IS NULL OR last_heartbeat_at < ?)
           ORDER BY worker_id FOR UPDATE`,
            [sqlDate(cutoff)],
          );
          for (const row of rows) {
            await db.execute(
              `UPDATE worker
             SET status = 'OFFLINE', updated_at = ?, version = version + 1
             WHERE worker_id = ? AND version = ?`,
              [sqlDate(at), row.worker_id, Number(row.version)],
            );
            await insertAudit(db, {
              workerId: row.worker_id,
              event: 'WORKER_OFFLINE',
              actorId: input.actorId ?? 'system',
              detail: {
                previousStatus: row.status,
                lastHeartbeatAt: dbDate(row.last_heartbeat_at),
              },
              at,
            });
          }
          const [updated] = await db.execute(
            `SELECT * FROM worker WHERE worker_id IN (${rows.map(() => '?').join(', ') || 'NULL'})
           ORDER BY worker_id`,
            rows.map((row) => row.worker_id),
          );
          return {
            ok: true,
            count: rows.length,
            workers: await workerRecordsWithProjects(db, updated),
          };
        },
        { write: true },
      );
    },

    async setLease({ workerId, lease } = {}) {
      if (
        !fullId(workerId) ||
        !plainObject(lease) ||
        !nonEmpty(lease.runId, 128) ||
        !validProjectId(lease.projectId) ||
        !nonEmpty(lease.workItemId, 128) ||
        !nonEmpty(lease.leaseToken, 512) ||
        !normalizedIso(lease.expiresAt)
      )
        return failure('WORKER_LEASE_INVALID', 'Worker lease is invalid');
      const at = explicitTime(lease, now());
      const tokenHash = sha256({ leaseToken: lease.leaseToken });
      const leaseId = `lease-${sha256({ workerId, runId: lease.runId }).slice(0, 32)}`;
      return run(
        async (db) => {
          const worker = await workerByIdForUpdate(db, workerId);
          if (!worker) return failure('WORKER_NOT_FOUND', 'Worker was not found');
          if (worker.status === 'REVOKED')
            return failure('WORKER_REVOKED', 'A revoked worker cannot acquire a lease');
          const execution = await one(
            db,
            `SELECT r.work_item_id, r.worker_id, w.project_id
             FROM execution_run r JOIN work_item w USING (work_item_id)
             WHERE r.run_id = ?`,
            [lease.runId],
          );
          if (!execution) return failure('WORKER_RUN_NOT_FOUND', 'Execution run was not found');
          if (execution.work_item_id !== lease.workItemId)
            return failure('WORKER_LEASE_INVALID', 'Lease run does not match its WorkItem');
          if (execution.project_id !== lease.projectId)
            return failure('WORKER_LEASE_INVALID', 'Lease run does not match its project');
          if (execution.worker_id !== workerId)
            return failure('WORKER_LEASE_INVALID', 'Lease run belongs to another worker');
          const existing = await one(db, 'SELECT lease_id FROM lease WHERE run_id = ? FOR UPDATE', [
            lease.runId,
          ]);
          if (existing) {
            await db.execute(
              `UPDATE lease
             SET project_id = ?, work_item_id = ?, worker_id = ?, token_hash = ?,
                 acquired_at = ?, expires_at = ?, released_at = NULL
             WHERE lease_id = ?`,
              [
                lease.projectId,
                lease.workItemId,
                workerId,
                tokenHash,
                sqlDate(at),
                sqlDate(lease.expiresAt),
                existing.lease_id,
              ],
            );
          } else {
            await db.execute(
              `INSERT INTO lease (
               lease_id, project_id, work_item_id, run_id, worker_id, token_hash,
               acquired_at, expires_at, released_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
              [
                leaseId,
                lease.projectId,
                lease.workItemId,
                lease.runId,
                workerId,
                tokenHash,
                sqlDate(at),
                sqlDate(lease.expiresAt),
              ],
            );
          }
          activeLeaseTokens.set(leaseKey(workerId, lease.runId), lease.leaseToken);
          return {
            ok: true,
            lease: {
              runId: lease.runId,
              projectId: lease.projectId,
              workItemId: lease.workItemId,
              leaseToken: lease.leaseToken,
              expiresAt: normalizedIso(lease.expiresAt),
              tokenHash,
            },
          };
        },
        { write: true, duplicateCode: 'WORKER_LEASE_CONFLICT' },
      );
    },

    // Raw lease tokens remain process-local. MySQL stores only their hashes, and
    // the control service remains authoritative after a process restart.
    async getLease({ workerId, runId } = {}) {
      if (!fullId(workerId) || !nonEmpty(runId, 128))
        return failure('WORKER_LEASE_INVALID', 'Worker and run ids are required');
      return run(async (db) => {
        const row = await one(
          db,
          `SELECT 1 FROM lease
           WHERE worker_id = ? AND run_id = ? AND released_at IS NULL`,
          [workerId, runId],
        );
        if (!row) return failure('WORKER_LEASE_NOT_FOUND', 'Worker lease was not found');
        const leaseToken = activeLeaseTokens.get(leaseKey(workerId, runId));
        if (leaseToken)
          return {
            ok: true,
            lease: {
              runId,
              leaseToken,
            },
          };
        return failure(
          'WORKER_LEASE_TOKEN_UNAVAILABLE',
          'Raw lease tokens are validated by the control service',
        );
      });
    },

    async deleteLease({ workerId, runId } = {}) {
      if (!fullId(workerId) || !nonEmpty(runId, 128))
        return failure('WORKER_LEASE_INVALID', 'Worker and run ids are required');
      const at = explicitTime({}, now());
      return run(
        async (db) => {
          const [result] = await db.execute(
            `UPDATE lease SET released_at = ?
           WHERE worker_id = ? AND run_id = ? AND released_at IS NULL`,
            [sqlDate(at), workerId, runId],
          );
          activeLeaseTokens.delete(leaseKey(workerId, runId));
          return { ok: true, deleted: result.affectedRows > 0 };
        },
        { write: true },
      );
    },

    // Worker job claiming stays in controlService; this store only owns Worker
    // identity, project authorization, command delivery and event replay.
    redactWorkerAuditDetail(value) {
      return sanitizedAuditDetail(value);
    },

    appendAudit(input = {}) {
      return api.appendWorkerAudit(input);
    },

    listAudit(filter = {}) {
      return api.listWorkerAudit(filter);
    },
  });
  return api;
}
