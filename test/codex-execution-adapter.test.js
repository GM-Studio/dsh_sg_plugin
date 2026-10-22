import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import {
  createCodexExecutionAdapter,
  extractSessionId,
} from '../src/codex/control/codex-execution-adapter.js';

function fakeSpawn(lines, exitCode = 0) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    queueMicrotask(() => {
      for (const line of lines) child.stdout.emit('data', `${JSON.stringify(line)}\n`);
      child.stderr.emit('data', 'warning without secrets\n');
      child.emit('close', exitCode, null);
    });
    return child;
  };
  return { calls, spawnImpl };
}

test('Codex adapter starts exec with JSON events and extracts session id', async () => {
  const fake = fakeSpawn([
    { type: 'thread.started', thread: { id: 'session-123' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'done' } },
  ]);
  const adapter = createCodexExecutionAdapter({
    command: 'codex-test',
    spawnImpl: fake.spawnImpl,
  });
  const events = [];
  const projectRoot = path.resolve('work-product');
  const result = await adapter.start({
    projectRoot,
    prompt: 'Implement the feature',
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, 'session-123');
  assert.equal(events.length, 2);
  assert.deepEqual(fake.calls[0].args.slice(0, 4), ['exec', '--json', '--color', 'never']);
  assert.ok(fake.calls[0].args.includes('--cd'));
  assert.equal(fake.calls[0].options.cwd, projectRoot);
});

test('Codex adapter isolates host MCP and injects the bound SpecGate server', async () => {
  const fake = fakeSpawn([{ type: 'thread.started', thread_id: 'session-123' }]);
  const adapter = createCodexExecutionAdapter({
    command: '/opt/codex/bin/codex',
    spawnImpl: fake.spawnImpl,
    platform: 'linux',
    env: {
      PATH: '/opt/bin',
      CODEX_HOME: '/home/owner/.codex',
      SPECGATE_WORK_ITEM_ID: 'work-1',
      SPECGATE_CONTROL_MODE: '1',
    },
  });

  await adapter.start({
    projectRoot: '/work/product',
    prompt: 'Implement',
    environment: {
      SPECGATE_WORK_ITEM_ID: 'work-1',
      SPECGATE_CONTROL_HOME: '/home/owner/.codex/specgate-control',
    },
  });

  const args = fake.calls[0].args;
  assert.ok(args.includes('approval_policy="never"'));
  assert.ok(args.includes('mcp_servers={}'));
  assert.ok(args.includes('plugins={}'));
  assert.ok(args.some((value) => value.startsWith('mcp_servers.specgate_control.command=')));
  const serverArgs = args.find((value) => value.startsWith('mcp_servers.specgate_control.args='));
  const parsedServerArgs = JSON.parse(serverArgs.slice(serverArgs.indexOf('=') + 1));
  assert.match(parsedServerArgs[0], /src[\\/]codex[\\/]server\.js/);
  assert.equal(parsedServerArgs[1], '--project-root');
  assert.equal(parsedServerArgs[2], '/work/product');
  const serverEnv = args.find((value) => value.startsWith('mcp_servers.specgate_control.env='));
  assert.match(serverEnv, /SPECGATE_NATIVE_AGENTS = "1"/);
  assert.match(serverEnv, /SPECGATE_WORK_ITEM_ID = "work-1"/);
  assert.equal(fake.calls[0].options.env.SPECGATE_WORK_ITEM_ID, 'work-1');
  assert.equal(fake.calls[0].options.env.SPECGATE_CONTROL_MODE, '1');
  assert.equal(fake.calls[0].options.detached, true);
});

test('Codex adapter resumes an exact session with a follow-up prompt', async () => {
  const fake = fakeSpawn([{ type: 'turn.completed', session_id: 'session-123' }]);
  const adapter = createCodexExecutionAdapter({
    command: 'codex-test',
    spawnImpl: fake.spawnImpl,
  });
  const result = await adapter.resume({
    projectRoot: path.resolve('work-product'),
    sessionId: 'session-123',
    prompt: 'Continue after H1 approval',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(fake.calls[0].args.slice(0, 3), ['exec', 'resume', 'session-123']);
  assert.ok(fake.calls[0].args.includes('mcp_servers={}'));
  assert.ok(fake.calls[0].args.includes('plugins={}'));
});

test('session extraction only accepts explicit session or thread identifiers', () => {
  assert.equal(extractSessionId({ session_id: 's-1' }), 's-1');
  assert.equal(extractSessionId({ thread: { id: 't-1' } }), 't-1');
  assert.equal(extractSessionId({ id: 'event-id' }), null);
  assert.equal(extractSessionId({ item: { id: 'item-id' } }), null);
});

test('Codex adapter fails closed for invalid session and non-JSON output', async () => {
  const spawnImpl = (_command, _args, _options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    queueMicrotask(() => {
      child.stdout.emit('data', 'not-json\n');
      child.emit('close', 1, null);
    });
    return child;
  };
  const adapter = createCodexExecutionAdapter({ spawnImpl });
  assert.equal(
    (await adapter.resume({ projectRoot: process.cwd(), sessionId: '', prompt: 'x' })).code,
    'INVALID_ARGUMENT',
  );
  const result = await adapter.start({ projectRoot: process.cwd(), prompt: 'x' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CODEX_EXECUTION_FAILED');
});
