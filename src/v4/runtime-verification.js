import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { toolchainEnv } from './provision.js';
import { randomUUID } from 'node:crypto';

export function runtimeCommands(side, root, toolchain = {}) {
  const pm = side.packageManager || 'pnpm';
  if (side.role === 'frontend' || side.stack === 'node') {
    const manager = pm === 'pnpm' ? toolchain.pnpm : null;
    const command =
      manager?.kind === 'node-script'
        ? manager.node
        : manager?.path || (process.platform === 'win32' ? pm + '.cmd' : pm);
    const prefix = manager?.kind === 'node-script' ? [manager.path] : [];
    return {
      command,
      args: [
        ...prefix,
        ...(pm === 'yarn' ? [] : ['run']),
        side.role === 'frontend' ? 'dev' : 'start',
        ...(side.role === 'frontend'
          ? ['--', '--host', '127.0.0.1', '--port', '5173', '--strictPort']
          : []),
      ],
      port: side.role === 'frontend' ? 5173 : 3000,
    };
  }
  if (side.stack === 'java') {
    const gradle = side.buildTool === 'gradle';
    return {
      command: path.join(
        root,
        gradle
          ? process.platform === 'win32'
            ? 'gradlew.bat'
            : 'gradlew'
          : process.platform === 'win32'
            ? 'mvnw.cmd'
            : 'mvnw',
      ),
      args: [gradle ? 'bootRun' : 'spring-boot:run'],
      port: 8080,
    };
  }
  const venv = path.join(
    root,
    '.venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
  );
  const python = fs.existsSync(venv) ? venv : toolchain.python?.path || 'python';
  return {
    command: python,
    args:
      side.framework === 'django'
        ? ['manage.py', 'runserver', '127.0.0.1:8000', '--noreload']
        : side.framework === 'flask'
          ? ['-m', 'flask', '--app', 'app', 'run', '--host', '127.0.0.1', '--port', '8000']
          : ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'],
    port: 8000,
  };
}

async function request(url, options = {}) {
  const timeout = AbortSignal.timeout(3000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  return fetch(url, { ...options, redirect: 'error', signal });
}

export async function verifyHttpCrud(base, marker = 'sg-init-' + Date.now(), { signal } = {}) {
  const endpoint = base + '/api/items';
  const body = (name) => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description: 'initialization probe' }),
  });
  const send = (url, options = {}) => request(url, { ...options, signal });
  let id;
  let createAttempted = false;
  let completed = false;
  let failure;
  try {
    signal?.throwIfAborted();
    createAttempted = true;
    const created = await send(endpoint, { method: 'POST', ...body(marker) });
    if (created.status !== 201) throw new Error('create expected 201, got ' + created.status);
    const item = await created.json();
    if (item.id === undefined || item.id === null || item.name !== marker)
      throw new Error('create response does not match contract');
    id = item.id;
    const read = await send(endpoint + '/' + encodeURIComponent(id));
    if (read.status !== 200 || (await read.json()).name !== marker) throw new Error('read failed');
    const list = await send(endpoint);
    const items = await list.json();
    if (list.status !== 200 || !Array.isArray(items) || !items.some((entry) => entry.id === id))
      throw new Error('list failed');
    const updated = await send(endpoint + '/' + encodeURIComponent(id), {
      method: 'PUT',
      ...body(marker + '-updated'),
    });
    if (updated.status !== 200 || (await updated.json()).name !== marker + '-updated')
      throw new Error('update failed');
    const reread = await send(endpoint + '/' + encodeURIComponent(id));
    if (reread.status !== 200 || (await reread.json()).name !== marker + '-updated')
      throw new Error('updated value is not stored');
    const invalid = await send(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (invalid.status !== 400) throw new Error('missing name must return 400');
    const removed = await send(endpoint + '/' + encodeURIComponent(id), { method: 'DELETE' });
    if (removed.status !== 204) throw new Error('delete failed');
    const missing = await send(endpoint + '/' + encodeURIComponent(id));
    if (missing.status !== 404) throw new Error('deleted item remains visible');
    completed = true;
  } catch (error) {
    failure = error;
  } finally {
    // Cleanup deliberately does not inherit cancellation: POST may have committed
    // even when its response was aborted before the probe id became available.
    if (!completed && createAttempted) {
      try {
        await cleanupProbe(endpoint, marker, id);
      } catch (cleanupError) {
        failure = new Error([failure?.message, cleanupError.message].filter(Boolean).join('; '), {
          cause: cleanupError,
        });
      }
    }
  }
  if (failure) throw failure;
  return {
    ok: true,
    status: 'passed',
    operations: ['create', 'read', 'list', 'update', 'delete', 'read-missing'],
  };
}

async function cleanupProbe(endpoint, marker, id) {
  let ids = [id];
  if (id === undefined || id === null) {
    const listed = await request(endpoint);
    if (listed.status !== 200) throw new Error('probe cleanup list failed');
    const items = await listed.json();
    if (!Array.isArray(items)) throw new Error('probe cleanup list is not an array');
    ids = items
      .filter((entry) => entry.name === marker || entry.name === marker + '-updated')
      .map((entry) => entry.id);
  }
  for (const probeId of ids) {
    if (probeId === undefined || probeId === null) throw new Error('probe cleanup missing id');
    const removed = await request(endpoint + '/' + encodeURIComponent(probeId), {
      method: 'DELETE',
    });
    if (![204, 404].includes(removed.status)) throw new Error('probe cleanup delete failed');
    const missing = await request(endpoint + '/' + encodeURIComponent(probeId));
    if (missing.status !== 404) throw new Error('probe cleanup item remains visible');
  }
}

async function isListening(port) {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForExit(exited, timeout = 2000) {
  const expires = Date.now() + timeout;
  while (!exited()) {
    if (Date.now() >= expires) return false;
    await delay(25);
  }
  return true;
}

async function stop(child) {
  if (!child.pid) {
    if (typeof child.exitCode === 'number' || child.signalCode || child.__sgSpawnError) return;
    throw new Error('cannot confirm owned process identity for cleanup');
  }
  if (process.platform === 'win32') {
    // taskkill /T covers descendants; waiting for its successful exit is required,
    // not just issuing child.kill() or observing the launcher exit.
    if (!processExists(child.pid)) {
      throw new Error('owned launcher exited before process-tree cleanup could be confirmed');
    }
    await new Promise((resolve, reject) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      const timer = setTimeout(() => {
        killer.kill();
        reject(new Error('taskkill timed out'));
      }, 5000);
      killer.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      killer.once('exit', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error('taskkill failed: ' + code));
      });
    });
    if (
      !(await waitForExit(
        () => !processExists(child.pid) && (child.exitCode !== null || child.signalCode),
      ))
    )
      throw new Error('owned process did not exit after taskkill');
  } else {
    const group = -child.pid;
    if (!processExists(group)) return;
    try {
      process.kill(group, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    if (!(await waitForExit(() => !processExists(group)))) {
      try {
        process.kill(group, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
      if (!(await waitForExit(() => !processExists(group))))
        throw new Error('owned process group did not exit after SIGKILL');
    }
  }
}

/** Temporary owned processes only. Never probe CRUD against an already occupied port. */
export async function verifyRuntime({
  root,
  selection,
  toolchain = {},
  signal,
  spawnProcess = spawn,
  resolvePort = (_side, port) => port,
}) {
  const children = [];
  const results = [];
  const token = randomUUID();
  let outcome;
  try {
    for (const side of selection.sides) {
      if (signal?.aborted) throw new Error('verification cancelled');
      const cwd = path.join(root, side.path);
      const command = runtimeCommands(side, cwd, toolchain);
      // Internal injection for isolated tests; production retains fixed stack ports.
      command.port = resolvePort(side, command.port);
      if (await isListening(command.port))
        throw new Error('端口 ' + command.port + ' 已占用；不访问或修改已有服务');
      signal?.throwIfAborted();
      const child = spawnProcess(command.command, command.args, {
        cwd,
        stdio: 'ignore',
        detached: process.platform !== 'win32',
        shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command.command),
        env: { ...toolchainEnv(toolchain), SG_INIT_VERIFY_TOKEN: token },
      });
      children.push(child);
      let error;
      child.once('error', (value) => {
        error = value;
        child.__sgSpawnError = value;
      });
      const base = 'http://127.0.0.1:' + command.port;
      let ready = false;
      const expires = Date.now() + 90000;
      while (Date.now() < expires) {
        if (signal?.aborted) throw new Error('verification cancelled');
        if (error || child.exitCode !== null) throw error || new Error('验证服务提前退出');
        try {
          const response = await request(base + (side.role === 'frontend' ? '/' : '/api/items'), {
            signal,
          });
          if (response.status === 200) {
            ready = true;
            break;
          }
        } catch {
          /* Wait for this owned process to become ready. */
        }
        await delay(250, undefined, { signal });
      }
      if (!ready) throw new Error('服务启动超时：' + side.id);
      const backendPresent = selection.sides.some((entry) => entry.role === 'backend');
      if (side.role === 'backend' || backendPresent) {
        const instance = await request(base + '/api/sg-init-instance', { signal });
        if (instance.status !== 200 || (await instance.json()).token !== token)
          throw new Error('无法确认验证服务实例身份；拒绝执行 CRUD');
      }
      const crud =
        side.role === 'backend' || backendPresent
          ? await verifyHttpCrud(base, 'sg-init-' + token, { signal })
          : { ok: true, status: 'not-applicable' };
      results.push({
        side: side.id,
        start: 'passed',
        httpCrud: crud.status,
        command: [command.command, ...command.args].join(' '),
      });
    }
    outcome = { ok: true, status: 'passed', browserInteraction: 'not-verified', results };
  } catch (error) {
    outcome = {
      ok: false,
      status: 'failed',
      message: error.message,
      browserInteraction: 'not-verified',
      results,
    };
  } finally {
    const cleanup = await Promise.allSettled(children.map(stop));
    const failures = cleanup
      .filter((entry) => entry.status === 'rejected')
      .map((entry) => entry.reason.message);
    if (failures.length) {
      outcome = {
        ...outcome,
        ok: false,
        status: 'failed',
        cleanup: 'failed',
        message: [outcome?.message, '服务清理失败：' + failures.join('; ')]
          .filter(Boolean)
          .join('; '),
      };
    } else if (outcome) outcome.cleanup = 'passed';
  }
  return outcome;
}
