import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  TOOL_IDS,
  defaultToolchainDir,
  discoverAll,
  installEnvironment,
  mavenVersionAccepted,
  methodChain,
  nodeVersionAccepted,
  parseInstallArgs,
  planTools,
  portableEnvAugment,
  portableTargets,
  portableUrls,
  renderEnvBlock,
  replaceEnvBlock,
  verifyTool,
} from '../scripts/install-env.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

test('version gates match the sg_verify toolchain requirements', () => {
  assert.equal(nodeVersionAccepted('22.12.0'), true);
  assert.equal(nodeVersionAccepted('22.11.9'), false);
  assert.equal(nodeVersionAccepted('24.14.0'), true);
  assert.equal(nodeVersionAccepted('20.19.0'), false);
  assert.equal(nodeVersionAccepted(''), false);
  assert.equal(mavenVersionAccepted('3.9.11'), true);
  assert.equal(mavenVersionAccepted('3.8.7'), false);
  assert.equal(mavenVersionAccepted('4.0.0'), false);
});

test('plan reuses discovered tools and only reinstalls on request', () => {
  const found = { git: { ok: true }, node: { ok: false }, jdk8: { ok: true } };
  const plan = planTools({ found, requests: ['git', 'node', 'jdk8'] });
  assert.deepEqual(
    plan.map((entry) => [entry.id, entry.action]),
    [
      ['git', 'reuse'],
      ['node', 'install'],
      ['jdk8', 'reuse'],
    ],
  );
  const forced = planTools({ found, requests: ['git'], reinstall: true });
  assert.equal(forced[0].action, 'install');
});

test('windows chain prefers winget then choco then portable, git has no portable fallback', () => {
  const managers = { platform: 'win32', winget: true, choco: true, elevated: true };
  assert.deepEqual(
    methodChain({ platform: 'win32', tool: 'jdk17', managers }).map((entry) => entry.method),
    ['winget', 'choco', 'portable'],
  );
  assert.deepEqual(
    methodChain({ platform: 'win32', tool: 'maven', managers }).map((entry) => entry.method),
    ['choco', 'portable'],
  );
  assert.deepEqual(
    methodChain({ platform: 'win32', tool: 'git', managers }).map((entry) => entry.method),
    ['winget', 'choco'],
  );
  const noManagers = { platform: 'win32', winget: false, choco: false };
  assert.deepEqual(
    methodChain({ platform: 'win32', tool: 'jdk8', managers: noManagers }).map(
      (entry) => entry.method,
    ),
    ['portable'],
  );
  assert.deepEqual(methodChain({ platform: 'win32', tool: 'git', managers: noManagers }), []);
});

test('linux chain uses the package manager only with privileges and falls back to portable', () => {
  const elevated = { platform: 'linux', packageManager: 'apt-get', elevated: true, sudo: false };
  const chain = methodChain({ platform: 'linux', tool: 'jdk8', managers: elevated });
  assert.deepEqual(
    chain.map((entry) => entry.method),
    ['apt-get', 'portable'],
  );
  assert.deepEqual(chain[0].packages, ['openjdk-8-jdk']);
  const unprivileged = {
    platform: 'linux',
    packageManager: 'apt-get',
    elevated: false,
    sudo: false,
  };
  assert.deepEqual(
    methodChain({ platform: 'linux', tool: 'node', managers: unprivileged }).map(
      (entry) => entry.method,
    ),
    ['portable'],
  );
  const sudo = { platform: 'linux', packageManager: 'dnf', elevated: false, sudo: true };
  assert.deepEqual(
    methodChain({ platform: 'linux', tool: 'maven', managers: sudo }).map((entry) => entry.method),
    ['dnf', 'portable'],
  );
  assert.deepEqual(
    methodChain({ platform: 'linux', tool: 'git', managers: unprivileged }).map(
      (entry) => entry.method,
    ),
    [],
  );
});

test('portable urls target Adoptium, Apache CDN with archive fallback, and nodejs.org', () => {
  const jdk = portableUrls({ tool: 'jdk8', platform: 'linux', arch: 'x64' });
  assert.equal(jdk.length, 1);
  assert.match(
    jdk[0],
    /^https:\/\/api\.adoptium\.net\/v3\/binary\/latest\/8\/ga\/linux\/jdk\/x64\//,
  );
  const jdkWinArm = portableUrls({ tool: 'jdk21', platform: 'win32', arch: 'arm64' });
  assert.match(jdkWinArm[0], /\/21\/ga\/windows\/jdk\/aarch64\//);
  const maven = portableUrls({ tool: 'maven', platform: 'win32', arch: 'x64' });
  assert.equal(maven.length, 2);
  assert.match(maven[0], /^https:\/\/dlcdn\.apache\.org\/.*-bin\.zip$/);
  assert.match(maven[1], /^https:\/\/archive\.apache\.org\/.*-bin\.zip$/);
  const node = portableUrls({ tool: 'node', platform: 'linux', arch: 'x64' });
  assert.match(node[0], /^https:\/\/nodejs\.org\/dist\/v22\..*linux-x64\.tar\.gz$/);
  assert.deepEqual(portableUrls({ tool: 'git', platform: 'linux', arch: 'x64' }), []);
});

test('portable targets keep the default jdk dir discoverable and sandbox custom dirs', () => {
  const home = path.join(ROOT, 'test', 'fixtures', 'fake-home');
  const defaultDir = defaultToolchainDir(home);
  const defaults = portableTargets({
    tool: 'jdk17',
    platform: 'linux',
    toolchainDir: defaultDir,
    homedir: home,
  });
  assert.equal(defaults.baseDir, path.join(home, '.jdks'));
  assert.equal(defaults.dirName, 'temurin-17');
  const sandbox = portableTargets({
    tool: 'jdk17',
    platform: 'linux',
    toolchainDir: path.join(home, 'sandbox'),
    homedir: home,
  });
  assert.equal(sandbox.baseDir, path.join(home, 'sandbox', 'jdks'));
  const maven = portableTargets({
    tool: 'maven',
    platform: 'win32',
    toolchainDir: defaultDir,
    homedir: home,
  });
  assert.equal(maven.baseDir, defaultDir);
  assert.match(maven.dirName, /^apache-maven-3\.9\./);
  assert.equal(
    portableTargets({ tool: 'git', platform: 'win32', toolchainDir: defaultDir, homedir: home }),
    null,
  );
});

test('portable env augment exposes maven and node through existing discovery keys', () => {
  const mavenHome = path.join(path.sep + 'opt', 'tc', 'apache-maven-3.9.11');
  const maven = portableEnvAugment('maven', mavenHome, { platform: 'linux' });
  assert.equal(maven.variables.SG_MAVEN_HOME, mavenHome);
  assert.deepEqual(maven.pathPrepend, [path.join(mavenHome, 'bin')]);
  const nodeWin = portableEnvAugment('node', 'C:\\tc\\node-current', { platform: 'win32' });
  assert.deepEqual(nodeWin.pathPrepend, ['C:\\tc\\node-current']);
  const nodeHome = path.join(path.sep + 'home', 'u', '.specgate', 'toolchains', 'node-current');
  const nodeLinux = portableEnvAugment('node', nodeHome, { platform: 'linux' });
  assert.deepEqual(nodeLinux.pathPrepend, [path.join(nodeHome, 'bin')]);
  assert.deepEqual(
    portableEnvAugment('jdk8', path.join(path.sep + 'home', 'u', '.jdks', 'temurin-8'), {
      platform: 'linux',
    }),
    {
      variables: {},
      pathPrepend: [],
    },
  );
});

test('env block rendering and replacement stay inside managed markers', () => {
  const linux = renderEnvBlock({
    entries: { SG_MAVEN_HOME: '/opt/maven' },
    pathPrepend: ['/opt/maven/bin'],
    platform: 'linux',
  });
  assert.match(
    linux,
    /^# specgate-env:begin\nexport SG_MAVEN_HOME="\/opt\/maven"\nexport PATH="\/opt\/maven\/bin:\$PATH"\n# specgate-env:end$/,
  );
  const windows = renderEnvBlock({
    entries: { SG_MAVEN_HOME: 'C:\\maven' },
    pathPrepend: ['C:\\maven\\bin'],
    platform: 'win32',
  });
  assert.match(windows, /\$env:SG_MAVEN_HOME = 'C:\\maven'/);
  assert.match(windows, /\$env:PATH = 'C:\\maven\\bin;' \+ \$env:PATH/);
  const appended = replaceEnvBlock('export OTHER=1\n', linux);
  assert.match(appended, /^export OTHER=1\n\n# specgate-env:begin/);
  const replaced = replaceEnvBlock(
    appended,
    renderEnvBlock({ entries: { SG_MAVEN_HOME: '/new' }, pathPrepend: [], platform: 'linux' }),
  );
  assert.match(replaced, /export SG_MAVEN_HOME="\/new"/);
  assert.doesNotMatch(replaced, /\/opt\/maven/);
  assert.match(replaced, /^export OTHER=1/);
  assert.equal(replaced.match(/# specgate-env:begin/g).length, 1);
});

test('argument parsing validates tools, methods and absolute toolchain dirs', () => {
  const defaults = parseInstallArgs([]);
  assert.deepEqual(defaults.only, TOOL_IDS);
  assert.equal(defaults.method, 'auto');
  assert.equal(defaults.envWrite, true);
  const parsed = parseInstallArgs([
    '--check',
    '--json',
    '--reinstall',
    '--no-env-write',
    '--only=jdk8, maven,jdk8',
    '--method=portable',
    '--toolchain-dir=/tmp/sg-env',
  ]);
  assert.equal(parsed.check, true);
  assert.equal(parsed.json, true);
  assert.equal(parsed.reinstall, true);
  assert.equal(parsed.envWrite, false);
  assert.deepEqual(parsed.only, ['jdk8', 'maven']);
  assert.equal(parsed.method, 'portable');
  assert.equal(parsed.toolchainDir, '/tmp/sg-env');
  assert.throws(() => parseInstallArgs(['--only=jdk9']), /未知工具/);
  assert.throws(() => parseInstallArgs(['--method=brew']), /未知安装方式/);
  assert.throws(() => parseInstallArgs(['--toolchain-dir=relative']), /绝对路径/);
  assert.throws(() => parseInstallArgs(['--surprise']), /未知参数/);
});

test('unknown tools verify as not ok without touching the system', () => {
  const result = verifyTool('docker');
  assert.equal(result.ok, false);
  assert.match(result.message, /未知工具/);
});

test('help exits successfully and runs no discovery or install', () => {
  let logged = 0;
  const result = installEnvironment({
    argv: ['--help'],
    log: () => {
      logged += 1;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.help, true);
  assert.equal(logged, 0);
});

test('discovery reports real facts for the current machine without writing', () => {
  const { found } = discoverAll({});
  for (const id of TOOL_IDS) assert.equal(typeof found[id].ok, 'boolean', id);
  // git 与 node 在本仓库的开发环境中必然可用；断言真实探测结果而非固定版本。
  assert.equal(found.git.ok, true);
  assert.match(found.git.version, /^\d+\./);
});

test('package manifest does not ship superseded external installer prototypes', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const entry of [
    'scripts/install-env.mjs',
    'scripts/install-env.ps1',
    'scripts/install-env.sh',
  ])
    assert.equal(manifest.files.includes(entry), false, entry + ' must not be packaged');
  assert.equal(manifest.scripts['env:install'], undefined);
  assert.equal(manifest.scripts['env:check'], undefined);
});
