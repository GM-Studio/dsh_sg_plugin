import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GATE_ORDER } from '../src/constants.js';
import { confirmGate, readGate } from '../src/gates.js';
import { archiveChange, createChange } from '../src/openspec.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-lifecycle-'));
  fs.mkdirSync(path.join(root, '.specgate', 'gates'), { recursive: true });
  fs.mkdirSync(path.join(root, 'openspec', 'changes'), { recursive: true });
  return root;
}

test('creating a new change invalidates G3-G11 but keeps G1/G2', () => {
  const root = makeProject();
  for (const gate of ['G1', 'G2', 'G3', 'G4', 'G5']) confirmGate(root, gate);

  const created = createChange(root, 'demo', 'demo change');
  assert.ok(fs.existsSync(path.join(created.path, 'proposal.md')));
  assert.equal(readGate(root, 'G1').confirmed, true);
  assert.equal(readGate(root, 'G2').confirmed, true);
  assert.equal(readGate(root, 'G3').confirmed, false);
  assert.equal(readGate(root, 'G4').confirmed, false);
  assert.equal(readGate(root, 'G5').confirmed, false);
});

test('archiving a change clears every gate marker', () => {
  const root = makeProject();
  for (const gate of GATE_ORDER) confirmGate(root, gate);
  createChange(root, 'demo', 'demo change');

  const archived = archiveChange(root, 'demo');
  assert.ok(fs.existsSync(path.join(archived.path, 'proposal.md')));
  for (const gate of GATE_ORDER) {
    assert.equal(readGate(root, gate).satisfied, false, `${gate} should be cleared`);
  }
});
