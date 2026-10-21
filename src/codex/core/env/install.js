import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists, readText } from '../util/fsx.js';
import { digest } from '../util/hash.js';

export function detectNodeManager(root) {
  const checks = [
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
    ['bun', 'bun.lockb'],
    ['npm', 'package-lock.json'],
  ];
  for (const [manager, lockfile] of checks) {
    if (exists(path.join(root, lockfile))) return { manager, lockfile };
  }
  return { manager: 'npm', lockfile: null };
}

export function nodeInstallCommand(manager, root) {
  const windows = process.platform === 'win32';
  switch (manager) {
    case 'pnpm':
      return { bin: 'pnpm', args: ['install', '--frozen-lockfile'], shell: windows };
    case 'yarn':
      return { bin: 'yarn', args: ['install', '--immutable'], shell: windows };
    case 'bun':
      return { bin: 'bun', args: ['install', '--frozen-lockfile'], shell: windows };
    default: {
      const hasLock = exists(path.join(root, 'package-lock.json'));
      return {
        bin: 'npm',
        args: [hasLock ? 'ci' : 'install'],
        shell: process.platform === 'win32',
      };
    }
  }
}

export function detectPythonInstaller(root) {
  if (exists(path.join(root, 'uv.lock'))) return { tool: 'uv', lockfile: 'uv.lock' };
  if (exists(path.join(root, 'poetry.lock'))) return { tool: 'poetry', lockfile: 'poetry.lock' };
  if (exists(path.join(root, 'requirements.txt')))
    return { tool: 'pip', lockfile: 'requirements.txt' };
  if (exists(path.join(root, 'pyproject.toml'))) return { tool: 'pip', lockfile: 'pyproject.toml' };
  return { tool: null, lockfile: null };
}

export function pythonInstallCommand(root, pythonBin) {
  const { tool } = detectPythonInstaller(root);
  if (tool === 'uv') return { bin: 'uv', args: ['sync', '--frozen'], shell: false };
  if (tool === 'pip') {
    if (exists(path.join(root, 'requirements.txt'))) {
      return {
        bin: pythonBin,
        args: ['-m', 'pip', 'install', '-r', 'requirements.txt'],
        shell: false,
      };
    }
    return { bin: pythonBin, args: ['-m', 'pip', 'install', '-e', '.'], shell: false };
  }
  if (tool === 'poetry') {
    return { bin: pythonBin, args: ['-m', 'pip', 'install', '-e', '.'], shell: false };
  }
  return null;
}

function installMarker(root, key) {
  const dir = path.join(os.tmpdir(), 'sg-install');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${digest(path.resolve(root)).slice(7, 23)}-${key.slice(7, 19)}.json`;
  return path.join(dir, name);
}

export function installForSuite({
  root,
  suite,
  pythonBin = null,
  env = process.env,
  dryRun = false,
  timeoutMs = 20 * 60 * 1000,
}) {
  if (suite?.install === false) return { ok: true, skipped: true, reason: 'install-disabled' };

  const isPython = suite?.kind === 'pytest';
  let command = null;
  let fingerprint = '';

  if (isPython) {
    command = pythonInstallCommand(root, pythonBin || 'python');
    if (!command) return { ok: true, skipped: true, reason: 'no-python-deps' };
    const { lockfile } = detectPythonInstaller(root);
    fingerprint = lockfile
      ? digest(readText(path.join(root, lockfile)))
      : digest(String(command.args));
  } else {
    const { manager, lockfile } = detectNodeManager(root);
    if (!lockfile && suite?.install !== true) {
      return { ok: true, skipped: true, reason: 'no-lockfile' };
    }
    command = nodeInstallCommand(manager, root);
    fingerprint = lockfile ? digest(readText(path.join(root, lockfile))) : digest(manager);
  }

  const key = digest({
    command: [command.bin, ...command.args],
    fingerprint,
    suite: suite?.id || 'default',
  });
  const marker = installMarker(root, key);
  if (exists(marker)) return { ok: true, skipped: true, reused: true };

  if (dryRun) return { ok: true, dryRun: true, command, key };

  const result = spawnSync(command.bin, command.args, {
    cwd: root,
    encoding: 'utf8',
    env,
    timeout: timeoutMs,
    shell: command.shell,
    windowsHide: true,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      code: 'INSTALL_FAILED',
      message: `依赖安装失败（${command.bin}）：${String(result.stderr || result.stdout || '').slice(-800)}`,
    };
  }
  try {
    fs.writeFileSync(marker, JSON.stringify({ key, at: new Date().toISOString() }), 'utf8');
  } catch {
    // marker is best-effort
  }
  return {
    ok: true,
    command,
    tail: String(result.stdout || '').slice(-400),
  };
}
