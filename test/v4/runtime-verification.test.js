import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  verifyHttpCrud,
  runtimeCommands,
  verifyRuntime,
} from '../../src/v4/runtime-verification.js';

async function fixture(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: 'http://127.0.0.1:' + server.address().port };
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

// Self-contained so the same real HTTP fixture can run in an owned child.
function crudHandler(items, options = {}) {
  return async (request, response) => {
    const id = request.url.split('/')[3];
    let data = '';
    for await (const chunk of request) data += chunk;
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (request.url === '/api/sg-init-instance') {
      send(200, { token: options.token });
      return;
    }
    if (request.method === 'POST') {
      const payload = JSON.parse(data);
      if (!payload.name?.trim()) {
        send(400, {});
        return;
      }
      const item = { id: 1, ...payload };
      items.set('1', item);
      if (options.onCreate?.(request, response)) return;
      send(201, item);
    } else if (request.method === 'PUT') {
      const item = { id: 1, ...JSON.parse(data) };
      if (!options.noPersist) items.set(id, item);
      send(200, item);
    } else if (request.method === 'DELETE') {
      if (options.failDelete) {
        send(500, {});
        return;
      }
      items.delete(id);
      options.onDelete?.();
      send(204);
    } else if (!id) send(200, [...items.values()]);
    else if (items.has(id)) send(200, items.get(id));
    else send(404, {});
  };
}

test('HTTP verification requires actual create/read/list/update/delete and 400 responses', async () => {
  const items = new Map();
  const { server, url } = await fixture(crudHandler(items));
  try {
    assert.equal((await verifyHttpCrud(url)).ok, true);
    assert.equal(items.size, 0);
  } finally {
    await close(server);
  }
});

test('health-only response is not CRUD success', async () => {
  const { server, url } = await fixture((_request, response) => {
    response.writeHead(200);
    response.end('{}');
  });
  try {
    await assert.rejects(verifyHttpCrud(url), /create expected 201/);
  } finally {
    await close(server);
  }
});

test('update must be persisted and failure still deletes the created probe', async () => {
  const items = new Map();
  const { server, url } = await fixture(crudHandler(items, { noPersist: true }));
  try {
    await assert.rejects(verifyHttpCrud(url), /not stored/);
    assert.equal(items.size, 0);
  } finally {
    await close(server);
  }
});

test('cancellation aborts an in-flight create and cleans the committed probe without the aborted signal', async () => {
  const items = new Map();
  const controller = new AbortController();
  let deletes = 0;
  const { server, url } = await fixture(
    crudHandler(items, {
      onCreate() {
        controller.abort(new Error('cancelled create'));
        return true;
      },
      onDelete() {
        deletes += 1;
      },
    }),
  );
  try {
    await assert.rejects(
      verifyHttpCrud(url, 'cancel-probe', { signal: controller.signal }),
      /cancelled create/,
    );
    assert.equal(items.size, 0);
    assert.equal(deletes, 1);
  } finally {
    await close(server);
  }
});

test('probe cleanup failure is surfaced rather than silently swallowed', async () => {
  const { server, url } = await fixture(
    crudHandler(new Map(), { noPersist: true, failDelete: true }),
  );
  try {
    await assert.rejects(verifyHttpCrud(url), /probe cleanup delete failed/);
  } finally {
    await close(server);
  }
});

test('runtime commands preserve selected manager and stack', () => {
  assert.equal(runtimeCommands({ stack: 'node', packageManager: 'npm' }, '.').port, 3000);
  assert.equal(runtimeCommands({ stack: 'java', buildTool: 'maven' }, '.').port, 8080);
  assert.equal(runtimeCommands({ stack: 'python', framework: 'fastapi' }, '.').port, 8000);
  assert.equal(
    runtimeCommands({ stack: 'react', role: 'frontend', packageManager: 'pnpm' }, '.').port,
    5173,
  );
});

const selection = { sides: [{ id: 'api', path: 'api', role: 'backend', stack: 'node' }] };

test('aborted verification does not start a service or send requests', async () => {
  let calls = 0;
  const { server } = await fixture((_request, response) => {
    calls += 1;
    response.end('existing');
  });
  const controller = new AbortController();
  controller.abort();
  try {
    const result = await verifyRuntime({
      root: os.tmpdir(),
      selection,
      signal: controller.signal,
      resolvePort: () => server.address().port,
      spawnProcess() {
        throw new Error('must not start');
      },
    });
    assert.equal(result.ok, false);
    assert.equal(calls, 0);
  } finally {
    await close(server);
  }
});

test('occupied port is rejected without HTTP requests or spawning a service', async () => {
  let calls = 0;
  const { server } = await fixture((_request, response) => {
    calls += 1;
    response.end('existing');
  });
  try {
    const result = await verifyRuntime({
      root: os.tmpdir(),
      selection,
      resolvePort: () => server.address().port,
      spawnProcess() {
        throw new Error('must not start');
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /已占用/);
    assert.equal(calls, 0);
    assert.equal(server.listening, true);
  } finally {
    await close(server);
  }
});

async function ownedFixture(
  t,
  { wrongToken = false, cancelCreate = false, ignoreTerm = false, processTree = false } = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-runtime-'));
  fs.mkdirSync(path.join(root, 'api'));
  const probe = await fixture((_req, res) => res.end());
  const port = probe.server.address().port;
  await close(probe.server);
  const file = path.join(root, 'service.cjs');
  const createdFile = path.join(root, 'created');
  const deletedFile = path.join(root, 'deleted');
  const descendantFile = path.join(root, 'descendant-pid');
  fs.writeFileSync(
    file,
    `const http = require('node:http'); const fs = require('node:fs');\n${crudHandler.toString()}\nconst handler = crudHandler(new Map(), { token: ${wrongToken ? "'wrong'" : 'process.env.SG_INIT_VERIFY_TOKEN'}, onCreate: ${cancelCreate ? `() => { fs.writeFileSync(${JSON.stringify(createdFile)}, 'created'); return true; }` : 'undefined'}, onDelete: () => fs.writeFileSync(${JSON.stringify(deletedFile)}, 'deleted') });\n${ignoreTerm ? "process.on('SIGTERM', () => {});" : ''}\nhttp.createServer(handler).listen(${port}, '127.0.0.1');\n`,
  );
  if (processTree) {
    const launcher = path.join(root, 'launcher.cjs');
    // The injected launcher, not the HTTP descendant, is the owned process.
    fs.writeFileSync(
      launcher,
      `const child = require('node:child_process').spawn(process.execPath, [${JSON.stringify(file)}], { stdio: 'ignore', env: process.env }); require('node:fs').writeFileSync(${JSON.stringify(descendantFile)}, String(child.pid)); setInterval(() => {}, 1000);`,
    );
  }
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && !child.signalCode) {
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    port,
    createdFile,
    deletedFile,
    descendantFile,
    get child() {
      return child;
    },
    spawnProcess(_command, _args, options) {
      assert.match(options.env.SG_INIT_VERIFY_TOKEN, /^[0-9a-f-]{36}$/i);
      child = spawn(process.execPath, [processTree ? path.join(root, 'launcher.cjs') : file], {
        ...options,
        shell: false,
      });
      return child;
    },
  };
}

test('temporary owned node service passes token handshake, CRUD, and confirmed cleanup', async (t) => {
  const owned = await ownedFixture(t);
  const result = await verifyRuntime({
    root: owned.root,
    selection,
    resolvePort: () => owned.port,
    spawnProcess: owned.spawnProcess,
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.cleanup, 'passed');
  assert.equal(result.results[0].httpCrud, 'passed');
  assert.ok(owned.child.exitCode !== null || owned.child.signalCode);
  assert.throws(() => process.kill(owned.child.pid, 0), { code: 'ESRCH' });
});

test('cleanup terminates both the owned launcher and HTTP descendant', async (t) => {
  const owned = await ownedFixture(t, { processTree: true });
  const result = await verifyRuntime({
    root: owned.root,
    selection,
    resolvePort: () => owned.port,
    spawnProcess: owned.spawnProcess,
  });
  assert.equal(result.ok, true, result.message);
  const descendant = Number(fs.readFileSync(owned.descendantFile, 'utf8'));
  assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
  assert.throws(() => process.kill(owned.child.pid, 0), { code: 'ESRCH' });
});

test('owned service with wrong handshake token fails and is cleaned up', async (t) => {
  const owned = await ownedFixture(t, { wrongToken: true });
  const result = await verifyRuntime({
    root: owned.root,
    selection,
    resolvePort: () => owned.port,
    spawnProcess: owned.spawnProcess,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /身份/);
  assert.equal(result.cleanup, 'passed');
  assert.equal(fs.existsSync(owned.deletedFile), false);
});

test('runtime cancellation during POST cleans the probe and the owned node process', async (t) => {
  const owned = await ownedFixture(t, { cancelCreate: true });
  const controller = new AbortController();
  const watcher = setInterval(() => {
    if (fs.existsSync(owned.createdFile)) controller.abort(new Error('cancelled runtime'));
  }, 10);
  try {
    const result = await verifyRuntime({
      root: owned.root,
      selection,
      signal: controller.signal,
      resolvePort: () => owned.port,
      spawnProcess: owned.spawnProcess,
    });
    assert.equal(result.ok, false);
    assert.equal(result.cleanup, 'passed');
    assert.equal(fs.existsSync(owned.deletedFile), true);
    assert.throws(() => process.kill(owned.child.pid, 0), { code: 'ESRCH' });
  } finally {
    clearInterval(watcher);
  }
});

test(
  'POSIX cleanup escalates SIGTERM to SIGKILL for an uncooperative owned service',
  { skip: process.platform === 'win32' },
  async (t) => {
    const owned = await ownedFixture(t, { ignoreTerm: true });
    const result = await verifyRuntime({
      root: owned.root,
      selection,
      resolvePort: () => owned.port,
      spawnProcess: owned.spawnProcess,
    });
    assert.equal(result.ok, true, result.message);
    assert.equal(owned.child.signalCode, 'SIGKILL');
  },
);

test('cleanup failure overrides an otherwise passed runtime result', async () => {
  const probe = await fixture((_req, res) => res.end());
  const port = probe.server.address().port;
  await close(probe.server);
  let server;
  try {
    const result = await verifyRuntime({
      root: os.tmpdir(),
      selection,
      resolvePort: () => port,
      spawnProcess(_command, _args, options) {
        server = http.createServer(
          crudHandler(new Map(), { token: options.env.SG_INIT_VERIFY_TOKEN }),
        );
        server.listen(port, '127.0.0.1');
        const child = new EventEmitter();
        child.exitCode = null;
        return child; // No PID: cannot claim process-tree cleanup succeeded.
      },
    });
    assert.equal(result.results[0].httpCrud, 'passed');
    assert.equal(result.ok, false);
    assert.equal(result.status, 'failed');
    assert.equal(result.cleanup, 'failed');
    assert.match(result.message, /清理失败/);
  } finally {
    if (server) await close(server);
  }
});
