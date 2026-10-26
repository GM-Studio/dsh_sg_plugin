// 有界只读发现（M3 / SNA-0303）。
//
// 目标（AC-10、NFR-01）：
// - 只读检查不下载、不安装、不修改系统或项目环境配置；
// - 发现必须有界：根目录数、单目录条目数、遍历深度、超时全部设上限；
// - 复用既有 java-env 的有界原则，但把上限抽为共享常量（原先散落在各函数里）。

import fs from 'node:fs';
import path from 'node:path';

/** 发现上限的单一来源。 */
export const DISCOVERY_BOUNDS = Object.freeze({
  maxRoots: 128,
  maxDirectoryEntries: 256,
  maxDepth: 4,
  maxMilliseconds: 10000,
  maxCandidatesPerTool: 16,
});

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/** 归一化上限，拒绝非法值而不是静默回退。 */
export function normalizeBounds(overrides = {}) {
  const bounds = { ...DISCOVERY_BOUNDS, ...overrides };
  for (const key of Object.keys(DISCOVERY_BOUNDS))
    if (!Number.isSafeInteger(bounds[key]) || bounds[key] <= 0)
      return failure('DISCOVERY_BOUNDS_INVALID', '发现上限必须是正整数：' + key);
  return { ok: true, bounds };
}

function safeLstat(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * 有界查找可执行文件。
 * 只读：不创建、不删除、不修改任何文件；不发起网络请求。
 */
export function discoverExecutable({
  name,
  roots = [],
  platform = process.platform,
  bounds: overrides = {},
  now = () => Date.now(),
} = {}) {
  if (typeof name !== 'string' || name.length === 0)
    return failure('DISCOVERY_INPUT_INVALID', 'name 必须是非空可执行名');
  if (!Array.isArray(roots)) return failure('DISCOVERY_INPUT_INVALID', 'roots 必须是数组');
  const normalized = normalizeBounds(overrides);
  if (!normalized.ok) return normalized;
  const bounds = normalized.bounds;
  const startedAt = now();

  const executable =
    platform === 'win32' ? [name + '.exe', name + '.cmd', name + '.bat', name] : [name];
  const candidates = [];
  const inspectedRoots = [];
  let truncated = false;
  let timedOut = false;

  const rootList = roots.slice(0, bounds.maxRoots);
  if (roots.length > bounds.maxRoots) truncated = true;

  for (const root of rootList) {
    if (now() - startedAt > bounds.maxMilliseconds) {
      timedOut = true;
      break;
    }
    if (typeof root !== 'string' || root.length === 0) continue;
    inspectedRoots.push(root);
    const stat = safeLstat(root);
    if (!stat || !stat.isDirectory()) continue;
    // 直接命中：<root>/<exe> 与 <root>/bin/<exe>。
    // 后者是 JAVA_HOME / MAVEN_HOME / GRADLE_HOME 的标准布局，必须支持。
    for (const directory of [root, path.join(root, 'bin')]) {
      for (const fileName of executable) {
        const full = path.join(directory, fileName);
        const fileStat = safeLstat(full);
        if (fileStat && fileStat.isFile()) candidates.push(full);
        if (candidates.length >= bounds.maxCandidatesPerTool) break;
      }
      if (candidates.length >= bounds.maxCandidatesPerTool) break;
    }
    if (candidates.length >= bounds.maxCandidatesPerTool) {
      truncated = true;
      break;
    }
    // 一层子目录：<root>/<child>/bin/<exe>
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true }).slice(0, bounds.maxDirectoryEntries);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const binDirectory = path.join(root, entry.name, 'bin');
      for (const fileName of executable) {
        const full = path.join(binDirectory, fileName);
        const fileStat = safeLstat(full);
        if (fileStat && fileStat.isFile()) candidates.push(full);
        if (candidates.length >= bounds.maxCandidatesPerTool) break;
      }
      if (candidates.length >= bounds.maxCandidatesPerTool) break;
    }
    if (candidates.length >= bounds.maxCandidatesPerTool) {
      truncated = true;
      break;
    }
  }

  return {
    ok: true,
    name,
    candidates: [...new Set(candidates)],
    inspectedRoots,
    truncated,
    timedOut,
    bounds,
    complete: !truncated && !timedOut,
    // 显式声明：本次发现没有做任何写操作或网络访问。
    readOnly: true,
    performedWrites: false,
    performedNetwork: false,
  };
}

/**
 * 构造系统的发现根目录（有界，不整盘遍历）。
 * 环境变量优先，其次常见安装位置，最后用户缓存。
 */
export function discoveryRoots({ env = process.env, platform = process.platform, home } = {}) {
  const roots = [];
  const push = (value) => {
    if (typeof value === 'string' && value.length > 0) roots.push(value);
  };
  // 1. 用户显式声明的路径优先。
  push(env.SG_TOOLCHAINS);
  push(env.JAVA_HOME);
  push(env.MAVEN_HOME);
  push(env.GRADLE_HOME);
  // 2. PATH 中的每个目录。
  const separator = platform === 'win32' ? ';' : ':';
  for (const entry of String(env.PATH || '').split(separator)) push(entry);
  // 3. 用户缓存与项目隔离位置。
  const userHome = home || env.USERPROFILE || env.HOME;
  if (typeof userHome === 'string' && userHome.length > 0) {
    push(path.join(userHome, '.specgate', 'toolchains'));
    if (platform === 'win32') {
      push(path.join(userHome, 'scoop', 'apps'));
      push(path.join(userHome, '.jdks'));
    } else {
      push(path.join(userHome, '.sdkman', 'candidates'));
    }
  }
  // 4. 常见系统安装根（有界列举，不递归整盘）。
  if (platform === 'win32') {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData])
      if (typeof base === 'string' && base.length > 0) push(base);
  } else {
    for (const base of ['/usr/lib/jvm', '/usr/local', '/opt']) push(base);
  }
  return [...new Set(roots)].slice(0, DISCOVERY_BOUNDS.maxRoots);
}
