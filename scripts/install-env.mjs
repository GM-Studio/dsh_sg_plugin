#!/usr/bin/env node
// SpecGate 一键环境安装：先发现并复用已安装工具链，缺失时按平台自动安装。
// Windows：winget → choco → 便携归档；Linux：apt/dnf/pacman → 便携归档。
// 每步安装后真实重新探测，失败自动尝试下一种方式；最终报告只反映实际结果。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  discoverJava,
  discoverMaven,
  discoverNode,
  mergeEnvironment,
  probeTool,
  readPersistentEnvironment,
} from '../src/codex/core/java/java-env.js';
import { removeTemporaryDirectory } from '../src/codex/core/temp.js';

export const TOOL_IDS = ['git', 'node', 'jdk8', 'jdk17', 'jdk21', 'maven'];
export const JDK_MAJORS = { jdk8: 8, jdk17: 17, jdk21: 21 };
export const NODE_PORTABLE_VERSION = 'v22.12.0';
export const MAVEN_PORTABLE_VERSION = '3.9.11';
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const ENV_BLOCK_START = '# specgate-env:begin';
const ENV_BLOCK_END = '# specgate-env:end';

// 与 sg_verify 的工具链门槛保持一致：Node 22.12+/24，Maven 3.9.x。
export function nodeVersionAccepted(version) {
  const [major = 0, minor = 0] = String(version || '')
    .split('.')
    .map(Number);
  return (major === 22 && minor >= 12) || major === 24;
}

export function mavenVersionAccepted(version) {
  return /^3\.9\./.test(String(version || ''));
}

export function defaultToolchainDir(homedir = os.homedir()) {
  return path.join(homedir, '.specgate', 'toolchains');
}

function run(command, args, { timeout = COMMAND_TIMEOUT_MS, env, cwd } = {}) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      ...(env ? { env } : {}),
      ...(cwd ? { cwd } : {}),
    });
    return {
      ok: result.status === 0,
      status: result.status,
      output: `${result.stdout || ''}${result.stderr || ''}`.slice(-4096),
      error: result.error ? String(result.error.message || result.error.code) : null,
    };
  } catch (error) {
    return { ok: false, status: null, output: '', error: error.message };
  }
}

/** 逐工具真实探测；返回值即报告事实，绝不虚构版本。 */
export function verifyTool(id, { env = process.env, platform = process.platform } = {}) {
  if (id === 'git') {
    const probe = run('git', ['--version'], { timeout: 8000, env });
    const match = /git version ([\w.-]+)/.exec(probe.output);
    return probe.ok && match
      ? { ok: true, version: match[1], location: null }
      : { ok: false, message: '未探测到 git' };
  }
  if (id === 'node') {
    const node = discoverNode({ env, platform });
    return node
      ? { ok: true, version: node.version, npmVersion: node.npmVersion, location: node.node }
      : { ok: false, message: '未发现满足门槛（Node 22.12+/24）的 Node 与 npm' };
  }
  if (Object.hasOwn(JDK_MAJORS, id)) {
    const java = discoverJava({ env, platform });
    const hit = java.homes.find((entry) => entry.major === JDK_MAJORS[id]);
    return hit
      ? { ok: true, version: hit.version, location: hit.home }
      : {
          ok: false,
          message: `未发现 JDK ${JDK_MAJORS[id]}（已检查 JAVA_HOME、PATH 与常见安装目录）`,
        };
  }
  if (id === 'maven') {
    // mvn 启动脚本需要 JAVA_HOME；缺失时先用已发现的 JDK 补上再探测，避免误报缺失。
    const probeEnv = { ...env };
    const javaHome = String(probeEnv.JAVA_HOME || '');
    if (!javaHome || !fs.existsSync(path.join(javaHome, 'bin'))) {
      const java = discoverJava({ env: probeEnv, platform });
      if (java.homes[0]) probeEnv.JAVA_HOME = java.homes[0].home;
    }
    const maven = discoverMaven({ env: probeEnv, platform });
    return maven
      ? { ok: true, version: maven.version, location: maven.path }
      : { ok: false, message: '未发现 Maven 3.9.x' };
  }
  return { ok: false, message: '未知工具：' + id };
}

export function discoverAll({ env = process.env, platform = process.platform } = {}) {
  const persistent = readPersistentEnvironment({ platform, env });
  const merged = mergeEnvironment({ ...persistent, env, platform });
  const found = {};
  for (const id of TOOL_IDS) found[id] = verifyTool(id, { env: merged, platform });
  return { found, env: merged };
}

export function planTools({ found, requests = TOOL_IDS, reinstall = false }) {
  return requests.map((id) => {
    const current = found[id] || { ok: false };
    return { id, action: !reinstall && current.ok ? 'reuse' : 'install', current };
  });
}

export function detectManagers({ platform = process.platform, env = process.env } = {}) {
  const managers = { platform };
  if (platform === 'win32') {
    managers.winget = run('winget', ['--version'], { timeout: 8000, env }).ok;
    managers.choco = run('choco', ['--version'], { timeout: 8000, env }).ok;
    managers.elevated = run('net', ['session'], { timeout: 8000, env }).ok;
    return managers;
  }
  managers.elevated = typeof process.geteuid === 'function' && process.geteuid() === 0;
  managers.sudo =
    !managers.elevated && run('sudo', ['-n', 'true'], { timeout: 8000, env }).ok === true;
  for (const candidate of ['apt-get', 'dnf', 'pacman'])
    if (run(candidate, ['--version'], { timeout: 8000, env }).ok) {
      managers.packageManager = candidate;
      break;
    }
  return managers;
}

const WINGET_PACKAGES = {
  git: 'Git.Git',
  node: 'OpenJS.NodeJS.LTS',
  jdk8: 'EclipseAdoptium.Temurin.8.JDK',
  jdk17: 'EclipseAdoptium.Temurin.17.JDK',
  jdk21: 'EclipseAdoptium.Temurin.21.JDK',
};
const CHOCO_PACKAGES = {
  git: 'git',
  node: 'nodejs-lts',
  jdk8: 'temurin8',
  jdk17: 'temurin17',
  jdk21: 'temurin21',
  maven: 'maven',
};
const APT_PACKAGES = {
  git: ['git'],
  node: ['nodejs', 'npm'],
  jdk8: ['openjdk-8-jdk'],
  jdk17: ['openjdk-17-jdk'],
  jdk21: ['openjdk-21-jdk'],
  maven: ['maven'],
};
const DNF_PACKAGES = {
  git: ['git'],
  node: ['nodejs', 'npm'],
  jdk8: ['java-1.8.0-openjdk-devel'],
  jdk17: ['java-17-openjdk-devel'],
  jdk21: ['java-21-openjdk-devel'],
  maven: ['maven'],
};
const PACMAN_PACKAGES = {
  git: ['git'],
  node: ['nodejs', 'npm'],
  jdk8: ['jdk8-openjdk'],
  jdk17: ['jdk17-openjdk'],
  jdk21: ['jdk21-openjdk'],
  maven: ['maven'],
};
const PACKAGE_MAPS = { 'apt-get': APT_PACKAGES, dnf: DNF_PACKAGES, pacman: PACMAN_PACKAGES };

export function methodChain({ platform, tool, managers }) {
  const chain = [];
  if (platform === 'win32') {
    if (managers.winget && WINGET_PACKAGES[tool])
      chain.push({ method: 'winget', id: WINGET_PACKAGES[tool] });
    if (managers.choco && CHOCO_PACKAGES[tool])
      chain.push({ method: 'choco', id: CHOCO_PACKAGES[tool] });
  } else if (managers.packageManager && (managers.elevated || managers.sudo)) {
    const packages = PACKAGE_MAPS[managers.packageManager]?.[tool];
    if (packages) chain.push({ method: managers.packageManager, packages });
  }
  // Git 没有便携归档方案；其余工具最终回退到用户目录便携安装，无需管理员权限。
  if (tool !== 'git') chain.push({ method: 'portable' });
  return chain;
}

export function portableUrls({ tool, platform, arch }) {
  const osName = platform === 'win32' ? 'windows' : 'linux';
  const adoptiumArch = arch === 'arm64' ? 'aarch64' : 'x64';
  if (Object.hasOwn(JDK_MAJORS, tool))
    return [
      `https://api.adoptium.net/v3/binary/latest/${JDK_MAJORS[tool]}/ga/${osName}/jdk/${adoptiumArch}/hotspot/normal/eclipse`,
    ];
  if (tool === 'maven') {
    const name = `apache-maven-${MAVEN_PORTABLE_VERSION}-bin.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
    return [
      `https://dlcdn.apache.org/maven/maven-3/${MAVEN_PORTABLE_VERSION}/binaries/${name}`,
      `https://archive.apache.org/dist/maven/maven-3/${MAVEN_PORTABLE_VERSION}/binaries/${name}`,
    ];
  }
  if (tool === 'node') {
    const nodeArch = arch === 'arm64' ? 'arm64' : 'x64';
    const name =
      platform === 'win32'
        ? `node-${NODE_PORTABLE_VERSION}-win-${nodeArch}.zip`
        : `node-${NODE_PORTABLE_VERSION}-linux-${nodeArch}.tar.gz`;
    return [`https://nodejs.org/dist/${NODE_PORTABLE_VERSION}/${name}`];
  }
  return [];
}

/** 便携安装目录：默认 JDK 装入 ~/.jdks（可被现有发现逻辑扫描），其余装入工具链目录。 */
export function portableTargets({ tool, platform, toolchainDir, homedir = os.homedir() }) {
  const usingDefault = toolchainDir === defaultToolchainDir(homedir);
  if (Object.hasOwn(JDK_MAJORS, tool))
    return {
      baseDir: usingDefault ? path.join(homedir, '.jdks') : path.join(toolchainDir, 'jdks'),
      dirName: `temurin-${JDK_MAJORS[tool]}`,
    };
  if (tool === 'maven')
    return { baseDir: toolchainDir, dirName: `apache-maven-${MAVEN_PORTABLE_VERSION}` };
  if (tool === 'node')
    return {
      baseDir: toolchainDir,
      dirName: `node-${NODE_PORTABLE_VERSION}-${platform === 'win32' ? 'win' : 'linux'}`,
    };
  return null;
}

function portableMarker(tool, platform) {
  if (Object.hasOwn(JDK_MAJORS, tool)) return ['bin', platform === 'win32' ? 'javac.exe' : 'javac'];
  if (tool === 'maven') return ['bin', platform === 'win32' ? 'mvn.cmd' : 'mvn'];
  if (tool === 'node') return platform === 'win32' ? ['node.exe'] : ['bin', 'node'];
  return null;
}

function findToolHome(root, marker, depth = 0) {
  if (depth > 3) return null;
  try {
    if (fs.existsSync(path.join(root, ...marker))) return root;
    for (const entry of fs.readdirSync(root, { withFileTypes: true }))
      if (entry.isDirectory()) {
        const hit = findToolHome(path.join(root, entry.name), marker, depth + 1);
        if (hit) return hit;
      }
  } catch {
    /* 不可读目录直接跳过。 */
  }
  return null;
}

function uniqueDirectory(target) {
  if (!fs.existsSync(target)) return target;
  return `${target}-${Date.now()}`;
}

function safeLiteral(value) {
  if (/['"\r\n]/.test(String(value))) throw new Error('路径包含不安全字符：' + value);
  return String(value);
}

function download(urls, dest, { env, log }) {
  for (const url of urls) {
    log(`下载 ${url}`);
    const curl = run('curl', ['-fL', '--retry', '2', '--connect-timeout', '30', '-o', dest, url], {
      timeout: DOWNLOAD_TIMEOUT_MS,
      env,
    });
    if (curl.ok && fs.existsSync(dest) && fs.statSync(dest).size > 1024 * 1024) return true;
    if (curl.error && /ENOENT|not found/i.test(curl.error + curl.output)) {
      const fallback = run(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `$ProgressPreference='SilentlyContinue';Invoke-WebRequest -Uri '${safeLiteral(url)}' -OutFile '${safeLiteral(dest)}'`,
        ],
        { timeout: DOWNLOAD_TIMEOUT_MS, env },
      );
      if (fallback.ok && fs.existsSync(dest) && fs.statSync(dest).size > 1024 * 1024) return true;
    }
  }
  return false;
}

function extractArchive(archive, destDir, { platform, env, log }) {
  fs.mkdirSync(destDir, { recursive: true });
  log(`解压 ${path.basename(archive)}`);
  const tar = run('tar', ['-xf', archive, '-C', destDir], { timeout: COMMAND_TIMEOUT_MS, env });
  if (tar.ok) return true;
  if (platform === 'win32' && /\.zip$/i.test(archive))
    return run(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${safeLiteral(archive)}' -DestinationPath '${safeLiteral(destDir)}' -Force`,
      ],
      { timeout: COMMAND_TIMEOUT_MS, env },
    ).ok;
  return false;
}

function probePortable(tool, home, { platform, env }) {
  const marker = portableMarker(tool, platform);
  const binary = path.join(home, ...marker);
  if (!fs.existsSync(binary)) return { ok: false, message: '缺少可执行入口：' + binary };
  if (Object.hasOwn(JDK_MAJORS, tool)) {
    const text = probeTool(binary, ['-version'], 8000, env);
    const match = /(?:javac|version)\s+"?(\d+(?:\.\d+)*)/.exec(text);
    const version = match ? match[1] : null;
    const major = version ? Number(/^1\.(\d+)/.exec(version)?.[1] || version.split('.')[0]) : null;
    return major === JDK_MAJORS[tool]
      ? { ok: true, version, location: home }
      : { ok: false, message: `JDK 版本探测不符：${version || '无输出'}` };
  }
  if (tool === 'maven') {
    const java = discoverJava({ env, platform });
    const probeEnv = { ...env, ...(java.homes[0] ? { JAVA_HOME: java.homes[0].home } : {}) };
    const text = probeTool(binary, ['-v'], 15000, probeEnv);
    const match = /Apache Maven\s+([\w.-]+)/i.exec(text);
    return match && mavenVersionAccepted(match[1])
      ? { ok: true, version: match[1], location: binary }
      : { ok: false, message: `Maven 版本探测不符：${match?.[1] || '无输出'}` };
  }
  if (tool === 'node') {
    const text = probeTool(binary, ['-v'], 8000, env);
    const match = /^v?([\d.]+)/.exec(text.trim());
    return match && nodeVersionAccepted(match[1])
      ? { ok: true, version: match[1], location: binary }
      : { ok: false, message: `Node 版本探测不符：${match?.[1] || '无输出'}` };
  }
  return { ok: false, message: '不支持的便携安装工具：' + tool };
}

/** 便携安装返回需要合入进程环境的路径，供安装后立即复测与后续持久化。 */
export function portableEnvAugment(tool, home, { platform }) {
  if (tool === 'maven')
    return { variables: { SG_MAVEN_HOME: home }, pathPrepend: [path.join(home, 'bin')] };
  if (tool === 'node')
    return {
      variables: {},
      pathPrepend: [platform === 'win32' ? home : path.join(home, 'bin')],
    };
  return { variables: {}, pathPrepend: [] };
}

function installPortable({ tool, platform, arch, toolchainDir, env, log, homedir }) {
  const urls = portableUrls({ tool, platform, arch });
  const targets = portableTargets({ tool, platform, toolchainDir, homedir });
  if (!urls.length || !targets) return { ok: false, message: `${tool} 不支持便携安装` };
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-env-'));
  try {
    const ext = platform === 'win32' ? '.zip' : '.tar.gz';
    const archive = path.join(staging, `sg-${tool}${ext}`);
    if (!download(urls, archive, { env, log }))
      return { ok: false, message: '下载失败：' + urls.join(' 或 ') };
    const extractDir = path.join(staging, 'extracted');
    if (!extractArchive(archive, extractDir, { platform, env, log }))
      return { ok: false, message: '解压失败：' + archive };
    const marker = portableMarker(tool, platform);
    const home = findToolHome(extractDir, marker);
    if (!home) return { ok: false, message: '解压内容中未找到可执行入口' };
    const target = uniqueDirectory(path.join(targets.baseDir, targets.dirName));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    log(`安装到 ${target}`);
    try {
      fs.renameSync(home, target);
    } catch {
      fs.cpSync(home, target, { recursive: true });
    }
    const verified = probePortable(tool, target, { platform, env });
    return verified.ok
      ? { ...verified, method: 'portable', augment: portableEnvAugment(tool, target, { platform }) }
      : { ...verified, location: target };
  } finally {
    try {
      removeTemporaryDirectory(staging, { maxRetries: 20, retryDelay: 100 });
    } catch (error) {
      log(`暂存目录清理失败（${staging}）：${error.message}`);
    }
  }
}

function packageAvailable(step, { env }) {
  if (step.method !== 'apt-get') return true;
  return step.packages.every(
    (name) => run('apt-cache', ['show', name], { timeout: 15000, env }).ok,
  );
}

function installWithManager({ step, managers, env, log, reinstall }) {
  if (step.method === 'winget') {
    const args = [
      'install',
      '--id',
      step.id,
      '-e',
      '--accept-source-agreements',
      '--accept-package-agreements',
      ...(reinstall ? ['--force'] : []),
    ];
    log(`winget ${args.join(' ')}`);
    return run('winget', args, { timeout: DOWNLOAD_TIMEOUT_MS, env });
  }
  if (step.method === 'choco') {
    const args = ['install', step.id, '-y', '--no-progress', ...(reinstall ? ['--force'] : [])];
    log(`choco ${args.join(' ')}`);
    return run('choco', args, { timeout: DOWNLOAD_TIMEOUT_MS, env });
  }
  const command = managers.elevated ? step.method : 'sudo';
  const prefix = managers.elevated ? [] : ['-n', step.method];
  if (step.method === 'apt-get') {
    log(`apt-get update && apt-get install -y ${step.packages.join(' ')}`);
    run(command, [...prefix, 'update', '-y'], { timeout: COMMAND_TIMEOUT_MS, env });
    return run(command, [...prefix, 'install', '-y', ...step.packages], {
      timeout: DOWNLOAD_TIMEOUT_MS,
      env,
    });
  }
  if (step.method === 'dnf') {
    log(`dnf install -y ${step.packages.join(' ')}`);
    return run(command, [...prefix, 'install', '-y', ...step.packages], {
      timeout: DOWNLOAD_TIMEOUT_MS,
      env,
    });
  }
  if (step.method === 'pacman') {
    log(`pacman -S --noconfirm ${step.packages.join(' ')}`);
    return run(command, [...prefix, '-S', '--noconfirm', ...step.packages], {
      timeout: DOWNLOAD_TIMEOUT_MS,
      env,
    });
  }
  return { ok: false, output: '', error: '未知安装方式：' + step.method };
}

export function replaceEnvBlock(text, block) {
  const source = String(text || '').replace(/\r\n/g, '\n');
  const start = source.indexOf(ENV_BLOCK_START);
  const end = source.indexOf(ENV_BLOCK_END);
  if (start !== -1 && end !== -1 && end > start)
    return (
      source.slice(0, start).trimEnd() +
      (source.slice(0, start).trimEnd() ? '\n\n' : '') +
      block +
      '\n' +
      source.slice(end + ENV_BLOCK_END.length).replace(/^\n+/, '')
    ).replace(/\n{3,}/g, '\n\n');
  return (source.trimEnd() ? source.trimEnd() + '\n\n' : '') + block + '\n';
}

export function renderEnvBlock({ entries, pathPrepend, platform }) {
  const lines = [ENV_BLOCK_START];
  if (platform === 'win32') {
    for (const [key, value] of Object.entries(entries)) lines.push(`$env:${key} = '${value}'`);
    for (const dir of pathPrepend) lines.push(`$env:PATH = '${dir};' + $env:PATH`);
  } else {
    for (const [key, value] of Object.entries(entries)) lines.push(`export ${key}="${value}"`);
    if (pathPrepend.length) lines.push(`export PATH="${pathPrepend.join(':')}:$PATH"`);
  }
  lines.push(ENV_BLOCK_END);
  return lines.join('\n');
}

function persistEnvironment({ platform, entries, pathPrepend, toolchainDir, log }) {
  if (!Object.keys(entries).length && !pathPrepend.length) return;
  try {
    fs.mkdirSync(toolchainDir, { recursive: true });
    fs.writeFileSync(
      path.join(toolchainDir, 'env.json'),
      JSON.stringify(
        { entries, pathPrepend, platform, updatedAt: new Date().toISOString() },
        null,
        2,
      ) + '\n',
    );
    if (platform === 'win32') {
      const script = renderEnvBlock({ entries, pathPrepend, platform });
      fs.writeFileSync(path.join(toolchainDir, 'specgate-env.ps1'), script + '\n');
      const commands = Object.entries(entries).map(
        ([key, value]) =>
          `[Environment]::SetEnvironmentVariable('${safeLiteral(key)}','${safeLiteral(value)}','User')`,
      );
      if (pathPrepend.length)
        commands.push(
          `$p=[Environment]::GetEnvironmentVariable('PATH','User');$add='${safeLiteral(pathPrepend.join(';'))}';` +
            `$parts=@(($add -split ';') + ($p -split ';' | Where-Object {$_ -and ($add -split ';') -notcontains $_}));` +
            `[Environment]::SetEnvironmentVariable('PATH',($parts -join ';'),'User')`,
        );
      if (commands.length)
        run('powershell.exe', ['-NoProfile', '-Command', commands.join(';')], {
          timeout: 30000,
        });
      log('已写入用户环境变量并生成 specgate-env.ps1');
    } else {
      const block = renderEnvBlock({ entries, pathPrepend, platform });
      for (const file of [
        path.join(os.homedir(), '.profile'),
        path.join(os.homedir(), '.bashrc'),
      ]) {
        let existing = '';
        try {
          existing = fs.readFileSync(file, 'utf8');
        } catch {
          /* 文件不存在时直接创建。 */
        }
        fs.writeFileSync(file, replaceEnvBlock(existing, block));
      }
      log('已写入 ~/.profile 与 ~/.bashrc 的 specgate-env 块');
    }
  } catch (error) {
    log(`环境持久化失败（不影响本次安装结果）：${error.message}`);
  }
}

export function parseInstallArgs(argv) {
  const options = {
    check: false,
    json: false,
    reinstall: false,
    envWrite: true,
    method: 'auto',
    only: [...TOOL_IDS],
    toolchainDir: null,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--check') options.check = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--reinstall') options.reinstall = true;
    else if (arg === '--no-env-write') options.envWrite = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--only=')) {
      const ids = arg
        .slice('--only='.length)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      for (const id of ids)
        if (!TOOL_IDS.includes(id))
          throw new Error('未知工具：' + id + '（可选：' + TOOL_IDS.join('、') + '）');
      options.only = [...new Set(ids)];
    } else if (arg.startsWith('--method=')) {
      const method = arg.slice('--method='.length);
      if (!['auto', 'winget', 'choco', 'apt-get', 'dnf', 'pacman', 'portable'].includes(method))
        throw new Error('未知安装方式：' + method);
      options.method = method;
    } else if (arg.startsWith('--toolchain-dir=')) {
      const dir = arg.slice('--toolchain-dir='.length).trim();
      if (!path.isAbsolute(dir)) throw new Error('--toolchain-dir 必须是绝对路径');
      options.toolchainDir = dir;
    } else throw new Error('未知参数：' + arg);
  }
  if (!options.only.length) throw new Error('--only 至少需要一个工具');
  return options;
}

const USAGE = `SpecGate 环境一键安装
用法：node scripts/install-env.mjs [选项]
  --check               只发现并报告，不安装
  --only=git,node,...   仅处理指定工具（git、node、jdk8、jdk17、jdk21、maven）
  --reinstall           忽略已发现的安装，重新执行安装链路
  --method=<方式>       auto|winget|choco|apt-get|dnf|pacman|portable
  --toolchain-dir=<目录> 便携安装目录（默认 ~/.specgate/toolchains；JDK 默认 ~/.jdks）
  --no-env-write        不写入用户环境变量/配置文件（沙箱测试用）
  --json                输出机器可读 JSON 报告
Windows 依次尝试 winget → choco → 便携归档；Linux 依次尝试 apt/dnf/pacman → 便携归档。
每步安装后都会真实重新探测；报告只反映实际探测结果。`;

export function installEnvironment({
  platform = process.platform,
  arch = os.arch(),
  argv = [],
  homedir = os.homedir(),
  log = (line) => process.stderr.write(line + '\n'),
} = {}) {
  const options = parseInstallArgs(argv);
  if (options.help) {
    process.stdout.write(USAGE + '\n');
    return { ok: true, help: true, tools: {} };
  }
  const toolchainDir = options.toolchainDir || defaultToolchainDir(homedir);
  let { found, env } = discoverAll({ platform });
  const plan = planTools({ found, requests: options.only, reinstall: options.reinstall });
  const report = {};
  for (const id of options.only) report[id] = { ...found[id] };
  if (options.check) {
    for (const id of options.only)
      report[id] = found[id].ok ? { ...found[id], status: 'reused' } : { ...found[id] };
    const ok = options.only.every((id) => found[id].ok);
    return finish({ ok, report, plan, options, platform, log, checked: true });
  }
  const managers = detectManagers({ platform, env });
  log(
    `平台 ${platform}/${arch}；包管理器：` +
      (platform === 'win32'
        ? `winget=${managers.winget ? '可用' : '缺失'}，choco=${managers.choco ? '可用' : '缺失'}，管理员=${managers.elevated ? '是' : '否'}`
        : `${managers.packageManager || '无'}，root=${managers.elevated ? '是' : '否'}，sudo=${managers.sudo ? '可用' : '不可用'}`),
  );
  for (const step of plan) {
    const { id } = step;
    if (step.action === 'reuse') {
      log(
        `复用 ${id}：${step.current.version}${step.current.location ? ' @ ' + step.current.location : ''}`,
      );
      report[id] = { ...step.current, status: 'reused' };
      continue;
    }
    let chain = methodChain({ platform, tool: id, managers });
    if (options.method !== 'auto') chain = chain.filter((entry) => entry.method === options.method);
    if (!chain.length) {
      report[id] = { ok: false, status: 'failed', message: '没有可用的安装方式' };
      log(`安装 ${id} 失败：没有可用的安装方式`);
      continue;
    }
    let installed = null;
    for (const method of chain) {
      if (installed) break;
      log(`安装 ${id}：尝试 ${method.method}`);
      let outcome;
      if (method.method === 'portable')
        outcome = installPortable({ tool: id, platform, arch, toolchainDir, env, log, homedir });
      else if (!packageAvailable(method, { env })) {
        log(`安装 ${id}：${method.method} 仓库中没有 ${method.packages.join('/')}，尝试下一种方式`);
        continue;
      } else
        outcome = installWithManager({
          step: method,
          managers,
          env,
          log,
          reinstall: options.reinstall,
        });
      if (method.method !== 'portable' && !outcome.ok) {
        log(
          `安装 ${id}：${method.method} 未成功（${(outcome.error || outcome.output || '').slice(-200)}）`,
        );
        continue;
      }
      if (method.method === 'portable') {
        if (!outcome.ok) {
          log(`安装 ${id}：便携安装失败（${outcome.message}）`);
          continue;
        }
        if (outcome.augment) {
          for (const [key, value] of Object.entries(outcome.augment.variables)) env[key] = value;
          if (outcome.augment.pathPrepend.length)
            env.PATH = [...outcome.augment.pathPrepend, env.PATH].join(
              platform === 'win32' ? ';' : ':',
            );
          if (options.envWrite && !options.toolchainDir)
            persistEnvironment({
              platform,
              entries: outcome.augment.variables,
              pathPrepend: outcome.augment.pathPrepend,
              toolchainDir,
              log,
            });
        }
        installed = { ...outcome, status: 'installed' };
        continue;
      }
      // 包管理器安装后：Windows 读取最新持久环境，再真实复测。
      const refreshed = discoverAll({ platform });
      env = refreshed.env;
      const verified = refreshed.found[id];
      if (verified.ok) installed = { ...verified, status: 'installed', method: method.method };
      else log(`安装 ${id}：${method.method} 执行后仍未通过探测，尝试下一种方式`);
    }
    if (installed) {
      report[id] = installed;
      log(
        `安装 ${id} 成功：${installed.version} @ ${installed.location || '系统路径'}（${installed.method}）`,
      );
    } else {
      report[id] = { ok: false, status: 'failed', message: '所有安装方式均未通过真实探测' };
      log(`安装 ${id} 失败：所有方式均未通过真实探测`);
    }
  }
  const finalDiscovery = discoverAll({ platform });
  for (const id of options.only)
    if (report[id].ok && !finalDiscovery.found[id].ok && report[id].status === 'installed')
      report[id].discoveryNote =
        '已安装并通过直接探测；新会话若未发现，请重载环境或查看 toolchainDir/env.json';
  const ok = options.only.every((id) => report[id].ok);
  return finish({ ok, report, plan, options, platform, log });
}

function finish({ ok, report, options, platform, log, checked = false }) {
  const lines = [checked ? 'SpecGate 环境检查：' : 'SpecGate 环境准备结果：'];
  for (const [id, entry] of Object.entries(report)) {
    const status = entry.ok
      ? entry.status === 'reused'
        ? '已复用'
        : `已安装（${entry.method || 'portable'}）`
      : '缺失';
    lines.push(
      `- ${id}：${status}${entry.version ? '，版本 ' + entry.version : ''}${entry.location ? '，位置 ' + entry.location : ''}${entry.ok ? '' : '（' + (entry.message || '未探测到') + '）'}`,
    );
  }
  lines.push(ok ? '全部就绪。' : '仍有缺项；可重跑本命令或按提示手动安装。');
  if (options.json) {
    process.stdout.write(JSON.stringify({ ok, platform, tools: report }, null, 2) + '\n');
  } else {
    log(lines.join('\n'));
  }
  return { ok, report, text: lines.join('\n') };
}

function main() {
  try {
    const result = installEnvironment({ argv: process.argv.slice(2) });
    process.exitCode = result.ok || result.help ? 0 : 1;
  } catch (error) {
    process.stderr.write((error.code ? error.code + '：' : '') + error.message + '\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main();
