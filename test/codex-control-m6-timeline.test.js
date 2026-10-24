import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditQuery } from '../src/codex/control/audit-query.js';
import {
  EVIDENCE_EVENT_TYPES,
  createEvidenceTimeline,
} from '../src/codex/control/evidence-timeline.js';
import { createMemoryRepository } from '../src/codex/core/control/persistence/memory-repository.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const AT = '2026-10-23T02:00:00.000Z';

const event = (overrides = {}) => ({
  eventId: 'event-1',
  projectId: 'project-1',
  workItemId: 'work-1',
  runId: 'run-1',
  sessionId: 'session-1',
  type: 'run.started',
  occurredAt: AT,
  summary: 'Run started',
  artifactHash: HASH_A,
  correlationId: 'correlation-1',
  payload: { phase: 'start' },
  ...overrides,
});

const audit = (overrides = {}) => ({
  auditId: 'audit-1',
  projectId: 'project-1',
  actorType: 'system',
  actorId: 'test',
  action: 'CREATE',
  objectType: 'work_item',
  objectId: 'work-1',
  detail: {},
  createdAt: AT,
  ...overrides,
});

test('timeline orders, filters and bounds discrete events with defensive copies', async () => {
  const timeline = createEvidenceTimeline({
    maxEvents: 10,
    clock: () => Date.parse('2026-10-23T05:00:00.000Z'),
  });
  await timeline.record(
    event({
      eventId: 'event-late',
      occurredAt: '2026-10-23T04:00:00.000Z',
      type: 'test.passed',
      summary: 'Late test passed',
    }),
  );
  await timeline.record(
    event({
      eventId: 'event-early',
      occurredAt: '2026-10-23T01:00:00.000Z',
      summary: 'Early start',
    }),
  );
  await timeline.record(
    event({
      eventId: 'event-middle',
      occurredAt: '2026-10-23T03:00:00.000Z',
      type: 'test.started',
      summary: 'Middle test started',
    }),
  );

  const bounded = await timeline.list({ projectId: 'project-1', limit: 2 });
  assert.equal(bounded.ok, true);
  assert.equal(bounded.events[0].receivedAt, '2026-10-23T05:00:00.000Z');
  assert.deepEqual(
    bounded.events.map((entry) => entry.eventId),
    ['event-early', 'event-middle'],
  );
  assert.equal(bounded.nextCursor, 'event-middle');

  const remaining = await timeline.list({
    projectId: 'project-1',
    after: 'event-middle',
    workItemId: 'work-1',
    runId: 'run-1',
  });
  assert.deepEqual(
    remaining.events.map((entry) => entry.eventId),
    ['event-late'],
  );

  bounded.events[0].summary = 'tampered';
  bounded.events[0].payload.phase = 'tampered';
  const reread = await timeline.list({ projectId: 'project-1', limit: 1 });
  assert.equal(reread.events[0].summary, 'Early start');
  assert.equal(reread.events[0].payload.phase, 'start');
});

test('timeline supports every allowed type and deterministic JSONL/JSON export', async () => {
  const timeline = createEvidenceTimeline();
  for (const [index, type] of EVIDENCE_EVENT_TYPES.entries()) {
    const result = await timeline.record(
      event({
        eventId: `event-${index}`,
        type,
        occurredAt: new Date(Date.parse(AT) + index * 1000).toISOString(),
        summary: `Recorded ${type}`,
      }),
    );
    assert.equal(result.ok, true, type);
  }
  const jsonl = await timeline.export({
    projectId: 'project-1',
    format: 'jsonl',
    limit: 3,
  });
  const replay = await timeline.export({
    projectId: 'project-1',
    format: 'jsonl',
    limit: 3,
  });
  assert.equal(jsonl.ok, true);
  assert.equal(jsonl.content, replay.content);
  assert.equal(jsonl.eventCount, 3);
  assert.match(jsonl.content, /\n$/);
  const rows = jsonl.content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    rows.map((entry) => entry.eventId),
    ['event-0', 'event-1', 'event-2'],
  );

  const json = await timeline.export({ projectId: 'project-1', format: 'json', limit: 2 });
  assert.equal(json.ok, true);
  assert.equal(JSON.parse(json.content).events.length, 2);
});

test('timeline rejects unknown types and missing required fields without persistence', async () => {
  const timeline = createEvidenceTimeline();
  assert.equal((await timeline.record(event({ type: 'model.thought' }))).code, 'EVIDENCE_INVALID');
  assert.equal((await timeline.record(event({ eventId: undefined }))).code, 'EVIDENCE_INVALID');
  assert.equal(
    (await timeline.record(event({ correlationId: undefined }))).code,
    'EVIDENCE_INVALID',
  );
  assert.equal(
    (await timeline.record(event({ artifactHash: 'not-a-hash' }))).code,
    'EVIDENCE_INVALID',
  );
  assert.equal((await timeline.list({ projectId: 'project-1' })).events.length, 0);
});

test('timeline redacts paths, credentials and customer names before persistence', async () => {
  const timeline = createEvidenceTimeline();
  const recorded = await timeline.record(
    event({
      summary:
        'Run in C:\\Users\\alice\\secret\\repo token=supersecret customerName: Acme Holdings',
      payload: {
        authorization: 'Bearer abcdefghijklmnop',
        customerName: 'Acme Holdings',
        customer: { name: 'Another Customer', id: 'customer-1' },
        nested: {
          path: '/home/alice/private/project',
          result: 'passed',
        },
      },
    }),
  );
  assert.equal(recorded.ok, true);
  const serialized = JSON.stringify(recorded.event);
  assert.doesNotMatch(serialized, /alice|supersecret|Acme Holdings|abcdefghijklmnop/);
  assert.match(serialized, /LOCAL_PATH/);
  assert.match(serialized, /REDACTED/);
  assert.equal(recorded.event.payload.nested.result, 'passed');
  assert.equal(recorded.event.payload.customer.name, '[REDACTED]');
  assert.equal(recorded.event.payload.customer.id, 'customer-1');
});

test('timeline fails closed for chain-of-thought, token streams, raw logs and diffs', async () => {
  const timeline = createEvidenceTimeline();
  const unsafe = [
    event({ eventId: 'cot', summary: 'Here is my chain-of-thought: inspect every file' }),
    event({ eventId: 'tokens', summary: 'token stream: one two three' }),
    event({ eventId: 'raw', payload: { rawLog: 'full process output' } }),
    event({ eventId: 'stdout', payload: { stdout: 'complete stdout' } }),
    event({
      eventId: 'diff',
      payload: { patch: 'diff --git a/file.js b/file.js\n@@ -1,1 +1,1 @@' },
    }),
  ];
  for (const candidate of unsafe) {
    const result = await timeline.record(candidate);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'EVIDENCE_PROHIBITED_CONTENT');
  }
  const listed = await timeline.list({ projectId: 'project-1' });
  assert.equal(listed.events.length, 0);
});

test('timeline adapter persists sanitized evidence and rejects replay conflicts', async () => {
  const repository = createMemoryRepository();
  let now = Date.parse(AT);
  const timeline = createEvidenceTimeline({ repository, clock: () => now });
  const recorded = await timeline.record(
    event({ summary: 'Run in /home/alice/private/repo with token=secret-token' }),
  );
  assert.equal(recorded.ok, true);
  assert.doesNotMatch(JSON.stringify(recorded.event), /alice|secret-token/);

  now += 1000;
  const replay = await timeline.record(
    event({ summary: 'Run in /home/alice/private/repo with token=secret-token' }),
  );
  assert.equal(replay.ok, true);
  assert.equal(replay.duplicate, true);

  const conflict = await timeline.record(event({ summary: 'Different content' }));
  assert.equal(conflict.code, 'EVIDENCE_CONFLICT');

  const reader = createEvidenceTimeline({ repository });
  const listed = await reader.list({ projectId: 'project-1' });
  assert.equal(listed.events.length, 1);
  assert.match(listed.events[0].summary, /LOCAL_PATH|REDACTED/);
});

test('decision timeline preserves artifact version, action and stale/rejected status', async () => {
  const timeline = createEvidenceTimeline();
  await timeline.record(
    event({
      eventId: 'decision-old',
      type: 'decision.recorded',
      occurredAt: '2026-10-23T02:00:00.000Z',
      artifactHash: HASH_A,
      decision: {
        decisionId: 'decision-1',
        version: 2,
        action: 'approve',
        status: 'STALE',
      },
    }),
  );
  await timeline.record(
    event({
      eventId: 'decision-new',
      type: 'decision.applied',
      occurredAt: '2026-10-23T03:00:00.000Z',
      artifactHash: HASH_B,
      decisionId: 'decision-2',
      version: 3,
      action: 'request_changes',
      status: 'REJECTED',
    }),
  );
  const listed = await timeline.list({ projectId: 'project-1' });
  assert.equal(listed.events.length, 2);
  assert.deepEqual(
    listed.events.map((entry) => entry.artifactHash),
    [HASH_A, HASH_B],
  );
  assert.equal(listed.events[0].decision.version, 2);
  assert.equal(listed.events[0].decision.action, 'approve');
  assert.equal(listed.events[0].decision.status, 'STALE');
  assert.equal(listed.events[1].decision.status, 'REJECTED');
});

test('audit query trims owner and non-owner access by project scope', async () => {
  const repository = createMemoryRepository();
  assert.equal(repository.appendAudit(audit()).ok, true);
  assert.equal(
    repository.appendAudit(
      audit({
        auditId: 'audit-2',
        projectId: 'project-2',
        action: 'UPDATE',
        objectId: 'work-2',
      }),
    ).ok,
    true,
  );

  const owner = createAuditQuery({ repository, role: 'owner' });
  assert.equal((await owner.list({ projectId: 'project-2' })).audits.length, 1);
  assert.equal((await owner.export({ projectId: 'project-2', format: 'jsonl' })).auditCount, 1);

  const scoped = createAuditQuery({
    repository,
    role: 'viewer',
    allowedProjects: ['project-1'],
  });
  const visible = await scoped.list({ projectId: 'project-1' });
  assert.equal(visible.ok, true);
  assert.equal(visible.audits.length, 1);
  assert.equal((await scoped.list({ projectId: 'project-2' })).code, 'AUDIT_FORBIDDEN');
  assert.equal((await scoped.export({ projectId: 'project-2' })).code, 'AUDIT_FORBIDDEN');

  const unscopedViewer = createAuditQuery({ repository, role: 'viewer' });
  assert.equal((await unscopedViewer.list({ projectId: 'project-1' })).code, 'AUDIT_FORBIDDEN');
});

test('audit query verifies the chain first and fails closed on corruption or absence', async () => {
  let listed = false;
  const corrupt = createAuditQuery({
    repository: {
      verifyAuditChain: () => ({ ok: false, code: 'AUDIT_CORRUPT', message: 'tampered' }),
      listAudit: () => {
        listed = true;
        return { ok: true, audits: [] };
      },
    },
  });
  assert.equal((await corrupt.list({ projectId: 'project-1' })).code, 'AUDIT_CORRUPT');
  assert.equal(listed, false);

  const missing = createAuditQuery({
    repository: {
      listAudit: () => ({ ok: true, audits: [] }),
    },
  });
  assert.equal((await missing.list({ projectId: 'project-1' })).code, 'AUDIT_CHAIN_UNAVAILABLE');
});

test('audit query redacts paths and secrets and rejects raw logs', async () => {
  const repository = createMemoryRepository();
  repository.appendAudit(
    audit({
      detail: {
        password: 'not-for-export',
        path: 'C:\\Users\\alice\\private\\repo',
        note: 'token=another-secret',
      },
    }),
  );
  const query = createAuditQuery({ repository });
  const listed = await query.list({ projectId: 'project-1' });
  assert.equal(listed.ok, true);
  const serialized = JSON.stringify(listed.audits);
  assert.doesNotMatch(serialized, /not-for-export|alice|another-secret/);
  assert.match(serialized, /REDACTED|LOCAL_PATH/);

  const unsafeRepository = createMemoryRepository();
  unsafeRepository.appendAudit(
    audit({
      auditId: 'audit-raw',
      detail: { rawLog: 'complete stdout and stderr' },
    }),
  );
  const unsafe = await createAuditQuery({ repository: unsafeRepository }).list({
    projectId: 'project-1',
  });
  assert.equal(unsafe.code, 'AUDIT_DETAIL_UNSAFE');
});

test('audit query returns ordered defensive copies and deterministic bounded export', async () => {
  const repository = createMemoryRepository();
  repository.appendAudit(
    audit({
      auditId: 'audit-1',
      action: 'DECIDE',
      createdAt: '2026-10-23T02:00:00.000Z',
      detail: { action: 'approve' },
    }),
  );
  repository.appendAudit(
    audit({
      auditId: 'audit-2',
      action: 'APPLY',
      createdAt: '2026-10-23T03:00:00.000Z',
      detail: { applied: true },
    }),
  );
  const query = createAuditQuery({ repository });
  const listed = await query.list({
    projectId: 'project-1',
    after: 1,
    action: 'APPLY',
    limit: 1,
  });
  assert.equal(listed.ok, true);
  assert.deepEqual(
    listed.audits.map((entry) => entry.auditId),
    ['audit-2'],
  );
  listed.audits[0].detail.applied = false;
  assert.equal(
    (await query.list({ projectId: 'project-1', after: 1 })).audits[0].detail.applied,
    true,
  );

  const first = await query.export({ projectId: 'project-1', format: 'jsonl', limit: 1 });
  const second = await query.export({ projectId: 'project-1', format: 'jsonl', limit: 1 });
  assert.equal(first.content, second.content);
  assert.equal(first.auditCount, 1);
  assert.match(first.content, /\n$/);
  const json = await query.export({ projectId: 'project-1', format: 'json', limit: 1 });
  const exported = JSON.parse(json.content);
  assert.equal(exported.audits.length, 1);
  assert.equal(exported.chain.headHash.length, 64);
});
