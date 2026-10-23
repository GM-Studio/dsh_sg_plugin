import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '../../util/hash.js';

const DEFAULT_DIRECTORY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION_FILE = /^(\d{3,})-([a-z0-9][a-z0-9-]*)\.sql$/;
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

function normalizeApplied(rows = []) {
  return rows.map((row) => ({
    migrationId: row.migrationId ?? row.migration_id,
    checksum: row.checksum,
    appliedAt: row.appliedAt ?? row.applied_at ?? null,
  }));
}

function normalizeManifest(manifest) {
  return manifest.map((entry) => ({
    migrationId: entry.migrationId,
    checksum: entry.checksum,
    sql: entry.sql,
  }));
}

export async function readMigrationFiles({ directory = DEFAULT_DIRECTORY } = {}) {
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    return failure('MIGRATION_DIRECTORY_UNREADABLE', 'Migration directory cannot be read', {
      cause: error.code ?? null,
    });
  }
  const sqlFiles = names.filter((name) => name.endsWith('.sql')).sort();
  if (sqlFiles.length === 0)
    return failure('MIGRATION_MANIFEST_INVALID', 'No SQL migrations were found');
  const invalid = sqlFiles.find((name) => !MIGRATION_FILE.test(name));
  if (invalid)
    return failure('MIGRATION_MANIFEST_INVALID', 'Migration filenames must be numbered and safe', {
      file: invalid,
    });
  const entries = [];
  for (const name of sqlFiles) {
    const sql = await fs.readFile(path.join(directory, name), 'utf8');
    if (!sql.trim())
      return failure('MIGRATION_MANIFEST_INVALID', 'Migration file is empty', { file: name });
    entries.push({
      migrationId: name.replace(/\.sql$/, ''),
      file: name,
      checksum: sha256(sql),
      sql,
    });
  }
  return { ok: true, entries };
}

export async function createMigrationManifest({ directory = DEFAULT_DIRECTORY } = {}) {
  const loaded = await readMigrationFiles({ directory });
  if (!loaded.ok) return loaded;
  return loaded.entries;
}

export function planMigrations({ manifest, applied = [] } = {}) {
  if (!Array.isArray(manifest))
    return failure('MIGRATION_MANIFEST_INVALID', 'Migration manifest must be an array');
  const entries = normalizeManifest(manifest);
  const migrationIds = new Set();
  for (const entry of entries) {
    if (
      typeof entry.migrationId !== 'string' ||
      entry.migrationId.length === 0 ||
      typeof entry.checksum !== 'string' ||
      typeof entry.sql !== 'string'
    )
      return failure('MIGRATION_MANIFEST_INVALID', 'Migration manifest entries are invalid');
    if (migrationIds.has(entry.migrationId))
      return failure('MIGRATION_MANIFEST_INVALID', 'Migration manifest contains duplicate ids', {
        migrationId: entry.migrationId,
      });
    migrationIds.add(entry.migrationId);
  }
  const byId = new Map(entries.map((entry) => [entry.migrationId, entry]));
  const normalizedApplied = normalizeApplied(applied);
  for (const row of normalizedApplied) {
    const entry = byId.get(row.migrationId);
    if (!entry)
      return failure(
        'MIGRATION_UNKNOWN_APPLIED',
        'Applied migration is missing from the manifest',
        {
          migrationId: row.migrationId,
        },
      );
    if (entry.checksum !== row.checksum)
      return failure('MIGRATION_CHECKSUM_MISMATCH', 'Applied migration bytes have changed', {
        migrationId: row.migrationId,
      });
  }
  const appliedIds = new Set(normalizedApplied.map((row) => row.migrationId));
  return {
    ok: true,
    pending: entries.filter((entry) => !appliedIds.has(entry.migrationId)),
    applied: normalizedApplied,
  };
}

async function loadApplied(connection) {
  const [rows] = await connection.query(
    'SELECT migration_id, checksum, applied_at FROM schema_migration ORDER BY migration_id',
  );
  return rows;
}

export async function applyMigrations({
  directory = DEFAULT_DIRECTORY,
  manifest,
  connection,
} = {}) {
  if (
    !connection ||
    typeof connection.query !== 'function' ||
    typeof connection.beginTransaction !== 'function' ||
    typeof connection.commit !== 'function' ||
    typeof connection.rollback !== 'function'
  )
    return failure(
      'MIGRATION_CONNECTION_INVALID',
      'A transactional database connection is required',
    );
  let entries = manifest;
  if (!entries) {
    const loaded = await createMigrationManifest({ directory });
    if (!Array.isArray(loaded)) return loaded;
    entries = loaded;
  }
  if (!Array.isArray(entries))
    return failure('MIGRATION_MANIFEST_INVALID', 'Migration manifest must be an array');
  const validation = planMigrations({ manifest: entries, applied: [] });
  if (!validation.ok) return validation;
  let transactionStarted = false;
  let current = null;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    let applied;
    try {
      applied = await loadApplied(connection);
    } catch (error) {
      if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
      applied = [];
    }
    const plan = planMigrations({ manifest: entries, applied });
    if (!plan.ok) {
      await connection.rollback();
      return plan;
    }
    for (const entry of plan.pending) {
      current = entry;
      await connection.query(entry.sql);
      await connection.query(
        'INSERT INTO schema_migration (migration_id, checksum, applied_at) VALUES (?, ?, ?)',
        [entry.migrationId, entry.checksum, new Date().toISOString()],
      );
    }
    await connection.commit();
    return {
      ok: true,
      applied: plan.pending.map((entry) => ({
        migrationId: entry.migrationId,
        checksum: entry.checksum,
      })),
    };
  } catch (error) {
    current = current ?? null;
    let rollbackSucceeded = false;
    try {
      if (transactionStarted) {
        await connection.rollback();
        rollbackSucceeded = true;
      }
    } catch {
      rollbackSucceeded = false;
    }
    return failure(
      'MIGRATION_APPLY_FAILED',
      'Migration failed; inspect schema_migration and table structure before retrying',
      {
        migrationId: current?.migrationId ?? null,
        cause: error.code ?? null,
        rollbackAttempted: transactionStarted,
        rollbackSucceeded,
        partialEffectsPossible: transactionStarted,
        recovery:
          'Inspect schema_migration and the actual table structure; repair the failing migration before rerunning.',
      },
    );
  }
}
