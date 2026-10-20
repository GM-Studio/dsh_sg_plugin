import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

export function verifyJavaProject({ root, env = process.env, timeoutMs = 15 * 60 * 1000 } = {}) {
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
      ? '本地验证通过：后端 verify、前端 build/test/lint/format 全部通过。'
      : '本地验证失败于 ' + failed.name + '；代码已保留，可修复后重试。',
    report,
  };
}
