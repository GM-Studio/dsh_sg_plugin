import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { normalizeJavaPreset } from './java-versions.js';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function findFile(root, name, depth = 6) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full;
    if (entry.isDirectory()) {
      const found = findFile(full, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

function toolchainRoots(root) {
  const roots = [];
  let current = path.resolve(root);
  for (let depth = 0; depth < 6; depth += 1) {
    roots.push(path.join(current, '.specgate', 'toolchains'));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

function javaMajor(home) {
  try {
    const release = fs.readFileSync(path.join(home, 'release'), 'utf8');
    const match = /JAVA_VERSION="([^"]+)"/.exec(release);
    if (match) {
      const parts = match[1].split('.');
      return parts[0] === '1' ? Number(parts[1]) : Number(parts[0]);
    }
  } catch {
    // JAVA_HOME may not look like a JDK; probe below handles it.
  }
  return null;
}

function resolveJavaHome(root, jdk, env) {
  const explicit = env.SG_JAVA_HOME;
  if (explicit && javaMajor(explicit) === Number(jdk)) return explicit;
  for (const base of toolchainRoots(root)) {
    const dir = path.join(base, 'jdk-' + jdk);
    const java = findFile(dir, 'java.exe', 4);
    if (java) return path.dirname(path.dirname(java));
  }
  if (env.JAVA_HOME && javaMajor(env.JAVA_HOME) === Number(jdk)) return env.JAVA_HOME;
  return null;
}

function resolveMaven(root, env) {
  if (env.MAVEN_CMD) return env.MAVEN_CMD;
  for (const base of toolchainRoots(root)) {
    const found = findFile(base, 'mvn.cmd', 4);
    if (found) return found;
  }
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['mvn'], {
    encoding: 'utf8',
  });
  if (onPath.status === 0) return String(onPath.stdout).split(/\r?\n/).filter(Boolean)[0];
  return null;
}

function run(name, command, args, cwd, env, timeoutMs) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    env,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
  });
  const text = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n');
  return {
    name,
    command: [command, ...args].join(' '),
    status: result.status === null ? 1 : result.status,
    durationMs: Date.now() - started,
    tail: text.split(/\r?\n/).filter(Boolean).slice(-12),
  };
}

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

function waitExit(child, timeoutMs = 15000) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitHealthy(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return true;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

async function runRuntimeSmoke({ root, javaHome, env }) {
  const backend = path.join(root, 'backend');
  const target = path.join(backend, 'target');
  const jar = fs
    .readdirSync(target)
    .filter((name) => name.endsWith('.jar') && !name.endsWith('.original'))
    .map((name) => path.join(target, name))[0];
  if (!jar) return { name: 'runtime', status: 1, durationMs: 0, tail: ['No backend jar'] };
  const dbDir = fs.mkdtempSync(path.join(root, '.specgate', 'verify-db-'));
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port;
  const childEnv = {
    ...env,
    BACKEND_PORT: String(port),
    MANAGEMENT_ENDPOINT_SHUTDOWN_ENABLED: 'true',
    MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE: 'health,shutdown',
    DB_URL:
      'jdbc:h2:file:' + path.join(dbDir, 'tasks').replace(/\\/g, '/') + ';DB_CLOSE_ON_EXIT=FALSE',
  };
  const java = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const logs = [];
  let child = null;
  const startedAt = Date.now();
  function start() {
    child = spawn(java, ['-jar', jar], {
      cwd: backend,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (chunk) => logs.push(String(chunk)));
    child.stderr.on('data', (chunk) => logs.push(String(chunk)));
  }
  async function stop() {
    const current = child;
    child = null;
    if (!current || current.exitCode !== null) return;
    try {
      await fetch(base + '/actuator/shutdown', {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Fall back to terminating the process below.
    }
    await waitExit(current, 8000);
    if (current.exitCode === null) {
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/pid', String(current.pid), '/T', '/F'], { stdio: 'ignore' });
      else current.kill('SIGTERM');
      await waitExit(current);
    }
  }
  try {
    start();
    if (!(await waitHealthy(base + '/actuator/health')))
      throw new Error('Backend did not become healthy');
    const created = await fetch(base + '/api/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'sg-verify', completed: false }),
      signal: AbortSignal.timeout(10000),
    });
    if (created.status !== 201) throw new Error('POST /api/tasks returned ' + created.status);
    const task = await created.json();
    await stop();
    start();
    if (!(await waitHealthy(base + '/actuator/health'))) throw new Error('Backend restart failed');
    const listed = await fetch(base + '/api/tasks', { signal: AbortSignal.timeout(10000) });
    if (listed.status !== 200) throw new Error('GET /api/tasks returned ' + listed.status);
    const items = await listed.json();
    if (!Array.isArray(items) || !items.some((item) => item.id === task.id))
      throw new Error('Task did not survive backend restart');
    const deleted = await fetch(base + '/api/tasks/' + task.id, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10000),
    });
    if (deleted.status !== 204) throw new Error('DELETE /api/tasks returned ' + deleted.status);
    return {
      name: 'runtime',
      status: 0,
      durationMs: Date.now() - startedAt,
      tail: logs.join('').split(/\r?\n/).filter(Boolean).slice(-8),
    };
  } catch (error) {
    return {
      name: 'runtime',
      status: 1,
      durationMs: Date.now() - startedAt,
      tail: [
        ...logs.join('').split(/\r?\n/).filter(Boolean).slice(-8),
        String(error.message || error),
      ],
    };
  } finally {
    await stop();
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
}

export async function verifyJavaProject({
  root,
  env = process.env,
  timeoutMs = 15 * 60 * 1000,
} = {}) {
  root = path.resolve(root);
  const marker = path.join(root, '.specgate', 'monorepo.json');
  if (!fs.existsSync(marker)) {
    return { ok: false, code: 'E_NOT_JAVA_PROJECT', message: '不是 Java/Vue monorepo 初始化项目' };
  }
  let metadata;
  try {
    metadata = readJson(marker);
  } catch (error) {
    return { ok: false, code: 'E_METADATA_INVALID', message: error.message };
  }
  const normalized = normalizeJavaPreset(metadata.preset);
  if (!normalized.ok) return normalized;
  const preset = normalized.preset;
  const javaHome = resolveJavaHome(root, preset.jdk, env);
  const maven = resolveMaven(root, env);
  const missing = [];
  if (!javaHome) missing.push('JDK ' + preset.jdk);
  if (!maven) missing.push('Maven 3.9.x');
  if (missing.length) {
    const report = {
      schemaVersion: 1,
      preset: preset.id,
      status: 'blocked',
      ok: false,
      missing,
      checkedAt: new Date().toISOString(),
      stages: [],
    };
    fs.writeFileSync(
      path.join(root, '.specgate', 'verify-report.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
    return {
      ok: false,
      code: 'VERIFY_BLOCKED',
      message:
        '缺少本地验证前置条件：' +
        missing.join('、') +
        '；请先安装，或把 JDK 放入 .specgate/toolchains/jdk-' +
        preset.jdk +
        '。生成代码已保留。',
      report,
    };
  }
  const commandEnv = {
    ...env,
    JAVA_HOME: javaHome,
    PATH: path.join(javaHome, 'bin') + path.delimiter + (env.PATH || env.Path || ''),
  };
  commandEnv.Path = commandEnv.PATH;
  const stages = [];
  const plan = [
    ['backend-verify', maven, ['-B', '-ntp', 'verify'], path.join(root, 'backend')],
    [
      'frontend-install',
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['install', '--no-audit', '--no-fund'],
      path.join(root, 'frontend'),
    ],
    [
      'frontend-build',
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'build'],
      path.join(root, 'frontend'),
    ],
    [
      'frontend-test',
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'test'],
      path.join(root, 'frontend'),
    ],
    [
      'frontend-lint',
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'lint'],
      path.join(root, 'frontend'),
    ],
    [
      'frontend-format',
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'format:check'],
      path.join(root, 'frontend'),
    ],
  ];
  let failed = null;
  for (const [name, command, args, cwd] of plan) {
    const stage = run(name, command, args, cwd, commandEnv, timeoutMs);
    stages.push(stage);
    if (stage.status !== 0) {
      failed = stage;
      break;
    }
  }
  if (!failed) {
    const runtime = await runRuntimeSmoke({ root, javaHome, env: commandEnv });
    stages.push(runtime);
    if (runtime.status !== 0) failed = runtime;
  }
  const ok = !failed;
  const report = {
    schemaVersion: 1,
    preset: preset.id,
    label: preset.label,
    status: ok ? 'smoke-passed' : 'failed',
    ok,
    checkedAt: new Date().toISOString(),
    toolchain: { javaHome, maven },
    stages,
    failedStage: failed ? failed.name : null,
  };
  fs.writeFileSync(
    path.join(root, '.specgate', 'verify-report.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  const initFile = path.join(root, '.specgate', 'init-report.json');
  if (fs.existsSync(initFile)) {
    try {
      const init = readJson(initFile);
      init.phase = ok ? 'SMOKE_PASSED' : 'VERIFY_FAILED';
      init.initializationComplete = ok;
      init.verification = {
        kind: 'local-sg-verify',
        ok,
        checkedAt: report.checkedAt,
        report: '.specgate/verify-report.json',
        failedStage: report.failedStage,
      };
      fs.writeFileSync(initFile, JSON.stringify(init, null, 2) + '\n');
    } catch {
      // The verification report remains readable even if init-report is corrupt.
    }
  }
  return {
    ok,
    code: ok ? 'SMOKE_PASSED' : 'VERIFY_FAILED',
    message: ok
      ? '本地验证通过：后端 verify、前端 build/test/lint/format、启动/CRUD/重启持久化全部通过。'
      : '本地验证失败于 ' + failed.name + '；代码已保留，可修复后重试。',
    report,
  };
}
