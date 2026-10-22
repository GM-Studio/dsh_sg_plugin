import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createControlStore } from '../src/codex/control/store.js';
import { createControlService } from '../src/codex/control/service.js';
import { createControlSupervisor } from '../src/codex/control/supervisor.js';

test('waiting checkpoint persists Codex session and resumes it after H1 Decision', async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-resume-project-'));
  const service = createControlService({
    store: createControlStore({
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'sg-control-resume-store-')),
    }),
  });
  const created = await service.createWorkItem({
    title: 'Export',
    request: 'Implement export',
    projectRoot,
  });
  const marker = {
    type: 'H1_APPROVAL',
    reason: 'Confirm scope',
    question: 'Approve?',
    actions: ['approve', 'request_changes'],
    artifactHash: 'a'.repeat(64),
  };
  const calls = [];
  let turn = 0;
  const supervisor = createControlSupervisor({
    service,
    adapter: {
      async run(input) {
        calls.push({ mode: input.mode, sessionId: input.sessionId });
        turn += 1;
        if (turn === 1) {
          input.onEvent({ type: 'thread.started', thread_id: 'session-persisted' });
          input.onEvent({
            type: 'item.completed',
            item: {
              type: 'agent_message',
              text: `SPECGATE_WAITING_FOR_USER:${JSON.stringify(marker)}`,
            },
          });
          return { ok: true, exitCode: 0, sessionId: 'session-persisted' };
        }
        return { ok: true, exitCode: 0, sessionId: 'session-persisted' };
      },
    },
  });
  const waiting = await supervisor.runOnce();
  assert.equal(waiting.status, 'waiting');
  const waitingItem = await service.getWorkItem(created.workItem.workItemId);
  const attention = waitingItem.attention;
  assert.equal(waitingItem.run.sessionId, 'session-persisted');
  const decided = await service.decide({
    workItemId: created.workItem.workItemId,
    attentionId: attention.requestId,
    attentionRevision: attention.revision,
    expectedWorkItemVersion: waitingItem.workItem.revision,
    artifactHash: 'a'.repeat(64),
    action: 'approve',
    idempotencyKey: 'resume-h1',
    actorId: 'owner',
    source: 'web',
    authLevel: 'step-up',
  });
  assert.equal(decided.ok, true, JSON.stringify(decided));
  const resumed = await supervisor.runOnce();
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(calls[1].mode, 'resume');
  assert.equal(calls[1].sessionId, 'session-persisted');
  const after = await service.getWorkItem(created.workItem.workItemId);
  assert.equal(after.attention.type, 'COMPLETION');
});
