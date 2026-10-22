import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONTROL_TOOLS, callControlTool } from '../src/codex/control/tools.js';
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';

function fixture() {
  const controlRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-tools-'));
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-tools-project-'));
  let next = 0;
  const service = createControlService({
    store: createControlStore({ root: controlRoot }),
    randomId: () => `tool-${++next}`,
    clock: () => Date.parse('2026-10-22T10:00:00.000Z'),
  });
  return { controlRoot, projectRoot, service };
}

test('control MCP tools create and inspect a WorkItem without trusting actor input', async () => {
  const { projectRoot, service } = fixture();
  const created = await callControlTool(
    {
      projectRoot,
      service,
      env: { SPECGATE_CONTROL_HOME: 'C:\\control' },
    },
    'sg_work_item_create',
    {
      title: 'Exporter',
      request: 'Implement CSV export',
      priority: 'normal',
    },
  );
  assert.equal(created.ok, true, JSON.stringify(created));
  const status = await callControlTool({ projectRoot, service, env: {} }, 'sg_work_item_status', {
    workItemId: created.workItem.workItemId,
  });
  assert.equal(status.ok, true);
  assert.equal(status.workItem.executionState, 'QUEUED');
  assert.equal(status.decision, undefined);
});

test('wait tool creates one durable AttentionRequest and never approves it', async () => {
  const { projectRoot, service } = fixture();
  const created = await callControlTool({ projectRoot, service, env: {} }, 'sg_work_item_create', {
    title: 'Exporter',
    request: 'Implement CSV export',
  });
  const input = {
    workItemId: created.workItem.workItemId,
    type: 'BLOCKED',
    reason: 'The dependency is unavailable',
    question: 'Retry or cancel?',
    actions: ['retry', 'cancel'],
    summary: 'Scope is ready.',
    risks: [],
    evidence: [],
  };
  const first = await callControlTool(
    { projectRoot, service, env: {} },
    'sg_work_item_wait',
    input,
  );
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.attention.status, 'OPEN');
  assert.equal(first.workItem.executionState, 'WAITING_FOR_USER');
  const forgedGate = await callControlTool({ projectRoot, service, env: {} }, 'sg_work_item_wait', {
    ...input,
    type: 'H3_APPROVAL',
  });
  assert.equal(forgedGate.code, 'CONTROL_GATE_TOOL_REQUIRED');
});

test('control tool definitions expose no arbitrary shell or approval injection', () => {
  for (const tool of CONTROL_TOOLS) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    const text = JSON.stringify(tool);
    assert.doesNotMatch(text, /command|shell|approvalHandle|actorId/i);
  }
});
