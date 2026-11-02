import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProtocol } from '../src/codex/protocol.js';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'diagnostic-fixture', version: '1' },
  },
};
const ready = { jsonrpc: '2.0', method: 'notifications/initialized' };
const call = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'fault', arguments: {} },
};
const secret = 'synthetic-client-secret-DO-NOT-EXPOSE';

for (const [code, category] of [
  ['EACCES', 'permission'],
  ['ENOSPC', 'storage'],
  ['MODULE_NOT_FOUND', 'dependency'],
  ['ECONNREFUSED', 'network'],
  ['AUTH_REQUIRED', 'authentication'],
  ['ETIMEDOUT', 'timeout'],
]) {
  test(`protocol retains safe ${code} diagnosis for sync and async exceptions`, async () => {
    for (const asyncFault of [false, true]) {
      const error = Object.assign(
        new Error(`password=${secret} https://user:${secret}@example.test/?token=${secret}`),
        { code, cause: { code: 'IGNORED', message: secret } },
      );
      const dispatch = createProtocol({
        registry: {
          definitions: [{ name: 'fault' }],
          call: () => {
            if (asyncFault) return Promise.reject(error);
            throw error;
          },
        },
      });
      await dispatch(init);
      dispatch(ready);
      const result = (await dispatch(call)).result;
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.cause.code, code);
      assert.equal(result.structuredContent.cause.category, category);
      assert.equal(result.structuredContent.stage, 'tool.call');
      assert.ok(result.structuredContent.retryAction);
      assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
      assert.doesNotMatch(JSON.stringify(result), /example\.test|at TestContext/);
    }
  });
}

test('real stdio filesystem failure returns structured diagnosis without stdout pollution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-stdio-diagnostic-'));
  const script = path.join(root, 'fault.mjs');
  fs.writeFileSync(
    script,
    `import fs from 'node:fs';import {serveStdio} from ${JSON.stringify(pathToFileURL(path.join(pluginRoot, 'src/codex/server.js')).href)};serveStdio({projectRoot:${JSON.stringify(root)},toolRegistryFactory:()=>({definitions:[{name:'fault'}],call(){return fs.readFileSync(${JSON.stringify(path.join(root, 'actually-missing.json'))},'utf8')}})});`,
  );
  const execution = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    input: [init, ready, call].map((v) => JSON.stringify(v)).join('\n') + '\n',
    timeout: 30000,
    windowsHide: true,
  });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stderr, '');
  const messages = execution.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const data = messages.find((v) => v.id === 2).result.structuredContent;
  assert.equal(data.cause.code, 'ENOENT');
  assert.equal(data.cause.category, 'dependency');
  assert.equal(data.stage, 'tool.call');
});

test('initialize failure has a safe diagnosis and permits a fresh handshake', async () => {
  let fail = true;
  const dispatch = createProtocol({
    registry: { definitions: [] },
    onInitialize: () => {
      if (fail) throw Object.assign(new Error(secret), { code: 'EACCES' });
    },
  });
  const first = await dispatch(init);
  assert.equal(first.error.code, -32603);
  assert.equal(first.error.data.stage, 'protocol.initialize');
  assert.equal(first.error.data.cause.category, 'permission');
  assert.doesNotMatch(JSON.stringify(first), new RegExp(secret));
  fail = false;
  assert.equal((await dispatch({ ...init, id: 3 })).result.protocolVersion, '2025-06-18');
});

test('unknown errors, hostile getters and cycles never expose raw provider data', async () => {
  let messageReads = 0;
  const fault = { code: 'SYNTHETIC_SECRET_ABCDEFGHIJKLMNOPQRSTUV' };
  fault.cause = fault;
  Object.defineProperty(fault, 'message', {
    get() {
      messageReads++;
      throw new Error(secret);
    },
  });
  const dispatch = createProtocol({
    registry: {
      definitions: [{ name: 'fault' }],
      call() {
        throw fault;
      },
    },
  });
  await dispatch(init);
  dispatch(ready);
  const result = (await dispatch(call)).result;
  assert.equal(result.structuredContent.cause.code, 'UNKNOWN');
  assert.equal(result.structuredContent.cause.category, 'unknown');
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_SECRET|DO-NOT-EXPOSE/);
  assert.equal(messageReads, 0);
});

test('real loopback connection failure travels through stdio as a network diagnostic', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-network-diagnostic-'));
  const script = path.join(root, 'network.mjs');
  fs.writeFileSync(
    script,
    `import net from 'node:net';import {serveStdio} from ${JSON.stringify(pathToFileURL(path.join(pluginRoot, 'src/codex/server.js')).href)};serveStdio({projectRoot:${JSON.stringify(root)},toolRegistryFactory:()=>({definitions:[{name:'fault'}],async call(){const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));await new Promise((resolve,reject)=>{const socket=net.connect({host:'127.0.0.1',port});socket.once('error',reject);socket.once('connect',()=>{socket.destroy();reject(new Error('port unexpectedly reused'))});});}})});`,
  );
  const execution = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    input: [init, ready, call].map((v) => JSON.stringify(v)).join('\n') + '\n',
    timeout: 30000,
    windowsHide: true,
  });
  assert.equal(execution.status, 0, execution.stderr);
  assert.equal(execution.stderr, '');
  const data = execution.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .find((v) => v.id === 2).result.structuredContent;
  assert.equal(data.cause.code, 'ECONNREFUSED');
  assert.equal(data.cause.category, 'network');
});

test('actual startup reports an invalid explicit project without creating it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-bootstrap-diagnostic-'));
  const missing = path.join(root, 'does-not-exist');
  const execution = spawnSync(
    process.execPath,
    [path.join(pluginRoot, 'src/codex/server.js'), '--project-root', missing],
    { cwd: root, input: '', encoding: 'utf8', timeout: 30000, windowsHide: true },
  );
  assert.equal(execution.status, 1);
  assert.equal(execution.stdout, '');
  const data = JSON.parse(execution.stderr.trim());
  assert.equal(data.stage, 'bootstrap.project-binding');
  assert.equal(data.cause.category, 'configuration');
  assert.equal(fs.existsSync(missing), false);
});

function bootstrapFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-bootstrap-entry-'));
  for (const relative of [
    'src/codex/server.js',
    'src/codex/core/diagnostics.js',
    'src/codex/core/bootstrap-diagnostics.js',
    'src/codex/core/env/version-range.js',
  ]) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(pluginRoot, relative), target);
  }
  fs.mkdirSync(path.join(root, '.codex-plugin'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ type: 'module', engines: { node: '>=20.19.0' } }),
  );
  fs.writeFileSync(
    path.join(root, '.codex-plugin/plugin.json'),
    JSON.stringify({ name: 'startup-fixture', version: '1.0.0' }),
  );
  return root;
}
function startup(root, args = [], flags = []) {
  const execution = spawnSync(
    process.execPath,
    [...flags, path.join(root, 'src/codex/server.js'), ...args],
    { cwd: root, input: '', encoding: 'utf8', timeout: 30000, windowsHide: true },
  );
  assert.equal(execution.status, 1, execution.stdout + execution.stderr);
  assert.equal(execution.stdout, '');
  const lines = execution.stderr
    .trim()
    .split('\n')
    .filter((line) => line.startsWith('{'));
  assert.equal(lines.length, 1, execution.stderr);
  const data = JSON.parse(lines[0]);
  assert.doesNotMatch(JSON.stringify(data), new RegExp(secret));
  assert.ok(data.retryAction);
  return data;
}
test('actual entry catches malformed plugin metadata before loading the runtime', () => {
  const root = bootstrapFixture();
  fs.writeFileSync(path.join(root, '.codex-plugin/plugin.json'), `{invalid token=${secret}`);
  const result = startup(root);
  assert.equal(result.stage, 'bootstrap.config');
  assert.equal(result.cause.category, 'configuration');
});
test('actual entry reports a real runtime/engines mismatch before importing dependencies', () => {
  const root = bootstrapFixture();
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ type: 'module', engines: { node: '>=999.0.0' } }),
  );
  const result = startup(root);
  assert.equal(result.stage, 'bootstrap.runtime');
  assert.equal(result.cause.category, 'runtime');
});
test('actual entry reports a missing runtime module without exposing the Node stack', () => {
  const result = startup(bootstrapFixture());
  assert.equal(result.stage, 'bootstrap.load');
  assert.equal(result.cause.code, 'ERR_MODULE_NOT_FOUND');
  assert.equal(result.cause.category, 'dependency');
});
test('actual Node permission boundary is reported before touching the explicit project', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-permission-project-'));
  const flag = process.allowedNodeEnvironmentFlags.has('--permission')
    ? '--permission'
    : '--experimental-permission';
  assert.ok(process.allowedNodeEnvironmentFlags.has(flag), 'required actual Node permission mode');
  const result = startup(
    pluginRoot,
    ['--project-root', project],
    [flag, `--allow-fs-read=${pluginRoot}`],
  );
  assert.equal(result.cause.category, 'permission');
  assert.equal(result.cause.code, 'ERR_ACCESS_DENIED');
  assert.deepEqual(fs.readdirSync(project), []);
});
