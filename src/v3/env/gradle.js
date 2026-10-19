import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists } from '../util/fsx.js';

function isWindows(platform = process.platform) {
  return platform === 'win32';
}

export function gradleWrapperBin(root, { platform = process.platform } = {}) {
  const names = isWindows(platform) ? ['gradlew.bat', 'gradlew'] : ['gradlew', 'gradlew.bat'];
  for (const name of names) {
    const full = path.join(root, name);
    if (exists(full)) return full;
  }
  return null;
}

function pathDirs(env = process.env) {
  return String(env.PATH || '')
    .split(path.delimiter)
    .map((dir) => dir.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function systemGradleBin(env = process.env, { platform = process.platform } = {}) {
  const names = isWindows(platform) ? ['gradle.bat', 'gradle.exe', 'gradle'] : ['gradle'];
  for (const dir of pathDirs(env)) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (exists(full)) return full;
    }
  }
  return null;
}

export function gradleVersion(bin, { cwd, env = process.env, timeoutMs = 20000 } = {}) {
  try {
    const result = spawnSync(bin, ['--version'], {
      cwd: cwd || undefined,
      env,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      windowsHide: true,
      timeout: timeoutMs,
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const match = /Gradle\s+(\d+\.\d+(?:\.\d+)?)/i.exec(output);
    return result.status === 0 && match ? match[1] : null;
  } catch {
    return null;
  }
}

export function resolveGradle({ root, env = process.env, platform = process.platform } = {}) {
  const wrapper = gradleWrapperBin(root, { platform });
  if (wrapper) {
    return {
      ok: true,
      bin: wrapper,
      wrapper: true,
      version: gradleVersion(wrapper, { cwd: root, env }),
    };
  }
  const system = systemGradleBin(env, { platform });
  if (system) {
    return {
      ok: true,
      bin: system,
      wrapper: false,
      version: gradleVersion(system, { cwd: root, env }),
    };
  }
  return {
    ok: false,
    code: 'BUILD_TOOL_NOT_FOUND',
    message:
      '未找到 Gradle Wrapper（gradlew/gradlew.bat）或系统 Gradle（gradle）；请安装 Gradle 8.x 或运行 gradle wrapper 生成 Wrapper（不会自动下载）',
  };
}
