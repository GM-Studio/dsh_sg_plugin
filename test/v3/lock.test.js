import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquire, inspect, release, lockPath } from '../../src/v3/lock.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-lock-'));
}

function writeLock(root, record) {
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(lockPath(root), `${JSON.stringify(record)}\n`, 'utf8');
}

test('acquire 后 inspect 显示已锁定', () => {
  const root = tempRoot();
  const result = acquire(root);
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(lockPath(root)), true);
  const state = inspect(root);
  assert.equal(state.locked, true);
  assert.equal(state.holder.pid, process.pid);
});

test('同一进程重复 acquire 被拒', () => {
  const root = tempRoot();
  assert.equal(acquire(root).ok, true);
  const second = acquire(root);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'LOCKED');
});

test('release 后可以重新获取', () => {
  const root = tempRoot();
  acquire(root);
  const released = release(root);
  assert.equal(released.ok, true);
  assert.equal(released.released, true);
  assert.equal(acquire(root).ok, true);
});

test('死进程的锁可以被接管', () => {
  const root = tempRoot();
  writeLock(root, {
    pid: 2147483646,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    host: 'test',
  });
  const result = acquire(root);
  assert.equal(result.ok, true);
  assert.equal(inspect(root).holder.pid, process.pid);
});

test('force 可以接管存活进程的锁', () => {
  const root = tempRoot();
  assert.equal(acquire(root).ok, true);
  const forced = acquire(root, { force: true });
  assert.equal(forced.ok, true);
});

test('非持有者不能 release', () => {
  const root = tempRoot();
  writeLock(root, {
    pid: 2147483646,
    startedAt: new Date().toISOString(),
    host: 'test',
  });
  const result = release(root);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NOT_OWNER');
});

test('损坏的锁文件视为未锁定', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(lockPath(root), 'garbage', 'utf8');
  const state = inspect(root);
  assert.equal(state.locked, false);
  assert.equal(state.corrupt, true);
  assert.equal(acquire(root).ok, true);
});
