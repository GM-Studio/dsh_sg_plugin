import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createManagementServer } from '../src/codex/management/server.js';
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';
import { createControlStoreAuditRepository } from '../src/codex/control/store-audit-adapter.js';
import { createAuditQuery } from '../src/codex/control/audit-query.js';

const PAIRING = 'm6-web-pairing-token';
const ARTIFACT = 'a'.repeat(64);

function services() {
  return {
    verifyStepUp: async () => 'step-up',
    projection: {
      health: async () => ({ ok: true, status: 'healthy' }),
      overview: async () => ({ ok: true, projects: [] }),
      listWorkItems: async () => ({ ok: true, workItems: [] }),
      getWorkItem: async (id) => ({
        ok: true,
        workItem: {
          workItemId: id,
          projectId: 'project-1',
          title: 'Timeline item',
        },
        run: { runId: 'run-1' },
      }),
      getRun: async (id) => ({ ok: true, run: { runId: id } }),
      listAttention: async () => ({ ok: true, attention: [] }),
      listNotifications: async () => ({ ok: true, notifications: [] }),
    },
    decisions: {
      async create(input) {
        return {
          ok: true,
          decision: {
            decisionId: 'decision-1',
            workItemId: input.workItemId,
            action: input.action,
            status: 'CONSUMED',
            artifactHash: input.artifactHash,
            expectedWorkItemVersion: input.expectedWorkItemVersion,
            createdAt: '2026-10-24T06:00:00.000Z',
          },
          workItem: { workItemId: input.workItemId, projectId: 'project-1' },
          attention: { requestId: input.attentionId, artifactHash: input.artifactHash },
        };
      },
    },
  };
}

function timeline() {
  const recorded = [];
  return {
    recorded,
    async record(event) {
      recorded.push(structuredClone(event));
      return { ok: true, event };
    },
    async list(options) {
      return {
        ok: true,
        events: [
          {
            eventId: 'event-1',
            type: 'run.started',
            summary: 'Run started',
            occurredAt: '2026-10-24T06:00:00.000Z',
            artifactHash: ARTIFACT,
            ...options,
          },
        ],
      };
    },
    async export(options) {
      return { ok: true, content: '{"eventId":"event-1"}\n', format: options.format };
    },
  };
}

function auditQuery() {
  return {
    async list(options) {
      return {
        ok: true,
        audits: [
          {
            auditId: 'audit-1',
            sequence: 1,
            projectId: options.projectId,
            action: 'UPDATE',
            createdAt: '2026-10-24T06:00:00.000Z',
          },
        ],
      };
    },
    async export(options) {
      return { ok: true, content: '{"auditId":"audit-1"}\n', format: options.format };
    },
  };
}

async function start(t) {
  const fakeTimeline = timeline();
  const management = createManagementServer({
    services: services(),
    timeline: fakeTimeline,
    auditQuery: auditQuery(),
    pairingToken: PAIRING,
  });
  const started = await management.start();
  t.after(() => management.close());
  const paired = await fetch(`${started.baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: PAIRING }),
  });
  const cookie = paired.headers.get('set-cookie').split(';')[0];
  const { csrfToken } = await paired.json();
  return { ...started, cookie, csrfToken, timeline: fakeTimeline };
}

test('timeline and audit queries require an authenticated session', async (t) => {
  const server = await start(t);
  assert.equal((await fetch(`${server.baseUrl}/api/work-items/work-1/timeline`)).status, 401);
  assert.equal((await fetch(`${server.baseUrl}/api/audit?projectId=project-1`)).status, 401);
});

test('timeline and audit APIs support bounded query and export', async (t) => {
  const server = await start(t);
  const timeline = await fetch(`${server.baseUrl}/api/work-items/work-1/timeline?limit=10`, {
    headers: { cookie: server.cookie },
  });
  assert.equal(timeline.status, 200);
  assert.equal((await timeline.json()).events[0].type, 'run.started');
  const exportTimeline = await fetch(
    `${server.baseUrl}/api/work-items/work-1/timeline/export?format=jsonl`,
    { headers: { cookie: server.cookie } },
  );
  assert.equal(exportTimeline.status, 200);
  assert.match((await exportTimeline.json()).content, /eventId/);
  const audit = await fetch(`${server.baseUrl}/api/audit?projectId=project-1`, {
    headers: { cookie: server.cookie },
  });
  assert.equal(audit.status, 200);
  assert.equal((await audit.json()).audits[0].auditId, 'audit-1');
  const exportedAudit = await fetch(
    `${server.baseUrl}/api/audit/export?projectId=project-1&format=json`,
    { headers: { cookie: server.cookie } },
  );
  assert.equal(exportedAudit.status, 200);
  assert.match((await exportedAudit.json()).content, /auditId/);
});

test('Decision mutations append a discrete timeline event', async (t) => {
  const server = await start(t);
  const response = await fetch(`${server.baseUrl}/api/decisions`, {
    method: 'POST',
    headers: {
      cookie: server.cookie,
      'content-type': 'application/json',
      'x-specgate-csrf': server.csrfToken,
    },
    body: JSON.stringify({
      workItemId: 'work-1',
      attentionId: 'attention-1',
      attentionRevision: 1,
      expectedWorkItemVersion: 2,
      artifactHash: ARTIFACT,
      action: 'approve',
      idempotencyKey: 'timeline-decision-1',
      stepUpCode: '123456',
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(server.timeline.recorded[0].type, 'decision.recorded');
  assert.equal(server.timeline.recorded[0].projectId, 'project-1');
  assert.equal(server.timeline.recorded[0].artifactHash, ARTIFACT);
});

test('management UI renders discrete timeline events and export without payload dumps', () => {
  const app = fs.readFileSync(path.resolve('src/codex/management/public/app.js'), 'utf8');
  assert.match(app, /\/timeline\?limit=100/);
  assert.match(app, /timeline\/export\?format=jsonl/);
  assert.match(app, /class="timeline-list"/);
  assert.match(app, /event\.summary/);
  assert.doesNotMatch(app, /timeline[\s\S]{0,200}JSON\.stringify\(event/);
});

test('control event history is queryable through the audit-chain adapter', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m6-audit-project-'));
  const store = createControlStore({
    root: fs.mkdtempSync(path.join(os.tmpdir(), 'sg-m6-audit-store-')),
  });
  const service = createControlService({ store });
  const created = await service.createWorkItem({
    title: 'Audited work',
    request: 'Create an audited event chain',
    projectRoot,
  });
  const query = createAuditQuery({
    repository: createControlStoreAuditRepository({ store }),
    role: 'owner',
  });
  const listed = await query.list({
    projectId: created.workItem.projectId,
    limit: 20,
  });
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.equal(listed.audits.length > 0, true);
  assert.equal(listed.audits[0].action, 'CREATE');
  assert.match(listed.chain.headHash, /^[a-f0-9]{64}$/);
});
