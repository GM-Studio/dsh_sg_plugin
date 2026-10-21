import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { commandSpec } from './verify-evidence.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(check, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const result = await check();
      if (result) return result;
    } catch {
      // Retry while the browser or server is starting.
    }
    await sleep(250);
  }
  return false;
}

export function findBrowserExecutable({ platform = process.platform, env = process.env } = {}) {
  const configured = env.SG_BROWSER_EXECUTABLE || env.CHROME_BIN;
  if (configured && fs.existsSync(configured)) return configured;
  const candidates =
    platform === 'win32'
      ? [
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'];
  return candidates.find((candidate) => {
    if (path.isAbsolute(candidate)) return fs.existsSync(candidate);
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    return found.status === 0 && Boolean(String(found.stdout || '').trim());
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 2000,
    });
  } else {
    child.kill('SIGKILL');
  }
}

async function connectCdp(webSocketUrl) {
  const ws = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('Unable to connect to browser DevTools'));
  });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || 'CDP command failed'));
    else resolve(message.result || {});
  };
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

export async function runBrowserSmoke({
  root,
  backendPort,
  frontendPort,
  env,
  frontendCommand,
  frontendArgs,
  restart,
  signal,
  directory,
  log,
}) {
  const startedAt = new Date().toISOString();
  const logFile = path.join(directory, 'browser.log');
  const fd = fs.openSync(logFile, 'w');
  const lines = [];
  let closed = false;
  const write = (message) => {
    if (closed) return;
    const text = String(message || '');
    try {
      fs.writeSync(fd, text + '\n');
    } catch {
      return;
    }
    lines.push(text);
    if (lines.length > 40) lines.shift();
    if (typeof log === 'function') log(text);
  };
  let frontend = null;
  let browser = null;
  let cdp = null;
  let profile = null;
  try {
    if (signal?.aborted) throw new Error('Verification cancelled');
    const frontendSpec = commandSpec(frontendCommand, frontendArgs);
    frontend = spawn(frontendSpec.command, frontendSpec.args, {
      cwd: path.join(root, 'frontend'),
      env: {
        ...env,
        BACKEND_PORT: String(backendPort),
        FRONTEND_PORT: String(frontendPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: frontendSpec.windowsVerbatimArguments,
    });
    let frontendLog = '';
    frontend.stdout.on('data', (chunk) => {
      frontendLog += chunk.toString();
      write(chunk.toString());
    });
    frontend.stderr.on('data', (chunk) => {
      frontendLog += chunk.toString();
      write(chunk.toString());
    });
    const url = 'http://127.0.0.1:' + frontendPort;
    if (!(await waitFor(async () => (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok)))
      throw new Error('Frontend did not become healthy: ' + frontendLog.slice(-800));

    const executable = findBrowserExecutable({ env });
    if (!executable)
      throw new Error('No Chrome/Edge executable found for --full browser verification');
    const debugPort = await freePort();
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-browser-'));
    browser = spawn(
      executable,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-dev-shm-usage',
        '--remote-allow-origins=*',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=' + debugPort,
        '--user-data-dir=' + profile,
        '--window-size=1280,900',
        'about:blank',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    browser.stdout.on('data', (chunk) => write(chunk.toString()));
    browser.stderr.on('data', (chunk) => write(chunk.toString()));
    const cdpUrl = await waitFor(async () => {
      const response = await fetch('http://127.0.0.1:' + debugPort + '/json/list', {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return null;
      const pages = await response.json();
      return pages.find((page) => page.type === 'page' && page.webSocketDebuggerUrl)
        ?.webSocketDebuggerUrl;
    }, 30000);
    if (!cdpUrl) throw new Error('Browser DevTools did not become available');
    cdp = await connectCdp(cdpUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails)
        throw new Error(
          result.exceptionDetails.exception?.description || 'Browser evaluation failed',
        );
      return result.result?.value;
    };
    const waitForPage = (expression) =>
      waitFor(async () => Boolean(await evaluate(expression)), 30000);
    const click = async (label) => {
      const clicked = await evaluate(
        `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(label)}); if (!button) return false; button.click(); return true; })()`,
      );
      if (!clicked) throw new Error('Browser button not found: ' + label);
    };
    const setInput = (selector, value) =>
      evaluate(
        `(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
      );
    const login = async (username, password) => {
      if (!(await waitForPage(`Boolean(document.querySelector('#username'))`)))
        throw new Error('Login form did not appear');
      if (!(await setInput('#username', username))) throw new Error('Username input missing');
      if (!(await setInput('#password', password))) throw new Error('Password input missing');
      await click('Sign in');
      if (!(await waitForPage(`Boolean(document.querySelector('.sidebar'))`)))
        throw new Error('Login did not reach the task manager');
    };

    await cdp.send('Page.navigate', { url });
    if (!(await waitForPage(`document.readyState === 'complete'`)))
      throw new Error('Browser page did not load');
    await login('admin', env.APP_ADMIN_PASSWORD);
    await setInput('#title', 'browser-persist');
    await click('Add task');
    if (!(await waitForPage(`document.body.innerText.includes('browser-persist')`)))
      throw new Error('Browser create task did not render');
    await click('Edit');
    await setInput('#title', 'browser-persist-updated');
    await click('Save changes');
    if (!(await waitForPage(`document.body.innerText.includes('browser-persist-updated')`)))
      throw new Error('Browser update task did not render');
    await restart();
    await cdp.send('Page.navigate', { url });
    await login('admin', env.APP_ADMIN_PASSWORD);
    if (!(await waitForPage(`document.body.innerText.includes('browser-persist-updated')`)))
      throw new Error('Browser task did not survive restart');
    await click('Delete');
    await click('Confirm delete');
    if (!(await waitForPage(`!document.body.innerText.includes('browser-persist-updated')`)))
      throw new Error('Browser delete did not remove the task');
    await click('Sign out');
    await login('viewer', env.APP_VIEWER_PASSWORD);
    if (await evaluate(`Boolean(document.querySelector('#title'))`))
      throw new Error('Viewer unexpectedly received write controls');
    write('Browser login/CRUD/restart persistence/viewer permissions passed');
    return {
      name: 'browser',
      status: 0,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - Date.parse(startedAt),
      log: path.relative(root, logFile).replace(/\\/g, '/'),
      tail: lines.slice(-8),
    };
  } catch (error) {
    write(String(error.message || error));
    return {
      name: 'browser',
      status: 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - Date.parse(startedAt),
      log: path.relative(root, logFile).replace(/\\/g, '/'),
      tail: lines.slice(-8),
    };
  } finally {
    try {
      cdp?.close();
    } catch {
      // Ignore browser cleanup errors.
    }
    stopChild(browser);
    stopChild(frontend);
    closed = true;
    fs.closeSync(fd);
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  }
}
