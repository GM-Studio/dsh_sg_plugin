import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { confirmGate } from '../src/gates.js';
import { clearStatusCache, computeStatus } from '../src/status.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-next-'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.specgate', 'gates'), { recursive: true });
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'demo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'config.yaml'),
    'version: 1\nenabled: true\nenforcement: hybrid\nparadigm: L1\n',
  );
  fs.writeFileSync(
    path.join(root, 'openspec', 'changes', 'demo', 'proposal.md'),
    '## Intent\nx\n## Scope\ny\n',
  );
  return root;
}

test('next step asks for G1, then G2, before proposing G3', () => {
  const root = makeProject();
  clearStatusCache();
  assert.equal(computeStatus(root, { fresh: true }).nextStep.gate, 'G1');

  confirmGate(root, 'G1');
  clearStatusCache();
  assert.equal(computeStatus(root, { fresh: true }).nextStep.gate, 'G2');

  confirmGate(root, 'G2');
  clearStatusCache();
  assert.equal(computeStatus(root, { fresh: true }).nextStep.gate, 'G3');

  confirmGate(root, 'G3');
  clearStatusCache();
  assert.equal(computeStatus(root, { fresh: true }).nextStep.action, 'create-design');
});

test('tasks drafting with G6 confirmed asks for G7, not G6 again', () => {
  const root = makeProject();
  const change = path.join(root, 'openspec', 'changes', 'demo');
  fs.writeFileSync(
    path.join(change, 'design.md'),
    '## Architecture\nx\n## Technical Approach\ny\n',
  );
  fs.mkdirSync(path.join(change, 'specs', 'login'), { recursive: true });
  fs.writeFileSync(
    path.join(change, 'specs', 'login', 'spec.md'),
    '## Requirements\n\nScenario: login\n',
  );
  fs.writeFileSync(path.join(change, 'tasks.md'), '- [ ] one\n');

  for (const gate of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']) confirmGate(root, gate);

  clearStatusCache();
  assert.equal(computeStatus(root, { fresh: true }).nextStep.gate, 'G7');

  confirmGate(root, 'G7');
  clearStatusCache();
  assert.equal(computeStatus(root, { fresh: true }).nextStep.action, 'implement');

  fs.writeFileSync(path.join(change, 'tasks.md'), '- [x] one\n');
  clearStatusCache();
  assert.equal(computeStatus(root, { fresh: true }).nextStep.gate, 'G8');
});

test('no active change points to /sg-propose once G1/G2 are confirmed', () => {
  const root = makeProject();
  fs.rmSync(path.join(root, 'openspec', 'changes', 'demo'), { recursive: true, force: true });

  clearStatusCache();
  const before = computeStatus(root, { fresh: true });
  assert.match(before.nextStep.text, /先完成 G1\/G2/);

  confirmGate(root, 'G1');
  confirmGate(root, 'G2');
  clearStatusCache();
  const after = computeStatus(root, { fresh: true });
  assert.equal(after.nextStep.action, 'create-change');
  assert.match(after.nextStep.text, /\/sg-propose/);
});
