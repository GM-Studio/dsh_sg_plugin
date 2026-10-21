import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVerification, executeVerificationStage } from '../../src/v4/verify-evidence.js';

test('real process evidence preserves full output, arguments, exit code and unexecuted stages', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidence = createVerification(root, { id: 'test', label: 'Test' });
  assert.throws(
    () => evidence.save({ ok: true, status: 'smoke-passed' }),
    /reconciliation incomplete/,
  );
  evidence.save({ ok: false, status: 'running' });
  const stage = await executeVerificationStage({
    root,
    directory: evidence.directory,
    name: 'backend-verify',
    command: process.execPath,
    args: [
      '-e',
      'console.log("first"); for(let i=0;i<40;i++) console.log("line "+i); process.exit(7)',
    ],
    cwd: root,
    env: process.env,
    timeoutMs: 5000,
  });
  evidence.save({ stages: [stage], status: 'failed' });
  assert.equal(stage.status, 7);
  assert.equal(stage.cwd, root);
  assert.ok(stage.startedAt && stage.finishedAt);
  assert.match(fs.readFileSync(path.join(root, stage.log), 'utf8'), /^first/);
  assert.ok(!stage.tail.includes('first'));
  assert.equal(evidence.report.reconciliation.notRun, 6);
  assert.equal(evidence.report.checks[1].status, 'not-run');
  assert.equal(evidence.report.ok, false);
});

test('cancelling a running process terminates it and records cancellation', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-evidence-cancel-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidence = createVerification(root, { id: 'test', label: 'Test' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 150);
  const stage = await executeVerificationStage({
    root,
    directory: evidence.directory,
    name: 'frontend-build',
    command: process.execPath,
    args: ['-e', 'setTimeout(()=>{},30000)'],
    cwd: root,
    env: process.env,
    signal: controller.signal,
    timeoutMs: 5000,
  });
  clearTimeout(timer);
  assert.notEqual(stage.status, 0);
  assert.equal(stage.reason, 'cancelled');
  assert.ok(stage.durationMs < 5000);
});
