import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { findTool } from './environment.js';
import { jdkDownloadUrl, resolveMirrors } from './mirrors.js';

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function majorOf(value) {
  const match = /(\d+)/.exec(String(value || ''));
  return match ? Number(match[1]) : null;
}

function minorOf(value) {
  const match = /(\d+)\.(\d+)/.exec(String(value || ''));
  return match ? match[1] + '.' + match[2] : null;
}

function planAction(tool, version, platform, arch, targetName, mirrors) {
  let url = null;
  if (tool === 'maven') {
    url =
      mirrors.maven +
      '/org/apache/maven/apache-maven/' +
      version +
      '/apache-maven-' +
      version +
      '-bin.' +
      (platform === 'win32' ? 'zip' : 'tar.gz');
  } else if (tool === 'gradle') {
    url = mirrors.gradleDist;
  } else if (tool === 'jdk') {
    url = jdkDownloadUrl(mirrors, version, platform, arch);
  }
  return {
    tool,
    version: String(version),
    kind: 'download',
    url,
    target: '.specgate/toolchains/' + targetName,
    requiresElevation: false,
  };
}

function pickJava(environment, major) {
  const candidates = environment?.tools?.java || [];
  return candidates.find((item) => Number(item.major) === Number(major)) || null;
}

export function planProvisioning({
  environment,
  selection,
  allowDownload = true,
  mirrors = resolveMirrors(),
} = {}) {
  if (!environment) return { ok: false, code: 'ENV_MISSING', message: '缺少环境扫描结果' };
  const actions = [];
  const warnings = [];
  const tools = {};
  const platform = environment.platform;
  const arch = environment.arch;

  const sides = selection?.sides || [];
  const needsNode = sides.some((side) => ['node', 'vue', 'react'].includes(side.stack));
  const node = findTool(environment, 'node');
  if (needsNode && !node) {
    return { ok: false, code: 'NODE_MISSING', message: '未找到 Node' };
  }
  if (node) tools.node = node;
  const pnpm = findTool(environment, 'pnpm');
  if (pnpm) tools.pnpm = pnpm;
  const npm = findTool(environment, 'npm');
  if (npm) tools.npm = npm;
  const python = findTool(environment, 'python');
  if (python) tools.python = python;
  const uv = findTool(environment, 'uv');
  if (uv) tools.uv = uv;

  for (const side of sides) {
    if (side.stack === 'node' || side.stack === 'vue' || side.stack === 'react') {
      if (side.nodeVersion && majorOf(node.version) !== Number(side.nodeVersion)) {
        warnings.push('Node 请求 ' + side.nodeVersion + '，当前复用 ' + node.version);
      }
      const pm = side.packageManager || 'pnpm';
      if (pm === 'pnpm' && !pnpm) {
        if (npm && allowDownload) {
          actions.push({
            tool: 'pnpm',
            version: '11.28.5',
            kind: 'npm-install',
            target: '.specgate/toolchains/pnpm',
            requiresElevation: false,
          });
        } else if (npm) {
          warnings.push('未找到 pnpm，回退 npm');
          tools.pnpmFallback = 'npm';
        } else {
          return { ok: false, code: 'PNPM_MISSING', message: '未找到 pnpm，也没有 npm 可回退' };
        }
      }
      continue;
    }
    if (side.stack === 'python') {
      if (!python) {
        return {
          ok: false,
          code: 'PYTHON_MISSING',
          message: '未找到 Python；请安装 Python 3.10+ 或允许下载项目内 Python',
        };
      }
      if (side.pythonVersion && minorOf(python.version) !== String(side.pythonVersion)) {
        warnings.push('Python 请求 ' + side.pythonVersion + '，当前复用 ' + python.version);
      }
      if (side.packageManager === 'uv' && !uv) {
        if (allowDownload) {
          actions.push({
            tool: 'uv',
            version: 'latest',
            kind: 'pip-install',
            target: '.specgate/toolchains/uv-venv',
            requiresElevation: false,
          });
        } else {
          warnings.push('未找到 uv，回退 pip');
        }
      }
      continue;
    }
    if (side.stack === 'java') {
      const jdk = pickJava(environment, side.jdk);
      if (jdk) {
        tools.java = jdk;
      } else if (allowDownload) {
        if (!jdkDownloadUrl(mirrors, side.jdk, platform, arch)) {
          return {
            ok: false,
            code: 'JDK_MANUAL_INSTALL_REQUIRED',
            message:
              'JDK ' +
              side.jdk +
              ' 没有可解压的国内镜像包；请通过系统包管理器安装，或改用可下载的 JDK 11/13/17/21',
          };
        }
        actions.push(planAction('jdk', side.jdk, platform, arch, 'jdk-' + side.jdk, mirrors));
      } else {
        return { ok: false, code: 'JDK_MISSING', message: '未找到 JDK ' + side.jdk };
      }

      const buildTool = side.buildTool === 'gradle' ? 'gradle' : 'maven';
      const found = findTool(environment, buildTool === 'gradle' ? 'gradle' : 'mvn');
      if (found) {
        tools[buildTool] = found;
      } else if (allowDownload) {
        actions.push(
          buildTool === 'gradle'
            ? planAction('gradle', '8.14', platform, arch, 'gradle-8.14', mirrors)
            : planAction('maven', '3.9.11', platform, arch, 'apache-maven-3.9.11', mirrors),
        );
      } else {
        return {
          ok: false,
          code: 'BUILD_TOOL_MISSING',
          message: '未找到 ' + buildTool + '；请安装或允许下载',
        };
      }
    }
  }

  const unique = [];
  const seen = new Set();
  for (const action of actions) {
    const key = action.tool + ':' + action.version;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(action);
  }

  return {
    ok: true,
    tools,
    actions: unique,
    warnings,
    requiresElevation: false,
    scope: environment.sandbox?.scope || 'project',
    platform,
    arch,
    mirrors,
  };
}

export function provisionSummary(plan) {
  if (!plan || plan.ok === false) return plan?.message || '环境计划不可用';
  const reuse = [];
  if (plan.tools?.node) reuse.push('node ' + (plan.tools.node.version || ''));
  if (plan.tools?.pnpm) reuse.push('pnpm ' + (plan.tools.pnpm.version || ''));
  if (plan.tools?.python) reuse.push('python ' + (plan.tools.python.version || ''));
  if (plan.tools?.java) reuse.push('java ' + (plan.tools.java.version || ''));
  if (plan.tools?.maven) reuse.push('maven ' + (plan.tools.maven.version || ''));
  if (plan.tools?.gradle) reuse.push('gradle ' + (plan.tools.gradle.version || ''));
  if (plan.tools?.uv) reuse.push('uv ' + (plan.tools.uv.version || ''));
  const lines = [];
  if (reuse.length) lines.push('复用：' + reuse.join(' / '));
  const downloads = (plan.actions || []).filter((item) => item.kind === 'download');
  const pipInstalls = (plan.actions || []).filter((item) => item.kind === 'pip-install');
  const npmInstalls = (plan.actions || []).filter((item) => item.kind === 'npm-install');
  if (downloads.length) {
    lines.push(
      '下载：' +
        downloads.map((item) => item.tool + ' ' + item.version).join(' / ') +
        '（项目内 .specgate/toolchains）',
    );
  }
  if (pipInstalls.length) {
    lines.push('安装：' + pipInstalls.map((item) => item.tool).join(' / ') + '（pip 国内镜像）');
  }
  if (npmInstalls.length) {
    lines.push('安装：' + npmInstalls.map((item) => item.tool).join(' / ') + '（npm 淘宝镜像）');
  }
  if (plan.mirrors) {
    lines.push('镜像：' + plan.mirrors.preset + '（npm / pip / maven / gradle）');
  }
  if (plan.warnings?.length) lines.push('提示：' + plan.warnings.join('；'));
  return lines.join('\n') || '复用当前环境';
}

async function downloadFile(url, destination, signal) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15 * 60 * 1000)])
      : AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok || !response.body) {
    throw new Error('下载失败 HTTP ' + response.status + '：' + url);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = destination + '.part';
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp), { signal });
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  fs.renameSync(temp, destination);
  return destination;
}

export function archiveExtension(url, platform = process.platform) {
  const pathname = new URL(url, 'https://local.invalid').pathname;
  if (/\.(tar\.gz|tgz)$/i.test(pathname)) return '.tar.gz';
  if (/\.zip$/i.test(pathname)) return '.zip';
  return platform === 'win32' ? '.zip' : '.tar.gz';
}

function extract(archive, target, platform) {
  fs.mkdirSync(target, { recursive: true });
  let result;
  if (platform === 'win32' && /\.zip$/i.test(archive)) {
    result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath ' +
          "'" +
          archive.replace(/'/g, "''") +
          "'" +
          ' -DestinationPath ' +
          "'" +
          target.replace(/'/g, "''") +
          "'" +
          ' -Force',
      ],
      { encoding: 'utf8', timeout: 10 * 60 * 1000 },
    );
  } else if (/\.zip$/i.test(archive)) {
    result = spawnSync('unzip', ['-q', archive, '-d', target], {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
    });
  } else {
    result = spawnSync('tar', ['-xzf', archive, '-C', target], {
      encoding: 'utf8',
      timeout: 10 * 60 * 1000,
    });
  }
  if (result.status !== 0) {
    throw new Error('解压失败：' + String(result.stderr || result.stdout || '').slice(-500));
  }
}

function findExecutable(root, names, maxDepth = 6) {
  const wanted = new Set(names);
  function walk(dir, depth) {
    if (depth > maxDepth) return null;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && wanted.has(entry.name)) return full;
      if (entry.isDirectory()) {
        const found = walk(full, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(root, 0);
}

function probe(bin, args) {
  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin),
  });
  return {
    ok: result.status === 0,
    output: String(result.stdout || '') + String(result.stderr || ''),
  };
}

function executableNamesFor(tool, platform) {
  if (tool === 'jdk') return platform === 'win32' ? ['java.exe'] : ['java'];
  if (tool === 'maven') return platform === 'win32' ? ['mvn.cmd', 'mvn.bat'] : ['mvn'];
  if (tool === 'gradle') return platform === 'win32' ? ['gradle.bat'] : ['gradle'];
  return platform === 'win32' ? ['uv.exe'] : ['uv'];
}

async function provisionOne(action, root, platform, signal) {
  const target = path.join(root, action.target);
  const toolchainsRoot = path.resolve(root, '.specgate', 'toolchains');
  const relative = path.relative(toolchainsRoot, path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('工具链安装目标必须位于项目 .specgate/toolchains 内');
  const names = executableNamesFor(action.tool, platform);
  if (exists(target)) {
    const existing = findExecutable(target, names);
    if (existing) {
      return {
        ...action,
        path: existing,
        home: path.dirname(path.dirname(existing)),
        reused: true,
      };
    }
  }
  const downloads = path.join(root, '.specgate', 'toolchains', '.downloads');
  const extension = archiveExtension(action.archive || action.url, platform);
  const archive = path.join(downloads, action.tool + '-' + action.version + extension);
  if (!action.archive) await downloadFile(action.url, archive, signal);
  if (signal?.aborted) throw new Error('用户取消安装');
  extract(action.archive || archive, target, platform);
  try {
    if (!action.archive) fs.rmSync(archive, { force: true });
  } catch {
    // best-effort
  }
  const found = findExecutable(target, names);
  if (!found) throw new Error('安装后未找到可执行文件：' + action.tool);
  return { ...action, path: found, home: path.dirname(path.dirname(found)), reused: false };
}

async function provisionPnpm(root, plan) {
  const npm = plan.tools?.npm;
  if (!npm?.path) throw new Error('安装 pnpm 需要 npm');
  const target = path.join(root, '.specgate', 'toolchains', 'pnpm');
  const existing = exists(target) ? findExecutable(target, ['pnpm.cjs', 'pnpm.mjs']) : null;
  if (existing) return { path: existing, reused: true };
  fs.mkdirSync(target, { recursive: true });
  const installed = spawnSync(
    npm.path,
    [
      'install',
      '--prefix',
      target,
      'pnpm@11.28.5',
      '--registry',
      plan.mirrors.npm,
      '--no-audit',
      '--no-fund',
      '--loglevel',
      'error',
    ],
    {
      env: {
        ...process.env,
        npm_config_registry: plan.mirrors.npm,
        NPM_CONFIG_REGISTRY: plan.mirrors.npm,
      },
      encoding: 'utf8',
      timeout: 600000,
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(npm.path),
    },
  );
  if (installed.status !== 0) {
    throw new Error('pnpm 安装失败：' + String(installed.stderr || '').slice(-500));
  }
  const found = findExecutable(target, ['pnpm.cjs', 'pnpm.mjs']);
  if (!found) throw new Error('pnpm 安装后未找到 pnpm.cjs');
  return { path: found, reused: false };
}

async function provisionUv(root, plan) {
  const python = plan.tools?.python?.path;
  if (!python) throw new Error('安装 uv 需要 Python');
  const target = path.join(root, '.specgate', 'toolchains', 'uv-venv');
  const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv';
  const existing = exists(target) ? findExecutable(target, [uvName]) : null;
  if (existing) return { path: existing, reused: true };
  fs.mkdirSync(target, { recursive: true });
  const env = {
    ...process.env,
    PIP_INDEX_URL: plan.mirrors.pypi,
    PIP_TRUSTED_HOST: plan.mirrors.pypiHost,
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
  };
  const created = spawnSync(python, ['-m', 'venv', target], {
    env,
    encoding: 'utf8',
    timeout: 300000,
    windowsHide: true,
  });
  if (created.status !== 0)
    throw new Error('uv venv 创建失败：' + String(created.stderr || '').slice(-300));
  const vpy =
    process.platform === 'win32'
      ? path.join(target, 'Scripts', 'python.exe')
      : path.join(target, 'bin', 'python');
  const installed = spawnSync(
    vpy,
    [
      '-m',
      'pip',
      'install',
      'uv',
      '--index-url',
      plan.mirrors.pypi,
      '--trusted-host',
      plan.mirrors.pypiHost,
      '--disable-pip-version-check',
    ],
    { env, encoding: 'utf8', timeout: 600000, windowsHide: true },
  );
  if (installed.status !== 0) {
    throw new Error('uv 安装失败：' + String(installed.stderr || '').slice(-500));
  }
  const found = findExecutable(target, [uvName]);
  if (!found) throw new Error('uv 安装后未找到可执行文件');
  return { path: found, reused: false };
}

export async function provisionToolchain({ root, plan, platform = process.platform, signal }) {
  if (!plan || plan.ok === false) return plan;
  const tools = { ...(plan.tools || {}) };
  const completed = [];
  for (const action of plan.actions || []) {
    try {
      if (signal?.aborted) throw new Error('用户取消安装');
      const result =
        action.kind === 'pip-install'
          ? await provisionUv(root, plan)
          : action.kind === 'npm-install'
            ? await provisionPnpm(root, plan)
            : await provisionOne(action, root, platform, signal);
      completed.push({ ...action, ...result });
      if (action.tool === 'jdk') {
        tools.java = {
          path: result.path,
          home: result.home,
          source: 'project',
          version: result.reused ? 'reused' : 'provisioned',
          major: Number(action.version),
        };
      } else if (action.tool === 'maven') {
        tools.maven = { path: result.path, source: 'project', version: action.version };
      } else if (action.tool === 'gradle') {
        tools.gradle = { path: result.path, source: 'project', version: action.version };
      } else if (action.tool === 'uv') {
        tools.uv = { path: result.path, source: 'project', version: 'latest' };
      } else if (action.tool === 'pnpm') {
        tools.pnpm = {
          path: result.path,
          kind: 'node-script',
          node: tools.node?.path,
          source: 'project',
          version: action.version,
        };
      }
    } catch (error) {
      return {
        ok: false,
        code: 'TOOLCHAIN_PROVISION_FAILED',
        message:
          (error instanceof Error ? error.message : String(error)) + '（' + action.tool + '）',
        action,
        completed,
      };
    }
  }
  return { ok: true, tools, completed, warnings: plan.warnings || [] };
}

export function toolchainEnv(tools, base = process.env) {
  const env = { ...base };
  const dirs = [];
  if (tools?.node?.path) dirs.push(path.dirname(tools.node.path));
  if (tools?.python?.path) dirs.push(path.dirname(tools.python.path));
  if (tools?.java?.home) {
    env.JAVA_HOME = tools.java.home;
    dirs.push(path.join(tools.java.home, 'bin'));
  }
  if (tools?.maven?.path) {
    env.MAVEN_HOME = path.dirname(path.dirname(tools.maven.path));
    dirs.push(path.dirname(tools.maven.path));
  }
  if (tools?.gradle?.path) {
    env.GRADLE_HOME = path.dirname(path.dirname(tools.gradle.path));
    dirs.push(path.dirname(tools.gradle.path));
  }
  if (tools?.uv?.path) dirs.push(path.dirname(tools.uv.path));
  let basePath = env.PATH || env.Path || '';
  if (process.platform === 'win32') {
    const systemRoot = env.SystemRoot || env.windir || 'C:\\Windows';
    env.SystemRoot = systemRoot;
    env.windir = env.windir || systemRoot;
    env.ComSpec = env.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe');
    env.PATHEXT = env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
    const systemDirs = [path.join(systemRoot, 'System32'), systemRoot];
    basePath = [...systemDirs, basePath].filter(Boolean).join(path.delimiter);
  }
  if (dirs.length) {
    env.PATH = [...new Set(dirs)].join(path.delimiter) + path.delimiter + basePath;
    env.Path = env.PATH;
  }
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  return env;
}

export function verifyToolchain(tools, env) {
  const checks = [];
  if (tools?.java?.path) checks.push(['java', tools.java.path, ['-version']]);
  if (tools?.maven?.path) checks.push(['mvn', tools.maven.path, ['-v']]);
  if (tools?.gradle?.path) checks.push(['gradle', tools.gradle.path, ['--version']]);
  if (tools?.uv?.path) checks.push(['uv', tools.uv.path, ['--version']]);
  for (const [name, bin, args] of checks) {
    const result = probe(bin, args);
    if (!result.ok)
      return { ok: false, code: 'TOOLCHAIN_VERIFY_FAILED', message: name + ' 无法执行' };
  }
  return { ok: true };
}
