import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists, readText } from '../util/fsx.js';

export function readNodeRequirement(root, { suite, config } = {}) {
  if (suite?.node) return String(suite.node);
  if (config?.node) return String(config.node);
  for (const file of ['.nvmrc', '.node-version']) {
    const full = path.join(root, file);
    if (exists(full)) {
      const value = readText(full).trim().replace(/^v/, '');
      if (value) return value;
    }
  }
  const pkgPath = path.join(root, 'package.json');
  if (exists(pkgPath)) {
    try {
      const pkg = JSON.parse(readText(pkgPath));
      if (pkg?.engines?.node) return String(pkg.engines.node);
    } catch {
      // ignore invalid package.json
    }
  }
  return null;
}

export function majorOf(requirement) {
  const match = String(requirement || '').match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function compareVersions(a, b) {
  const left = String(a).split('.').map(Number);
  const right = String(b).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function pickVersion(requirement, versions) {
  const alternatives = String(requirement || '')
    .split('||')
    .map((item) => item.trim())
    .filter(Boolean);
  if (alternatives.length > 1) {
    const matches = alternatives
      .map((alternative) => pickVersion(alternative, versions))
      .filter(Boolean);
    matches.sort(compareVersions);
    return matches.length ? matches[matches.length - 1] : null;
  }
  if (!requirement) return null;
  const cleaned = String(requirement).trim().replace(/^v/, '');
  if (versions.includes(cleaned)) return cleaned;

  const numbers = [...cleaned.matchAll(/(\d+)/g)].map((match) => Number(match[1]));
  if (numbers.length === 0) return null;

  const lowerMajor = numbers[0];
  const upperMatch = /<\s*(\d+)/.exec(cleaned);
  const upperMajor = upperMatch ? Number(upperMatch[1]) : null;
  const caretOrTilde = /[\^~]/.test(cleaned);

  let matching = versions.filter((version) => {
    const major = Number(String(version).split('.')[0]);
    if (major < lowerMajor) return false;
    if (upperMajor !== null && major >= upperMajor) return false;
    return true;
  });

  if (!/[<>=^~]/.test(cleaned) || caretOrTilde) {
    matching = matching.filter((version) => Number(String(version).split('.')[0]) === lowerMajor);
  }

  matching.sort(compareVersions);
  return matching.length > 0 ? matching[matching.length - 1] : null;
}

function nvmRoots(env) {
  const roots = [];
  if (env.NVM_HOME) roots.push(env.NVM_HOME);
  try {
    const result = spawnSync('nvm', ['root'], { encoding: 'utf8', windowsHide: true });
    if (result.status === 0) {
      const value = String(result.stdout || '').trim();
      if (value) roots.push(value);
    }
  } catch {
    // nvm is optional
  }
  return [...new Set(roots)];
}

export function nodeDirCandidates(env = process.env) {
  const candidates = [
    {
      tool: 'current',
      version: String(process.version || '').replace(/^v/, ''),
      dir: path.dirname(process.execPath),
    },
  ];

  for (const root of nvmRoots(env)) {
    if (!exists(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^v\d+/.test(entry.name)) continue;
      candidates.push({
        tool: 'nvm',
        version: entry.name.slice(1),
        dir: path.join(root, entry.name),
      });
    }
  }

  const fnmRoots = [
    env.APPDATA && path.join(env.APPDATA, 'fnm', 'node-versions'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'fnm', 'node-versions'),
    env.USERPROFILE && path.join(env.USERPROFILE, '.local', 'share', 'fnm', 'node-versions'),
    env.HOME && path.join(env.HOME, '.local', 'share', 'fnm', 'node-versions'),
  ].filter(Boolean);
  for (const root of fnmRoots) {
    if (!exists(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const version = entry.name.replace(/^v/, '');
      const installation = path.join(root, entry.name, 'installation');
      candidates.push({
        tool: 'fnm',
        version,
        dir: exists(installation) ? installation : path.join(root, entry.name),
      });
    }
  }

  const voltaRoots = [
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Volta', 'tools', 'image', 'node'),
    env.USERPROFILE && path.join(env.USERPROFILE, '.volta', 'tools', 'image', 'node'),
  ].filter(Boolean);
  for (const root of voltaRoots) {
    if (!exists(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      candidates.push({ tool: 'volta', version: entry.name, dir: path.join(root, entry.name) });
    }
  }

  const asdfRoots = [
    env.USERPROFILE && path.join(env.USERPROFILE, '.asdf', 'installs', 'nodejs'),
    env.HOME && path.join(env.HOME, '.asdf', 'installs', 'nodejs'),
  ].filter(Boolean);
  for (const root of asdfRoots) {
    if (!exists(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name, 'bin');
      candidates.push({ tool: 'asdf', version: entry.name, dir });
    }
  }

  return candidates;
}

function binDirOf(candidate) {
  if (exists(path.join(candidate.dir, 'node.exe'))) return candidate.dir;
  if (exists(path.join(candidate.dir, 'node'))) return candidate.dir;
  if (exists(path.join(candidate.dir, 'bin', 'node.exe'))) return path.join(candidate.dir, 'bin');
  return null;
}

export function resolveNode({ root, suite, config, env = process.env, verify = true } = {}) {
  const requirement = readNodeRequirement(root, { suite, config });
  if (!requirement) return { ok: true, skipped: true, env };

  const candidates = nodeDirCandidates(env);
  const versions = [...new Set(candidates.map((item) => item.version))];
  const version = pickVersion(requirement, versions);
  if (!version) {
    return {
      ok: false,
      code: versions.length === 0 ? 'NODE_VERSION_TOOL_MISSING' : 'NODE_VERSION_NOT_INSTALLED',
      message:
        versions.length === 0
          ? `项目要求 Node ${requirement}，但没有找到 volta/fnm/nvm-windows/asdf`
          : `项目要求 Node ${requirement}，已安装版本不匹配：${versions.join(', ')}`,
      available: versions,
    };
  }

  const candidate = candidates.find((item) => item.version === version);
  const binDir = candidate ? binDirOf(candidate) : null;
  if (!binDir) {
    return {
      ok: false,
      code: 'NODE_VERSION_NOT_INSTALLED',
      message: `找到版本 ${version} 但缺少 node 可执行文件`,
    };
  }

  const nextEnv = {
    ...env,
    PATH: `${binDir}${path.delimiter}${env.PATH || ''}`,
    SG_NODE_VERSION: version,
  };
  if (!verify)
    return { ok: true, requirement, version, tool: candidate.tool, dir: binDir, env: nextEnv };

  const result = spawnSync('node', ['-v'], { env: nextEnv, encoding: 'utf8', windowsHide: true });
  const printed = String(result.stdout || '')
    .trim()
    .replace(/^v/, '');
  if (result.status !== 0 || !printed.startsWith(version)) {
    return {
      ok: false,
      code: 'NODE_VERSION_MISMATCH',
      message: `期望 Node ${version}，切换后实际 ${printed || 'unknown'}`,
      env: nextEnv,
    };
  }
  return { ok: true, requirement, version, tool: candidate.tool, dir: binDir, env: nextEnv };
}
