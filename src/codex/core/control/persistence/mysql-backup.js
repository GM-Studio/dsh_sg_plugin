import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createMigrationManifest, planMigrations } from './migrations.js';
import { verifyMysqlAuditChain, migrateMysql } from './mysql-repository.js';
import { failure } from './repository-contract.js';

const TABLES = Object.freeze([
  'schema_migration',
  'control_user',
  'device',
  'auth_session',
  'project',
  'worker',
  'project_worker',
  'work_item',
  'execution_run',
  'lease',
  'attention',
  'decision',
  'evidence_event',
  'notification_delivery',
  'delivery',
  'audit_log',
  'repository_head',
]);
const MAX_BYTES = 32 * 1024 * 1024;
const AAD = Buffer.from('specgate-mysql-backup-v1');
const validKey = (key) => Buffer.isBuffer(key) && key.length === 32;

// Keys are supplied by the local operator and are never part of the backup envelope.
export async function createMysqlBackup({ pool, key } = {}) {
  if (!validKey(key)) return failure('BACKUP_KEY_INVALID', 'A 32-byte backup key is required');
  let db;
  let locked = false;
  try {
    db = await pool.getConnection();
    const [[lock]] = await db.query(
      "SELECT GET_LOCK(CONCAT('sg-migrate-', LEFT(SHA2(DATABASE(), 256), 48)), 10) AS acquired",
    );
    locked = lock.acquired === 1;
    if (!locked) return failure('BACKUP_BUSY', 'A migration or backup holds the database lock');
    await db.beginTransaction();
    await db.query('SELECT * FROM repository_head WHERE singleton = 1 FOR UPDATE');
    const verified = await verifyMysqlAuditChain(db);
    if (!verified.ok) throw Object.assign(new Error(), { code: verified.code });
    const snapshot = { version: 1, tables: [] };
    let bytes = 0;
    for (const name of TABLES) {
      // Bound each read as well as the complete encrypted artifact.
      const [[{ count }]] = await db.query(`SELECT COUNT(*) AS count FROM ${name}`);
      if (Number(count) > 100000) throw Object.assign(new Error(), { code: 'BACKUP_LIMIT' });
      const [rows] = await db.query(`SELECT * FROM ${name}`);
      bytes += Buffer.byteLength(JSON.stringify(rows));
      if (bytes > MAX_BYTES) throw Object.assign(new Error(), { code: 'BACKUP_LIMIT' });
      snapshot.tables.push({ name, rows });
    }
    await db.commit();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(snapshot), 'utf8'),
      cipher.final(),
    ]);
    return {
      ok: true,
      backup: {
        version: 1,
        algorithm: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      },
    };
  } catch (error) {
    if (db) {
      try {
        await db.rollback();
      } catch {
        db.destroy();
        db = null;
      }
    }
    return failure('BACKUP_FAILED', 'Encrypted logical backup failed', {
      cause: error.code ?? null,
    });
  } finally {
    if (locked && db) {
      try {
        await db.query(
          "SELECT RELEASE_LOCK(CONCAT('sg-migrate-', LEFT(SHA2(DATABASE(), 256), 48)))",
        );
      } catch {
        db.destroy();
        db = null;
      }
    }
    db?.release();
  }
}

export async function restoreMysqlBackup({ pool, key, backup } = {}) {
  if (!validKey(key)) return failure('BACKUP_KEY_INVALID', 'A 32-byte backup key is required');
  let snapshot;
  try {
    if (
      backup?.version !== 1 ||
      backup.algorithm !== 'aes-256-gcm' ||
      typeof backup.ciphertext !== 'string' ||
      backup.ciphertext.length > MAX_BYTES * 1.5
    )
      throw new Error('Invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(backup.iv, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(backup.tag, 'base64'));
    snapshot = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(backup.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf8'),
    );
    if (
      snapshot.version !== 1 ||
      JSON.stringify(snapshot.tables.map((t) => t.name)) !== JSON.stringify(TABLES) ||
      snapshot.tables.some((t) => !Array.isArray(t.rows))
    )
      throw new Error('Invalid tables');
    const manifest = await createMigrationManifest();
    const plan = planMigrations({ manifest, applied: snapshot.tables[0].rows });
    if (!plan.ok || plan.pending.length)
      return failure('BACKUP_SCHEMA_MISMATCH', 'Backup must match the current migration manifest');
  } catch {
    return failure('BACKUP_INVALID', 'Backup authentication or structure validation failed');
  }
  let db;
  let changed = false;
  try {
    const [tables] = await pool.query('SHOW TABLES');
    if (tables.length)
      return failure('RESTORE_TARGET_NOT_EMPTY', 'Restore requires a dedicated empty database');
    changed = true;
    const migrated = await migrateMysql({ pool });
    if (!migrated.ok) return { ...migrated, partialEffectsPossible: true };
    db = await pool.getConnection();
    await db.beginTransaction();
    await db.query('SELECT * FROM repository_head WHERE singleton = 1 FOR UPDATE');
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    await db.query('DELETE FROM repository_head');
    for (const row of snapshot.tables[0].rows) {
      await db.execute(
        'UPDATE schema_migration SET applied_at = ? WHERE migration_id = ? AND checksum = ?',
        [row.applied_at, row.migration_id, row.checksum],
      );
    }
    for (const { name, rows } of snapshot.tables.slice(1)) {
      const [columns] = await db.query(`SHOW COLUMNS FROM ${name}`);
      const writable = columns.filter((c) => !c.Extra.includes('GENERATED')).map((c) => c.Field);
      for (const row of rows) {
        if (Object.keys(row).some((k) => !columns.some((c) => c.Field === k)))
          throw new Error('Unknown backup column');
        const values = writable.map((c) =>
          row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c],
        );
        await db.execute(
          `INSERT INTO ${name} (${writable.map((c) => `\`${c}\``).join(',')}) VALUES (${writable.map(() => '?').join(',')})`,
          values,
        );
      }
    }
    // Re-enabling FK checks does not revalidate existing rows; explicitly inspect every FK.
    const [foreignKeys] = await db.query(
      'SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL',
    );
    for (const fk of foreignKeys) {
      const {
        TABLE_NAME: table,
        COLUMN_NAME: column,
        REFERENCED_TABLE_NAME: parent,
        REFERENCED_COLUMN_NAME: target,
      } = fk;
      if (
        ![table, parent].every((n) => TABLES.includes(n)) ||
        ![column, target].every((n) => /^[a-z_]+$/.test(n))
      )
        throw new Error('Unexpected foreign key');
      const [orphans] = await db.query(
        `SELECT 1 FROM ${table} c LEFT JOIN ${parent} p ON c.\`${column}\` = p.\`${target}\` WHERE c.\`${column}\` IS NOT NULL AND p.\`${target}\` IS NULL LIMIT 1`,
      );
      if (orphans.length) throw new Error('Orphaned backup reference');
    }
    // Verify within this transaction, so damaged audit data cannot be committed.
    const verified = await verifyMysqlAuditChain(db);
    if (!verified.ok) throw Object.assign(new Error(), { code: verified.code });
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
    await db.commit();
    return { ok: true, tables: TABLES.length, audit: verified };
  } catch (error) {
    if (db) {
      try {
        await db.rollback();
      } catch {
        db.destroy();
        db = null;
      }
    }
    return failure(
      'RESTORE_FAILED',
      'Restore failed; inspect the dedicated target database before retrying',
      { cause: error.code ?? null, partialEffectsPossible: changed },
    );
  } finally {
    if (db) {
      try {
        await db.query('SET FOREIGN_KEY_CHECKS = 1');
      } catch {
        db.destroy();
        db = null;
      }
      db?.release();
    }
  }
}
