// 技术栈无关的只读发现（M2 / SNA-0201）。
//
// 目标（FR-01 / AC-01..AC-03）：任意仓库都能得到扫描结果与能力清单，
// 不要求 Maven、不要求前端、不要求业务工具链已安装。
//
// 设计原则：
// 1. 只读：不运行仓库脚本、不装依赖、不生成业务模板、不改写代码；
// 2. 基于文件事实：构建文件与锁文件，不凭目录名猜模块角色；
// 3. 未知技术栈输出观察与缺口，而不是拒绝整个分析阶段；
// 4. 有界：文件数、单项条目数与遍历深度均设上限（NFR-01 原则）。

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scanDirectories, workspaceOwner, SCAN_LIMITS } from './scan.js';

const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  '.specgate',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  '.idea',
  '.vscode',
]);

/** 单次探测的条目上限（不遍历整盘）。 */
export const MAX_SCAN_ENTRIES = 25000;
/** 默认仓库目录探查预算（包含根目录及嵌套目录）。 */
export const MAX_TOP_LEVEL_DIRECTORIES = SCAN_LIMITS.maxDirectories;

/** 构建文件 → 构建系统。 */
const BUILD_MARKERS = Object.freeze([
  { file: 'pom.xml', buildSystem: 'maven', language: 'java' },
  { file: 'build.gradle', buildSystem: 'gradle', language: 'java' },
  { file: 'build.gradle.kts', buildSystem: 'gradle', language: 'kotlin' },
  { file: 'settings.gradle', buildSystem: 'gradle', language: 'java' },
  { file: 'settings.gradle.kts', buildSystem: 'gradle', language: 'kotlin' },
  { file: 'package.json', buildSystem: 'npm', language: 'javascript' },
  { file: 'pyproject.toml', buildSystem: 'python', language: 'python' },
  { file: 'setup.py', buildSystem: 'python', language: 'python' },
  { file: 'setup.cfg', buildSystem: 'python', language: 'python' },
  { file: 'Pipfile', buildSystem: 'python', language: 'python' },
  { file: 'requirements.txt', buildSystem: 'python', language: 'python' },
  { file: 'go.mod', buildSystem: 'go', language: 'go' },
  { file: 'Cargo.toml', buildSystem: 'cargo', language: 'rust' },
  { file: 'Gemfile', buildSystem: 'bundler', language: 'ruby' },
  { file: 'composer.json', buildSystem: 'composer', language: 'php' },
  { file: 'CMakeLists.txt', buildSystem: 'cmake', language: 'cpp' },
  { file: 'Makefile', buildSystem: 'make', language: 'unknown' },
  { file: '*.csproj', buildSystem: 'dotnet', language: 'csharp' },
]);

/** 锁文件 → 包管理器。 */
const LOCKFILES = Object.freeze([
  { file: 'pnpm-lock.yaml', packageManager: 'pnpm' },
  { file: 'yarn.lock', packageManager: 'yarn' },
  { file: 'package-lock.json', packageManager: 'npm' },
  { file: 'bun.lockb', packageManager: 'bun' },
  { file: 'poetry.lock', packageManager: 'poetry' },
  { file: 'Pipfile.lock', packageManager: 'pipenv' },
  { file: 'uv.lock', packageManager: 'uv' },
  { file: 'go.sum', packageManager: 'go' },
  { file: 'Cargo.lock', packageManager: 'cargo' },
  { file: 'Gemfile.lock', packageManager: 'bundler' },
  { file: 'composer.lock', packageManager: 'composer' },
]);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function isDirectory(target) {
  try {
    return fs.lstatSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 探测有界扫描选中的仓库目录中的构建事实。
 * 返回该目录的 markers、lockfiles 与 package scripts。
 */
function inspectDirectory(root, relative, discovery) {
  const entries = discovery.entries.get(relative) || [];
  const files = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const read = (file) => discovery.readText(relative === '.' ? file : relative + '/' + file);
  const markers = [];
  const locks = [];
  let scripts = null;
  let manifest = null;
  for (const marker of BUILD_MARKERS) {
    if (marker.file.includes('*')) continue; // 通配在下面单独处理
    if (files.has(marker.file))
      markers.push({
        file: marker.file,
        buildSystem: marker.buildSystem,
        language: marker.language,
      });
  }
  // 通配型标记（如 *.csproj）：只看目录直接子项，不递归。
  try {
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.csproj'))
        markers.push({ file: entry.name, buildSystem: 'dotnet', language: 'csharp' });
    }
  } catch {
    /* 目录不可读：按缺口处理，不抛错 */
  }
  for (const lock of LOCKFILES) {
    if (files.has(lock.file)) locks.push({ file: lock.file, packageManager: lock.packageManager });
  }
  if (markers.some((marker) => marker.buildSystem === 'npm')) {
    try {
      manifest = JSON.parse(read('package.json'));
      scripts = object(manifest?.scripts) ? manifest.scripts : null;
    } catch {
      markers.push({
        file: 'package.json',
        buildSystem: 'npm',
        language: 'javascript',
        invalid: true,
      });
    }
  }
  for (const marker of markers) read(marker.file);
  return { relative, markers, locks, scripts, manifest };
}

/** 从 package.json 依赖推断前端框架；无法判定时不臆造。 */
function frontendFrameworkFrom(manifest) {
  if (!object(manifest)) return null;
  const dependencies = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
  if (object(dependencies)) {
    if (Object.hasOwn(dependencies, 'vue')) return 'vue';
    if (Object.hasOwn(dependencies, 'react')) return 'react';
    if (Object.hasOwn(dependencies, '@angular/core')) return 'angular';
    if (Object.hasOwn(dependencies, 'svelte')) return 'svelte';
  }
  return null;
}

/** npm 脚本 → 能力与命令。 */
function npmCapabilities(scripts, relative, manager = 'npm') {
  const capabilities = [];
  const commands = { build: [], test: [], lint: [], format: [], runtime: [] };
  if (!object(scripts)) return { capabilities, commands };
  const scriptMap = [
    ['build', 'build'],
    ['test', 'test'],
    ['lint', 'lint'],
    ['format', 'format'],
    ['dev', 'runtime'],
    ['start', 'runtime'],
  ];
  for (const [script, kind] of scriptMap) {
    if (typeof scripts[script] !== 'string') continue;
    const id =
      (relative === '.' ? 'root' : relative.replace(/[^A-Za-z0-9._-]+/g, '-')) + '-' + script;
    capabilities.push({ id, kind, module: relative });
    commands[kind].push({ id, cwd: relative, argv: [manager, 'run', script] });
  }
  return { capabilities, commands };
}

/**
 * 探测仓库技术栈。
 * 返回值中的 `stack` 只是描述性标签，不参与准入判断。
 */
export function detectStack({ root, maxDirectories = MAX_TOP_LEVEL_DIRECTORIES, ...limits } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    return { ok: false, code: 'STACK_DETECT_INVALID', message: 'root 必须是绝对路径' };
  if (!isDirectory(root))
    return { ok: false, code: 'STACK_DETECT_INVALID', message: 'root 不是普通目录' };

  const scanned = [];
  const modules = [];
  const capabilities = [];
  const observations = [];
  const gaps = [];
  const commands = { install: [], build: [], test: [], lint: [], format: [], runtime: [] };
  const lockfiles = [];

  let discovery;
  try {
    discovery = scanDirectories({ root, skip: SKIP_DIRECTORIES, maxDirectories, ...limits });
  } catch (error) {
    return { ok: false, code: error.code || 'STACK_DETECT_INVALID', message: error.message };
  }
  const { candidates, workspaces, scan } = discovery;
  for (const relative of candidates) {
    const found = inspectDirectory(root, relative, discovery);
    scanned.push(relative);
    lockfiles.push(...found.locks.map((lock) => ({ ...lock, relative })));
    if (found.markers.length === 0) continue;
    const buildSystems = [...new Set(found.markers.map((marker) => marker.buildSystem))];
    const languages = [...new Set(found.markers.map((marker) => marker.language))];
    const commandPrefix =
      relative === '.'
        ? 'root'
        : relative
            .replace(/[^A-Za-z0-9._-]/g, '-')
            .replace(/^[^A-Za-z0-9]+/, 'module-')
            .slice(0, 100) +
          '-' +
          createHash('sha256').update(relative).digest('hex').slice(0, 12);
    const owner = buildSystems.includes('npm')
      ? workspaceOwner(
          workspaces.filter((workspace) => workspace.kind !== 'go'),
          relative,
        )
      : null;
    const ownManager =
      String(found.manifest?.packageManager || '').split('@')[0] ||
      found.locks.find(
        (lock) =>
          !buildSystems.includes('npm') ||
          ['npm', 'pnpm', 'yarn', 'bun'].includes(lock.packageManager),
      )?.packageManager ||
      '';
    const packageManager =
      ownManager || (buildSystems.includes('npm') ? owner?.packageManager : '') || '';
    if (buildSystems.includes('npm') && owner && ownManager && ownManager !== owner.packageManager)
      discovery.issue('WORKSPACE_MANAGER_CONFLICT', relative);
    if (found.markers.some((marker) => marker.invalid))
      gaps.push(relative + '/package.json 无法解析，前端命令未被发现');
    modules.push({
      id: relative === '.' ? 'root' : relative,
      root: relative,
      buildSystems,
      languages,
      packageManager,
      ...(owner ? { workspaceRoot: owner.root } : {}),
    });
    if (buildSystems.includes('go')) {
      commands.install.push({
        id: commandPrefix + '-go-deps',
        cwd: relative,
        argv: ['go', 'mod', 'download'],
      });
      commands.build.push({
        id: commandPrefix + '-go-build',
        cwd: relative,
        argv: ['go', 'build', './...'],
      });
      commands.test.push({
        id: commandPrefix + '-go-test',
        cwd: relative,
        argv: ['go', 'test', './...'],
      });
    }
    if (buildSystems.includes('python')) {
      const manager = found.locks.find((lock) =>
        ['uv', 'poetry'].includes(lock.packageManager),
      )?.packageManager;
      const prefix =
        manager === 'uv'
          ? ['uv', 'run', '--frozen', 'python']
          : manager === 'poetry'
            ? ['poetry', 'run', 'python']
            : ['python'];
      const names = new Set((discovery.entries.get(relative) || []).map((e) => e.name));
      const pytest = names.has('pytest.ini') || names.has('conftest.py');
      commands.test.push({
        id: commandPrefix + '-python-test',
        cwd: relative,
        argv: [...prefix, '-m', pytest ? 'pytest' : 'unittest', ...(pytest ? [] : ['discover'])],
      });
    }
    const moduleId = relative === '.' ? 'root' : relative;
    const npm = npmCapabilities(
      found.scripts,
      relative,
      ['npm', 'pnpm', 'yarn'].includes(packageManager) ? packageManager : 'npm',
    );
    // 构建能力：npm 有显式脚本时以脚本为准（更具体，含真实命令）；
    // 否则按构建系统声明一项。两者不在同一模块上重复计数。
    const npmBuildCapability = npm.capabilities.some((entry) => entry.kind === 'build');
    for (const buildSystem of buildSystems) {
      if (buildSystem === 'npm' && npmBuildCapability) continue;
      capabilities.push({
        id: moduleId + '-' + buildSystem + '-build',
        kind: 'build',
        module: moduleId,
        toolchain: buildSystem,
      });
    }
    for (const entry of npm.capabilities)
      if (!capabilities.some((existing) => existing.id === entry.id)) capabilities.push(entry);
    for (const key of Object.keys(npm.commands)) commands[key].push(...npm.commands[key]);
    // Maven/Gradle 的能力需要工具链探测（M3），这里只登记「存在构建系统」这一事实。
    if (buildSystems.includes('maven'))
      observations.push({
        id: (relative === '.' ? 'root' : relative) + '-maven',
        text: relative + ' 使用 Maven（pom.xml 存在）',
        sourceRefs: [relative === '.' ? 'pom.xml' : relative + '/pom.xml'],
      });
    const framework = frontendFrameworkFrom(found.manifest);
    if (framework)
      observations.push({
        id: (relative === '.' ? 'root' : relative) + '-frontend-framework',
        text: relative + ' 的依赖声明了 ' + framework,
        sourceRefs: [relative === '.' ? 'package.json' : relative + '/package.json'],
      });
  }

  if (modules.length === 0)
    gaps.push(
      '未发现任何已知构建文件（pom.xml/build.gradle/package.json/pyproject.toml/go.mod/Cargo.toml 等）',
    );

  if (!scan.complete)
    gaps.push('扫描不完整：' + scan.issues.map((i) => i.code + ' ' + i.path).join('；'));
  const languages = [...new Set(modules.flatMap((entry) => entry.languages))];
  const buildSystems = [...new Set(modules.flatMap((entry) => entry.buildSystems))];
  // stack 仅作描述：单构建设计系统且各模块一致时给出可读标签。
  let stack = null;
  if (buildSystems.length === 1 && languages.length === 1)
    stack = languages[0] + '-' + buildSystems[0];
  else if (buildSystems.length > 0) stack = buildSystems.slice().sort().join('+');

  return {
    ok: true,
    stack,
    languages,
    buildSystems,
    modules,
    capabilities,
    observations,
    gaps,
    commands,
    lockfiles,
    scanned,
    scan,
    workspaces,
  };
}
