// 模块边界与入口识别（M2 / SNA-0202）。
//
// 目标（AC-02）：纯后端、纯前端、CLI、库及同仓库多模块都能表达各自实际结构，
// 且不补造不存在的前后端模块。
//
// 关键约束（需求 FR-01）：不能仅凭目录名称判断模块或角色。
// 因此本模块的模块判定只依赖构建文件与锁文件，角色来自可核对的构建事实：
// - Maven <packaging> 或 spring-boot 依赖 → service；
// - npm 依赖含前端框架 → ui；
// - 存在 bin 字段或 main 且无 UI 依赖 → cli / library；
// - 无法判定时给 other，而不是猜成 backend/frontend。

import fs from 'node:fs';
import path from 'node:path';

/** 单模块内探查的条目上限。 */
export const MAX_ENTRY_FILES = 256;

/** 构建文件 → 构建系统（与 discovery/stack.js 保持一致的口径）。 */
const BUILD_FILES = Object.freeze({
  'pom.xml': 'maven',
  'build.gradle': 'gradle',
  'build.gradle.kts': 'gradle',
  'settings.gradle': 'gradle',
  'settings.gradle.kts': 'gradle',
  'package.json': 'npm',
  'pyproject.toml': 'python',
  'setup.py': 'python',
  // 真实项目常只有 requirements.txt 或 setup.cfg（实测 pilot-py-api 两者皆无
  // pyproject.toml，导致模块识别为空）。
  'setup.cfg': 'python',
  'requirements.txt': 'python',
  Pipfile: 'python',
  // Makefile 作为构建系统在对齐 stack.js 的同时，只在没有更具体构建文件时生效。
  'go.mod': 'go',
  'Cargo.toml': 'cargo',
  'composer.json': 'composer',
  Gemfile: 'bundler',
  'CMakeLists.txt': 'cmake',
});

/** 入口约定：只作为观察证据，不单独决定角色。 */
const ENTRY_CANDIDATES = Object.freeze([
  'src/main/java',
  'src/main.js',
  'src/main.ts',
  'src/index.js',
  'src/index.ts',
  'main.go',
  'src/main.py',
  'src/lib.rs',
]);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function safeReadJson(target) {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

function safeExists(target) {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

function readTextBounded(target, maximum = 65536) {
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.size > maximum) return null;
    return fs.readFileSync(target, 'utf8');
  } catch {
    return null;
  }
}

/** 目录中存在的构建文件。 */
function buildFilesIn(directory) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true }).slice(0, MAX_ENTRY_FILES);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const buildSystem = BUILD_FILES[entry.name];
    if (buildSystem) found.push({ file: entry.name, buildSystem });
    if (entry.name.endsWith('.csproj')) found.push({ file: entry.name, buildSystem: 'dotnet' });
  }
  return found;
}

/** 从 Maven POM 读取 packaging 与关键依赖（有界文本扫描，不解析完整 XML）。 */
function mavenFacts(directory) {
  const pom = readTextBounded(path.join(directory, 'pom.xml'));
  if (pom === null) return { packaging: null, springBoot: false };
  const packaging = /<packaging>\s*([A-Za-z0-9._-]+)\s*<\/packaging>/.exec(pom)?.[1] || 'jar';
  const springBoot = /spring-boot-starter/.test(pom);
  return { packaging, springBoot };
}

/** 从 package.json 读取依赖与入口字段。 */
function npmFacts(directory) {
  const manifest = safeReadJson(path.join(directory, 'package.json'));
  if (!object(manifest)) return null;
  const dependencies = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
  const has = (name) => object(dependencies) && Object.hasOwn(dependencies, name);
  return {
    manifest,
    hasUI: has('vue') || has('react') || has('@angular/core') || has('svelte'),
    hasBin: object(manifest.bin) || typeof manifest.bin === 'string',
    hasMain: typeof manifest.main === 'string' || typeof manifest.module === 'string',
  };
}

function pythonFacts(directory) {
  const pyproject = readTextBounded(path.join(directory, 'pyproject.toml'));
  if (pyproject === null) return { isCli: false, isLibrary: false };
  return {
    isCli: /\[project\.scripts\]|\[tool\.poetry\.scripts\]/.test(pyproject),
    isLibrary: /\[build-system\]/.test(pyproject),
  };
}

/** 入口证据：存在的入口路径（相对模块根）。 */
function entryPoints(directory) {
  const found = [];
  for (const candidate of ENTRY_CANDIDATES)
    if (safeExists(path.join(directory, candidate))) found.push(candidate);
  return found;
}

/**
 * 由构建事实推断模块角色。
 * 无法判定时返回 other —— 绝不默认成 backend/frontend。
 */
export function inferModuleRole({ buildSystem, maven, npm, python }) {
  if (buildSystem === 'maven' || buildSystem === 'gradle') {
    if (maven?.springBoot) return 'service';
    if (maven?.packaging === 'pom') return 'other';
    return maven?.packaging === 'war' ? 'service' : 'library';
  }
  if (buildSystem === 'npm') {
    if (npm?.hasUI) return 'ui';
    if (npm?.hasBin) return 'cli';
    if (npm?.hasMain) return 'library';
    return 'other';
  }
  if (buildSystem === 'python') {
    if (python?.isCli) return 'cli';
    if (python?.isLibrary) return 'library';
    return 'other';
  }
  if (buildSystem === 'go') return 'cli';
  if (buildSystem === 'cargo') return 'other';
  return 'other';
}

/**
 * 识别模块。
 * @param root 仓库根（绝对路径）
 * @param candidates 待检查的相对目录（含 "."）
 */
export function discoverModules({ root, candidates = ['.'] } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    return { ok: false, code: 'MODULE_DISCOVERY_INVALID', message: 'root 必须是绝对路径' };
  const modules = [];
  const gaps = [];
  const observations = [];

  for (const relative of candidates) {
    const directory = relative === '.' ? root : path.join(root, relative);
    let isDir = false;
    try {
      isDir = fs.lstatSync(directory).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;
    const buildFiles = buildFilesIn(directory);
    // 没有构建文件的目录不是模块，即使目录名像 backend/frontend。
    if (buildFiles.length === 0) continue;
    const maven = buildFiles.some((entry) => entry.buildSystem === 'maven')
      ? mavenFacts(directory)
      : null;
    const npm = buildFiles.some((entry) => entry.buildSystem === 'npm')
      ? npmFacts(directory)
      : null;
    const python = buildFiles.some((entry) => entry.buildSystem === 'python')
      ? pythonFacts(directory)
      : null;
    const buildSystem = buildFiles[0].buildSystem;
    const role = inferModuleRole({ buildSystem, maven, npm, python });
    const entries = entryPoints(directory);
    const id = relative === '.' ? 'root' : relative;
    modules.push({
      id,
      root: relative,
      role,
      buildSystem,
      buildFiles: buildFiles.map((entry) =>
        relative === '.' ? entry.file : relative + '/' + entry.file,
      ),
      entryPoints: entries,
    });
    if (entries.length === 0) gaps.push(id + ' 未发现约定入口，无法推断运行验证方式');
    observations.push({
      id: id + '-build-system',
      text: id + ' 的构建系统为 ' + buildFiles.map((entry) => entry.buildSystem).join('+'),
      sourceRefs: buildFiles.map((entry) =>
        relative === '.' ? entry.file : relative + '/' + entry.file,
      ),
    });
    if (npm && npm.hasUI)
      observations.push({
        id: id + '-ui',
        text: id + ' 的依赖声明了前端框架',
        sourceRefs: [relative === '.' ? 'package.json' : relative + '/package.json'],
      });
  }

  if (modules.length === 0) gaps.push('未识别到任何模块：不存在受支持的构建文件');

  // 角色分布只统计实际存在的模块。
  const roles = modules.reduce((accumulator, entry) => {
    accumulator[entry.role] = (accumulator[entry.role] || 0) + 1;
    return accumulator;
  }, {});

  return { ok: true, modules, roles, observations, gaps };
}
