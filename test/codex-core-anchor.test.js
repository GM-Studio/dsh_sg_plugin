import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStateStore } from '../src/codex/state-machine.js';

test('external anchor detects simultaneous snapshot and event rollback and missing anchor', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-anchor-project-'));
  const anchorRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-anchor-store-'));
  const store = createStateStore({ projectRoot, anchorRoot });
  assert.equal((await store.create({ expectedVersion: 0, changeId: 'anchor' })).ok, true);
  const directory = path.join(projectRoot, '.specgate/codex');
  const old = ['events.jsonl', 'state.json'].map((file) =>
    fs.readFileSync(path.join(directory, file)),
  );
  assert.equal(
    (await store.update({ expectedVersion: 1, patch: { context: { next: true } } })).ok,
    true,
  );
  const filename = fs.readdirSync(anchorRoot).find((file) => file.endsWith('.jsonl'));
  assert.deepEqual(
    fs
      .readFileSync(path.join(anchorRoot, filename), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).version),
    [1, 2],
  );
  for (const [index, file] of ['events.jsonl', 'state.json'].entries())
    fs.writeFileSync(path.join(directory, file), old[index]);
  assert.equal((await store.inspect()).code, 'ANCHOR_ROLLBACK');
  const anchor = fs.readdirSync(anchorRoot).find((file) => file.endsWith('.jsonl'));
  assert.ok(anchor);
  fs.unlinkSync(path.join(anchorRoot, anchor));
  assert.equal((await store.inspect()).code, 'ANCHOR_MISSING');
});
