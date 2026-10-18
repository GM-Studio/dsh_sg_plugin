import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  clearAllGates,
  confirmGate,
  gateRequiredForParadigm,
  invalidateFrom,
  missingGates,
  readGate,
  requiredGatesFor,
  waiveGate,
} from '../src/gates.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-gates-'));
  fs.mkdirSync(path.join(root, '.specgate', 'gates'), { recursive: true });
  return root;
}

test('confirmGate writes a marker and waiveGate replaces it', () => {
  const root = makeProject();
  confirmGate(root, 'G1');
  assert.equal(readGate(root, 'G1').confirmed, true);

  waiveGate(root, 'G1', 'user explicitly skipped');
  const gate = readGate(root, 'G1');
  assert.equal(gate.confirmed, false);
  assert.equal(gate.waived, true);
  assert.equal(gate.reason, 'user explicitly skipped');
  assert.equal(gate.satisfied, true);
});

test('missingGates reports only unsatisfied gates', () => {
  const root = makeProject();
  confirmGate(root, 'G1');
  confirmGate(root, 'G2');
  assert.deepEqual(missingGates(root, ['G1', 'G2', 'G3']), ['G3']);
});

test('L3 exempts requirement/proposal/design/specs gates', () => {
  assert.equal(gateRequiredForParadigm('G1', 'L3'), false);
  assert.equal(gateRequiredForParadigm('G3', 'L3'), false);
  assert.equal(gateRequiredForParadigm('G2', 'L3'), true);
  assert.deepEqual(requiredGatesFor('source', 'L3'), ['G2', 'G6', 'G7']);
  assert.deepEqual(requiredGatesFor('proposal', 'L1'), ['G1', 'G2']);
});

test('invalidateFrom clears the gate and all downstream gates', () => {
  const root = makeProject();
  for (const gate of ['G1', 'G2', 'G3', 'G4', 'G5']) confirmGate(root, gate);
  const removed = invalidateFrom(root, 'G4');
  assert.deepEqual(removed.sort(), ['G4.confirmed', 'G5.confirmed']);
  assert.equal(readGate(root, 'G3').confirmed, true);
  assert.equal(readGate(root, 'G4').confirmed, false);
  assert.equal(readGate(root, 'G5').confirmed, false);
});

test('clearAllGates removes confirmed and waived markers', () => {
  const root = makeProject();
  confirmGate(root, 'G1');
  confirmGate(root, 'G2');
  waiveGate(root, 'G4', 'skip');
  const removed = clearAllGates(root);
  assert.deepEqual(removed.sort(), ['G1.confirmed', 'G2.confirmed', 'G4.waived']);
  assert.equal(readGate(root, 'G1').satisfied, false);
  assert.equal(readGate(root, 'G4').satisfied, false);
});
