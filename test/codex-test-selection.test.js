import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MYSQL_TEST_FILES, selectTestFiles } from '../scripts/run-tests.mjs';

test('core and explicit MySQL suites partition every regression without dropping tests', () => {
  const all = selectTestFiles('all');
  const core = selectTestFiles('core');
  const mysql = selectTestFiles('mysql');
  assert.deepEqual(mysql, [...MYSQL_TEST_FILES].sort());
  assert.deepEqual([...core, ...mysql].sort(), all);
  assert.equal(new Set([...core, ...mysql]).size, all.length);
  assert.ok(core.includes('codex-state-kernel.test.js'));
  assert.ok(core.includes('codex-development-flow.test.js'));
  assert.throws(() => selectTestFiles('unknown'), /Test suite/);
});

test('a new database-dependent test requires an explicit suite decision', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-suite-policy-'));
  for (const file of MYSQL_TEST_FILES) fs.writeFileSync(path.join(directory, file), '');
  fs.writeFileSync(
    path.join(directory, 'new-database.test.js'),
    "import mysql from 'mysql2/promise';\n",
  );
  assert.throws(() => selectTestFiles('core', directory), /EXTERNAL_TEST_CLASSIFICATION_REQUIRED/);
});
