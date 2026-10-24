import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { readMysqlTestOptions } from './mysql-test-config.mjs';
import {
  createMysqlBackup,
  restoreMysqlBackup,
} from '../src/codex/core/control/persistence/mysql-backup.js';
import {
  createMysqlPool,
  createMysqlRepository,
  migrateMysql,
  splitMigrationStatements,
} from '../src/codex/core/control/persistence/mysql-repository.js';
import { createMigrationManifest } from '../src/codex/core/control/persistence/migrations.js';

const AT = '2026-10-24T01:00:00.000Z';
const HASH = 'a'.repeat(64);
const WORK = {
  workItemId: 'work-1',
  projectId: 'project-1',
  title: 'MySQL contract',
  executionState: 'DECIDED_PENDING_APPLY',
  revision: 3,
  artifactHash: HASH,
  updatedAt: AT,
};
const ATTENTION = {
  attentionId: 'attention-1',
  workItemId: WORK.workItemId,
  projectId: WORK.projectId,
  scope: 'delivery',
  revision: 1,
  status: 'OPEN',
  artifactHash: HASH,
  workItemVersion: 3,
  expiresAt: '2026-10-25T01:00:00.000Z',
};
const DECISION = {
  decisionId: 'decision-1',
  workItemId: WORK.workItemId,
  attentionId: ATTENTION.attentionId,
  scope: 'delivery',
  attentionRevision: 1,
  expectedWorkItemVersion: 3,
  artifactHash: HASH,
  action: 'approve',
  idempotencyKey: 'Idem-1',
  actorId: 'owner',
  source: 'web',
  authLevel: 'step-up',
  payload: {},
  status: 'PENDING_APPLY',
  createdAt: AT,
};
const audit = (id) => ({
  auditId: id,
  projectId: WORK.projectId,
  actorType: 'system',
  actorId: 'test',
  action: 'CREATE',
  objectType: 'work_item',
  objectId: WORK.workItemId,
  detail: { test: true },
  createdAt: AT,
});
const event = {
  eventId: 'event-1',
  projectId: WORK.projectId,
  workItemId: WORK.workItemId,
  eventType: 'check.completed',
  source: 'worker',
  payload: { result: 'pass' },
  occurredAt: AT,
  receivedAt: AT,
};
const notification = {
  deliveryId: 'notification-1',
  projectId: WORK.projectId,
  workItemId: WORK.workItemId,
  attentionId: ATTENTION.attentionId,
  channel: 'feishu',
  recipient: 'private@example.test',
  kind: 'attention',
  version: 1,
};

test('migration splitting preserves quoted semicolons and escaped quotes', () => {
  assert.deepEqual(
    splitMigrationStatements("-- comment;\nSELECT 'a;b'; SELECT 'it''s'; SELECT `x;y`;"),
    ["SELECT 'a;b'", "SELECT 'it''s'", 'SELECT `x;y`'],
  );
  assert.throws(() => splitMigrationStatements("SELECT 'unclosed"));
});

test('pool refuses missing configuration and overrides unsafe driver flags', async () => {
  assert.throws(() => createMysqlPool({}));
  assert.throws(() => createMysqlRepository({}));
  const pool = createMysqlPool({ database: 'test', multipleStatements: true, dateStrings: false });
  assert.equal(pool.pool.config.connectionConfig.multipleStatements, false);
  assert.equal(pool.pool.config.connectionConfig.dateStrings, true);
  await pool.end();
});

test(
  'real MySQL M1 migration, concurrency, audit, retention and restore',
  { timeout: 60000 },
  async (t) => {
    const options = await readMysqlTestOptions();
    // The supplied account only creates random test databases; existing databases are never touched.
    delete options.database;
    const admin = await mysql.createConnection({
      ...options,
      timezone: 'Z',
      dateStrings: true,
      multipleStatements: false,
    });
    const database = `sg_m1_${randomUUID().replaceAll('-', '')}`.padEnd(64, 'x');
    const restored = `sg_m1_restore_${randomUUID().replaceAll('-', '')}`;
    const pools = [];
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sg-mysql-migration-'));
    t.after(async () => {
      await Promise.all(pools.map((pool) => pool.end()));
      await admin.query(`DROP DATABASE IF EXISTS \`${restored}\``);
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.end();
      await fs.rm(directory, { recursive: true, force: true });
    });
    await admin.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
    );
    const pool = createMysqlPool({ ...options, database, connectionLimit: 6 });
    pools.push(pool);
    let now = Date.parse(AT);
    const repository = createMysqlRepository({ pool, clock: () => now });
    const secondPool = createMysqlPool({ ...options, database, connectionLimit: 3 });
    pools.push(secondPool);
    const other = createMysqlRepository({ pool: secondPool, clock: () => now });
    const [[version]] = await admin.query('SELECT VERSION() AS version');
    t.diagnostic(`MySQL ${version.version}; two pools, nine connection slots; UTC`);
    function passed(result) {
      assert.equal(result.ok, true, JSON.stringify(result));
      return result;
    }

    await t.test(
      'empty database migration, concurrent repeat, checksum and DDL failure recovery',
      async () => {
        passed(await migrateMysql({ pool }));
        const repeats = await Promise.all([
          migrateMysql({ pool }),
          migrateMysql({ pool: secondPool }),
        ]);
        for (const result of repeats) assert.deepEqual(passed(result).applied, []);
        const manifest = await createMigrationManifest();
        assert.equal(
          (
            await migrateMysql({
              pool,
              manifest: manifest.map((m, i) => (i ? m : { ...m, checksum: '0'.repeat(64) })),
            })
          ).code,
          'MIGRATION_CHECKSUM_MISMATCH',
        );
        const failing = [
          ...manifest,
          {
            migrationId: '003-failure',
            checksum: '1'.repeat(64),
            sql: 'CREATE TABLE recovery_probe (id INT); INVALID SQL;',
          },
        ];
        const failed = await migrateMysql({ pool, manifest: failing });
        assert.equal(failed.code, 'MIGRATION_APPLY_FAILED');
        assert.equal(failed.partialEffectsPossible, true);
        assert.equal(failed.migrationId, '003-failure');
        const [tables] = await pool.query("SHOW TABLES LIKE 'recovery_probe'");
        assert.equal(tables.length, 1, 'DDL effects survive rollback');
        const [records] = await pool.query(
          "SELECT * FROM schema_migration WHERE migration_id = '003-failure'",
        );
        assert.equal(records.length, 0);
        await pool.query('DROP TABLE recovery_probe');
        passed(await migrateMysql({ pool }));
      },
    );

    await t.test('project versions and concurrent WorkItem CAS have one winner', async () => {
      passed(
        await repository.saveProject({
          projectId: WORK.projectId,
          name: 'M1',
          evidenceRetentionDays: 1,
          notificationRetentionDays: 1,
          decisionRetentionDays: 1,
          auditRetentionDays: 30,
        }),
      );
      passed(await repository.saveWorkItem(WORK));
      const update = {
        workItemId: WORK.workItemId,
        expectedRevision: 3,
        workItem: { ...WORK, revision: 4 },
      };
      const results = await Promise.all([
        repository.updateWorkItemCas(update),
        other.updateWorkItemCas(update),
      ]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.equal(results.filter((r) => r.code === 'WORK_ITEM_VERSION_CONFLICT').length, 1);
      const reset = { ...WORK, workItemId: 'decision-work' };
      passed(await repository.saveWorkItem(reset));
      const version = passed(await repository.getProject(WORK.projectId)).version;
      passed(
        await repository.updateProjectRetention({
          projectId: WORK.projectId,
          expectedVersion: version,
          evidenceRetentionDays: 1,
        }),
      );
      assert.equal(
        (
          await other.updateProjectRetention({
            projectId: WORK.projectId,
            expectedVersion: version,
            evidenceRetentionDays: 2,
          })
        ).code,
        'PROJECT_VERSION_CONFLICT',
      );
      assert.equal(
        (
          await repository.updateWorkItemCas({
            ...update,
            expectedRevision: 4,
            workItem: { ...WORK, projectId: 'other', revision: 5 },
          })
        ).code,
        'WORK_ITEM_INVALID',
      );
    });

    const d = { ...DECISION, workItemId: 'decision-work' };
    await t.test(
      'Decision and Evidence concurrent retries dedupe and reject conflicting content',
      async () => {
        passed(await repository.saveAttention({ ...ATTENTION, workItemId: d.workItemId }));
        const decisions = await Promise.all([
          repository.recordDecision(d),
          other.recordDecision({ ...d, decisionId: 'replayed-id' }),
        ]);
        decisions.forEach(passed);
        assert.equal(decisions.filter((r) => r.replayed).length, 1);
        assert.equal(new Set(decisions.map((r) => r.decision.decisionId)).size, 1);
        assert.equal(
          (await repository.recordDecision({ ...d, action: 'cancel' })).code,
          'IDEMPOTENCY_CONFLICT',
        );
        assert.equal(
          (
            await repository.recordDecision({
              ...d,
              decisionId: 'mismatch',
              idempotencyKey: 'different',
              projectId: 'other',
            })
          ).code,
          'DECISION_PROJECT_MISMATCH',
        );
        const evidence = await Promise.all([
          repository.appendEvidence(event),
          other.appendEvidence(event),
        ]);
        evidence.forEach(passed);
        assert.equal(evidence.filter((r) => r.duplicate).length, 1);
        assert.equal(
          (await repository.appendEvidence({ ...event, payload: { changed: true } })).code,
          'EVIDENCE_CONFLICT',
        );
        assert.equal(
          (
            await repository.appendEvidence({
              ...event,
              eventId: 'other-event',
              projectId: 'other',
            })
          ).code,
          'EVIDENCE_PROJECT_MISMATCH',
        );
        passed(
          await repository.recordDecision({
            ...d,
            decisionId: 'case-sensitive-key',
            idempotencyKey: 'idem-1',
          }),
        );
      },
    );

    await t.test(
      'Decision applies atomically once, and stale artifact never partially mutates',
      async () => {
        const actual = (await repository.recordDecision(d)).decision;
        const application = {
          decisionId: actual.decisionId,
          workItemId: d.workItemId,
          expectedRevision: 3,
          actorId: 'worker-1',
          at: AT,
        };
        const results = await Promise.all([
          repository.applyDecision(application),
          other.applyDecision(application),
        ]);
        assert.equal(results.filter((r) => r.ok).length, 1);
        assert.equal(results.filter((r) => r.code === 'WORK_ITEM_VERSION_CONFLICT').length, 1);
        assert.equal(
          (await repository.getWorkItem(d.workItemId)).workItem.executionState,
          'RESUMING',
        );
        assert.equal((await repository.getDecision(actual.decisionId)).decision.status, 'APPLIED');
        const stale = await repository.recordDecision({
          ...d,
          decisionId: 'stale',
          idempotencyKey: 'stale',
          expectedWorkItemVersion: 4,
          artifactHash: 'b'.repeat(64),
        });
        passed(stale);
        const w = (await repository.getWorkItem(d.workItemId)).workItem;
        passed(
          await repository.updateWorkItemCas({
            workItemId: w.workItemId,
            expectedRevision: 4,
            workItem: { ...w, executionState: 'DECIDED_PENDING_APPLY', revision: 5 },
          }),
        );
        assert.equal(
          (
            await repository.applyDecision({
              ...application,
              decisionId: 'stale',
              expectedRevision: 5,
            })
          ).code,
          'DECISION_STALE',
        );
        assert.equal((await repository.getDecision('stale')).decision.status, 'PENDING_APPLY');
        assert.equal((await repository.getWorkItem(d.workItemId)).workItem.revision, 5);
      },
    );

    await t.test('notifications dedupe across pools and store only recipient hashes', async () => {
      const input = { ...notification, workItemId: d.workItemId };
      const results = await Promise.all([
        repository.enqueueNotification(input),
        other.enqueueNotification({ ...input, deliveryId: 'duplicate-notification' }),
      ]);
      results.forEach(passed);
      assert.equal(results.filter((r) => r.duplicate).length, 1);
      const delivery = (await repository.listNotifications(WORK.projectId)).deliveries[0];
      assert.equal(delivery.recipient, undefined);
      assert.match(delivery.recipientHash, /^[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(delivery).includes(input.recipient), false);
      assert.equal(
        (await repository.enqueueNotification({ ...input, projectId: 'other' })).code,
        'NOTIFICATION_PROJECT_MISMATCH',
      );
    });

    await t.test(
      'concurrent audit append is contiguous, rejects invalid input and rolls back cleanly',
      async () => {
        const results = await Promise.all(
          Array.from({ length: 16 }, (_, i) =>
            (i % 2 ? repository : other).appendAudit(audit(`audit-${i}`)),
          ),
        );
        results.forEach(passed);
        assert.equal(passed(await repository.verifyAuditChain()).count, 16);
        assert.equal((await repository.appendAudit(audit('audit-0'))).code, 'AUDIT_DUPLICATE');
        assert.equal(
          (await repository.appendAudit({ ...audit('invalid'), action: 'ARBITRARY' })).code,
          'AUDIT_ENTRY_INVALID',
        );
        await pool.query(
          "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected audit failure'",
        );
        assert.equal(
          (await repository.appendAudit(audit('sql-failure'))).code,
          'PERSISTENCE_FAILED',
        );
        await pool.query('DROP TRIGGER reject_audit');
        assert.equal(passed(await repository.verifyAuditChain()).count, 16);
        passed(await repository.appendAudit(audit('after-failure')));
        assert.equal(passed(await repository.verifyAuditChain()).count, 17);
      },
    );

    await t.test(
      'retention deletes atomically with receipt, is isolated, and blocks audit expiry',
      async () => {
        now += 2 * DAY;
        passed(await repository.saveProject({ projectId: 'other' }));
        passed(
          await repository.appendEvidence({
            ...event,
            eventId: 'keep-other',
            workItemId: null,
            projectId: 'other',
          }),
        );
        const before = passed(await repository.verifyAuditChain());
        await pool.query(
          "CREATE TRIGGER reject_purge BEFORE DELETE ON evidence_event FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected purge failure'",
        );
        assert.equal(
          (
            await repository.purgeExpired({
              projectId: WORK.projectId,
              at: new Date(now).toISOString(),
            })
          ).code,
          'PERSISTENCE_FAILED',
        );
        await pool.query('DROP TRIGGER reject_purge');
        assert.deepEqual(await repository.verifyAuditChain(), before);
        assert.equal((await repository.listEvidence(WORK.projectId)).events.length, 1);
        const result = passed(
          await repository.purgeExpired({
            projectId: WORK.projectId,
            at: new Date(now).toISOString(),
          }),
        );
        assert.deepEqual(result.removed, {
          evidence: 1,
          notifications: 1,
          decisions: 3,
          audits: 0,
        });
        assert.equal((await repository.listEvidence('other')).events.length, 1);
        assert.equal((await repository.listEvidence(WORK.projectId)).events.length, 0);
        assert.equal(
          (await repository.listAudit(WORK.projectId)).audits.at(-1).action,
          'RETENTION_PURGE',
        );
        assert.equal(
          (
            await repository.purgeExpired({
              projectId: WORK.projectId,
              at: '2027-10-25T00:00:00.000Z',
            })
          ).code,
          'AUDIT_RETENTION_REQUIRES_ARCHIVE',
        );
      },
    );

    await t.test(
      'backup and restore preserve all table rows, versions and the audit head',
      async () => {
        const [tables] = await pool.query('SHOW TABLES');
        const saved = [];
        for (const row of tables) {
          const name = Object.values(row)[0];
          const [rows] = await pool.query(`SELECT * FROM \`${name}\``);
          saved.push({ name, rows });
        }
        const key = randomBytes(32);
        const backup = passed(await createMysqlBackup({ pool, key })).backup;
        assert.equal(JSON.stringify(backup).includes('private@example.test'), false);
        assert.equal(JSON.stringify(backup).includes('audit-0'), false);
        const backupFile = path.join(directory, 'encrypted-backup.json');
        await fs.writeFile(backupFile, JSON.stringify(backup));
        const envelope = JSON.parse(await fs.readFile(backupFile, 'utf8'));
        await admin.query(
          `CREATE DATABASE \`${restored}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
        );
        const restorePool = createMysqlPool({ ...options, database: restored });
        pools.push(restorePool);
        assert.equal(
          (await restoreMysqlBackup({ pool: restorePool, key: randomBytes(32), backup: envelope }))
            .code,
          'BACKUP_INVALID',
        );
        assert.equal(
          (
            await restoreMysqlBackup({
              pool: restorePool,
              key,
              backup: { ...envelope, tag: randomBytes(16).toString('base64') },
            })
          ).code,
          'BACKUP_INVALID',
        );
        assert.equal((await restorePool.query('SHOW TABLES'))[0].length, 0);
        passed(await restoreMysqlBackup({ pool: restorePool, key, backup: envelope }));
        assert.equal(
          (await restoreMysqlBackup({ pool: restorePool, key, backup: envelope })).code,
          'RESTORE_TARGET_NOT_EMPTY',
        );
        const restoredRepository = createMysqlRepository({ pool: restorePool });
        assert.deepEqual(
          await restoredRepository.verifyAuditChain(),
          await repository.verifyAuditChain(),
        );
        assert.deepEqual(
          await restoredRepository.getWorkItem(WORK.workItemId),
          await repository.getWorkItem(WORK.workItemId),
        );
        assert.deepEqual(
          await restoredRepository.getProject(WORK.projectId),
          await repository.getProject(WORK.projectId),
        );
        assert.deepEqual(passed(await migrateMysql({ pool: restorePool })).applied, []);
        for (const table of saved) {
          const [actual] = await restorePool.query(`SELECT * FROM \`${table.name}\``);
          const canonical = (rows) => rows.map((r) => JSON.stringify(r)).sort();
          assert.deepEqual(canonical(actual), canonical(table.rows), table.name);
        }
      },
    );

    await t.test('tampering and deleted audit tail explicitly fail closed', async () => {
      await pool.execute(
        "UPDATE audit_log SET detail_json = '{\"tampered\":true}' WHERE audit_id = 'audit-0'",
      );
      assert.equal((await repository.verifyAuditChain()).code, 'AUDIT_CORRUPT');
      assert.equal((await repository.listAudit(WORK.projectId)).code, 'AUDIT_CORRUPT');
      assert.equal((await repository.appendAudit(audit('after-tamper'))).code, 'AUDIT_CORRUPT');
      await pool.execute('UPDATE audit_log SET detail_json = ? WHERE audit_id = ?', [
        JSON.stringify({ test: true }),
        'audit-0',
      ]);
      passed(await repository.verifyAuditChain());
      await pool.query('DELETE FROM audit_log ORDER BY sequence DESC LIMIT 1');
      assert.equal((await repository.verifyAuditChain()).code, 'AUDIT_CORRUPT');
    });
  },
);

const DAY = 24 * 60 * 60 * 1000;
