import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createArtifactStore } from '../src/codex/core/artifact-store.js';

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-artifact-store-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('immutable JSON writes are path-bounded and idempotent for identical content', (t) => {
  const root = temp(t);
  const store = createArtifactStore({ projectRoot: root });
  const result = store.writeJson('.specgate/codex/project.json', { projectId: 'p1' });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.hash, /^[a-f0-9]{64}$/);
  const second = store.writeJson('.specgate/codex/project.json', { projectId: 'p1' });
  assert.equal(second.ok, true);
  assert.equal(second.hash, result.hash);
  assert.deepEqual(store.readJson('.specgate/codex/project.json'), {
    ok: true,
    value: { projectId: 'p1' },
    hash: result.hash,
  });
});

test('existing artifact content cannot be overwritten', (t) => {
  const root = temp(t);
  const store = createArtifactStore({ projectRoot: root });
  assert.equal(store.writeJson('delivery.json', { deliveryId: 'one' }).ok, true);
  const conflict = store.writeJson('delivery.json', { deliveryId: 'two' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'ARTIFACT_CONFLICT');
  assert.deepEqual(store.readJson('delivery.json').value, { deliveryId: 'one' });
});

test('absolute paths, traversal, control characters and filesystem root are rejected', (t) => {
  const root = temp(t);
  const store = createArtifactStore({ projectRoot: root });
  for (const relative of ['/absolute.json', '../escape.json', 'a/../../escape.json', 'bad\0id']) {
    const result = store.writeJson(relative, { ok: true });
    assert.equal(result.ok, false, relative);
    assert.equal(result.code, 'UNSAFE_ARTIFACT_PATH');
  }
});

test('symlink parents and symlink artifacts are rejected without writing outside', (t) => {
  const root = temp(t);
  const outside = temp(t);
  fs.symlinkSync(
    outside,
    path.join(root, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const store = createArtifactStore({ projectRoot: root });
  const result = store.writeJson('linked/escape.json', { escaped: true });
  assert.equal(result.code, 'UNSAFE_ARTIFACT_PATH');
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('hardlinked artifacts are rejected and external content remains unchanged', (t) => {
  const root = temp(t);
  const outside = temp(t);
  const external = path.join(outside, 'record.json');
  fs.writeFileSync(external, '{"safe":true}\n');
  fs.linkSync(external, path.join(root, 'record.json'));
  const store = createArtifactStore({ projectRoot: root });
  const read = store.readJson('record.json');
  assert.equal(read.code, 'UNSAFE_ARTIFACT_PATH');
  assert.equal(fs.readFileSync(external, 'utf8'), '{"safe":true}\n');
});

test('oversized and non-JSON artifacts fail closed', (t) => {
  const root = temp(t);
  const store = createArtifactStore({ projectRoot: root, maximumBytes: 64 });
  assert.equal(store.writeJson('large.json', { text: 'x'.repeat(200) }).code, 'ARTIFACT_TOO_LARGE');
  fs.writeFileSync(path.join(root, 'broken.json'), '{broken');
  assert.equal(store.readJson('broken.json').code, 'ARTIFACT_INVALID');
});

test('immutable text artifacts are readable, hashed and conflict-protected', (t) => {
  const root = temp(t);
  const store = createArtifactStore({ projectRoot: root });
  const written = store.writeText('packs/customer.md', '# Delivery\n\nSafe summary.\n');
  assert.equal(written.ok, true, JSON.stringify(written));
  const read = store.readText('packs/customer.md');
  assert.equal(read.ok, true);
  assert.equal(read.value, '# Delivery\n\nSafe summary.\n');
  assert.equal(read.hash, written.hash);
  assert.equal(store.writeText('packs/customer.md', 'other\n').code, 'ARTIFACT_CONFLICT');
});
