import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  acquireOperationLock,
  operationKey,
  releaseOperationLock,
} from '../src/idempotency.js';
import { DAY_MS, projectComplete, runMutation } from '../src/mutations.js';
import { initProject } from '../src/init.js';

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-idem-'));
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  return root;
}

test('state mutations are never replayed from an operation record', async () => {
  const root = tmpProject();
  let runs = 0;
  const meta = { command: 'test-state', args: { value: 1 }, target: 'x', ttlMs: 0 };
  const execute = async () => {
    runs += 1;
    return { result: { kind: 'success', text: 'ok' }, record: true };
  };

  assert.equal((await runMutation(root, meta, execute)).text, 'ok');
  assert.equal((await runMutation(root, meta, execute)).text, 'ok');
  assert.equal(runs, 2);
  assert.equal(fs.existsSync(path.join(root, '.specgate', 'state', 'idempotency.json')), false);
});

test('append mutations dedupe for 24h, honor force, and preserve the record', async () => {
  const root = tmpProject();
  let runs = 0;
  const meta = {
    command: 'test-append',
    args: { reason: 'why' },
    target: 'deviation',
    ttlMs: DAY_MS,
  };
  const execute = async () => {
    runs += 1;
    return {
      result: { kind: 'success', text: `appended-${runs}` },
      summary: 'appended',
      record: true,
    };
  };

  assert.equal((await runMutation(root, meta, execute)).text, 'appended-1');
  const duplicate = await runMutation(root, meta, execute);
  assert.match(duplicate.text, /幂等跳过/);
  assert.equal(runs, 1);

  assert.equal((await runMutation(root, { ...meta, force: true }, execute)).text, 'appended-2');
  assert.equal(runs, 2);

  const store = JSON.parse(
    fs.readFileSync(path.join(root, '.specgate', 'state', 'idempotency.json'), 'utf8'),
  );
  assert.equal(Object.keys(store.operations).length, 1);
});

test('a concurrent duplicate is rejected by the operation lock', async () => {
  const root = tmpProject();
  const meta = { command: 'test-lock', args: { a: 1 }, target: 'x', ttlMs: 0 };
  const key = operationKey(root, meta.command, meta.args, meta.target);
  const lock = acquireOperationLock(root, key);
  assert.equal(lock.ok, true);

  let runs = 0;
  const busy = await runMutation(root, meta, async () => {
    runs += 1;
    return { result: { kind: 'success', text: 'should not run' } };
  });
  assert.equal(runs, 0);
  assert.match(busy.text, /正在执行/);

  releaseOperationLock(lock);
  const after = await runMutation(root, meta, async () => {
    runs += 1;
    return { result: { kind: 'success', text: 'ran' } };
  });
  assert.equal(after.text, 'ran');
  assert.equal(runs, 1);
});

test('operation keys are stable and distinguish arguments', () => {
  const root = path.resolve('/tmp/sg-key');
  const a = operationKey(root, 'cmd', { b: 2, a: 1 }, 't');
  const b = operationKey(root, 'cmd', { a: 1, b: 2 }, 't');
  const c = operationKey(root, 'cmd', { a: 1, b: 3 }, 't');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('projectComplete recognizes a fully initialized project and its gaps', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-complete-'));
  assert.equal(projectComplete(root, { git: false }), false);
  initProject(root, { git: false });
  assert.equal(projectComplete(root, { git: false }), true);
  fs.rmSync(path.join(root, '.dsh', 'skills', 'specgate', 'sg-using-skills'), {
    recursive: true,
    force: true,
  });
  assert.equal(projectComplete(root, { git: false }), false);
});
