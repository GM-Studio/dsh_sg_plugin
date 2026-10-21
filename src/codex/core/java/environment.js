import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function envHome(env) {
  return env.USERPROFILE || env.HOME || os.homedir();
}

function pathEntries(env) {
  return String(env.PATH || env.Path || '')
    .split(path.delimiter)
    .map((item) => item.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function executableNames(name, platform) {
  if (platform !== 'win32') return [name];
  return [name + '.exe', name + '.cmd', name + '.bat', name];
}

function findOnPath(name, env = process.env, platform = process.platform) {
  for (const dir of pathEntries(env)) {
    for (const candidate of executableNames(name, platform)) {
      const full = path.join(dir, candidate);
      if (exists(full)) return full;
    }
  }
  const finder = platform === 'win32' ? 'where' : 'which';
  for (const candidate of executableNames(name, platform)) {
    const result = run(finder, [candidate], { env, timeout: 5000 });
    const first = String(result.output || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => exists(line));
    if (first) return first;
  }
  return null;
}

function run(bin, args, { cwd, env = process.env, timeout = 15000 } = {}) {
  const result = spawnSync(bin, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin),
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    status: result.status,
    output: String(result.stdout || '') + String(result.stderr || ''),
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

function firstVersion(text) {
  const match = /(\d+\.\d+(?:\.\d+)?)/.exec(String(text || ''));
  return match ? match[1] : null;
}

function javaMajor(text) {
  const match = /(?:version\s+"?|javac\s+)(\d+)(?:[._](\d+))?/i.exec(String(text || ''));
  if (!match) return null;
  const major = Number(match[1]);
  if (major === 1 && match[2]) return Number(match[2]);
  return major;
}

function probeNode(file, env) {
  const r = run(file, ['-v'], { env });
  return r.status === 0 ? firstVersion(r.output) : null;
}

function probePython(file, env) {
  const r = run(file, ['-V'], { env });
  return r.status === 0 ? firstVersion(r.output) : null;
}

function probeJava(file, env) {
  const r = run(file, ['-version'], { env });
  return r.status === 0 ? { version: firstVersion(r.output), major: javaMajor(r.output) } : null;
}

function probeMaven(file, env) {
  const r = run(file, ['-v'], { env });
  return r.status === 0 ? firstVersion(r.output) : null;
}

function probeGradle(file, env) {
  const r = run(file, ['--version'], { env });
  return r.status === 0 ? firstVersion(r.output) : null;
}

function canWrite(target) {
  try {
    fs.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isElevated(platform = process.platform) {
  if (platform !== 'win32') return typeof process.getuid === 'function' && process.getuid() === 0;
  const r = run('net', ['session'], { timeout: 5000 });
  return r.status === 0;
}

async function checkUrl(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
      redirect: 'follow',
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function readConfig(env) {
  const home = envHome(env);
  const config = {};
  for (const key of [
    'JAVA_HOME',
    'MAVEN_HOME',
    'M2_HOME',
    'GRADLE_HOME',
    'NVM_HOME',
    'NVM_SYMLINK',
    'PYENV_ROOT',
    'UV_CACHE_DIR',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
  ]) {
    if (env[key]) config[key] = env[key];
  }
  const files = [
    path.join(home, '.m2', 'settings.xml'),
    path.join(home, '.npmrc'),
    path.join(home, '.config', 'pip', 'pip.conf'),
    path.join(home, 'AppData', 'Roaming', 'pip', 'pip.ini'),
    path.join(home, '.sdkmanrc'),
    path.join(home, '.tool-versions'),
    path.join(home, 'mise.toml'),
  ];
  config.files = files.filter((file) => exists(file));
  return config;
}

function readProjectConfig(root) {
  const files = ['.java-version', '.nvmrc', '.node-version', '.python-version', '.tool-versions'];
  const project = { files: [] };
  for (const name of files) {
    const full = path.join(root, name);
    if (!exists(full)) continue;
    try {
      project[name] = fs.readFileSync(full, 'utf8').trim();
      project.files.push(name);
    } catch {
      // best-effort
    }
  }
  return project;
}

export async function scanEnvironment({
  root = process.cwd(),
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  skipNetwork = false,
} = {}) {
  const tools = {
    node: [],
    npm: [],
    pnpm: [],
    yarn: [],
    python: [],
    uv: [],
    poetry: [],
    java: [],
    javac: [],
    mvn: [],
    gradle: [],
  };
  const systemNode = findOnPath('node', env, platform);
  if (systemNode && !tools.node.some((item) => item.path === systemNode)) {
    tools.node.push({ source: 'system', path: systemNode, version: probeNode(systemNode, env) });
  }
  for (const [name, binName] of [
    ['npm', 'npm'],
    ['pnpm', 'pnpm'],
    ['yarn', 'yarn'],
  ]) {
    const bin = findOnPath(binName, env, platform);
    if (bin && !tools[name].some((item) => item.path === bin)) {
      tools[name].push({
        source: 'system',
        path: bin,
        version: firstVersion(run(bin, ['-v'], { env }).output),
      });
    }
  }
  for (const binName of ['python', 'python3', 'py']) {
    const bin = findOnPath(binName, env, platform);
    if (!bin || tools.python.some((item) => item.path === bin)) continue;
    tools.python.push({ source: 'system', path: bin, version: probePython(bin, env) });
  }
  for (const binName of ['uv', 'poetry']) {
    const bin = findOnPath(binName, env, platform);
    if (bin)
      tools[binName].push({
        source: 'system',
        path: bin,
        version: firstVersion(run(bin, ['--version'], { env }).output),
      });
  }
  for (const binName of ['java', 'javac']) {
    const bin = findOnPath(binName, env, platform);
    if (bin) {
      const probe = probeJava(bin, env);
      tools[binName].push({
        source: 'system',
        path: bin,
        version: probe?.version || null,
        major: probe?.major || null,
      });
    }
  }
  for (const [name, binName] of [
    ['mvn', 'mvn'],
    ['gradle', 'gradle'],
  ]) {
    const bin = findOnPath(binName, env, platform);
    if (bin) {
      const version = name === 'mvn' ? probeMaven(bin, env) : probeGradle(bin, env);
      tools[name].push({ source: 'system', path: bin, version });
    }
  }

  let network = { skipped: true };
  if (!skipNetwork) {
    const [npm, pypi, maven] = await Promise.all([
      checkUrl('https://registry.npmjs.org/'),
      checkUrl('https://pypi.org/simple/'),
      checkUrl('https://repo.maven.apache.org/maven2/'),
    ]);
    network = { npm, pypi, maven };
  }

  return {
    schemaVersion: 1,
    scannedAt: new Date().toISOString(),
    platform,
    arch,
    tools,
    config: readConfig(env),
    project: readProjectConfig(root),
    network,
    sandbox: {
      projectWritable: canWrite(root),
      homeWritable: canWrite(envHome(env)),
      elevated: isElevated(platform),
      scope: isElevated(platform) ? 'system' : 'project',
    },
    toolchainRoot: path.join(root, '.specgate', 'toolchains'),
  };
}

export function findTool(environment, name, { major = null } = {}) {
  const list = environment?.tools?.[name] || [];
  for (const item of list) {
    if (major === null) return item;
    if (Number(item.major) === Number(major)) return item;
  }
  return null;
}

export function environmentSummary(environment) {
  if (!environment) return '环境：未扫描';
  const node = findTool(environment, 'node');
  const pnpm = findTool(environment, 'pnpm');
  const python = findTool(environment, 'python');
  const java = findTool(environment, 'java');
  return [
    'node=' + (node?.version || 'missing'),
    'pnpm=' + (pnpm?.version || 'missing'),
    'python=' + (python?.version || 'missing'),
    'java=' + (java?.version || 'missing'),
  ].join('  ');
}
