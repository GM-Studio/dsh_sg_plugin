import { canonicalJson } from '../events.js';
import {
  clone,
  failure,
  isPlainObject,
  sanitizeDiscreteValue,
  sanitizeEvidenceText,
} from './evidence-timeline.js';

const AUDIT_ACTIONS = new Set([
  'CREATE',
  'UPDATE',
  'DELETE',
  'DECIDE',
  'APPLY',
  'CANCEL',
  'EXPIRE',
  'NOTIFY',
  'REVOKE',
  'MIGRATE',
  'RETENTION_PURGE',
]);
const ACTOR_TYPES = new Set(['user', 'worker', 'system', 'channel']);
const ROLES = new Set(['owner', 'operator', 'approver', 'viewer', 'customer_acceptor']);
const HASH = /^[a-f0-9]{64}$/i;
const MAX_LIMIT = 5000;

function boundedText(value, maximum = 256) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function iso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
}

function normalizeScopes(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  if (value.some((projectId) => !boundedText(projectId, 128))) return null;
  return [...new Set(value.map((projectId) => projectId.trim()))];
}

function allowedProject(projectId, role, scopes) {
  if (scopes !== undefined) return scopes.includes(projectId);
  return role === 'owner';
}

function normalizeAudit(record, expectedProjectId) {
  if (!isPlainObject(record)) {
    return failure('AUDIT_CORRUPT', 'Audit record is unreadable');
  }
  if (
    !boundedText(record.auditId, 128) ||
    !Number.isSafeInteger(record.sequence) ||
    record.sequence < 1 ||
    !boundedText(record.projectId, 128) ||
    !ACTOR_TYPES.has(record.actorType) ||
    !boundedText(record.actorId, 256) ||
    !AUDIT_ACTIONS.has(record.action) ||
    !boundedText(record.objectType, 64) ||
    !boundedText(record.objectId, 128) ||
    !isPlainObject(record.detail) ||
    !iso(record.createdAt) ||
    !(record.previousHash === null || HASH.test(record.previousHash || '')) ||
    !HASH.test(record.entryHash || '')
  ) {
    return failure('AUDIT_CORRUPT', 'Audit chain record is incomplete or invalid', {
      auditId: record.auditId ?? null,
      sequence: record.sequence ?? null,
    });
  }
  if (record.projectId !== expectedProjectId) {
    return failure('AUDIT_CORRUPT', 'Audit repository returned another project');
  }
  const detail = sanitizeDiscreteValue(record.detail, { path: 'detail' });
  if (!detail.ok) {
    return failure('AUDIT_DETAIL_UNSAFE', 'Audit detail contains prohibited content', {
      auditId: record.auditId,
    });
  }
  const objectType = sanitizeEvidenceText(record.objectType, 64);
  const objectId = sanitizeEvidenceText(record.objectId, 128);
  const actorId = sanitizeEvidenceText(record.actorId, 256);
  if (
    !objectType.ok ||
    !objectId.ok ||
    !actorId.ok ||
    !objectId.value.trim() ||
    !actorId.value.trim()
  ) {
    return failure('AUDIT_CORRUPT', 'Audit object identity is invalid', {
      auditId: record.auditId,
    });
  }
  return {
    ok: true,
    audit: {
      auditId: record.auditId,
      sequence: record.sequence,
      projectId: record.projectId,
      actorType: record.actorType,
      actorId: actorId.value,
      action: record.action,
      objectType: objectType.value,
      objectId: objectId.value,
      detail: detail.value,
      createdAt: iso(record.createdAt),
      previousHash: record.previousHash,
      entryHash: record.entryHash,
    },
  };
}

function normalizeFilters(options) {
  if (!isPlainObject(options)) {
    return failure('AUDIT_FILTER_INVALID', 'Audit filters must be an object');
  }
  if (options.projectId !== undefined && !boundedText(options.projectId, 128)) {
    return failure('AUDIT_FILTER_INVALID', 'projectId filter is invalid');
  }
  if (options.action !== undefined && !AUDIT_ACTIONS.has(options.action)) {
    return failure('AUDIT_FILTER_INVALID', 'action filter is invalid');
  }
  const limit =
    options.limit === undefined
      ? 100
      : Number.isSafeInteger(options.limit) && options.limit >= 1
        ? Math.min(options.limit, MAX_LIMIT)
        : null;
  if (limit === null) {
    return failure('AUDIT_FILTER_INVALID', 'limit must be a positive integer');
  }
  return {
    ok: true,
    projectId: options.projectId?.trim(),
    action: options.action,
    after: options.after,
    limit,
  };
}

function cursorAfter(audits, cursor) {
  if (cursor === undefined || cursor === null || cursor === '') return { ok: true, index: -1 };
  if (typeof cursor === 'number' && Number.isSafeInteger(cursor) && cursor >= 1) {
    let index = -1;
    for (const [candidate, audit] of audits.entries()) {
      if (audit.sequence <= cursor) index = candidate;
    }
    return { ok: true, index };
  }
  if (typeof cursor !== 'string' || !boundedText(cursor, 128)) {
    return failure('AUDIT_CURSOR_INVALID', 'after must be a sequence, audit id, or timestamp');
  }
  const timestamp = iso(cursor);
  if (timestamp) {
    let index = -1;
    for (const [candidate, audit] of audits.entries()) {
      if (audit.createdAt <= timestamp) index = candidate;
    }
    return { ok: true, index };
  }
  const index = audits.findIndex((audit) => audit.auditId === cursor);
  return index < 0
    ? failure('AUDIT_CURSOR_NOT_FOUND', 'after audit was not found')
    : { ok: true, index };
}

export function createAuditQuery({ repository, role = 'owner', allowedProjects } = {}) {
  if (!ROLES.has(role)) throw new TypeError('role is not supported');
  const scopes = normalizeScopes(allowedProjects);
  if (scopes === null) {
    throw new TypeError('allowedProjects must contain bounded project ids');
  }

  async function verifyChain() {
    if (typeof repository?.verifyAuditChain !== 'function') {
      return failure('AUDIT_CHAIN_UNAVAILABLE', 'Audit chain verification is unavailable');
    }
    let result;
    try {
      result = await repository.verifyAuditChain();
    } catch {
      return failure('AUDIT_CHAIN_UNAVAILABLE', 'Audit chain verification failed');
    }
    if (!result || result.ok !== true) {
      return failure(
        result?.code ?? 'AUDIT_CORRUPT',
        result?.message ?? 'Audit chain verification failed',
      );
    }
    return {
      ok: true,
      headHash: result.headHash ?? null,
      count: Number.isSafeInteger(result.count) ? result.count : null,
    };
  }

  async function list(options = {}) {
    const filters = normalizeFilters(options);
    if (!filters.ok) return filters;
    const chain = await verifyChain();
    if (!chain.ok) return chain;
    if (typeof repository?.listAudit !== 'function') {
      return failure('AUDIT_QUERY_UNAVAILABLE', 'Audit listing is unavailable');
    }
    const projects = filters.projectId ? [filters.projectId] : scopes === undefined ? [] : scopes;
    if (!projects.length) {
      return failure('AUDIT_PROJECT_REQUIRED', 'projectId is required for this role');
    }
    if (projects.some((projectId) => !allowedProject(projectId, role, scopes))) {
      return failure('AUDIT_FORBIDDEN', 'Project is outside the permitted audit scope');
    }
    if (scopes !== undefined && projects.some((projectId) => !scopes.includes(projectId))) {
      return failure('AUDIT_FORBIDDEN', 'Project is outside the permitted audit scope');
    }

    const byId = new Map();
    for (const projectId of projects) {
      let result;
      try {
        result = await repository.listAudit(projectId);
      } catch {
        return failure('AUDIT_QUERY_FAILED', 'Audit records could not be read');
      }
      if (!result || result.ok !== true) {
        return failure(
          result?.code ?? 'AUDIT_QUERY_FAILED',
          result?.message ?? 'Audit records could not be read',
        );
      }
      if (!Array.isArray(result.audits)) {
        return failure('AUDIT_CORRUPT', 'Audit repository returned an invalid chain');
      }
      for (const record of result.audits) {
        const normalized = normalizeAudit(record, projectId);
        if (!normalized.ok) return normalized;
        byId.set(normalized.audit.auditId, normalized.audit);
      }
    }
    const ordered = [...byId.values()].sort((left, right) => left.sequence - right.sequence);
    const cursor = cursorAfter(ordered, filters.after);
    if (!cursor.ok) return cursor;
    const remaining = ordered
      .slice(cursor.index + 1)
      .filter((audit) => !filters.action || audit.action === filters.action);
    const limited = remaining.slice(0, filters.limit);
    return {
      ok: true,
      audits: clone(limited),
      count: limited.length,
      nextCursor: limited.at(-1)?.sequence ?? null,
      chain,
    };
  }

  async function exportAudit(options = {}) {
    const format = options.format ?? 'jsonl';
    if (!['jsonl', 'json'].includes(format)) {
      return failure('AUDIT_EXPORT_INVALID', 'format must be jsonl or json');
    }
    const listed = await list(options);
    if (!listed.ok) return listed;
    const content =
      format === 'jsonl'
        ? listed.audits.map((audit) => canonicalJson(audit)).join('\n') +
          (listed.audits.length ? '\n' : '')
        : canonicalJson({
            audits: listed.audits,
            chain: listed.chain,
          });
    return {
      ok: true,
      format,
      content,
      auditCount: listed.audits.length,
      nextCursor: listed.nextCursor,
      chain: listed.chain,
    };
  }

  return Object.freeze({ list, export: exportAudit });
}
