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
  registerCommands(ctx, { getCwd: () => root });
  return definitions;
}

function makeAgent(events, options = {}) {
  return {
    status: options.status || 'idle',
    session: {
      deriveMessages() {
        return options.messages || [];
      },
      append(type, data, opts) {
        if (options.reject) throw new Error('projection rejected');
        events.push({ type, data, opts });
      },
    },
  };
}

test('a fresh session receives one durable notice, never a synthetic assistant message', () => {
  const events = [];
  const agent = makeAgent(events);

  assert.equal(
    appendCommandNotice({ agent }, { kind: 'success', text: 'SpecGate 初始化完成\n项目：E:\\demo' }),
    true,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'user/message');
  assert.equal(events[0].data.role, 'user');
  assert.equal(events[0].data.source.kind, 'specgate');
  assert.equal(events[0].data.source.form, 'notice');
  assert.equal(events[0].data.source.summary, 'SpecGate 初始化完成');
  assert.match(events[0].data.content[0].text, /项目：E:\\demo/);
  assert.deepEqual(events[0].opts, { surfaceOp: 'append' });
});

test('an active conversation keeps only the DSH command card', () => {
  const events = [];
  const agent = makeAgent(events, { messages: [{ role: 'user' }] });

  assert.equal(appendCommandNotice({ agent }, { kind: 'success', text: 'SpecGate 状态' }), false);
  assert.equal(events.length, 0);
});

test('a running agent never receives a notice between tool call and result', () => {
  const events = [];
  const agent = makeAgent(events, { status: 'running' });

  assert.equal(appendCommandNotice({ agent }, { kind: 'success', text: 'SpecGate 状态' }), false);
  assert.equal(events.length, 0);
});

test('sg-init returns the full report and appends it in a fresh session', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-command-report-'));
  const events = [];
  const agent = makeAgent(events);
  const definitions = captureCommands(root);
  const init = definitions.find((definition) => definition.name === 'sg-init');
  assert.ok(init);
  assert.match(init.input.hint, /--path/);

  const result = await init.handler({ agent, rawInput: '--minimal --no-git' });

  assert.equal(result.kind, 'success');
  assert.match(result.text, /SpecGate 初始化完成/);
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'config.yaml')));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'user/message');
  assert.match(events[0].data.content[0].text, /SpecGate 初始化完成/);
  assert.equal(events[0].data.source.form, 'notice');
});

test('a failed command also reports its error text in a fresh session', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-command-error-'));
  const events = [];
  const agent = makeAgent(events);
  const definitions = captureCommands(root);
  const classify = definitions.find((definition) => definition.name === 'sg-classify');

  const result = await classify.handler({ agent, rawInput: '' });

  assert.equal(result.kind, 'error');
  assert.match(result.text, /用法/);
  assert.equal(events.length, 1);
  assert.match(events[0].data.content[0].text, /用法/);
});

test('a rejected notice append does not fail the command', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-command-fallback-'));
  const agent = makeAgent([], { reject: true });
  const definitions = captureCommands(root);
  const init = definitions.find((definition) => definition.name === 'sg-init');

  const result = await init.handler({ agent, rawInput: '--minimal --no-git' });

  assert.equal(result.kind, 'success');
  assert.match(result.text, /SpecGate 初始化完成/);
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'config.yaml')));
});

test('repeated /sg-init is a state-level no-op', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-command-idem-init-'));
  const agent = makeAgent([]);
  const definitions = captureCommands(root);
  const init = definitions.find((definition) => definition.name === 'sg-init');

  const first = await init.handler({ agent, rawInput: '--minimal --no-git' });
  const second = await init.handler({ agent, rawInput: '--minimal --no-git' });

  assert.equal(first.kind, 'success');
  assert.match(first.text, /SpecGate 初始化完成/);
  assert.equal(second.kind, 'success');
  assert.match(second.text, /幂等跳过/);
});

test('repeated /sg-deviation dedupes for 24h and --force appends again', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-command-idem-dev-'));
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-command-names-'));
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
