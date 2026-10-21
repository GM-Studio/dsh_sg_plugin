import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists, readText } from '../util/fsx.js';

export const SUPPORTED_JDK_MAJORS = [8, 11, 17, 21];

/** Extract the major version from a JDK version string (17.0.9 / 1.8.0_392 / temurin-21). */
export function majorOfVersion(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const match = /(\d+)(?:[._](\d+))?/.exec(text);
  if (!match) return null;
  const first = Number(match[1]);
  const second = match[2] === undefined ? null : Number(match[2]);
  if (first === 1 && second !== null && second >= 2) return second;
  return first;
}

export function isSupportedJdk(value) {
  return SUPPORTED_JDK_MAJORS.includes(majorOfVersion(value));
}

/** Parse `java -version` output from Temurin/OpenJDK/Oracle distributions. */
export function parseJavaVersion(text) {
  const output = String(text ?? '');
  const patterns = [
    /(?:java|openjdk)\s+version\s+"?([\w.+-]+)"?/i,
    /version\s+"?(\d[\w.+-]*)"?/i,
    /(?:openjdk|java)\s+"?(\d[\w.+-]*)"?/i,
    /\(build\s+([\w.+-]+)\)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match) return match[1];
  }
  return null;
}

/** Parse `javac -version` output. */
export function parseJavacVersion(text) {
  const output = String(text ?? '');
  const patterns = [/javac\s+([\w.+-]+)/i, /version\s+"?([\w.+-]+)"?/i];
  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match) return match[1];
  }
  return null;
}

function pathDirs(env = process.env, platform = process.platform) {
  return String(env.PATH || '')
    .split(path.delimiter)
    .map((dir) => dir.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function executableIn(dir, name, platform = process.platform) {
  const names = platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, `${name}`] : [`${name}`];
  for (const candidate of names) {
    const full = path.join(dir, candidate);
    if (exists(full)) return full;
  }
  return null;
}

function runVersion(bin, args, env, timeoutMs = 20000) {
  try {
    const result = spawnSync(bin, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: timeoutMs,
      env,
    });
    return `${result.stdout || ''}${result.stderr || ''}`.trim();
  } catch {
    return '';
  }
}

/** Probe a JDK home by executing `java -version` and `javac -version`. */
export function probeJdk(javaHome, env = process.env) {
  if (!javaHome || !exists(javaHome)) {
    return { ok: false, javaHome, error: 'JDK 目录不存在' };
  }
  const binDir = path.join(javaHome, 'bin');
  const javaBin = executableIn(binDir, 'java');
  const javacBin = executableIn(binDir, 'javac');
  if (!javaBin) return { ok: false, javaHome, javac: null, error: '缺少 java 可执行文件' };
  if (!javacBin) return { ok: false, javaHome, javac: null, error: '缺少 javac 可执行文件' };

  const javaVersion = parseJavaVersion(runVersion(javaBin, ['-version'], env));
  const javacVersion = parseJavacVersion(runVersion(javacBin, ['-version'], env));
  if (!javaVersion && !javacVersion) {
    return { ok: false, javaHome, javac: javacBin, error: '无法解析 java/javac 版本输出' };
  }
  return { ok: true, javaHome, javac: javacBin, javaVersion, javacVersion };
}

export function systemJavaCandidates(env = process.env, { platform = process.platform } = {}) {
  const candidates = [];
  for (const dir of pathDirs(env, platform)) {
    const java = executableIn(dir, 'java', platform);
    if (!java) continue;
    candidates.push({ source: 'PATH', javaHome: path.dirname(path.dirname(java)) });
  }
  return candidates;
}

export function sdkmanJavaHomes(env = process.env) {
  const roots = [];
  if (env.SDKMAN_CANDIDATES_DIR) roots.push(path.join(env.SDKMAN_CANDIDATES_DIR, 'java'));
  if (env.SDKMAN_DIR) roots.push(path.join(env.SDKMAN_DIR, 'candidates', 'java'));
  const home = env.HOME || env.USERPROFILE;
  if (home) roots.push(path.join(home, '.sdkman', 'candidates', 'java'));

  const homes = [];
  for (const root of roots) {
    if (!exists(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === 'current') continue;
      const full = path.join(root, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = fs.statSync(full).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (isDir) homes.push(full);
    }
  }
  return [...new Set(homes)];
}

/** Ordered JDK candidates: JAVA_HOME, system java on PATH, then SDKMAN installs. */
export function javaCandidates(env = process.env, { platform = process.platform } = {}) {
  const seen = new Set();
  const candidates = [];
  const add = (source, javaHome) => {
    if (!javaHome) return;
    const resolved = path.resolve(javaHome);
    const key = platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ source, javaHome: resolved });
  };

  if (env.JAVA_HOME) add('JAVA_HOME', env.JAVA_HOME);
  for (const candidate of systemJavaCandidates(env, { platform })) {
    add(candidate.source, candidate.javaHome);
  }

  const sdkman = sdkmanJavaHomes(env).sort((left, right) => {
    const delta =
      (majorOfVersion(path.basename(right)) || 0) - (majorOfVersion(path.basename(left)) || 0);
    if (delta !== 0) return delta;
    return path.basename(left).localeCompare(path.basename(right));
  });
  for (const home of sdkman) add('SDKMAN', home);

  return candidates;
}

/** Read the requested JDK from suite config, .java-version, then .sdkmanrc. */
export function readJavaRequirement(root, { suite = {}, env = process.env } = {}) {
  const configured = suite?.jdk;
  if (configured !== undefined && configured !== null && String(configured).trim() !== '') {
    return { requirement: String(configured).trim(), source: 'suite', env };
  }

  const versionFile = path.join(root, '.java-version');
  if (exists(versionFile)) {
    const value = readText(versionFile).trim();
    if (value) return { requirement: value, source: '.java-version', env };
  }

  const sdkmanrc = path.join(root, '.sdkmanrc');
  if (exists(sdkmanrc)) {
    const match = /^\s*java\s*=\s*(.+?)\s*$/m.exec(readText(sdkmanrc));
    if (match?.[1]) return { requirement: match[1].trim(), source: '.sdkmanrc', env };
  }

  return { requirement: null, source: null, env };
}

function candidateLabel(candidate) {
  return `${candidate.source}（${candidate.javaHome}）`;
}

function success(candidate, probed, { requirement, source, env }) {
  const javaHome = probed.javaHome || candidate.javaHome;
  const javac =
    probed.javac ||
    path.join(javaHome, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
  const binDir = path.dirname(javac);
  const version = probed.javacVersion || probed.javaVersion || null;
  return {
    ok: true,
    version,
    javaHome,
    javac,
    source: source || candidate.source,
    origin: candidate.source,
    requested: requirement,
    requestedMajor: requirement ? majorOfVersion(requirement) : null,
    env: {
      ...env,
      JAVA_HOME: javaHome,
      PATH: `${binDir}${path.delimiter}${env.PATH || ''}`,
    },
  };
}

/**
 * Resolve a JDK for the current project without downloading anything.
 * Priority: suite.jdk / .java-version / .sdkmanrc, then JAVA_HOME, PATH, SDKMAN.
 * `probe` is injectable for tests; it must accept (javaHome, env) and return a probeJdk shape.
 */
export function resolveJava({ root, suite = {}, env = process.env, probe = probeJdk } = {}) {
  const requirement = readJavaRequirement(root, { suite, env });
  const requestedMajor = requirement.requirement ? majorOfVersion(requirement.requirement) : null;
  const candidates = javaCandidates(env);
  const visited = [];
  let mismatch = null;

  for (const candidate of candidates) {
    if (!exists(candidate.javaHome)) {
      visited.push({ source: candidate.source, javaHome: candidate.javaHome, status: 'missing' });
      continue;
    }

    const probed = probe(candidate.javaHome, env);
    if (!probed?.ok) {
      visited.push({
        source: candidate.source,
        javaHome: candidate.javaHome,
        status: 'unusable',
        message: probed?.error || null,
      });
      continue;
    }

    const version = probed.javacVersion || probed.javaVersion || null;
    const actualMajor = majorOfVersion(version);
    const matched = requestedMajor === null || actualMajor === requestedMajor;
    visited.push({
      source: candidate.source,
      javaHome: candidate.javaHome,
      version,
      status: matched ? 'usable' : 'mismatch',
    });
    if (matched) return success(candidate, probed, requirement);

    const claimed = majorOfVersion(path.basename(candidate.javaHome));
    if (!mismatch && requestedMajor !== null && claimed === requestedMajor) {
      mismatch = { candidate, version };
    }
  }

  if (mismatch) {
    return {
      ok: false,
      code: 'JDK_VERSION_MISMATCH',
      message: `期望 JDK ${requestedMajor}（来源 ${requirement.source}），但 ${candidateLabel(
        mismatch.candidate,
      )} 的 javac 实际为 ${mismatch.version || 'unknown'}；请安装匹配版本或调整 suite.jdk`,
      candidates: visited,
    };
  }

  const target = requirement.requirement
    ? `JDK ${requestedMajor ?? requirement.requirement}`
    : `JDK ${SUPPORTED_JDK_MAJORS.join('/')}`;
  const detected = visited
    .filter((item) => item.version)
    .map((item) => `${item.version} (${item.source})`)
    .join(', ');
  return {
    ok: false,
    code: 'JDK_NOT_FOUND',
    message: `未找到可用的 ${target}${
      requirement.source ? `（来源 ${requirement.source}）` : ''
    }；已检测：${
      detected || '无'
    }；请安装 JDK 8/11/17/21 并设置 JAVA_HOME 或 suite.jdk（不会自动下载 JDK）`,
    candidates: visited,
  };
}
