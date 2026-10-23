import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * 跨平台 JDK / Maven / Node 快速发现。
 * 只做有界扫描：环境变量、PATH、常见安装目录（Windows/Linux/macOS），
 * 不递归整盘，不修改系统，也不依赖 shell。
 */

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function envHome(env, homedir) {
  return env.USERPROFILE || env.HOME || homedir || os.homedir();
}

/** Merge persistent scopes without returning or recording unrelated secrets. */
export function mergeEnvironment({
  machine = {},
  user = {},
  env = process.env,
  platform = process.platform,
} = {}) {
  const normalize = (source) =>
    Object.fromEntries(
      Object.entries(source).map(([key, value]) => [
        platform === 'win32' ? key.toUpperCase() : key,
        value,
      ]),
    );
  const system = normalize(machine),
    personal = normalize(user),
    current = normalize(env);
  const merged = { ...system, ...personal, ...current };
  const delimiter = platform === 'win32' ? ';' : ':';
  const entries = [current.PATH, personal.PATH, system.PATH]
    .filter(Boolean)
    .flatMap((value) => String(value).split(delimiter));
  merged.PATH = [...new Set(entries)].join(delimiter);
  for (let pass = 0; pass < 4; pass++) {
    for (const key of Object.keys(merged).filter((key) =>
      /HOME$|^PATH$|^MAVEN_CMD$|^PROGRAM|APPDATA$|^USERPROFILE$/.test(key),
    )) {
      merged[key] = String(merged[key]).replace(
        /%([^%]+)%/g,
        (match, variable) => merged[variable.toUpperCase()] || match,
      );
    }
  }
  // Native Windows tools expect these conventional spellings too.
  if (platform === 'win32')
    for (const key of [
      'ProgramFiles',
      'ProgramFiles(x86)',
      'ProgramW6432',
      'ComSpec',
      'SystemRoot',
    ])
      if (merged[key.toUpperCase()]) merged[key] = merged[key.toUpperCase()];
  return merged;
}

export function readPersistentEnvironment({
  platform = process.platform,
  env = process.env,
  files,
} = {}) {
  if (platform !== 'win32') {
    const home = envHome(env);
    const scopes = files || {
      machine: ['/etc/environment'],
      user: [
        path.join(home, '.pam_environment'),
        path.join(home, '.profile'),
        path.join(home, '.bash_profile'),
        path.join(home, '.bashrc'),
      ],
    };
    const result = { machine: {}, user: {} };
    // Read simple assignments only. Never source a user's shell configuration.
    for (const scope of ['machine', 'user'])
      for (const file of scopes[scope] || []) {
        let source;
        try {
          if (fs.statSync(file).size > 256 * 1024) continue;
          source = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        for (const line of source.split(/\r?\n/)) {
          const match =
            /^\s*(?:export\s+)?(PATH|JAVA\w*HOME|JDK_HOME|MAVEN_HOME|M2_HOME|SG_JAVA_HOME|SG_MAVEN_HOME|MAVEN_CMD)\s*=\s*(.*?)\s*$/.exec(
              line,
            );
          if (!match || /`|\$\(/.test(match[2])) continue;
          let value = match[2].replace(/^(["'])(.*)\1$/, '$2');
          const variables = { ...env, ...result.machine, ...result.user };
          value = value.replace(/\$\{(\w+)\}|\$(\w+)/g, (text, a, b) => variables[a || b] || text);
          if (!value.includes('$')) result[scope][match[1]] = value.replace(/^~(?=\/|$)/, home);
        }
      }
    return result;
  }
  try {
    const script =
      "$r=@{};foreach($s in @('Machine','User')){$v=@{};[Environment]::GetEnvironmentVariables($s).GetEnumerator() | ForEach-Object {if($_.Key -match '^(PATH|JAVA.*HOME|JDK_HOME|MAVEN_HOME|M2_HOME|SG_JAVA_HOME|SG_MAVEN_HOME|MAVEN_CMD)$'){$v[$_.Key]=$_.Value}};$r[$s.ToLower()]=$v};$r | ConvertTo-Json -Compress";
    const result = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env, encoding: 'utf8', timeout: 4000, windowsHide: true },
    );
    return result.status === 0
      ? JSON.parse(result.stdout.replace(/^\uFEFF/, ''))
      : { machine: {}, user: {} };
  } catch {
    return { machine: {}, user: {} };
  }
}

export function discoverArchives({ roots = [], maxEntries = 256 } = {}) {
  const result = [];
  let inspected = 0;
  for (const root of roots.slice(0, 16)) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++inspected > maxEntries) return result;
      if (!entry.isFile() || !/\.(zip|tar\.gz|tgz|msi|exe|deb|rpm)$/i.test(entry.name)) continue;
      const tool = /(?:openjdk|temurin|jdk)/i.test(entry.name)
        ? 'jdk'
        : /(?:apache-)?maven/i.test(entry.name)
          ? 'maven'
          : null;
      if (tool)
        result.push({
          tool,
          path: path.join(root, entry.name),
          portable: /\.(zip|tar\.gz|tgz)$/i.test(entry.name),
        });
    }
  }
  return result;
}

function pathEntries(env, platform = process.platform) {
  return String(env.PATH || env.Path || '')
    .split(platform === 'win32' ? ';' : ':')
    .map((item) => item.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
}

function exe(name, platform) {
  return platform === 'win32' ? name + '.exe' : name;
}

function winCommand(bin, args) {
  const quote = (value) => {
    if (/["\r\n%&|<>^!]/.test(value)) throw new Error('Unsafe Windows command argument');
    return '"' + value + '"';
  };
  const line = '"' + [bin, ...args].map(quote).join(' ') + '"';
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', line],
    verbatim: true,
  };
}

export function probeTool(bin, args, timeout = 3000, env = process.env) {
  try {
    const spec =
      process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
        ? winCommand(bin, args)
        : { command: bin, args };
    const result = spawnSync(spec.command, spec.args, {
      encoding: 'utf8',
      timeout,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      env,
      ...(spec.verbatim ? { windowsVerbatimArguments: true } : {}),
    });
    return result.status === 0 ? String(result.stdout || '') + String(result.stderr || '') : '';
  } catch {
    return '';
  }
}

export function javaMajorOf(version) {
  const match = /^(\d+)(?:\.(\d+))?/.exec(String(version || '').trim());
  if (!match) return null;
  const major = Number(match[1]);
  if (major === 1 && match[2]) return Number(match[2]);
  return major;
}

function readRelease(home) {
  const file = path.join(home, 'release');
  if (!exists(file)) return null;
  try {
    const text = fs.readFileSync(file, 'utf8');
    const match = /JAVA_VERSION="([^"]+)"/.exec(text);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function listDirs(root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() || (entry.isSymbolicLink() && isDir(path.join(root, entry.name))),
      )
      .slice(0, 128)
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function describeJava(home, platform, probe, env, deadline) {
  if (Date.now() >= deadline) return null;
  const bin = path.join(home, 'bin');
  const javac = path.join(bin, exe('javac', platform));
  const java = path.join(bin, exe('java', platform));
  if (!exists(javac) || !exists(java)) return null;
  const compiler = probe(
    javac,
    ['-version'],
    Math.max(100, Math.min(2000, deadline - Date.now())),
    env,
  );
  const runtime = probe(
    java,
    ['-version'],
    Math.max(100, Math.min(2000, deadline - Date.now())),
    env,
  );
  const match = /(?:javac|version)\s+"?(\d+(?:\.\d+)*(?:_\d+)?)/i.exec(compiler);
  if (!match || !runtime) return null;
  const version = match[1] || readRelease(home);
  const major = javaMajorOf(version);
  return {
    home,
    java: exists(java) ? java : null,
    javac,
    version: version || 'unknown',
    major,
  };
}

function windowsProgramDirs(env) {
  return [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.ProgramW6432,
    'C:\\Program Files',
    'D:\\Program Files',
    'E:\\Program Files',
  ].filter(Boolean);
}

export function javaRoots({ env = process.env, platform = process.platform, homedir } = {}) {
  const home = envHome(env, homedir);
  if (platform === 'win32') {
    const roots = [];
    for (const base of windowsProgramDirs(env)) {
      for (const vendor of [
        'Java',
        'Eclipse Adoptium',
        'Microsoft',
        'Amazon Corretto',
        'Zulu',
        'BellSoft',
        'Semeru',
        'RedHat',
        'AdoptOpenJDK',
        'JetBrains',
      ]) {
        roots.push(path.join(base, vendor));
      }
    }
    roots.push(
      path.join(home, '.specgate', 'toolchains'),
      path.join(home, '.jdks'),
      path.join(home, '.sdkman', 'candidates', 'java'),
      path.join(
        env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
        'Programs',
        'Eclipse Adoptium',
      ),
      path.join(home, 'scoop', 'apps'),
      'C:\\ProgramData\\chocolatey\\lib',
    );
    for (const drive of ['C:', 'D:', 'E:'])
      for (const folder of ['Java', 'jdk', 'tools', 'dev', 'software'])
        roots.push(drive + '\\' + folder);
    return roots;
  }
  if (platform === 'darwin') {
    return [
      '/Library/Java/JavaVirtualMachines',
      '/System/Volumes/Data/Library/Java/JavaVirtualMachines',
      path.join(home, 'Library/Java/JavaVirtualMachines'),
      path.join(home, '.jdks'),
      path.join(home, '.sdkman/candidates/java'),
    ];
  }
  return [
    path.join(home, '.specgate', 'toolchains'),
    '/usr/lib/jvm',
    '/usr/java',
    '/opt/java',
    '/opt/jdk',
    '/usr/local/java',
    '/opt',
    path.join(home, '.jdks'),
    path.join(home, '.sdkman/candidates/java'),
  ];
}

function pushUnique(list, value, source) {
  if (!value) return;
  const resolved = path.resolve(value);
  if (!list.some((item) => item.home === resolved)) list.push({ home: resolved, source });
}

export function discoverJava({
  env = process.env,
  platform = process.platform,
  homedir,
  roots = javaRoots({ env, platform, homedir }),
  probe = probeTool,
} = {}) {
  env = mergeEnvironment({ env, platform });
  const deadline = Date.now() + 8000;
  const candidates = [];
  for (const key of [
    'SG_JAVA_HOME',
    'JAVA_HOME',
    'JDK_HOME',
    ...Object.keys(env).filter((key) => /^JAVA_?\d+_?HOME$/i.test(key)),
  ]) {
    if (env[key] && isDir(env[key])) pushUnique(candidates, env[key], 'env:' + key);
  }
  for (const dir of pathEntries(env, platform)) {
    if (exists(path.join(dir, exe('javac', platform)))) {
      let real = path.join(dir, exe('javac', platform));
      try {
        real = fs.realpathSync(real);
      } catch {
        /* Ignore inaccessible links. */
      }
      pushUnique(candidates, path.dirname(path.dirname(real)), 'path');
    }
  }
  for (const root of roots.slice(0, 128)) {
    if (!isDir(root)) continue;
    if (exists(path.join(root, 'bin', exe('javac', platform)))) pushUnique(candidates, root, 'dir');
    for (const child of listDirs(root)) {
      if (exists(path.join(child, 'bin', exe('javac', platform)))) {
        pushUnique(candidates, child, 'dir');
        continue;
      }
      for (const nested of listDirs(child)) {
        if (exists(path.join(nested, 'bin', exe('javac', platform)))) {
          pushUnique(candidates, nested, 'dir');
        }
      }
    }
  }
  const homes = candidates
    .slice(0, 32)
    .map((item) => {
      const described = describeJava(item.home, platform, probe, env, deadline);
      return described ? { ...described, source: item.source } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.major || 0) - (a.major || 0));
  return { homes, pathEntries: pathEntries(env, platform) };
}

export function mavenRoots({ env = process.env, platform = process.platform, homedir } = {}) {
  const home = envHome(env, homedir);
  if (platform === 'win32') {
    const roots = [];
    for (const base of windowsProgramDirs(env)) {
      roots.push(base, path.join(base, 'apache-maven'), path.join(base, 'Maven'));
    }
    roots.push(
      path.join(home, '.specgate', 'toolchains'),
      'C:\\apache-maven',
      'D:\\apache-maven',
      'C:\\maven',
      'D:\\maven',
      path.join(home, '.m2', 'wrapper', 'dists'),
      path.join(home, '.sdkman', 'candidates', 'maven'),
      path.join(home, 'scoop', 'apps'),
      'C:\\ProgramData\\chocolatey\\lib',
    );
    return roots;
  }
  if (platform === 'darwin') {
    return [
      '/usr/local/Cellar/maven',
      '/opt/homebrew/Cellar/maven',
      '/usr/share/maven',
      '/opt/maven',
      path.join(home, '.sdkman/candidates/maven'),
    ];
  }
  return [
    path.join(home, '.specgate', 'toolchains'),
    '/usr/share/maven',
    '/usr/share/maven3',
    '/usr/local/maven',
    '/opt/maven',
    '/opt/apache-maven',
    '/opt',
    '/usr/local',
    path.join(home, '.m2/wrapper/dists'),
    path.join(home, '.sdkman/candidates/maven'),
  ];
}

function mavenBin(home, platform) {
  const bin = path.join(home, 'bin');
  for (const name of platform === 'win32' ? ['mvn.cmd', 'mvn.bat', 'mvn.exe', 'mvn'] : ['mvn']) {
    const full = path.join(bin, name);
    if (exists(full)) return full;
  }
  return null;
}

function describeMaven(bin, probe, env) {
  const text = probe(bin, ['-v'], 3000, env);
  const match = /Apache Maven\s+([\w.-]+)/i.exec(text);
  if (!match || !/^3\.9\./.test(match[1])) return null;
  return { path: bin, home: path.dirname(path.dirname(bin)), version: match ? match[1] : null };
}

export function discoverMaven({
  env = process.env,
  platform = process.platform,
  homedir,
  roots = mavenRoots({ env, platform, homedir }),
  probe = probeTool,
} = {}) {
  env = mergeEnvironment({ env, platform });
  const deadline = Date.now() + 6000;
  const seen = new Set();
  const tryBin = (bin) => {
    if (!bin || seen.has(bin) || seen.size >= 32 || Date.now() >= deadline || !exists(bin))
      return null;
    seen.add(bin);
    return describeMaven(bin, probe, env);
  };
  const explicit = tryBin(env.MAVEN_CMD);
  if (explicit) return explicit;
  for (const key of ['SG_MAVEN_HOME', 'MAVEN_HOME', 'M2_HOME']) {
    if (env[key]) {
      const found = tryBin(mavenBin(env[key], platform));
      if (found) return found;
    }
  }
  for (const dir of pathEntries(env, platform)) {
    for (const name of platform === 'win32' ? ['mvn.cmd', 'mvn.bat', 'mvn.exe', 'mvn'] : ['mvn']) {
      const found = tryBin(path.join(dir, name));
      if (found) return found;
    }
  }
  for (const root of roots.slice(0, 128)) {
    if (!isDir(root)) continue;
    const direct = tryBin(mavenBin(root, platform));
    if (direct) return direct;
    for (const child of listDirs(root)) {
      const found = tryBin(mavenBin(child, platform));
      if (found) return found;
      for (const nested of listDirs(child)) {
        const deep = tryBin(mavenBin(nested, platform));
        if (deep) return deep;
      }
    }
  }
  return null;
}

export function discoverNode({
  env = process.env,
  platform = process.platform,
  homedir,
  fallbackNode = process.execPath,
} = {}) {
  const home = envHome(env, homedir);
  const seen = new Set();
  const candidates = [];
  for (const dir of listDirs(path.join(home, '.specgate', 'toolchains')).slice(0, 32))
    if (/^node-/.test(path.basename(dir)))
      candidates.push(path.join(dir, platform === 'win32' ? 'node.exe' : 'bin/node'));
  for (const dir of pathEntries(env, platform)) {
    if (exists(path.join(dir, exe('node', platform))))
      candidates.push(path.join(dir, exe('node', platform)));
  }
  if (platform === 'win32') {
    for (const base of windowsProgramDirs(env)) {
      candidates.push(path.join(base, 'nodejs', 'node.exe'));
    }
    if (env.NVM_SYMLINK) candidates.push(path.join(env.NVM_SYMLINK, 'node.exe'));
    candidates.push(
      path.join(
        env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
        'Programs',
        'nodejs',
        'node.exe',
      ),
    );
  } else {
    candidates.push('/usr/local/bin/node', '/usr/bin/node', '/opt/homebrew/bin/node');
  }
  if (fallbackNode) candidates.push(fallbackNode);
  for (const node of candidates) {
    if (!node || seen.has(node) || !exists(node)) continue;
    seen.add(node);
    const version = /v?([\d.]+)/.exec(probeTool(node, ['-v'], 3000, env))?.[1] || null;
    if (!version) continue;
    const [major, minor] = version.split('.').map(Number);
    if (!((major === 22 && minor >= 12) || major === 24)) continue;
    const dir = path.dirname(node);
    let npm = null;
    for (const name of platform === 'win32' ? ['npm.cmd', 'npm.exe', 'npm'] : ['npm']) {
      if (exists(path.join(dir, name))) {
        npm = path.join(dir, name);
        break;
      }
    }
    if (!npm) {
      const cli = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (exists(cli)) npm = cli;
    }
    const npmVersion = npm
      ? firstVersion(
          probeTool(
            /\.[cm]?js$/i.test(npm) ? node : npm,
            /\.[cm]?js$/i.test(npm) ? [npm, '-v'] : ['-v'],
            3000,
            env,
          ),
        )
      : null;
    if (!npmVersion) continue;
    return { node, npm, version, npmVersion };
  }
  return null;
}

function firstVersion(text) {
  return /(\d+\.\d+(?:\.\d+)?)/.exec(String(text || ''))?.[1] || null;
}

export function formatEnvironmentScan({ java, maven, node, npm } = {}) {
  const lines = ['环境扫描：'];
  const homes = (java && java.homes) || [];
  const jdkLine = homes.length
    ? homes.map((item) => 'JDK ' + (item.major || '?') + ' @ ' + item.home).join('；')
    : '未发现 JDK（已检查 JAVA_HOME / PATH / 常见安装目录）';
  lines.push('- ' + jdkLine);
  lines.push(
    '- ' + (maven ? 'Maven ' + (maven.version || '') + ' @ ' + maven.path : '未发现 Maven'),
  );
  lines.push(
    '- ' +
      (node
        ? 'Node ' + node.version + (npm ? ' / npm ' + (node.npmVersion || '') : ' / 未发现 npm')
        : '未发现 Node'),
  );
  return lines.join('\n');
}

export function installGuidance({
  jdk = null,
  needMaven = false,
  platform = process.platform,
} = {}) {
  const lines = ['安装建议：'];
  if (jdk) {
    if (platform === 'win32') {
      lines.push(
        '- JDK ' + jdk + '：winget install --id EclipseAdoptium.Temurin.' + jdk + '.JDK -e',
      );
      lines.push(
        '  或 choco install temurin' +
          jdk +
          '；也可下载 https://adoptium.net/temurin/releases/?version=' +
          jdk,
      );
    } else if (platform === 'darwin') {
      lines.push('- JDK ' + jdk + '：brew install --cask temurin@' + jdk);
    } else {
      lines.push('- JDK ' + jdk + '：sudo apt install openjdk-' + jdk + '-jdk（Debian/Ubuntu）');
      lines.push('  或 sudo dnf install java-' + jdk + '-openjdk-devel（RHEL/Fedora）');
    }
    lines.push(
      '- 安装后设置 JAVA_HOME=' + (platform === 'win32' ? '<安装目录>' : '/path/to/jdk' + jdk),
    );
  }
  if (needMaven) {
    if (platform === 'win32') {
      lines.push('- Maven：winget install --id Apache.Maven -e，或 choco install maven');
    } else if (platform === 'darwin') {
      lines.push('- Maven：brew install maven');
    } else {
      lines.push(
        '- Maven：sudo apt install maven（Debian/Ubuntu）或 sudo dnf install maven（RHEL/Fedora）',
      );
    }
  }
  lines.push('- 也可以把 JDK/Maven 解压到项目 .specgate/toolchains/ 下，/sg-verify 会自动识别。');
  return lines;
}
