import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists } from '../util/fsx.js';

export const MAVEN_ARGS_PREFIX = ['-B', '-ntp', '-Dstyle.color=never'];

function isWindows(platform = process.platform) {
  return platform === 'win32';
}

/** Locate the project Maven Wrapper; prefers mvnw.cmd on Windows and mvnw elsewhere. */
export function mavenWrapperBin(root, { platform = process.platform } = {}) {
  const names = isWindows(platform) ? ['mvnw.cmd', 'mvnw'] : ['mvnw', 'mvnw.cmd'];
  for (const name of names) {
    const full = path.join(root, name);
    if (exists(full)) return full;
  }
  return null;
}

function systemMavenNames(platform = process.platform) {
  return isWindows(platform) ? ['mvn.cmd', 'mvn.bat', 'mvn.exe', 'mvn'] : ['mvn'];
}

function pathDirs(env = process.env) {
  return String(env.PATH || '')
    .split(path.delimiter)
    .map((dir) => dir.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

/** Locate a system Maven executable on PATH without executing it. */
export function systemMavenBin(env = process.env, { platform = process.platform } = {}) {
  for (const dir of pathDirs(env)) {
    for (const name of systemMavenNames(platform)) {
      const full = path.join(dir, name);
      if (exists(full)) return full;
    }
  }
  return null;
}

/** Run `mvn -v` and parse the version; returns null instead of throwing. */
export function mavenVersion(bin, { cwd, env = process.env, timeoutMs = 20000 } = {}) {
  try {
    const result = spawnSync(bin, ['-v'], {
      cwd: cwd || undefined,
      env,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      windowsHide: true,
      timeout: timeoutMs,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const match = /Apache Maven\s+(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)/i.exec(output);
    if (result.status !== 0 || !match) return null;
    return match[1];
  } catch {
    return null;
  }
}

/**
 * Resolve Maven for a suite without downloading anything.
 * Priority: project wrapper (mvnw/mvnw.cmd), then system mvn on PATH.
 */
export function resolveMaven({
  root,
  suite = {},
  env = process.env,
  platform = process.platform,
} = {}) {
  const wrapperBin = mavenWrapperBin(root, { platform });
  if (wrapperBin) {
    return {
      ok: true,
      bin: wrapperBin,
      argsPrefix: [...MAVEN_ARGS_PREFIX],
      version: mavenVersion(wrapperBin, { cwd: root, env }),
      wrapper: true,
    };
  }

  const systemBin = systemMavenBin(env, { platform });
  if (systemBin) {
    return {
      ok: true,
      bin: systemBin,
      argsPrefix: [...MAVEN_ARGS_PREFIX],
      version: mavenVersion(systemBin, { cwd: root, env }),
      wrapper: false,
    };
  }

  return {
    ok: false,
    code: 'BUILD_TOOL_NOT_FOUND',
    message:
      '未找到 Maven Wrapper（mvnw/mvnw.cmd）或系统 Maven（mvn）；' +
      '请安装 Maven 3.9.x 并加入 PATH，或执行 mvn wrapper:wrapper 生成 Wrapper（不会自动下载）',
  };
}
