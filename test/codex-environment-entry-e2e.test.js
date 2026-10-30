import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createToolRegistry } from '../src/codex/workflow-tools.js';

const data = (response) => response.structuredContent;
const roots = [];
test.after(() => {
  for (const root of roots)
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-env-entry-'));
  roots.push(root);
  return root;
}

export async function mcpClient(t, root) {
  const env = { ...process.env, SPECGATE_INTERACTIVE_APPROVAL: '1' };
  delete env.SPECGATE_OPTIONAL_MODULES;
  const child = spawn(process.execPath, [path.resolve('src/codex/server.js')], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  child.stderr.resume();
  const pending = new Map();
  let sequence = 0;
  let onForm = () => ({ action: 'cancel' });
  const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    if (message.method === 'elicitation/create') {
      Promise.resolve(onForm(message.params)).then((result) =>
        send({ jsonrpc: '2.0', id: message.id, result }),
      );
    } else if (pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    }
  });
  const request = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('MCP request timeout: ' + method));
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      send({ jsonrpc: '2.0', id, method, params });
    });
  child.on('error', (error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  });
  t.after(async () => {
    child.stdin.end();
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 5000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.destroy();
    child.unref();
    lines.close();
    for (const entry of pending.values()) clearTimeout(entry.timer);
  });
  await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: { elicitation: {} },
    clientInfo: { name: 'environment-e2e-protocol-fixture', version: '1' },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return {
    request,
    call: (name, args = {}) => request('tools/call', { name, arguments: args }),
    form: (callback) => {
      onForm = callback;
    },
  };
}

test('default stdio package surface exposes environment preparation and new-project selection', async (t) => {
  const root = temporary(t);
  const client = await mcpClient(t, root);
  const listing = await client.request('tools/list');
  for (const name of ['sg_env_check', 'sg_env_prepare', 'sg_project_create'])
    assert.ok(
      listing.tools.some((entry) => entry.name === name),
      name,
    );
  assert.equal(
    listing.tools.some((entry) => entry.name === 'sg_work_item_create'),
    false,
  );
  const check = data(
    await client.call('sg_env_check', { preset: 'jdk17-boot3.5', frontend: 'react' }),
  );
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.ok(Array.isArray(check.plan));
  assert.equal(check.workflowVerification, 'not-run');
  const node = data(await client.call('sg_env_check', { stack: 'node' }));
  assert.deepEqual(node.required, ['git', 'node']);
  assert.equal(node.environmentReady, true, JSON.stringify(node));
  assert.deepEqual(fs.readdirSync(root), []);
});

test('new-project environment selection is trusted, resumable, and does not generate business code', async (t) => {
  const parent = temporary(t),
    target = path.join(parent, 'selected');
  let forms = 0;
  const registry = createToolRegistry({
    projectRoot: parent,
    trustedUserIdentity: { kind: 'user', id: 'protocol-fixture', source: 'test-only' },
    requestPeer: async () => {
      forms++;
      return {
        action: 'accept',
        content: { path: target, preset: 'jdk17-boot3.5', frontend: 'react' },
      };
    },
    environmentService: {
      check: async () => ({ ok: true, environmentReady: true, workflowVerification: 'not-run' }),
      inspect: () => ({ status: 'ready' }),
    },
  });
  const selected = data(await registry.call('sg_project_create'));
  assert.equal(selected.ok, true, JSON.stringify(selected));
  assert.equal(selected.projectRoot, fs.realpathSync(target));
  assert.equal(selected.generated, false);
  assert.equal(selected.projectReady, false);
  assert.equal(selected.nextAction, 'ENVIRONMENT_READY');
  assert.deepEqual(fs.readdirSync(target), ['.specgate']);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(target, '.specgate/environment-selection.json'), 'utf8'))
      .selection,
    { preset: 'jdk17-boot3.5', frontend: 'react' },
  );
  assert.equal(data(await registry.call('sg_project_create')).projectRoot, selected.projectRoot);
  assert.equal(forms, 1);
});

test('missing or cancelled project form leaves the requested target untouched', async (t) => {
  const root = temporary(t),
    target = path.join(root, 'cancelled');
  for (const options of [
    {},
    {
      trustedUserIdentity: { kind: 'user', id: 'fixture', source: 'test' },
      requestPeer: async () => ({ action: 'cancel' }),
    },
  ]) {
    const registry = createToolRegistry({ projectRoot: root, ...options });
    const result = data(await registry.call('sg_project_create', { path: target }));
    assert.equal(result.ok, false);
    assert.equal(fs.existsSync(target), false);
  }
});
