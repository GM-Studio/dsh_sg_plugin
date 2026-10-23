import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configure } from './configure.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const children = new Set();
export function validatePort(value, fallback) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Port must be an integer between 1 and 65535');
  return String(port);
}
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  for (const entry of (process.env.PATH || '').split(delimiter))
    candidates.push(
      resolve(entry, 'node_modules/npm/bin/npm-cli.js'),
      resolve(entry, '../lib/node_modules/npm/bin/npm-cli.js'),
    );
  const found = candidates.find(
    (candidate) => candidate && candidate.endsWith('npm-cli.js') && existsSync(candidate),
  );
  if (!found)
    throw new Error('npm CLI not found. Install npm alongside Node or invoke through npm run.');
  return found;
}
function quoteWindows(value) {
  if (/["\r\n%&|<>^!]/.test(value)) throw new Error('Unsafe Windows command argument');
  return '"' + value + '"';
}
export function command(side, args) {
  if (side === 'frontend')
    return {
      executable: process.execPath,
      args: [npmCli(), ...args],
      cwd: resolve(root, 'frontend'),
    };
  const wrapper = resolve(root, 'backend', process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
  const executable = process.env.MAVEN_CMD || (existsSync(wrapper) ? wrapper : 'mvn');
  if (process.platform !== 'win32') return { executable, args, cwd: resolve(root, 'backend') };
  return {
    executable: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', '"' + [executable, ...args].map(quoteWindows).join(' ') + '"'],
    cwd: resolve(root, 'backend'),
  };
}
function execute(side, args) {
  const spec = command(side, args);
  const env = {
    ...process.env,
    BACKEND_PORT: validatePort(process.env.BACKEND_PORT, 8080),
    FRONTEND_PORT: validatePort(process.env.FRONTEND_PORT, 5173),
  };
  return new Promise((done, reject) => {
    const child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env,
      stdio: 'inherit',
      windowsVerbatimArguments: process.platform === 'win32' && side === 'backend',
    });
    children.add(child);
    child.once('error', (error) => {
      children.delete(child);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      children.delete(child);
      code === 0 ? done() : reject(new Error(side + ' exited with ' + (signal || code)));
    });
  });
}
function stop() {
  for (const child of children) {
    if (process.platform === 'win32')
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
}
process.once('SIGINT', () => {
  stop();
  process.exitCode = 130;
});
process.once('SIGTERM', () => {
  stop();
  process.exitCode = 143;
});
const workflows = {
  install: [
    [
      'frontend',
      [
        existsSync(resolve(root, 'frontend/package-lock.json')) ? 'ci' : 'install',
        '--no-audit',
        '--no-fund',
      ],
    ],
  ],
  backend: [['backend', ['spring-boot:run']]],
  frontend: [['frontend', ['run', 'dev']]],
  build: [
    ['backend', ['package', '-DskipTests']],
    ['frontend', ['run', 'build']],
  ],
  test: [
    ['backend', ['test']],
    ['frontend', ['test']],
  ],
  lint: [
    ['backend', ['checkstyle:check']],
    ['frontend', ['run', 'lint']],
  ],
  typecheck: [
    ['backend', ['-DskipTests', 'compile']],
    ['frontend', ['run', 'build']],
  ],
  static: [
    ['backend', ['checkstyle:check']],
    ['frontend', ['run', 'lint']],
  ],
  format: [
    ['backend', ['spotless:apply']],
    ['frontend', ['run', 'format']],
  ],
  'format:check': [
    ['backend', ['spotless:check']],
    ['frontend', ['run', 'format:check']],
  ],
  verify: [
    ['backend', ['verify']],
    ['frontend', ['run', 'build']],
    ['frontend', ['test']],
    ['frontend', ['run', 'lint']],
    ['frontend', ['run', 'format:check']],
  ],
};
export async function main(action) {
  if (action === 'configure') return configure(root);
  if (action === 'backend' || action === 'dev:all') {
    const local = configure(root);
    process.loadEnvFile(local.file);
    for (const name of ['APP_ADMIN_PASSWORD', 'APP_VIEWER_PASSWORD']) {
      const password = process.env[name] || '';
      const demoPassword = process.env.APP_LOCAL_DEMO === 'true' && password === (name === 'APP_ADMIN_PASSWORD' ? 'admin' : 'viewer');
      if ((!demoPassword && password.length < 12) || Buffer.byteLength(password) > 72)
        throw new Error(`${name} 配置无效：请在 .env 中设置至少 12 个字符且不超过 72 个 UTF-8 字节的密码。`);
    }
  }
  if (action === 'dev') action = 'frontend';
  if (action === 'dev:all') {
    try {
      await Promise.all([
        execute('backend', ['spring-boot:run']),
        execute('frontend', ['run', 'dev']),
      ]);
    } finally {
      stop();
    }
    return;
  }
  const steps = workflows[action];
  if (!steps) throw new Error('Unknown action: ' + action);
  for (const [side, args] of steps) await execute(side, args);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    stop();
    console.error(error.message);
    process.exitCode = 1;
  });
}
