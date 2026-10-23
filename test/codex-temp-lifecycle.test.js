import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTemporaryDirectory, withTemporaryDirectory } from '../src/codex/core/temp.js';
import { verifyMatrix } from '../scripts/verify-codex-matrix.mjs';
import { runPilot } from '../scripts/codex-delivery-pilot.mjs';

const setupTemp = fileURLToPath(new URL('./setup-temp.mjs', import.meta.url));

function sandbox(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-temp-lifecycle-test-'));
  t.after(() =>
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
  );
  return directory;
}

function isolatedEnvironment(temporaryRoot) {
  return {
    ...process.env,
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    TMPDIR: temporaryRoot,
    SPECGATE_TEST_TEMP_ROOT: '',
    SPECGATE_TEST_TEMP_OWNER_PID: '',
  };
}

test('managed temporary directory is removed after success', async (t) => {
  const parent = sandbox(t);
  let created;
  const value = await withTemporaryDirectory(
    'sg-managed-',
    async (directory) => {
      created = directory;
      fs.writeFileSync(path.join(directory, 'artifact.txt'), 'temporary');
      return 'done';
    },
    { parent },
  );

  assert.equal(value, 'done');
  assert.equal(fs.existsSync(created), false);
});

test('managed temporary directory is removed after callback failure', async (t) => {
  const parent = sandbox(t);
  let created;

  await assert.rejects(
    withTemporaryDirectory(
      'sg-managed-',
      async (directory) => {
        created = directory;
        fs.mkdirSync(path.join(directory, 'nested'));
        throw new Error('expected failure');
      },
      { parent },
    ),
    /expected failure/,
  );
  assert.equal(fs.existsSync(created), false);
});

test('managed cleanup is idempotent and targets only its created directory', (t) => {
  const parent = sandbox(t);
  const unrelated = path.join(parent, 'unrelated');
  fs.mkdirSync(unrelated);
  const temporary = createTemporaryDirectory('sg-managed-', { parent });
  fs.writeFileSync(path.join(temporary.path, 'artifact.txt'), 'temporary');

  temporary.cleanup();
  temporary.cleanup();

  assert.equal(fs.existsSync(temporary.path), false);
  assert.equal(fs.existsSync(unrelated), true);
});

test('test bootstrap scavenges only stale marked runs and removes its own run', (t) => {
  const parent = sandbox(t);
  const managed = path.join(parent, 'specgate-codex-tests');
  const stale = path.join(managed, 'run-stale');
  const unmarked = path.join(managed, 'run-unmarked');
  fs.mkdirSync(stale, { recursive: true });
  fs.mkdirSync(unmarked, { recursive: true });
  fs.writeFileSync(
    path.join(stale, '.specgate-test-temp.json'),
    JSON.stringify({
      schemaVersion: 1,
      ownerPid: 2147483647,
      createdAt: '2020-01-01T00:00:00.000Z',
    }),
  );
  fs.writeFileSync(path.join(stale, 'leftover.txt'), 'stale');
  fs.writeFileSync(path.join(unmarked, 'keep.txt'), 'keep');
  const setupUrl = pathToFileURL(setupTemp).href;
  const program = [
    "const os=require('node:os')",
    "const fs=require('node:fs')",
    "const path=require('node:path')",
    "const {spawnSync}=require('node:child_process')",
    "fs.writeFileSync(path.join(os.tmpdir(),'child.txt'),'ok')",
    `const nested=spawnSync(process.execPath,['--import',${JSON.stringify(setupUrl)},'--eval',"process.stdout.write(require('node:os').tmpdir())"],{encoding:'utf8',env:process.env,windowsHide:true})`,
    'if(nested.status!==0)throw new Error(nested.stderr)',
    'process.stdout.write(JSON.stringify({parent:os.tmpdir(),worker:nested.stdout,npmCache:process.env.npm_config_cache}))',
  ].join(';');

  const child = spawnSync(process.execPath, ['--import', setupUrl, '--eval', program], {
    encoding: 'utf8',
    env: isolatedEnvironment(parent),
    windowsHide: true,
  });

  assert.equal(child.status, 0, child.stderr);
  const roots = JSON.parse(child.stdout);
  assert.match(roots.parent, /specgate-codex-tests[\\/]run-/);
  assert.equal(roots.worker, roots.parent);
  assert.equal(roots.npmCache, path.join(roots.parent, 'npm-cache'));
  assert.equal(fs.existsSync(roots.parent), false);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(unmarked), true);
});

test('matrix workspace is removed after a completed run', async (t) => {
  const parent = sandbox(t);
  const output = path.join(parent, 'matrix-evidence');
  const report = await verifyMatrix({ output, concurrency: Number.NaN });

  assert.equal(report.workspaceCleanup.status, 'removed');
  assert.equal(fs.existsSync(report.workspace), false);
  assert.equal(fs.existsSync(path.join(output, 'matrix.json')), true);
});

test('matrix workspace is removed when orchestration throws', async (t) => {
  const parent = sandbox(t);
  const output = path.join(parent, 'matrix-failure-evidence');
  const concurrency = {
    valueOf() {
      throw new Error('forced matrix failure');
    },
  };

  await assert.rejects(verifyMatrix({ output, concurrency }), /forced matrix failure/);
  const report = JSON.parse(fs.readFileSync(path.join(output, 'matrix.json'), 'utf8'));
  assert.equal(report.workspaceCleanup.status, 'removed');
  assert.equal(fs.existsSync(report.workspace), false);
});

test('delivery pilot workspace is removed after success and failure', async (t) => {
  const parent = sandbox(t);
  const successfulOutput = path.join(parent, 'pilot-success');
  const successful = await runPilot({ output: successfulOutput, presets: [], scenarios: [] });
  assert.equal(successful.workspaceCleanup.status, 'removed');
  assert.equal(fs.existsSync(successful.workspace), false);

  const failedOutput = path.join(parent, 'pilot-failure');
  await assert.rejects(runPilot({ output: failedOutput, presets: null, scenarios: [] }));
  const failed = JSON.parse(fs.readFileSync(path.join(failedOutput, 'pilot.json'), 'utf8'));
  assert.equal(failed.workspaceCleanup.status, 'removed');
  assert.equal(fs.existsSync(failed.workspace), false);
});
