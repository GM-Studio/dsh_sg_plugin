import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { applyMigrations } from './migrations.js';
import { applyDecisionToWorkItem, WORK_ITEM_STATES, ATTENTION_STATES } from './state-machine.js';
import {
  clone,
  failure,
  sha256,
  nonEmpty,
  iso,
  DAY,
  normalizeProject,
  validProject,
  retentionDays,
  validateDecision,
  decisionFingerprint,
  validateAuditEntry,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
} from './repository-contract.js';

const json = (value) => JSON.stringify(value);
const parse = (value) => (typeof value === 'string' ? JSON.parse(value) : value);
const date = (value) =>
  value == null ? null : new Date(`${value.replace(' ', 'T')}Z`).toISOString();
const sqlDate = (value) => iso(value)?.replace('T', ' ').slice(0, 23) ?? null;
const policies = [
  'evidenceRetentionDays',
  'notificationRetentionDays',
  'decisionRetentionDays',
  'auditRetentionDays',
];
const policyColumns = [
  'evidence_retention_days',
  'notification_retention_days',
  'decision_retention_days',
  'audit_retention_days',
];

const require = createRequire(import.meta.url);
function mysqlDriver() {
  try {
    return require('mysql2/promise');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    throw Object.assign(
      new Error(
        'MySQL is outside Core v1. Install mysql2 explicitly before using the historical control-plane integration.',
      ),
      { code: 'MYSQL_DRIVER_NOT_INSTALLED' },
    );
  }
}

// Callers keep credentials in local configuration; errors never echo SQL or credentials.
export function createMysqlPool(options) {
  if (!options || typeof options !== 'object' || !nonEmpty(options.database, 64))
    throw new TypeError('MySQL connection options with a database are required');
  return mysqlDriver().createPool({
    ...options,
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    multipleStatements: false,
    connectTimeout: 10000,
    connectionLimit: options.connectionLimit ?? 4,
  });
}

export async function migrateMysql({ pool, directory, manifest } = {}) {
  let connection;
  let locked = false;
  try {
    connection = await pool.getConnection();
    const [[row]] = await connection.query(
      "SELECT GET_LOCK(CONCAT('sg-migrate-', LEFT(SHA2(DATABASE(), 256), 48)), 10) AS acquired",
    );
    locked = row.acquired === 1;
    if (!locked) return failure('MIGRATION_BUSY', 'Another migration holds the database lock');
    // Execute one trusted manifest statement at a time, without enabling multi-statements on runtime connections.
    const migrationConnection = {
      beginTransaction: () => connection.beginTransaction(),
      commit: () => connection.commit(),
      rollback: () => connection.rollback(),
      query: async (sql, parameters) => {
        if (parameters || !sql.includes(';')) return connection.query(sql, parameters);
        let result;
        for (const statement of splitMigrationStatements(sql))
          result = await connection.query(statement);
        return result;
      },
    };
    return await applyMigrations({ connection: migrationConnection, directory, manifest });
  } catch (error) {
    return failure('MIGRATION_CONNECTION_FAILED', 'Cannot migrate the configured database', {
      cause: error.code ?? null,
    });
  } finally {
    if (connection) {
      if (locked) {
        try {
          await connection.query(
            "SELECT RELEASE_LOCK(CONCAT('sg-migrate-', LEFT(SHA2(DATABASE(), 256), 48)))",
          );
        } catch {
          connection.destroy();
          connection = null;
        }
      }
      connection?.release();
    }
  }
}

// Schema migrations use ordinary SQL, including quoted semicolons and line comments.
export function splitMigrationStatements(sql) {
  const statements = [];
  let current = '',
    quote = null,
    comment = false;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (comment) {
      if (char === '\n') {
        comment = false;
        current += '\n';
      }
      continue;
    }
    if (!quote && char === '-' && sql[i + 1] === '-' && /\s/.test(sql[i + 2] ?? '')) {
      comment = true;
      i++;
      continue;
    }
    if (quote) {
      current += char;
      if (char === '\\' && i + 1 < sql.length) current += sql[++i];
      else if (char === quote) {
        if (sql[i + 1] === quote) current += sql[++i];
        else quote = null;
      }
    } else if (["'", '"', '`'].includes(char)) {
      quote = char;
      current += char;
    } else if (char === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else current += char;
  }
  if (quote) throw new TypeError('Unterminated migration string');
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function projectResult(row) {
  if (!row) return failure('PROJECT_NOT_FOUND', 'Project was not found');
  return {
    ok: true,
    project: {
      projectId: row.project_id,
      name: row.name,
      ...Object.fromEntries(policies.map((key, i) => [key, row[policyColumns[i]]])),
    },
    version: Number(row.version),
  };
}

function workResult(row) {
  if (!row) return failure('WORK_ITEM_NOT_FOUND', 'WorkItem was not found');
  return {
    ok: true,
    workItem: {
      workItemId: row.work_item_id,
      projectId: row.project_id,
      title: row.title,
      requestText: row.request_text,
      priority: row.priority,
      executionState: row.execution_state,
      businessMilestone: row.business_milestone,
      hostHealth: row.host_health,
      revision: Number(row.revision),
      currentRunId: row.current_run_id,
      currentAttentionId: row.current_attention_id,
      budget: parse(row.budget_json),
      budgetUsage: parse(row.budget_usage_json),
      outcome: parse(row.outcome_json),
      nextOwner: row.next_owner,
      nextAction: row.next_action,
      artifactHash: row.artifact_hash,
      lastTransition: parse(row.last_transition_json),
      createdAt: date(row.created_at),
      updatedAt: date(row.updated_at),
      completedAt: date(row.completed_at),
    },
  };
}

function decisionRecord(row) {
  return {
    decisionId: row.decision_id,
    workItemId: row.work_item_id,
    projectId: row.project_id,
    attentionId: row.attention_id,
    scope: row.scope,
    attentionRevision: Number(row.attention_revision),
    expectedWorkItemVersion: Number(row.expected_work_item_version),
    artifactHash: row.artifact_hash,
    action: row.action,
    idempotencyKey: row.idempotency_key,
    actorId: row.actor_id,
    source: row.actor_source,
    authLevel: row.auth_level,
    payload: parse(row.payload_json),
    status: row.status,
    createdAt: date(row.created_at),
    consumedAt: date(row.consumed_at),
    appliedAt: date(row.applied_at),
    appliedBy: row.applied_by,
  };
}

function auditRecord(row) {
  return {
    auditId: row.audit_id,
    sequence: Number(row.sequence),
    projectId: row.project_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    objectType: row.object_type,
    objectId: row.object_id,
    detail: parse(row.detail_json),
    createdAt: date(row.created_at),
    previousHash: row.previous_hash,
    entryHash: row.entry_hash,
  };
}

function notificationRecord(row) {
  return {
    deliveryId: row.delivery_id,
    projectId: row.project_id,
    workItemId: row.work_item_id,
    attentionId: row.attention_id,
    channel: row.channel,
    recipientHash: row.recipient_hash,
    kind: row.notification_kind,
    version: Number(row.notification_version),
    dedupeKey: row.dedupe_key,
    status: row.status,
    attemptCount: row.attempt_count,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

export async function verifyMysqlAuditChain(db) {
  const [rows] = await db.execute('SELECT * FROM audit_log ORDER BY sequence');
  let hash = null,
    sequence = 0;
  for (const row of rows) {
    const { entryHash, ...body } = auditRecord(row);
    if (body.sequence !== ++sequence || body.previousHash !== hash || sha256(body) !== entryHash)
      return failure('AUDIT_CORRUPT', 'Audit chain validation failed', { sequence });
    hash = entryHash;
  }
  const [[head]] = await db.execute('SELECT * FROM repository_head WHERE singleton = 1');
  if (!head || Number(head.sequence) !== sequence || head.entry_hash !== hash)
    return failure('AUDIT_CORRUPT', 'Audit chain head does not match durable entries');
  return { ok: true, count: sequence, headHash: hash };
}

export function createMysqlRepository({ pool, clock = Date.now } = {}) {
  if (!pool || typeof pool.getConnection !== 'function' || typeof clock !== 'function')
    throw new TypeError('A MySQL pool and a clock function are required');
  const now = () => new Date(clock()).toISOString();
  const one = async (db, sql, args = []) => (await db.execute(sql, args))[0][0];
  const project = async (db, id) =>
    projectResult(await one(db, 'SELECT * FROM project WHERE project_id = ?', [id]));
  const work = async (db, id) =>
    workResult(await one(db, 'SELECT * FROM work_item WHERE work_item_id = ?', [id]));
  const decision = async (db, id) => {
    const row = await one(
      db,
      'SELECT d.*, w.project_id FROM decision d JOIN work_item w USING (work_item_id) WHERE decision_id = ?',
      [id],
    );
    return row
      ? { ok: true, decision: decisionRecord(row) }
      : failure('DECISION_NOT_FOUND', 'Decision was not found');
  };
  async function run(write, fn) {
    let db;
    try {
      db = await pool.getConnection();
      if (write) {
        await db.beginTransaction();
        // A bounded single-writer control plane; the lock is shared across processes and adapters.
        // Take it before any domain reads to avoid stale repeatable-read snapshots.
        const head = await one(db, 'SELECT * FROM repository_head WHERE singleton = 1 FOR UPDATE');
        if (!head) throw Object.assign(new Error(), { code: 'REPOSITORY_HEAD_MISSING' });
      }
      const result = await fn(db);
      if (write) {
        if (result.ok) await db.commit();
        else await db.rollback();
      }
      return result;
    } catch (error) {
      if (write && db) {
        try {
          await db.rollback();
        } catch {
          db.destroy();
          db = null;
        }
      }
      return failure('PERSISTENCE_FAILED', 'Database operation failed', {
        cause: error.code ?? null,
      });
    } finally {
      db?.release();
    }
  }
  async function insert(db, table, values) {
    // Identifiers come exclusively from the fixed mappings below; all data is parameterized.
    const columns = Object.keys(values);
    await db.execute(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      Object.values(values),
    );
  }
  async function ensureProject(db, id) {
    if ((await project(db, id)).ok) return;
    await insertProject(db, { projectId: id });
  }
  async function insertProject(db, input) {
    const normalized = normalizeProject(input);
    await insert(db, 'project', {
      project_id: normalized.projectId,
      name: normalized.name,
      root_hash: sha256({ projectId: normalized.projectId }),
      ...Object.fromEntries(policyColumns.map((column, i) => [column, normalized[policies[i]]])),
      created_at: sqlDate(now()),
      updated_at: sqlDate(now()),
      version: 1,
    });
  }
  function workValues(w) {
    return {
      title: w.title ?? w.workItemId,
      request_text: w.requestText ?? '',
      priority: w.priority ?? 'normal',
      execution_state: w.executionState,
      business_milestone: w.businessMilestone ?? 'PROJECT_READY',
      host_health: w.hostHealth ?? 'ONLINE',
      revision: w.revision,
      current_run_id: w.currentRunId ?? null,
      current_attention_id: w.currentAttentionId ?? null,
      budget_json: json(w.budget ?? {}),
      budget_usage_json: json(w.budgetUsage ?? {}),
      outcome_json: w.outcome == null ? null : json(w.outcome),
      next_owner: w.nextOwner ?? 'system',
      next_action: w.nextAction ?? '',
      artifact_hash: w.artifactHash ?? null,
      last_transition_json: w.lastTransition == null ? null : json(w.lastTransition),
      updated_at: sqlDate(w.updatedAt ?? now()),
      completed_at: sqlDate(w.completedAt),
    };
  }
  function validWork(w) {
    return (
      w &&
      nonEmpty(w.workItemId, 128) &&
      nonEmpty(w.projectId, 128) &&
      Number.isSafeInteger(w.revision) &&
      w.revision >= 1 &&
      WORK_ITEM_STATES.includes(w.executionState) &&
      (w.artifactHash == null || /^[a-f0-9]{64}$/.test(w.artifactHash))
    );
  }
  async function updateWork(db, w, expected) {
    const values = workValues(w);
    const [result] = await db.execute(
      `UPDATE work_item SET ${Object.keys(values)
        .map((k) => `${k} = ?`)
        .join(', ')} WHERE work_item_id = ? AND revision = ?`,
      [...Object.values(values), w.workItemId, expected],
    );
    return result.affectedRows === 1;
  }
  const verify = verifyMysqlAuditChain;
  async function audit(db, entry) {
    if (!validateAuditEntry(entry)) return failure('AUDIT_ENTRY_INVALID', 'Audit entry is invalid');
    const verified = await verify(db);
    if (!verified.ok) return verified;
    if (await one(db, 'SELECT audit_id FROM audit_log WHERE audit_id = ?', [entry.auditId]))
      return failure('AUDIT_DUPLICATE', 'Audit entry already exists');
    if (entry.projectId != null) await ensureProject(db, entry.projectId);
    const record = {
      auditId: entry.auditId,
      sequence: verified.count + 1,
      projectId: entry.projectId ?? null,
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId,
      detail: clone(entry.detail),
      createdAt: iso(entry.createdAt),
      previousHash: verified.headHash,
    };
    record.entryHash = sha256(record);
    await insert(db, 'audit_log', {
      audit_id: record.auditId,
      sequence: record.sequence,
      project_id: record.projectId,
      actor_type: record.actorType,
      actor_id: record.actorId,
      action: record.action,
      object_type: record.objectType,
      object_id: record.objectId,
      detail_json: json(record.detail),
      previous_hash: record.previousHash,
      entry_hash: record.entryHash,
      created_at: sqlDate(record.createdAt),
    });
    await db.execute(
      'UPDATE repository_head SET sequence = ?, entry_hash = ? WHERE singleton = 1',
      [record.sequence, record.entryHash],
    );
    return { ok: true, audit: record };
  }
  const evidenceRows = async (db, id) => {
    const [rows] = await db.execute(
      'SELECT * FROM evidence_event WHERE project_id = ? ORDER BY received_at, event_id',
      [id],
    );
    return rows.map((r) => ({
      eventId: r.event_id,
      projectId: r.project_id,
      workItemId: r.work_item_id,
      runId: r.run_id,
      eventType: r.event_type,
      source: r.source,
      payload: parse(r.payload_json),
      occurredAt: date(r.occurred_at),
      receivedAt: date(r.received_at),
    }));
  };
  const notifications = async (db, id) => {
    const [rows] = await db.execute(
      'SELECT n.*, w.project_id FROM notification_delivery n JOIN work_item w USING (work_item_id) WHERE w.project_id = ? ORDER BY n.created_at, n.delivery_id',
      [id],
    );
    return rows.map(notificationRecord);
  };

  return Object.freeze({
    clock,
    getProject: (id) => run(false, (db) => project(db, id)),
    saveProject: (input) =>
      run(true, async (db) => {
        if (!validProject(input))
          return failure('PROJECT_INVALID', 'Project configuration is invalid');
        if ((await project(db, input.projectId)).ok)
          return failure('PROJECT_ALREADY_EXISTS', 'Project already exists');
        await insertProject(db, input);
        return project(db, input.projectId);
      }),
    updateProjectRetention: (input = {}) =>
      run(true, async (db) => {
        const current = await project(db, input.projectId);
        if (!current.ok) return current;
        if (input.expectedVersion !== current.version)
          return failure('PROJECT_VERSION_CONFLICT', 'Project version changed');
        if (policies.some((k) => input[k] !== undefined && retentionDays(input[k], null) === null))
          return failure('PROJECT_INVALID', 'Retention policy is invalid');
        const next = {
          ...current.project,
          ...Object.fromEntries(
            policies.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]),
          ),
        };
        await db.execute(
          `UPDATE project SET ${policyColumns.map((k) => `${k} = ?`).join(', ')}, version = version + 1, updated_at = ? WHERE project_id = ? AND version = ?`,
          [...policies.map((k) => next[k]), sqlDate(now()), input.projectId, input.expectedVersion],
        );
        return project(db, input.projectId);
      }),
    saveWorkItem: (input) =>
      run(true, async (db) => {
        if (!validWork(input)) return failure('WORK_ITEM_INVALID', 'WorkItem is invalid');
        if ((await work(db, input.workItemId)).ok)
          return failure('WORK_ITEM_ALREADY_EXISTS', 'WorkItem already exists');
        await ensureProject(db, input.projectId);
        await insert(db, 'work_item', {
          work_item_id: input.workItemId,
          project_id: input.projectId,
          ...workValues(input),
          created_at: sqlDate(input.createdAt ?? now()),
        });
        return work(db, input.workItemId);
      }),
    getWorkItem: (id) => run(false, (db) => work(db, id)),
    updateWorkItemCas: (input = {}) =>
      run(true, async (db) => {
        const current = await work(db, input.workItemId);
        if (!current.ok) return current;
        if (input.expectedRevision !== current.workItem.revision)
          return failure('WORK_ITEM_VERSION_CONFLICT', 'WorkItem revision changed');
        const next = input.workItem;
        if (
          !validWork(next) ||
          next.workItemId !== input.workItemId ||
          next.projectId !== current.workItem.projectId
        )
          return failure('WORK_ITEM_INVALID', 'WorkItem identity cannot change');
        if (next.revision !== input.expectedRevision + 1)
          return failure('WORK_ITEM_VERSION_CONFLICT', 'WorkItem update must advance one revision');
        if (!(await updateWork(db, next, input.expectedRevision)))
          return failure('WORK_ITEM_VERSION_CONFLICT', 'WorkItem revision changed');
        return work(db, input.workItemId);
      }),
    // Attention creation is explicit: a Decision cannot invent its approval context.
    saveAttention: (input) =>
      run(true, async (db) => {
        const w = await work(db, input?.workItemId);
        if (!w.ok) return w;
        if (
          !nonEmpty(input.attentionId, 128) ||
          input.projectId !== w.workItem.projectId ||
          !nonEmpty(input.scope) ||
          !Number.isSafeInteger(input.revision) ||
          input.revision < 1 ||
          !ATTENTION_STATES.includes(input.status) ||
          !iso(input.expiresAt) ||
          input.artifactHash !== w.workItem.artifactHash ||
          input.workItemVersion !== w.workItem.revision
        )
          return failure('ATTENTION_INVALID', 'Attention context is invalid');
        await insert(db, 'attention', {
          attention_id: input.attentionId,
          work_item_id: input.workItemId,
          project_id: input.projectId,
          scope: input.scope,
          attention_key: sha256({ scope: input.scope }),
          revision: input.revision,
          attention_type: input.type ?? 'H1_APPROVAL',
          status: input.status,
          reason_text: input.reason ?? '',
          question_text: input.question ?? '',
          actions_json: json(input.actions ?? []),
          summary_text: input.summary ?? '',
          risks_json: json(input.risks ?? []),
          evidence_json: json(input.evidence ?? []),
          artifact_hash: input.artifactHash,
          work_item_version: input.workItemVersion,
          expires_at: sqlDate(input.expiresAt),
          created_at: sqlDate(now()),
          updated_at: sqlDate(now()),
        });
        return { ok: true, attention: clone(input) };
      }),
    recordDecision: (input) =>
      run(true, async (db) => {
        if (!validateDecision(input)) return failure('DECISION_INVALID', 'Decision is invalid');
        input = {
          ...input,
          source: input.source ?? 'web',
          authLevel: input.authLevel ?? 'session',
        };
        const existing = await one(
          db,
          'SELECT d.*, w.project_id FROM decision d JOIN work_item w USING (work_item_id) WHERE idempotency_key = ?',
          [input.idempotencyKey],
        );
        if (existing) {
          const stored = decisionRecord(existing);
          if (decisionFingerprint(stored) !== decisionFingerprint(input))
            return failure(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency key was reused with different content',
            );
          return { ok: true, decision: stored, replayed: true };
        }
        if ((await decision(db, input.decisionId)).ok)
          return failure('DECISION_DUPLICATE', 'Decision id already exists');
        const w = await work(db, input.workItemId);
        if (!w.ok) return w;
        if (input.projectId !== undefined && input.projectId !== w.workItem.projectId)
          return failure('DECISION_PROJECT_MISMATCH', 'Decision project does not match WorkItem');
        const a = await one(db, 'SELECT * FROM attention WHERE attention_id = ?', [
          input.attentionId ?? null,
        ]);
        if (
          !a ||
          a.work_item_id !== input.workItemId ||
          a.project_id !== w.workItem.projectId ||
          a.scope !== input.scope ||
          Number(a.revision) !== input.attentionRevision
        )
          return failure('DECISION_ATTENTION_MISMATCH', 'Decision is not bound to this Attention');
        await insert(db, 'decision', {
          decision_id: input.decisionId,
          work_item_id: input.workItemId,
          attention_id: input.attentionId,
          scope: input.scope,
          attention_revision: input.attentionRevision,
          expected_work_item_version: input.expectedWorkItemVersion,
          artifact_hash: input.artifactHash.toLowerCase(),
          action: input.action,
          idempotency_key: input.idempotencyKey,
          actor_id: input.actorId,
          actor_source: input.source ?? 'web',
          auth_level: input.authLevel ?? 'session',
          payload_json: json(input.payload ?? {}),
          status: input.status ?? 'RECORDED',
          created_at: sqlDate(input.createdAt),
        });
        return { ...(await decision(db, input.decisionId)), replayed: false };
      }),
    getDecision: (id) => run(false, (db) => decision(db, id)),
    applyDecision: (input = {}) =>
      run(true, async (db) => {
        const d = await decision(db, input.decisionId);
        if (!d.ok) return d;
        const w = await work(db, input.workItemId);
        if (!w.ok) return w;
        if (d.decision.workItemId !== input.workItemId)
          return failure('DECISION_WORK_ITEM_MISMATCH', 'Decision is bound to another WorkItem');
        if (input.expectedRevision !== w.workItem.revision)
          return failure('WORK_ITEM_VERSION_CONFLICT', 'WorkItem revision changed');
        const applied = applyDecisionToWorkItem({
          workItem: w.workItem,
          decision: d.decision,
          actorId: input.actorId,
          at: input.at,
        });
        if (!applied.ok) return applied;
        if (!(await updateWork(db, applied.workItem, input.expectedRevision)))
          return failure('WORK_ITEM_VERSION_CONFLICT', 'WorkItem revision changed');
        await db.execute(
          'UPDATE decision SET status = ?, applied_at = ?, applied_by = ? WHERE decision_id = ?',
          ['APPLIED', sqlDate(input.at), input.actorId, input.decisionId],
        );
        return {
          ok: true,
          workItem: (await work(db, input.workItemId)).workItem,
          decision: (await decision(db, input.decisionId)).decision,
        };
      }),
    appendEvidence: (input) =>
      run(true, async (db) => {
        if (
          !input ||
          !nonEmpty(input.eventId, 128) ||
          !nonEmpty(input.projectId, 128) ||
          !nonEmpty(input.eventType, 128) ||
          !iso(input.receivedAt) ||
          !iso(input.occurredAt)
        )
          return failure('EVIDENCE_INVALID', 'Evidence is invalid');
        const event = {
          eventId: input.eventId,
          projectId: input.projectId,
          workItemId: input.workItemId ?? null,
          runId: input.runId ?? null,
          eventType: input.eventType,
          source: input.source,
          payload: input.payload ?? {},
          occurredAt: iso(input.occurredAt),
          receivedAt: iso(input.receivedAt),
        };
        const fingerprint = sha256(event);
        const old = await one(db, 'SELECT payload_hash FROM evidence_event WHERE event_id = ?', [
          input.eventId,
        ]);
        if (old)
          return old.payload_hash === fingerprint
            ? { ok: true, event, duplicate: true }
            : failure('EVIDENCE_CONFLICT', 'Evidence id was reused with different content');
        if (event.workItemId) {
          const w = await work(db, event.workItemId);
          if (!w.ok) return w;
          if (w.workItem.projectId !== input.projectId)
            return failure('EVIDENCE_PROJECT_MISMATCH', 'Evidence project does not match WorkItem');
        }
        if (event.runId) {
          const r = await one(db, 'SELECT work_item_id FROM execution_run WHERE run_id = ?', [
            event.runId,
          ]);
          if (!r || r.work_item_id !== event.workItemId)
            return failure('EVIDENCE_RUN_MISMATCH', 'Evidence run does not match WorkItem');
        }
        await ensureProject(db, input.projectId);
        await insert(db, 'evidence_event', {
          event_id: event.eventId,
          project_id: event.projectId,
          work_item_id: event.workItemId,
          run_id: event.runId,
          event_type: event.eventType,
          source: event.source,
          payload_json: json(event.payload),
          payload_hash: fingerprint,
          occurred_at: sqlDate(event.occurredAt),
          received_at: sqlDate(event.receivedAt),
        });
        return { ok: true, event, duplicate: false };
      }),
    listEvidence: (id) =>
      run(false, async (db) => ({ ok: true, events: await evidenceRows(db, id) })),
    enqueueNotification: (input) =>
      run(true, async (db) => {
        if (
          !input ||
          !nonEmpty(input.deliveryId, 128) ||
          !nonEmpty(input.projectId, 128) ||
          !nonEmpty(input.workItemId, 128) ||
          !nonEmpty(input.attentionId, 128) ||
          !NOTIFICATION_CHANNELS.includes(input.channel) ||
          !nonEmpty(input.recipient, 512) ||
          !NOTIFICATION_KINDS.includes(input.kind) ||
          !Number.isSafeInteger(input.version) ||
          input.version < 0
        )
          return failure('NOTIFICATION_INVALID', 'Notification delivery is invalid');
        const w = await work(db, input.workItemId);
        if (!w.ok) return w;
        if (w.workItem.projectId !== input.projectId)
          return failure(
            'NOTIFICATION_PROJECT_MISMATCH',
            'Notification project does not match WorkItem',
          );
        const a = await one(db, 'SELECT work_item_id FROM attention WHERE attention_id = ?', [
          input.attentionId,
        ]);
        if (!a || a.work_item_id !== input.workItemId)
          return failure(
            'NOTIFICATION_ATTENTION_MISMATCH',
            'Notification is not bound to this Attention',
          );
        const recipientHash = sha256({ channel: input.channel, recipient: input.recipient });
        const dedupeKey = sha256({
          attentionId: input.attentionId,
          channel: input.channel,
          recipientHash,
          kind: input.kind,
          version: input.version,
        });
        const old = await one(
          db,
          'SELECT n.*, w.project_id FROM notification_delivery n JOIN work_item w USING (work_item_id) WHERE dedupe_key = ?',
          [dedupeKey],
        );
        if (old) return { ok: true, delivery: notificationRecord(old), duplicate: true };
        if (
          await one(db, 'SELECT delivery_id FROM notification_delivery WHERE delivery_id = ?', [
            input.deliveryId,
          ])
        )
          return failure('NOTIFICATION_DUPLICATE', 'Notification delivery id already exists');
        const at = sqlDate(now());
        await insert(db, 'notification_delivery', {
          delivery_id: input.deliveryId,
          work_item_id: input.workItemId,
          attention_id: input.attentionId,
          channel: input.channel,
          recipient_hash: recipientHash,
          notification_kind: input.kind,
          notification_version: input.version,
          dedupe_key: dedupeKey,
          next_attempt_at: at,
          created_at: at,
          updated_at: at,
        });
        return {
          ok: true,
          delivery: (await notifications(db, input.projectId)).find(
            (n) => n.deliveryId === input.deliveryId,
          ),
          duplicate: false,
        };
      }),
    listNotifications: (id) =>
      run(false, async (db) => ({ ok: true, deliveries: await notifications(db, id) })),
    appendAudit: (entry) => run(true, (db) => audit(db, entry)),
    verifyAuditChain: () => run(true, verify),
    listAudit: (id) =>
      run(true, async (db) => {
        const verified = await verify(db);
        if (!verified.ok) return verified;
        const [rows] = await db.execute(
          'SELECT * FROM audit_log WHERE project_id = ? ORDER BY sequence',
          [id],
        );
        return { ok: true, audits: rows.map(auditRecord) };
      }),
    purgeExpired: (input = {}) =>
      run(true, async (db) => {
        const p = await project(db, input.projectId);
        if (!p.ok) return p;
        if (!iso(input.at))
          return failure('RETENTION_TIME_INVALID', 'Retention cutoff time is invalid');
        const cutoff = (key) =>
          sqlDate(new Date(Date.parse(input.at) - p.project[key] * DAY).toISOString());
        if (
          await one(
            db,
            'SELECT audit_id FROM audit_log WHERE project_id = ? AND created_at <= ? LIMIT 1',
            [input.projectId, cutoff('auditRetentionDays')],
          )
        )
          return failure(
            'AUDIT_RETENTION_REQUIRES_ARCHIVE',
            'Audit retention requires archival before deletion',
          );
        const tables = [
          [
            'evidence',
            'evidence_event',
            'project_id = ? AND received_at <= ?',
            'evidenceRetentionDays',
          ],
          [
            'notifications',
            'notification_delivery',
            'work_item_id IN (SELECT work_item_id FROM work_item WHERE project_id = ?) AND updated_at <= ?',
            'notificationRetentionDays',
          ],
          [
            'decisions',
            'decision',
            'work_item_id IN (SELECT work_item_id FROM work_item WHERE project_id = ?) AND created_at <= ?',
            'decisionRetentionDays',
          ],
        ];
        const removed = { evidence: 0, notifications: 0, decisions: 0, audits: 0 };
        for (const [kind, table, where, policy] of tables) {
          const row = await one(db, `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`, [
            input.projectId,
            cutoff(policy),
          ]);
          removed[kind] = Number(row.count);
        }
        if (Object.values(removed).some(Boolean)) {
          const receipt = await audit(db, {
            auditId: `retention-${randomUUID()}`,
            projectId: input.projectId,
            actorType: 'system',
            actorId: 'retention',
            action: 'RETENTION_PURGE',
            objectType: 'project',
            objectId: input.projectId,
            detail: { removed, at: iso(input.at) },
            createdAt: iso(input.at),
          });
          if (!receipt.ok) return receipt;
          for (const [, table, where, policy] of tables)
            await db.execute(`DELETE FROM ${table} WHERE ${where}`, [
              input.projectId,
              cutoff(policy),
            ]);
        }
        return { ok: true, removed };
      }),
  });
}
