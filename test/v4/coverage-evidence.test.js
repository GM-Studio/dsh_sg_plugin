import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { reconcileCoverage } from '../../src/v4/coverage-evidence.js';

test('coverage requires fresh reports and never averages away a failing side', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cov-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const backend = path.join(root, 'backend/target/site/jacoco/jacoco.xml');
  const frontend = path.join(root, 'frontend/coverage/coverage-summary.json');
  fs.mkdirSync(path.dirname(backend), { recursive: true });
  fs.mkdirSync(path.dirname(frontend), { recursive: true });
  const java = (lines = 90, branches = 80) =>
    fs.writeFileSync(
      backend,
      `<report><counter type="LINE" covered="${lines}" missed="${100 - lines}"/><counter type="BRANCH" covered="${branches}" missed="${100 - branches}"/></report>`,
    );
  const js = (lines = 90, branches = 80) =>
    fs.writeFileSync(
      frontend,
      JSON.stringify({
        total: {
          lines: { total: 100, covered: lines },
          branches: { total: 100, covered: branches },
        },
      }),
    );
  assert.equal(reconcileCoverage(root).ok, false);
  java();
  js();
  assert.equal(reconcileCoverage(root).ok, true);
  js(79, 100);
  assert.equal(reconcileCoverage(root).ok, false);
  js();
  java(100, 69);
  assert.equal(reconcileCoverage(root).ok, false);
  java();
  fs.utimesSync(backend, new Date(0), new Date(0));
  assert.equal(reconcileCoverage(root, { since: Date.now() }).ok, false);
  java();
  js(101, 80);
  assert.equal(reconcileCoverage(root).ok, false);
  fs.writeFileSync(frontend, '{"total":{}}');
  assert.equal(reconcileCoverage(root).ok, false);
});
