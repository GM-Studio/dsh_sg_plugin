import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { createConfiguredWorkerGateway } from '../src/codex/control/worker-runtime.js';

function controlService() {
  return {
    claimNext: async () => ({ ok: true, idle: true }),
    inspect: async () => ({ ok: true, state: { decisions: {}, workItems: {} } }),
  };
}

test('local Worker runtime uses an in-memory registry without cloud inbound access', async () => {
  const runtime = await createConfiguredWorkerGateway({
    config: {},
    controlService: controlService(),
  });
  assert.equal(runtime.ok, true);
  assert.equal(runtime.storage, 'memory');
  const registered = await runtime.workerGateway.register({
    displayName: 'Local worker',
    projectIds: ['project-1'],
    capabilities: { codex: 'exec-json' },
    actorId: 'owner',
  });
  assert.equal(registered.ok, true);
  assert.match(registered.token, /^sgw_/);
  const authenticated = await runtime.workerGateway.authenticate({ token: registered.token });
  assert.equal(authenticated.ok, true);
  await runtime.close();
});

test(
  'configured Worker runtime persists registry and rotation in MySQL',
  {
    skip:
      !process.env.SPECGATE_MYSQL_TEST_CONFIG &&
      'NOT_RUN: set SPECGATE_MYSQL_TEST_CONFIG to a local JSON connection file',
    timeout: 60000,
  },
  async (t) => {
    const adminOptions = JSON.parse(
      await fs.readFile(process.env.SPECGATE_MYSQL_TEST_CONFIG, 'utf8'),
    );
    delete adminOptions.database;
    const admin = await mysql.createConnection({
      ...adminOptions,
      timezone: 'Z',
      dateStrings: true,
      multipleStatements: false,
    });
    const database = `sg_worker_runtime_${randomUUID().replaceAll('-', '')}`;
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sg-worker-runtime-'));
    const configPath = path.join(directory, 'mysql.json');
    t.after(async () => {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await admin.end();
      await fs.rm(directory, { recursive: true, force: true });
    });
    await admin.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin`,
    );
    await fs.writeFile(
      configPath,
      JSON.stringify({ ...adminOptions, database, connectionLimit: 6 }),
      'utf8',
    );
    const config = { mysqlConfigPath: configPath };
    const first = await createConfiguredWorkerGateway({
      config,
      controlService: controlService(),
    });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.storage, 'mysql');
    const projectDatabase = await mysql.createConnection({
      ...adminOptions,
      database,
      timezone: 'Z',
      dateStrings: true,
      multipleStatements: false,
    });
    await projectDatabase.execute(
      `INSERT INTO project (
         project_id, name, root_hash, control_mode, status, created_at, updated_at
       ) VALUES (?, ?, ?, 'aggregate', 'READY', ?, ?)`,
      [
        'project-1',
        'Project one',
        'a'.repeat(64),
        '2026-10-24 03:00:00.000',
        '2026-10-24 03:00:00.000',
      ],
    );
    await projectDatabase.end();
    const registered = await first.workerGateway.register({
      displayName: 'Persistent worker',
      projectIds: ['project-1'],
      capabilities: { codex: 'exec-json' },
      actorId: 'owner',
    });
    assert.equal(registered.ok, true, JSON.stringify(registered));
    const rotated = await first.workerGateway.rotateToken({
      workerId: registered.worker.workerId,
      actorId: 'owner',
    });
    assert.equal(rotated.ok, true, JSON.stringify(rotated));
    const oldToken = await first.workerGateway.authenticate({ token: registered.token });
    assert.equal(oldToken.code, 'WORKER_AUTH_INVALID');
    await first.close();

    const second = await createConfiguredWorkerGateway({
      config,
      controlService: controlService(),
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    const listed = await second.workerGateway.listWorkers();
    assert.equal(listed.ok, true);
    assert.equal(
      listed.workers.some((worker) => worker.workerId === registered.worker.workerId),
      true,
    );
    const connected = await second.workerGateway.connect({ token: rotated.token });
    assert.equal(connected.ok, true, JSON.stringify(connected));
    const authenticated = await second.workerGateway.authenticate({ token: rotated.token });
    assert.equal(authenticated.ok, true, JSON.stringify(authenticated));
    await second.close();
  },
);
