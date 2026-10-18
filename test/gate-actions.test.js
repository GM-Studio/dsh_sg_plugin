import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readDeviations } from '../src/deviations.js';
import { performGateAction } from '../src/gate-actions.js';
import { confirmGate, readGate } from '../src/gates.js';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-gate-action-'));
  fs.mkdirSync(path.join(root, '.specgate', 'gates'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'config.yaml'),
    'version: 1\nenabled: true\nenforcement: hybrid\ngit: false\n',
  );
  return root;
}

function ctxAnswering(selected) {
  return {
    get(name) {
      if (name !== 'userQuestions') return undefined;
      return {
        async ask() {
          return { answers: [{ id: 'sg-gate', selected: [selected] }] };
        },
      };
    },
  };
}

test('confirm writes G1 when the user chooses 通过', async () => {
  const root = makeRoot();
  const result = await performGateAction(ctxAnswering('通过'), null, undefined, root, {
    gate: 'G1',
    action: 'confirm',
  });
  assert.equal(result.ok, true);
  assert.equal(readGate(root, 'G1').confirmed, true);
});

test('confirm leaves the gate open when the user chooses 需要修改', async () => {
  const root = makeRoot();
  confirmGate(root, 'G1');
  const result = await performGateAction(ctxAnswering('需要修改'), null, undefined, root, {
    gate: 'G2',
    action: 'confirm',
  });
  assert.equal(result.ok, false);
  assert.equal(readGate(root, 'G2').confirmed, false);
});

test('waive requires a reason, asks for confirmation and records a deviation', async () => {
  const root = makeRoot();

  const missingReason = await performGateAction(ctxAnswering('确认跳过'), null, undefined, root, {
    gate: 'G4',
    action: 'waive',
  });
  assert.equal(missingReason.ok, false);

  const result = await performGateAction(ctxAnswering('确认跳过'), null, undefined, root, {
    gate: 'G4',
    action: 'waive',
    reason: '用户明确要求跳过',
  });
  assert.equal(result.ok, true);
  assert.equal(readGate(root, 'G4').waived, true);
  const deviations = readDeviations(root);
  assert.equal(deviations.length, 1);
  assert.match(deviations[0].reason, /用户明确要求跳过/);
});

test('slash-command gate confirmation is explicit and never opens an invisible question', async () => {
  const root = makeRoot();

  const pending = await performGateAction(ctxAnswering('通过'), null, undefined, root, {
    gate: 'G1',
    action: 'confirm',
    interactive: false,
  });
  assert.equal(pending.ok, false);
  assert.equal(pending.requiresConfirmation, true);
  assert.match(pending.text, /confirm --yes/);
  assert.equal(readGate(root, 'G1').confirmed, false);

  const confirmed = await performGateAction(ctxAnswering('通过'), null, undefined, root, {
    gate: 'G1',
    action: 'confirm',
    interactive: false,
    confirmed: true,
  });
  assert.equal(confirmed.ok, true);
  assert.equal(readGate(root, 'G1').confirmed, true);
});

test('a timed-out structured confirmation fails closed instead of hanging', async () => {
  const root = makeRoot();
  const ctx = {
    get(name) {
      if (name !== 'userQuestions') return undefined;
      return {
        async askTimed() {
          return { pending: true, callId: 'call-1' };
        },
      };
    },
  };

  const result = await performGateAction(ctx, null, undefined, root, {
    gate: 'G1',
    action: 'confirm',
    interactive: true,
    callId: 'call-1',
  });
  assert.equal(result.ok, false);
  assert.match(result.text, /超时/);
  assert.equal(readGate(root, 'G1').confirmed, false);
});

test('slash-command waive needs both a reason and --yes', async () => {
  const root = makeRoot();

  const pending = await performGateAction(ctxAnswering('确认跳过'), null, undefined, root, {
    gate: 'G4',
    action: 'waive',
    reason: '用户要求',
    interactive: false,
  });
  assert.equal(pending.ok, false);
  assert.match(pending.text, /waive --yes/);

  const waived = await performGateAction(ctxAnswering('确认跳过'), null, undefined, root, {
    gate: 'G4',
    action: 'waive',
    reason: '用户要求',
    interactive: false,
    confirmed: true,
  });
  assert.equal(waived.ok, true);
  assert.equal(readGate(root, 'G4').waived, true);
});
