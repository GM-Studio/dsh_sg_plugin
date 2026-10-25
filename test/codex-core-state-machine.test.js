import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as kernel from '../src/codex/state-machine.js';
import { createToolRegistry } from '../src/codex/workflow-tools.js';

const main = [
  'CLARIFYING',
  'H1_PENDING',
  'PLANNED',
  'TEST_DESIGNING',
  'TESTS_FROZEN',
  'IMPLEMENTING',
  'VERIFYING',
  'REVIEWING',
  'H3_PENDING',
  'DELIVERED',
];
const side = ['BLOCKED', 'PAUSED', 'CANCELLED'];
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sg-core-state-'));

test('MVP exposes exactly the frozen ten main phases and three side phases', () => {
  assert.deepEqual(kernel.MAIN_PHASES, main);
  assert.deepEqual(kernel.SIDE_PHASES, side);
  assert.deepEqual(kernel.PHASES, [...main, ...side]);
  assert.equal(Object.isFrozen(kernel.MAIN_PHASES), true);
  assert.equal(Object.isFrozen(kernel.SIDE_PHASES), true);
  for (const phase of kernel.INTERNAL_PHASES)
    assert.ok(kernel.PHASES.includes(kernel.publicWorkflowState({ phase }).phase), phase);
  assert.deepEqual(Object.keys(kernel.TRANSITIONS), kernel.PHASES);
  for (const targets of Object.values(kernel.TRANSITIONS))
    assert.ok(targets.every((phase) => kernel.PHASES.includes(phase)));
});

test('state writes reject apparent credentials before persisting an event or advancing CAS', async () => {
  const projectRoot = temporary();
  const store = kernel.createStateStore({ projectRoot });
  assert.equal((await store.create({ changeId: 'one', expectedVersion: 0 })).ok, true);
  const events = path.join(projectRoot, '.specgate/codex/events.jsonl');
  const before = fs.readFileSync(events, 'utf8');
  for (const context of [
    { note: 'password=obvious-test-credential' },
    { nested: { api_key: 'obvious-test-credential' } },
    { note: 'Authorization: Bearer obvious-test-credential' },
  ]) {
    const rejected = await store.update({ expectedVersion: 1, patch: { context } });
    assert.equal(rejected.code, 'SENSITIVE_INPUT');
    assert.equal((await store.inspect()).state.version, 1);
    assert.equal(fs.readFileSync(events, 'utf8'), before);
  }
  const allowed = await store.update({
    expectedVersion: 1,
    patch: { context: { note: 'password=[REDACTED]' } },
  });
  assert.equal(allowed.ok, true);
});

test('a second active change leaves immutable refusal evidence without changing the state version', async () => {
  const projectRoot = temporary();
  const store = kernel.createStateStore({ projectRoot });
  await store.create({ changeId: 'one', expectedVersion: 0 });
  const refused = await store.create({ changeId: 'two', expectedVersion: 1 });
  assert.equal(refused.code, 'ACTIVE_CHANGE');
  assert.ok(refused.refusalEvidence?.path);
  const file = path.join(projectRoot, refused.refusalEvidence.path);
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(evidence.type, 'change.creation_rejected');
  assert.equal(evidence.activeChangeId, 'one');
  assert.equal(evidence.requestedChangeId, 'two');
  assert.equal(evidence.stateVersion, 1);
  assert.equal((await store.inspect()).state.version, 1);
  assert.equal((await store.inspect()).state.changeId, 'one');
  assert.equal(
    fs
      .readFileSync(path.join(projectRoot, '.specgate/codex/events.jsonl'), 'utf8')
      .trim()
      .split('\n').length,
    1,
  );
});

test('deleted and reordered audit records fail closed without repair or evidence loss', async () => {
  for (const mode of ['delete-middle', 'reorder']) {
    const projectRoot = temporary();
    const store = kernel.createStateStore({ projectRoot });
    await store.create({ changeId: 'one', expectedVersion: 0 });
    await store.update({ expectedVersion: 1, patch: { context: { first: true } } });
    await store.update({ expectedVersion: 2, patch: { context: { second: true } } });
    const file = path.join(projectRoot, '.specgate/codex/events.jsonl');
    const records = fs.readFileSync(file, 'utf8').trim().split('\n');
    const damaged =
      (mode === 'delete-middle'
        ? [records[0], records[2]]
        : [records[1], records[0], records[2]]
      ).join('\n') + '\n';
    fs.writeFileSync(file, damaged);
    assert.equal((await store.inspect()).code, 'AUDIT_CORRUPT');
    assert.equal(
      (await store.update({ expectedVersion: 3, patch: { context: {} } })).code,
      'AUDIT_CORRUPT',
    );
    assert.equal(fs.readFileSync(file, 'utf8'), damaged);
  }
});

test('legacy state views are read-only and do not claim delivery before an archive completes', () => {
  assert.equal(typeof kernel.publicWorkflowState, 'function');
  const previous = {
    phase: 'REQ_CRITIQUE',
    version: 4,
    changeId: 'one',
    checkpoint: { phase: 'REQ_CLARIFYING', label: 'user checkpoint' },
    resumePhase: 'REQ_INTAKE',
    context: { evidence: 'keep-original-hash' },
  };
  const before = structuredClone(previous);
  const viewed = kernel.publicWorkflowState(previous);
  assert.equal(viewed.phase, 'CLARIFYING');
  assert.equal(viewed.checkpoint.phase, 'CLARIFYING');
  assert.equal(viewed.resumePhase, 'CLARIFYING');
  assert.deepEqual(previous, before);
  assert.equal(kernel.publicWorkflowState({ ...previous, phase: 'ARCHIVING' }).phase, 'H3_PENDING');
  assert.equal(kernel.publicWorkflowState({ ...previous, phase: 'ARCHIVED' }).phase, 'DELIVERED');
  assert.equal(
    kernel.publicWorkflowState({ ...previous, phase: 'ARCHIVED_NOT_PUSHED' }).phase,
    'DELIVERED',
  );
  assert.throws(() => kernel.publicWorkflowState({ ...previous, phase: 'INVENTED' }), {
    code: 'INVALID_STATE',
  });
});

test('MCP state and lifecycle results use MVP phases without rewriting historical events', async () => {
  const projectRoot = temporary();
  const store = kernel.createStateStore({ projectRoot });
  const registry = createToolRegistry({ projectRoot });
  const created = await store.create({ changeId: 'one', expectedVersion: 0 });
  assert.equal(created.ok, true);
  const events = path.join(projectRoot, '.specgate/codex/events.jsonl');
  const before = fs.readFileSync(events, 'utf8');
  const status = (await registry.call('sg_state')).structuredContent;
  assert.equal(status.state.phase, 'CLARIFYING');
  assert.equal(status.state.checkpoint.phase, 'CLARIFYING');
  assert.equal(
    (await registry.call('status')).structuredContent.workflow.state.phase,
    'CLARIFYING',
  );
  assert.equal(fs.readFileSync(events, 'utf8'), before);
  const paused = (await registry.call('sg_pause', { expectedVersion: status.state.version }))
    .structuredContent;
  assert.equal(paused.state.phase, 'PAUSED');
  assert.equal(paused.state.resumePhase, 'CLARIFYING');
  const persisted = JSON.parse(fs.readFileSync(events, 'utf8').trim().split('\n').at(-1));
  assert.equal(paused.event.hash, persisted.hash);
  assert.equal(paused.event.sequence, persisted.sequence);
  assert.equal(
    Object.hasOwn(paused.event, 'state'),
    false,
    'Do not rewrite a hash-bound event body for display',
  );
  const resumed = (await registry.call('sg_resume', { expectedVersion: paused.state.version }))
    .structuredContent;
  assert.equal(resumed.state.phase, 'CLARIFYING');
  const cancelled = (await registry.call('sg_cancel', { expectedVersion: resumed.state.version }))
    .structuredContent;
  assert.equal(cancelled.state.phase, 'CANCELLED');
  const another = await store.create({ changeId: 'two', expectedVersion: cancelled.state.version });
  assert.equal(another.ok, true);
  assert.equal(
    (await store.create({ changeId: 'three', expectedVersion: another.state.version })).code,
    'ACTIVE_CHANGE',
  );
});

test('unmapped legacy phases cannot be silently exposed by the public result formatter', () => {
  assert.equal(typeof kernel.publicWorkflowResult, 'function');
  assert.throws(() => kernel.publicWorkflowResult({ ok: true, state: { phase: 'UNKNOWN' } }), {
    code: 'INVALID_STATE',
  });
  const response = kernel.publicWorkflowResult({
    ok: true,
    state: { phase: 'TESTING', context: { requirementText: 'TESTING' } },
    event: { hash: 'a'.repeat(64), sequence: 1, type: 'test.started', state: { phase: 'TESTING' } },
  });
  assert.equal(response.state.phase, 'VERIFYING');
  assert.equal(response.state.context.requirementText, 'TESTING');
  assert.equal(response.event.hash, 'a'.repeat(64));
  assert.equal(Object.hasOwn(response.event, 'state'), false);
});
