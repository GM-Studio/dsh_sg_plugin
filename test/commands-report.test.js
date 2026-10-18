import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { appendCommandNotice, registerCommands } from '../src/commands.js';

function captureCommands(root) {
  const definitions = [];
  const ctx = {
    commands: {
      register(definition) {
        definitions.push(definition);
        return () => {};
      },
    },
  };
  registerCommands(ctx, { getCwd: () => root, language: () => 'zh' });
  return definitions;
}

function makeAgent(events, options = {}) {
  const agent = {
    status: options.status || 'idle',
    session: {
      deriveMessages() {
        return options.messages || [];
      },
      append(type, data, opts) {
        if (options.rejectAppend) throw new Error('projection rejected');
        events.push({ channel: 'append', type, data, opts });
      },
    },
  };
  if (!options.noFollowup) {
    agent.followup = (payload) => {
      if (options.rejectFollowup) throw new Error('follow-up rejected');
      events.push({ channel: 'followup', payload });
    };
  }
  return agent;
}

function followups(events) {
  return events.filter((event) => event.channel === 'followup');
}

function appends(events) {
  return events.filter((event) => event.channel === 'append');
}

function followupText(events) {
  const [first] = followups(events);
  assert.ok(first, 'expected one agent hand-off');
  return first.payload.content[0].text;
}

function tempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `specgate-command-report-${label}-`));
}

test('a completed command hands its full output to the agent instead of a notice', async () => {
  const root = tempRoot('handoff');
  const events = [];
  const agent = makeAgent(events);
  const init = captureCommands(root).find((definition) => definition.name === 'sg-init');

  const result = await init.handler({ agent, rawInput: '--minimal --no-git' });

  assert.equal(result.kind, 'success');
  assert.equal(appends(events).length, 0, 'no collapsed notice when the agent took over');
  assert.equal(followups(events).length, 1);

  const [handoff] = followups(events);
  assert.equal(handoff.payload.role, 'user', 'followup consumes a real user message');
  assert.equal(typeof handoff.payload.id, 'string');
  assert.equal(handoff.payload.source.kind, 'specgate');
  assert.equal(handoff.payload.source.command, 'sg-init');

  const text = followupText(events);
  assert.match(text, /\/sg-init 已执行完成/);
  assert.match(text, /SpecGate 初始化完成/);
  assert.match(text, /完整呈现给用户/);
});

test('the hand-off also fires in an active conversation, not only in fresh sessions', async () => {
  const root = tempRoot('active');
  const events = [];
  const agent = makeAgent(events, { messages: [{ role: 'user' }, { role: 'assistant' }] });
  const definitions = captureCommands(root);
  await definitions.find((definition) => definition.name === 'sg-init').handler({
    agent,
    rawInput: '--minimal --no-git',
  });

  const status = definitions.find((definition) => definition.name === 'sg-status');
  const result = await status.handler({ agent, rawInput: '' });

  assert.equal(result.kind, 'success');
  assert.match(followupText(events), /G1/);
  assert.equal(appends(events).length, 0);
});

test('a running agent receives neither a hand-off nor a notice', async () => {
  const root = tempRoot('running');
  const events = [];
  const agent = makeAgent(events, { status: 'running' });
  const init = captureCommands(root).find((definition) => definition.name === 'sg-init');

  const result = await init.handler({ agent, rawInput: '--minimal --no-git' });

  assert.equal(result.kind, 'success');
  assert.equal(events.length, 0);
});

test('a rejected hand-off falls back to the durable notice', async () => {
  const root = tempRoot('fallback');
  const events = [];
  const agent = makeAgent(events, { rejectFollowup: true });
  const init = captureCommands(root).find((definition) => definition.name === 'sg-init');

  const result = await init.handler({ agent, rawInput: '--minimal --no-git' });

  assert.equal(result.kind, 'success');
  assert.match(result.text, /SpecGate 初始化完成/);
  assert.equal(followups(events).length, 0);
  assert.equal(appends(events).length, 1);
  assert.equal(appends(events)[0].data.source.form, 'notice');
});

test('appendCommandNotice still reports when the runtime has no followup', () => {
  const events = [];
  const agent = makeAgent(events, { noFollowup: true });

  assert.equal(
    appendCommandNotice({ agent }, { kind: 'success', text: 'SpecGate 初始化完成\n项目：E:\\demo' }),
    true,
  );
  assert.equal(appends(events).length, 1);
  const [notice] = appends(events);
  assert.equal(notice.type, 'user/message');
  assert.equal(notice.data.role, 'user');
  assert.equal(notice.data.source.kind, 'specgate');
  assert.equal(notice.data.source.form, 'notice');
  assert.equal(notice.data.source.summary, 'SpecGate 初始化完成');
  assert.match(notice.data.content[0].text, /项目：E:\\demo/);
  assert.deepEqual(notice.opts, { surfaceOp: 'append' });
});

test('a failed command also reaches the agent with its error text', async () => {
  const root = tempRoot('error');
  const events = [];
  const agent = makeAgent(events);
  const classify = captureCommands(root).find((definition) => definition.name === 'sg-classify');

  const result = await classify.handler({ agent, rawInput: '' });

  assert.equal(result.kind, 'error');
  assert.match(result.text, /用法/);
  const text = followupText(events);
  assert.match(text, /已执行失败/);
  assert.match(text, /用法/);
});

test('a rejected notice append does not fail the command', async () => {
  const root = tempRoot('notice-fallback');
  const agent = makeAgent([], { rejectAppend: true, noFollowup: true });
  const init = captureCommands(root).find((definition) => definition.name === 'sg-init');

  const result = await init.handler({ agent, rawInput: '--minimal --no-git' });

  assert.equal(result.kind, 'success');
  assert.match(result.text, /SpecGate 初始化完成/);
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'config.yaml')));
});

test('repeated /sg-init is a state-level no-op', async () => {
  const root = tempRoot('idem-init');
  const agent = makeAgent([]);
  const init = captureCommands(root).find((definition) => definition.name === 'sg-init');

  const first = await init.handler({ agent, rawInput: '--minimal --no-git' });
  const second = await init.handler({ agent, rawInput: '--minimal --no-git' });

  assert.equal(first.kind, 'success');
  assert.match(first.text, /SpecGate 初始化完成/);
  assert.equal(second.kind, 'success');
  assert.match(second.text, /幂等跳过/);
});

test('repeated /sg-deviation dedupes for 24h and --force appends again', async () => {
  const root = tempRoot('idem-dev');
  const agent = makeAgent([]);
  const definitions = captureCommands(root);
  const init = definitions.find((definition) => definition.name === 'sg-init');
  const deviation = definitions.find((definition) => definition.name === 'sg-deviation');

  await init.handler({ agent, rawInput: '--minimal --no-git' });
  const first = await deviation.handler({
    agent,
    rawInput: 'G4 用户明确要求跳过',
  });
  const second = await deviation.handler({
    agent,
    rawInput: 'G4 用户明确要求跳过',
  });
  const forced = await deviation.handler({
    agent,
    rawInput: 'G4 用户明确要求跳过 --force',
  });

  assert.equal(first.kind, 'success');
  assert.match(second.text, /幂等跳过/);
  assert.equal(forced.kind, 'success');
  assert.match(forced.text, /已记录偏离/);

  const log = fs.readFileSync(path.join(root, '.specgate', 'deviations.log'), 'utf8');
  assert.equal((log.match(/opId:/g) || []).length, 2);
});

test('commands use DSH-valid names and expose input hints where arguments are required', () => {
  const root = tempRoot('names');
  const definitions = captureCommands(root);
  const names = definitions.map((definition) => definition.name);

  assert.ok(names.includes('sg-init'));
  assert.ok(names.every((name) => /^[a-z0-9][a-z0-9_-]*$/.test(name)));
  assert.ok(!names.some((name) => name.includes(':')));
  for (const name of ['sg-commit', 'sg-gate', 'sg-deviation', 'sg-classify', 'sg-propose', 'sg-archive']) {
    const definition = definitions.find((item) => item.name === name);
    assert.equal(typeof definition.input?.hint, 'string', `${name} should advertise input`);
  }
});
