import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateReport } from '../../src/v3/report.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-report-'));
}

test('无 AC 标记的既有用例允许作为回归证据', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(root, 'spec', 'old.spec.js'), '', 'utf8');
  const result = validateReport({
    report: {
      schemaVersion: 1,
      cases: [{ id: 'TC-001', ac: [], status: 'pass', file: 'spec/old.spec.js' }],
    },
    deltaAcs: new Set(),
    knownAcs: new Set(),
    mapping: { requirements: [] },
    worktree: root,
    changedFiles: ['spec/new.spec.js'],
    requireChangedFiles: true,
  });
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('有 AC 标记的用例仍要求文件在 diff 中', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'spec'), { recursive: true });
  fs.writeFileSync(path.join(root, 'spec', 'old.spec.js'), '', 'utf8');
  const result = validateReport({
    report: {
      schemaVersion: 1,
      cases: [{ id: 'TC-001', ac: ['AC-001'], status: 'pass', file: 'spec/old.spec.js' }],
    },
    deltaAcs: new Set(['AC-001']),
    knownAcs: new Set(['AC-001']),
    mapping: { requirements: [{ ac: 'AC-001' }] },
    worktree: root,
    changedFiles: ['spec/new.spec.js'],
    requireChangedFiles: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /没有通过的用例/);
});
