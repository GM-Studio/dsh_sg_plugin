import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { archiveChange } from '../../src/v3/archive.js';

test('Java archive and tag require full VERIFIED evidence', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-archive-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.specgate'));
  fs.writeFileSync(
    path.join(root, '.specgate/monorepo.json'),
    JSON.stringify({ stack: 'java-vue', preset: 'jdk17-boot3.5' }),
  );
  fs.writeFileSync(
    path.join(root, '.specgate/init-report.json'),
    JSON.stringify({ phase: 'SMOKE_PASSED', verification: { ok: true } }),
  );
  const result = archiveChange({
    root,
    change: 'sample',
    integrationBranch: 'sg/sample/integration',
    tag: 'sg-v0.1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RELEASE_NOT_VERIFIED');
  assert.match(result.message, /\/sg-verify --full/);
});
