import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export async function mcpClient(t, root, { env: environment = {} } = {}) {
  const env = { ...process.env, ...environment, SPECGATE_INTERACTIVE_APPROVAL: '1' };
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
