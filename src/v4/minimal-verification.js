import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const verificationTimeouts = Object.freeze({
  install: 600000,
  build: 300000,
  test: 300000,
  startup: 90000,
  browser: 90000,
  shutdown: 30000,
});
const toolPath = (tool, fallback) => (typeof tool === 'string' ? tool : tool?.path || fallback);
function npmCommand(tools, args) {
  const npm = toolPath(tools.npm, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  return tools.npm?.kind === 'node-script' || /npm-cli\.js$/i.test(npm)
    ? { command: toolPath(tools.node, process.execPath), args: [npm, ...args] }
    : { command: npm, args };
}
/** Serializable preview of precisely the commands/dependencies executed after approval. */
export function verificationPlan(tools = {}) {
  const mvn = toolPath(tools.mvn || tools.maven, process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
  const java = toolPath(tools.java, 'java'),
    node = toolPath(tools.node, process.execPath);
  return {
    dependencies: {
      api: ['Spring Boot 2.7.18 web/data-jpa/test', 'H2 2.1.214'],
      web: [
        'vue@3.5.13',
        'vite@5.4.14',
        '@vitejs/plugin-vue@5.2.1',
        'typescript@5.7.3',
        'vue-tsc@2.2.0',
        'playwright@1.51.1',
      ],
    },
    commands: [
      {
        stage: 'install',
        cwd: 'api',
        command: mvn,
        args: ['-B', '-Dmaven.repo.local=./.m2-repository', 'dependency:go-offline'],
      },
      {
        stage: 'install',
        cwd: 'web',
        ...npmCommand(tools, ['install', '--no-audit', '--no-fund', '--cache', './.npm-cache']),
      },
      {
        stage: 'build',
        cwd: 'api',
        command: mvn,
        args: ['-B', '-Dmaven.repo.local=./.m2-repository', '-DskipTests', 'package'],
      },
      { stage: 'build', cwd: 'web', ...npmCommand(tools, ['run', 'build']) },
      {
        stage: 'test',
        cwd: 'api',
        command: mvn,
        args: ['-B', '-Dmaven.repo.local=./.m2-repository', 'test'],
      },
      { stage: 'test', cwd: 'web', ...npmCommand(tools, ['test']) },
      {
        stage: 'startup',
        cwd: 'api',
        command: java,
        args: [
          '-Djava.io.tmpdir=./target',
          '-jar',
          'target/item-api-0.0.1-SNAPSHOT.jar',
          '--verification.shutdown-token=<random-token>',
        ],
      },
      {
        stage: 'startup',
        cwd: 'web',
        command: node,
        args: [
          'node_modules/vite/bin/vite.js',
          '--host',
          '127.0.0.1',
          '--port',
          '5173',
          '--strictPort',
        ],
      },
      {
        stage: 'browser',
        cwd: 'web',
        command: node,
        args: ['verify-browser.mjs', 'probe|crud|persistence'],
      },
      {
        stage: 'restart',
        cwd: 'api',
        command: java,
        args: [
          '-Djava.io.tmpdir=./target',
          '-jar',
          'target/item-api-0.0.1-SNAPSHOT.jar',
          '--verification.shutdown-token=<same-random-token>',
        ],
      },
    ],
    ports: { api: 8080, web: 5173 },
    timeouts: { ...verificationTimeouts },
    environment: {
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
      npm_config_cache: '<root>/web/.npm-cache',
      JAVA_HOME: 'derived from approved java executable; child-process only',
      SG_VERIFY_MARKER: '<random-marker>',
      SG_BROWSER_PATH:
        tools.browser?.path || '<existing Chrome/Edge or installed Playwright Chromium>',
    },
    shutdown:
      'POST /internal/verification/shutdown with random X-Verification-Token; wait for normal exit before restart. Cleanup targets only spawned process IDs/groups.',
    writes: [
      'api/target/',
      'api/data/',
      'api/.m2-repository/',
      'web/.npm-cache/',
      'web/node_modules/',
      'web/package-lock.json',
      'web/dist/',
    ],
    browserPolicy:
      'Never download browsers/toolchains or globally install packages. Missing/unlaunchable installed browser stops verification. No mocks.',
  };
}

/** Read-only discovery; a missing browser is not automatically installed. */
export function detectExistingBrowser(env = process.env) {
  const value = (name) =>
    env[name] || Object.entries(env).find(([key]) => key.toUpperCase() === name)?.[1];
  const candidates = [
    env.SG_BROWSER_PATH,
    ...[value('PROGRAMFILES'), value('PROGRAMFILES(X86)'), value('LOCALAPPDATA')]
      .filter(Boolean)
      .flatMap((base) => [
        path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function listening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

function start(command, args, cwd, env) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
    detached: process.platform !== 'win32',
  });
  const record = { child, done: false, code: null, error: null, completion: null };
  record.completion = new Promise((resolve) => {
    child.once('error', (error) => {
      record.error = error;
      record.done = true;
      resolve(record);
    });
    child.once('exit', (code) => {
      record.code = code;
      record.done = true;
      resolve(record);
    });
  });
  return record;
}
async function stop(record) {
  if (!record || record.done) return;
  const pid = record.child.pid;
  if (!pid) throw new Error('Spawned process has no PID');
  if (process.platform === 'win32') {
    const killer = start(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      process.cwd(),
      process.env,
    );
    await bounded(killer.completion, 10000);
    if (killer.error) throw killer.error;
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    try {
      await bounded(record.completion, 5000);
    } catch {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
  await bounded(record.completion, 10000);
}
async function bounded(promise, timeout, signal) {
  signal?.throwIfAborted();
  let timer, listener;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Verification phase timed out after ' + timeout + 'ms')),
          timeout,
        );
        if (signal) {
          listener = () => reject(signal.reason || new Error('Cancelled'));
          signal.addEventListener('abort', listener, { once: true });
        }
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (listener) signal.removeEventListener('abort', listener);
  }
}
async function request(url, options = {}) {
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(3000)])
    : AbortSignal.timeout(3000);
  return fetch(url, { ...options, signal, redirect: 'error' });
}
async function ready(record, url, signal, timeout = verificationTimeouts.startup) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    if (record.done)
      throw record.error || new Error('Server exited before readiness: ' + record.code);
    try {
      const response = await request(url, { signal });
      if (response.ok) return;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    await delay(250, undefined, { signal });
  }
  throw new Error('Server readiness timed out: ' + url);
}
async function normalShutdown(record, token) {
  if (!record || record.done) throw new Error('Backend is not running for normal shutdown');
  const response = await request('http://127.0.0.1:8080/internal/verification/shutdown', {
    method: 'POST',
    headers: { 'X-Verification-Token': token },
  });
  if (response.status !== 202)
    throw new Error('Normal backend shutdown rejected: ' + response.status);
  await bounded(record.completion, verificationTimeouts.shutdown);
  if (record.error || record.code !== 0)
    throw record.error || new Error('Backend normal shutdown did not exit cleanly: ' + record.code);
  if (await listening(8080)) throw new Error('Backend port remains occupied after shutdown');
}

/** Runs only the fixed approved scaffold. Never creates/rewrites scaffold, req, or baseline. */
export async function verifyFixedScaffold({ root, tools = {}, signal, onStage = () => {} }) {
  const result = {
    ok: false,
    status: 'failed',
    stages: [],
    browserCrud: 'not-run',
    restartPersistence: 'not-run',
    cleanup: 'not-run',
  };
  const owned = [],
    token = randomUUID(),
    marker = 'sg-verify-' + randomUUID();
  let backend,
    frontend,
    stage = 'preflight';
  const env = {
    ...process.env,
    ...(tools.env || {}),
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    SG_VERIFY_MARKER: marker,
  };
  // node --test sets this internal variable; inheriting it silently skips nested project tests.
  delete env.NODE_TEST_CONTEXT;
  env.npm_config_cache = root ? path.join(root, 'web', '.npm-cache') : '';
  const nodePath = toolPath(tools.node, process.execPath);
  env.PATH = [
    path.dirname(nodePath),
    path.isAbsolute(toolPath(tools.java, 'java')) ? path.dirname(toolPath(tools.java, 'java')) : '',
    env.PATH || env.Path || '',
  ]
    .filter(Boolean)
    .join(path.delimiter);
  delete env.Path;
  const java = toolPath(tools.java, 'java');
  if (path.isAbsolute(java)) env.JAVA_HOME = path.dirname(path.dirname(java));
  const browser = toolPath(tools.browser, detectExistingBrowser(env));
  if (browser) env.SG_BROWSER_PATH = browser;
  const plan = verificationPlan(tools);
  const run = async (command, args, cwd, timeout) => {
    signal?.throwIfAborted();
    const record = start(command, args, path.join(root, cwd), env);
    owned.push(record);
    try {
      await bounded(record.completion, timeout, signal);
      if (record.error || record.code !== 0)
        throw record.error || new Error(command + ' exited ' + record.code);
    } catch (error) {
      await stop(record);
      throw error;
    }
  };
  const phase = async (name, work) => {
    stage = name;
    const started = Date.now();
    await onStage({ stage: name, status: 'running' });
    try {
      await work();
      const entry = { stage: name, status: 'passed', durationMs: Date.now() - started };
      result.stages.push(entry);
      await onStage(entry);
    } catch (error) {
      const entry = {
        stage: name,
        status: signal?.aborted ? 'cancelled' : 'failed',
        error: error.message,
        durationMs: Date.now() - started,
      };
      result.stages.push(entry);
      await onStage(entry);
      throw error;
    }
  };
  const spawnBackend = () => {
    signal?.throwIfAborted();
    backend = start(
      java,
      [
        '-Djava.io.tmpdir=./target',
        '-jar',
        'target/item-api-0.0.1-SNAPSHOT.jar',
        '--verification.shutdown-token=' + token,
      ],
      path.join(root, 'api'),
      env,
    );
    owned.push(backend);
    return ready(backend, 'http://127.0.0.1:8080/api/items', signal);
  };
  try {
    if (!root || !path.isAbsolute(root))
      throw new Error('Verification root must be an absolute path');
    signal?.throwIfAborted();
    if ((await listening(8080)) || (await listening(5173)))
      throw new Error(
        'Fixed port 8080 or 5173 is occupied; verification stopped without changing ports',
      );
    if (browser && !fs.existsSync(browser))
      throw new Error('Approved browser executable is missing: ' + browser);
    for (const name of ['install', 'build', 'test'])
      await phase(name, async () => {
        const deadline = Date.now() + verificationTimeouts[name];
        for (const command of plan.commands.filter((c) => c.stage === name))
          await run(command.command, command.args, command.cwd, Math.max(1, deadline - Date.now()));
        if (name === 'install')
          await run(
            toolPath(tools.node, process.execPath),
            ['verify-browser.mjs', 'probe'],
            'web',
            Math.min(verificationTimeouts.browser, Math.max(1, deadline - Date.now())),
          );
      });
    await phase('startup', async () => {
      if ((await listening(8080)) || (await listening(5173)))
        throw new Error('Fixed ports became occupied before startup');
      const deadline = Date.now() + verificationTimeouts.startup;
      await spawnBackend();
      const command = plan.commands.find((c) => c.cwd === 'web' && c.stage === 'startup');
      frontend = start(command.command, command.args, path.join(root, 'web'), env);
      owned.push(frontend);
      await ready(frontend, 'http://127.0.0.1:5173/', signal, Math.max(1, deadline - Date.now()));
    });
    await phase('browser-crud', async () => {
      await run(
        toolPath(tools.node, process.execPath),
        ['verify-browser.mjs', 'crud'],
        'web',
        verificationTimeouts.browser,
      );
      result.browserCrud = 'passed';
    });
    await phase('restart-persistence', async () => {
      await normalShutdown(backend, token);
      await spawnBackend();
      await run(
        toolPath(tools.node, process.execPath),
        ['verify-browser.mjs', 'persistence'],
        'web',
        verificationTimeouts.browser,
      );
      result.restartPersistence = 'passed';
    });
    if (backend.done || frontend.done)
      throw new Error('Owned runtime exited unexpectedly during browser verification');
    result.status = 'passed';
  } catch (error) {
    result.error = { stage, message: error.message };
    if (stage === 'browser-crud') result.browserCrud = signal?.aborted ? 'cancelled' : 'failed';
    if (stage === 'restart-persistence')
      result.restartPersistence = signal?.aborted ? 'cancelled' : 'failed';
    result.status = signal?.aborted ? 'cancelled' : 'failed';
  } finally {
    const errors = [];
    // Remove only our random marker; never delete database/user directories.
    if (backend && !backend.done) {
      try {
        const response = await request('http://127.0.0.1:8080/api/items');
        if (response.ok)
          for (const item of await response.json())
            if (item.name === marker) {
              const removed = await request('http://127.0.0.1:8080/api/items/' + item.id, {
                method: 'DELETE',
              });
              if (![204, 404].includes(removed.status)) errors.push('Probe record cleanup failed');
            }
      } catch (error) {
        errors.push(error.message);
      }
      try {
        await normalShutdown(backend, token);
      } catch (error) {
        errors.push(error.message);
      }
    }
    for (const record of owned.slice().reverse())
      try {
        await stop(record);
      } catch (error) {
        errors.push(error.message);
      }
    result.cleanup = errors.length ? 'failed' : 'passed';
    if (errors.length) {
      result.cleanupErrors = errors;
      result.status = 'failed';
    }
    result.ok =
      result.status === 'passed' &&
      result.browserCrud === 'passed' &&
      result.restartPersistence === 'passed' &&
      result.cleanup === 'passed';
    try {
      await onStage({ stage: 'cleanup', status: result.cleanup, errors });
    } catch (error) {
      result.ok = false;
      result.status = 'failed';
      result.error = { stage: 'cleanup', message: error.message };
    }
  }
  return result;
}
