import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { queueJavaInitHandoff } from '../../src/v4/java-init-handoff.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-init-handoff-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.specgate'));
  const file = path.join(root, '.specgate/init-pending.json');
  const result = {
    code: 'MAIN_AGENT_PENDING',
    root,
    token: {
      version: 1,
      root,
      baseline: randomUUID(),
      quality: { mode: 'lenient', generateOnly: false },
      stages: ['test', 'lint', 'format', 'review'],
    },
    mainAgentPrompt: 'Read actual code, review and finalize real evidence.',
  };
  fs.writeFileSync(
    file,
    JSON.stringify({ token: result.token, report: { phase: 'MAIN_AGENT_PENDING' } }),
  );
  const messages = [];
  const agent = { id: 'main', followup: (message) => messages.push(message) };
  const runtime = { service: (name) => (name === 'agents' ? { get: () => agent } : null) };
  const createMessage = (input) => ({ ...input, id: randomUUID(), role: 'user' });
  return { root, file, result, agent, runtime, messages, createMessage };
}
test('slash kickoff is deferred, identified, once-only and not quality acceptance', async (t) => {
  const f = fixture(t);
  const queued = queueJavaInitHandoff(f);
  assert.equal(queued.queued, true);
  assert.equal(f.messages.length, 0);
  assert.equal(queueJavaInitHandoff(f).reason, 'duplicate');
  assert.deepEqual(await queued.completion, { accepted: true });
  assert.equal(f.messages.length, 1);
  assert.equal(f.messages[0].source.kind, 'specgate');
  assert.equal(f.messages[0].source.form, 'notice');
  assert.equal(f.messages[0].content[0].text, f.result.mainAgentPrompt);
  assert.equal(queueJavaInitHandoff(f).reason, 'duplicate');
  const state = JSON.parse(fs.readFileSync(f.file));
  assert.equal(state.report.phase, 'MAIN_AGENT_PENDING');
  assert.equal(state.handoff.status, 'accepted');
});
test('generationOnly, nonpending, absent followup and pre-abort never enqueue', (t) => {
  const f = fixture(t);
  assert.equal(
    queueJavaInitHandoff({
      ...f,
      result: { ...f.result, report: { quality: { generateOnly: true } } },
    }).queued,
    false,
  );
  assert.equal(
    queueJavaInitHandoff({ ...f, result: { ...f.result, code: 'INITIALIZED' } }).queued,
    false,
  );
  assert.equal(queueJavaInitHandoff({ ...f, agent: {} }).reason, 'followup-unavailable');
  const abort = new AbortController();
  abort.abort();
  assert.equal(queueJavaInitHandoff({ ...f, signal: abort.signal }).reason, 'aborted');
  assert.equal(f.messages.length, 0);
});
test('abort between scheduling and delivery records error and permits explicit retry', async (t) => {
  const f = fixture(t),
    abort = new AbortController();
  const queued = queueJavaInitHandoff({ ...f, signal: abort.signal });
  abort.abort();
  assert.equal((await queued.completion).reason, 'aborted');
  assert.equal(f.messages.length, 0);
  assert.equal(JSON.parse(fs.readFileSync(f.file)).handoff.status, 'error');
  assert.equal((await queueJavaInitHandoff(f).completion).accepted, true);
});
test('disposed/replaced exact agent never delivers', async (t) => {
  const f = fixture(t);
  let live = f.agent;
  const runtime = { service: () => ({ get: () => live }) };
  const queued = queueJavaInitHandoff({ ...f, runtime });
  live = { id: f.agent.id };
  assert.equal((await queued.completion).reason, 'agent-not-live');
  assert.equal(f.messages.length, 0);
  assert.equal(queueJavaInitHandoff({ ...f, runtime }).reason, 'agent-not-live');
});
test('stale token and removed state are not recreated or overwritten', async (t) => {
  const f = fixture(t);
  const queued = queueJavaInitHandoff(f);
  fs.writeFileSync(f.file, JSON.stringify({ token: 'new', report: { unchanged: true } }));
  assert.equal((await queued.completion).reason, 'stale-token');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), {
    token: 'new',
    report: { unchanged: true },
  });
  assert.equal(queueJavaInitHandoff(f).reason, 'stale-token');
  fs.unlinkSync(f.file);
  assert.equal(queueJavaInitHandoff(f).reason, 'pending-unavailable');
  assert.equal(f.messages.length, 0);
});
test('checks again after asynchronous factory and contains followup rejection', async (t) => {
  const f = fixture(t),
    abort = new AbortController();
  const queued = queueJavaInitHandoff({
    ...f,
    signal: abort.signal,
    createMessage: async (input) => {
      abort.abort();
      return f.createMessage(input);
    },
  });
  assert.equal((await queued.completion).reason, 'aborted');
  f.agent.followup = async () => {
    throw new Error('transport failed');
  };
  const retry = queueJavaInitHandoff(f);
  assert.equal((await retry.completion).reason, 'transport failed');
  assert.match(JSON.parse(fs.readFileSync(f.file)).handoff.error, /transport failed/);
  assert.equal(f.messages.length, 0);
});
test('factory unavailable or malformed produces contained resumable failure', async (t) => {
  const f = fixture(t);
  const queued = queueJavaInitHandoff({ ...f, createMessage: () => ({ role: 'user' }) });
  assert.equal((await queued.completion).reason, 'message-factory-returned-invalid-message');
  assert.equal(f.messages.length, 0);
});
test('structured token equality survives JSON roundtrip and deduplicates equivalent copies', async (t) => {
  const f = fixture(t);
  const copy = { ...f, result: { ...f.result, token: JSON.parse(JSON.stringify(f.result.token)) } };
  const queued = queueJavaInitHandoff(copy);
  assert.equal(queued.queued, true);
  assert.equal(queueJavaInitHandoff(f).reason, 'duplicate');
  assert.equal((await queued.completion).accepted, true);
  fs.writeFileSync(f.file, JSON.stringify({ token: f.result.token, completed: true }));
  assert.equal(queueJavaInitHandoff(f).reason, 'stale-token');
});
test('runtime without agents registry can use exact supplied test agent', async (t) => {
  const f = fixture(t);
  const queued = queueJavaInitHandoff({ ...f, runtime: { service: () => undefined } });
  assert.equal((await queued.completion).accepted, true);
});
