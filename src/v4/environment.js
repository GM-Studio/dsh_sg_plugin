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
  const r = run(file, ['-version'], { env, timeout: 3000 });
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

function findBundled(env) {
  const root = path.join(envHome(env), '.dsh', 'dsh-runtimes');
  const result = { root, node: null, pnpm: null, python: null };
  if (!exists(root)) return result;
  let runtimes = [];
  try {
    runtimes = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return result;
  }
  for (const entry of runtimes.reverse()) {
    const deps = path.join(root, entry.name, 'dependencies');
    const node = path.join(deps, 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'node');
    const pnpm = path.join(deps, 'pnpm', 'bin', 'pnpm.cjs');
    const python = path.join(
      deps,
      'python',
      process.platform === 'win32' ? 'python.exe' : 'bin/python3',
    );
    if (!result.node && exists(node)) {
      result.node = {
        source: 'dsh',
        path: node,
        version: probeNode(node, env),
      };
    }
    if (!result.pnpm && exists(pnpm)) {
      result.pnpm = {
        source: 'dsh',
        path: pnpm,
        kind: 'node-script',
        node: result.node?.path || node,
        version: result.node
          ? (run(result.node.path, [pnpm, '--version'], { env }).output || '').trim()
          : null,
      };
    }
    if (!result.python && exists(python)) {
      result.python = {
        source: 'dsh',
        path: python,
        version: probePython(python, env),
      };
    }
  }
  return result;
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

function javaExecutableNames(platform) {
  return platform === 'win32' ? ['java.exe'] : ['java'];
}

function javaHomeCandidates(root, env, platform) {
  const homes = [];
  const add = (value) => {
    const home = String(value || '')
      .trim()
      .replace(/^"|"$/g, '');
    if (home) homes.push(home);
  };
  add(env.SG_JAVA_HOME);
  add(env.JAVA_HOME);
  add(env.JDK_HOME);
  const local = path.join(root, '.specgate', 'toolchains');
  const parentLocal = path.join(root, '..', '.specgate', 'toolchains');
  for (const base of [local, parentLocal]) {
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory() && /^jdk/i.test(entry.name))
          homes.push(path.join(base, entry.name));
      }
    } catch {
      // no local toolchain
    }
  }
  const home = envHome(env);
  const known = [];
  if (platform === 'win32') {
    const pf = env.ProgramFiles || env.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const vendors = [
      'Java',
      'Eclipse Adoptium',
      'Eclipse Foundation',
      'Zulu',
      'Amazon Corretto',
      'Microsoft',
      'BellSoft',
      'Semeru',
      'SapMachine',
      'AdoptOpenJDK',
    ];
    for (const base of [pf, pf86]) {
      for (const vendor of vendors) known.push(path.join(base, vendor));
    }
    known.push(path.join(home, '.jdks'));
    known.push(path.join(home, '.sdkman', 'candidates', 'java'));
    known.push(path.join(home, 'scoop', 'apps', 'temurin8-jdk'));
  } else {
    known.push('/usr/lib/jvm', '/usr/java', '/opt/java', '/Library/Java/JavaVirtualMachines');
    known.push(path.join(home, '.sdkman', 'candidates', 'java'));
    known.push(path.join(home, '.jdks'));
  }
  for (const base of known) {
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) homes.push(path.join(base, entry.name));
        else if (platform === 'darwin' && entry.name.endsWith('.jdk'))
          homes.push(path.join(base, entry.name, 'Contents', 'Home'));
      }
    } catch {
      // known directory absent
    }
  }
  if (platform === 'darwin') known.push('/Library/Java/JavaVirtualMachines');
  return [...new Set(homes)];
}

function javaCandidatePaths(root, env, platform) {
  const names = javaExecutableNames(platform);
  const candidates = [];
  const pushHome = (home) => {
    if (!home) return;
    for (const name of names) candidates.push(path.join(home, 'bin', name));
  };
  for (const home of javaHomeCandidates(root, env, platform)) pushHome(home);
  const onPath = findOnPath('java', env, platform);
  if (onPath) candidates.push(onPath);
  return [...new Set(candidates)].slice(0, 24);
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
  const bundled = findBundled(env);
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
  if (bundled.node) tools.node.push(bundled.node);
  if (bundled.pnpm) tools.pnpm.push(bundled.pnpm);
  if (bundled.python) tools.python.push(bundled.python);

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
  for (const bin of javaCandidatePaths(root, env, platform)) {
    if (!exists(bin)) continue;
    const probe = probeJava(bin, env);
    if (!probe) continue;
    if (tools.java.some((item) => item.path === bin)) continue;
    const home = path.dirname(path.dirname(bin));
    tools.java.push({
      source: 'scan',
      path: bin,
      home,
      version: probe.version || null,
      major: probe.major || null,
    });
    const javac =
      platform === 'win32' ? path.join(home, 'bin', 'javac.exe') : path.join(home, 'bin', 'javac');
    if (exists(javac) && !tools.javac.some((item) => item.path === javac)) {
      const jc = run(javac, ['-version'], { env, timeout: 3000 });
      tools.javac.push({
        source: 'scan',
        path: javac,
        home,
        version: firstVersion(jc.output),
        major: javaMajor(jc.output),
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
    bundled,
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
