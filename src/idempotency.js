import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensureDir,
  exists,
  nowIso,
  readJsonIfExists,
  writeFile,
  writeJson,
} from './util.js';

const STORE_VERSION = 1;
const DEFAULT_STALE_MS = 10 * 60 * 1000;

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function operationKey(root, command, args = {}, target = '') {
  const normalized = [
    path.resolve(root),
    String(command || ''),
    stableStringify(args || {}),
    String(target || ''),
  ].join('\u0000');
  return sha256(normalized).slice(0, 32);
}

export function stateDir(root) {
  return path.join(path.resolve(root), '.specgate', 'state');
}

export function storePath(root) {
  return path.join(stateDir(root), 'idempotency.json');
}

function lockDir() {
  return path.join(os.tmpdir(), 'specgate-locks');
}

function ensureStateDirectory(root) {
  const dir = stateDir(root);
  ensureDir(dir);
  const ignore = path.join(dir, '.gitignore');
  if (!exists(ignore)) writeFile(ignore, '*\n');
  return dir;
}

export function readIdempotencyStore(root) {
  const value = readJsonIfExists(storePath(root));
  if (!value || typeof value !== 'object' || typeof value.operations !== 'object') {
    return { version: STORE_VERSION, operations: {} };
  }
  return value;
}

function pruneStore(store, now = Date.now()) {
  for (const [key, record] of Object.entries(store.operations)) {
    if (record && typeof record.expiresAt === 'number' && record.expiresAt <= now) {
      delete store.operations[key];
    }
  }
  return store;
}

function writeIdempotencyStore(root, store) {
  ensureStateDirectory(root);
  const target = storePath(root);
  ensureDir(path.dirname(target));
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  writeJson(temporary, store);
  fs.renameSync(temporary, target);
}

function readLock(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Acquire one per-operation lock. A stale lock (default: 10 minutes) is
 * removed once, so a crashed command cannot block the project forever.
 */
export function acquireOperationLock(root, key, options = {}) {
  const staleMs = options.staleMs || DEFAULT_STALE_MS;
  const dir = lockDir();
  ensureDir(dir);
  const file = path.join(dir, `${key}.lock`);
  const owner = `${process.pid}:${randomUUID()}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(
        fd,
        JSON.stringify({
          key,
          owner,
          pid: process.pid,
          at: Date.now(),
          root: path.resolve(root),
        }),
        'utf8',
      );
      fs.closeSync(fd);
      return { ok: true, file, owner, key };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
      const holder = readLock(file);
      const at = Number(holder?.at || 0);
      if (!holder || !Number.isFinite(at) || Date.now() - at > staleMs) {
        try {
          fs.unlinkSync(file);
        } catch {
          // Another process may have removed it first.
        }
        continue;
      }
      return { ok: false, file, holder, key };
    }
  }

  return { ok: false, file, holder: readLock(file), key };
}

export function releaseOperationLock(lock) {
  if (!lock || lock.ok !== true) return;
  try {
    const holder = readLock(lock.file);
    if (holder?.owner === lock.owner) fs.unlinkSync(lock.file);
  } catch {
    // A missing lock is already released.
  }
}

/**
 * State-first idempotency with an operation record for append-like effects.
 *
 * `execute` receives `{ key, root, store, record }` and must return
 * `{ result, summary?, record? }`. State checks inside `execute` return their
 * own no-op result and set `record: false`; append-like effects set
 * `record: true` and use a positive `ttlMs`.
 *
 * A duplicate is only consulted when `ttlMs > 0`. Stateful commands therefore
 * always re-check the real project state instead of replaying a stale result.
 */
export async function withIdempotency(root, meta, execute) {
  const key = operationKey(root, meta.command, meta.args, meta.target);
  const lock = acquireOperationLock(root, key, meta);
  if (lock.ok !== true) {
    return {
      status: 'busy',
      key,
      holder: lock.holder,
      text: `相同操作正在执行（${key}），请稍后重试。`,
    };
  }

  try {
    const store = readIdempotencyStore(root);
    const existing = store.operations[key];
    if (
      Number(meta.ttlMs) > 0 &&
      meta.force !== true &&
      existing &&
      (!existing.expiresAt || existing.expiresAt > Date.now())
    ) {
      return { status: 'duplicate', key, record: existing };
    }

    const outcome = await execute({ key, root, store, record: existing });
    const result = outcome?.result;
    const shouldRecord =
      outcome?.record === true && Number(meta.ttlMs) > 0 && exists(path.join(path.resolve(root), '.specgate'));

    if (shouldRecord) {
      store.operations[key] = {
        key,
        command: String(meta.command || ''),
        argsHash: sha256(stableStringify(meta.args || {})).slice(0, 32),
        target: meta.target ? String(meta.target) : null,
        status: 'success',
        at: nowIso(),
        summary: String(outcome.summary || result?.text || '').slice(0, 500),
        resultHash: result?.text ? sha256(String(result.text)).slice(0, 32) : null,
        expiresAt: Date.now() + Number(meta.ttlMs),
      };
      pruneStore(store);
      writeIdempotencyStore(root, store);
    }

    return { status: 'ok', key, result, summary: outcome?.summary || result?.text };
  } finally {
    releaseOperationLock(lock);
  }
}

export function duplicateMessage(record) {
  const summary = String(record?.summary || '').trim();
  const when = record?.at ? `（记录于 ${record.at}）` : '';
  return summary
    ? `已执行过，幂等跳过：${summary}${when}`
    : `已执行过，幂等跳过${when}。`;
}

export function findStaleLocks(root, staleMs = DEFAULT_STALE_MS) {
  const dir = lockDir();
  const target = path.resolve(root);
  const stale = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return stale;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.lock')) continue;
    const file = path.join(dir, entry);
    const holder = readLock(file);
    if (!holder || holder.root !== target) continue;
    const at = Number(holder.at || 0);
    if (!Number.isFinite(at) || Date.now() - at > staleMs) {
      stale.push({ file, holder });
    }
  }
  return stale;
}
