import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyMigrations,
  createMigrationManifest,
  planMigrations,
  readMigrationFiles,
} from '../src/codex/core/control/persistence/migrations.js';

function fixture(files = { '001-initial.sql': 'CREATE TABLE example (id INT);' }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-migrations-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), content);
  }
  return directory;
}

function memoryConnection(applied = []) {
  const calls = [];
  let failAt = null;
  return {
    calls,
    rows: applied,
    failOn(statement) {
      failAt = statement;
    },
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (failAt && sql.includes(failAt)) throw new Error(`injected failure: ${failAt}`);
      if (sql.startsWith('SELECT migration_id, checksum, applied_at FROM schema_migration')) {
        return [this.rows, []];
      }
      return [[], []];
    },
    async beginTransaction() {
      calls.push({ sql: 'BEGIN' });
    },
    async commit() {
      calls.push({ sql: 'COMMIT' });
    },
    async rollback() {
      calls.push({ sql: 'ROLLBACK' });
    },
  };
}

test('manifest is deterministic and detects changed migration bytes', async () => {
  const directory = fixture();
  const first = await createMigrationManifest({ directory });
  const second = await createMigrationManifest({ directory });
  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.match(first[0].checksum, /^[a-f0-9]{64}$/);
  assert.equal(first[0].migrationId, '001-initial');
  fs.writeFileSync(path.join(directory, '001-initial.sql'), 'CREATE TABLE changed (id INT);');
  const changed = await createMigrationManifest({ directory });
  assert.notEqual(changed[0].checksum, first[0].checksum);
});

test('empty database plans all migrations and repeated plan applies none', async () => {
  const directory = fixture({
    '001-initial.sql': 'CREATE TABLE one (id INT);',
    '002-add.sql': 'ALTER TABLE one ADD COLUMN value INT;',
  });
  const manifest = await createMigrationManifest({ directory });
  const empty = planMigrations({ manifest, applied: [] });
  assert.deepEqual(
    empty.pending.map((entry) => entry.migrationId),
    ['001-initial', '002-add'],
  );
  const repeated = planMigrations({
    manifest,
    applied: manifest.map((entry) => ({ ...entry, appliedAt: '2026-10-23T00:00:00.000Z' })),
  });
  assert.deepEqual(repeated.pending, []);
});

test('checksum mismatch and unknown applied migrations fail closed', async () => {
  const directory = fixture();
  const manifest = await createMigrationManifest({ directory });
  assert.equal(
    planMigrations({
      manifest,
      applied: [{ migrationId: manifest[0].migrationId, checksum: '0'.repeat(64) }],
    }).code,
    'MIGRATION_CHECKSUM_MISMATCH',
  );
  assert.equal(
    planMigrations({
      manifest,
      applied: [{ migrationId: '999-unknown', checksum: '0'.repeat(64) }],
    }).code,
    'MIGRATION_UNKNOWN_APPLIED',
  );
});

test('applyMigrations applies pending entries in order in one transaction', async () => {
  const directory = fixture({
    '001-initial.sql': 'CREATE TABLE one (id INT);',
    '002-add.sql': 'ALTER TABLE one ADD COLUMN value INT;',
  });
  const connection = memoryConnection();
  const result = await applyMigrations({ directory, connection });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.applied.map((entry) => entry.migrationId),
    ['001-initial', '002-add'],
  );
  assert.equal(connection.calls[0].sql, 'BEGIN');
  assert.equal(connection.calls.at(-1).sql, 'COMMIT');
  assert.equal(
    connection.calls.some((call) => call.sql === 'ROLLBACK'),
    false,
  );
  assert.equal(
    connection.calls.filter((call) => /^(CREATE TABLE|ALTER TABLE)/.test(call.sql)).length,
    2,
  );
});

test('partial failure requests rollback and reports that DDL may have partially applied', async () => {
  const directory = fixture({
    '001-initial.sql': 'CREATE TABLE one (id INT);',
    '002-add.sql': 'ALTER TABLE one ADD COLUMN value INT;',
  });
  const connection = memoryConnection();
  connection.failOn('ALTER TABLE');
  const result = await applyMigrations({ directory, connection });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MIGRATION_APPLY_FAILED');
  assert.equal(result.migrationId, '002-add');
  assert.equal(connection.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(
    connection.calls.some((call) => call.sql === 'COMMIT'),
    false,
  );
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(result.partialEffectsPossible, true);
  assert.match(result.recovery, /schema_migration/);
});

test('duplicate migration ids fail closed before any database write', async () => {
  const directory = fixture();
  const manifest = await createMigrationManifest({ directory });
  const connection = memoryConnection();
  const result = await applyMigrations({
    directory,
    manifest: [manifest[0], manifest[0]],
    connection,
  });
  assert.equal(result.code, 'MIGRATION_MANIFEST_INVALID');
  assert.equal(connection.calls.length, 0);
});

test('applyMigrations refuses checksum drift before writing', async () => {
  const directory = fixture();
  const manifest = await createMigrationManifest({ directory });
  const connection = memoryConnection([
    { migration_id: manifest[0].migrationId, checksum: '0'.repeat(64) },
  ]);
  const result = await applyMigrations({ directory, manifest, connection });
  assert.equal(result.code, 'MIGRATION_CHECKSUM_MISMATCH');
  assert.equal(
    connection.calls.some(
      (call) =>
        /^(CREATE TABLE|ALTER TABLE)/.test(call.sql) ||
        call.sql.includes('INSERT INTO schema_migration'),
    ),
    false,
  );
  assert.equal(connection.calls.at(-1).sql, 'ROLLBACK');
});

test('migration files must be numbered sql files', async () => {
  const directory = fixture({ 'readme.txt': 'not a migration' });
  assert.equal((await readMigrationFiles({ directory })).code, 'MIGRATION_MANIFEST_INVALID');
});
