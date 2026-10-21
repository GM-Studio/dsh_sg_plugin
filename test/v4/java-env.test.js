import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverJava,
  discoverMaven,
  discoverNode,
  formatEnvironmentScan,
  installGuidance,
  javaMajorOf,
  javaRoots,
  mavenRoots,
  mergeEnvironment,
  discoverArchives,
  readPersistentEnvironment,
} from '../../src/v4/java-env.js';

const win = process.platform === 'win32';
const exe = (name) => (win ? name + '.exe' : name);
const fixtureProbe = (bin) =>
  /mvn/.test(bin)
    ? 'Apache Maven 3.9.11'
    : 'javac ' +
      JSON.parse(
        fs
          .readFileSync(path.join(path.dirname(path.dirname(bin)), 'release'), 'utf8')
          .split('=')[1],
      );

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function fakeJdk(root, name, version) {
  const home = path.join(root, name);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', exe('javac')), '');
  fs.writeFileSync(path.join(home, 'bin', exe('java')), '');
  fs.writeFileSync(path.join(home, 'release'), 'JAVA_VERSION="' + version + '"\n');
  return home;
}

function fakeMaven(root, name) {
  const home = path.join(root, name);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', win ? 'mvn.cmd' : 'mvn'), '');
  return home;
}

test('javaMajorOf parses legacy and modern versions', () => {
  assert.equal(javaMajorOf('1.8.0_401'), 8);
  assert.equal(javaMajorOf('17.0.9'), 17);
  assert.equal(javaMajorOf('21'), 21);
  assert.equal(javaMajorOf('unknown'), null);
});

test('Linux persistent assignments are read without executing shell code', (t) => {
  const root = temp(t);
  const system = path.join(root, 'environment');
  const profile = path.join(root, 'profile');
  fs.writeFileSync(system, 'JAVA_HOME="/opt/java17"\nMAVEN_HOME=/opt/maven\n');
  fs.writeFileSync(
    profile,
    'export JAVA_HOME="$HOME/jdk21"\nexport MAVEN_HOME=$(touch /tmp/never-execute)\nexport PATH="$JAVA_HOME/bin:$PATH"\n',
  );
  const result = readPersistentEnvironment({
    platform: 'linux',
    env: { HOME: root, PATH: '/usr/bin' },
    files: { machine: [system], user: [profile] },
  });
  assert.equal(result.machine.MAVEN_HOME, '/opt/maven');
  assert.equal(result.user.JAVA_HOME, root + '/jdk21');
  assert.equal(result.user.MAVEN_HOME, undefined);
  assert.match(result.user.PATH, /jdk21\/bin:\/usr\/bin/);
});

test('Windows PATH delimiter and environment keys follow the target platform', (t) => {
  const root = temp(t);
  const home = fakeJdk(root, 'java21', '21.0.1');
  // Simulate Windows executables even when the test runs on Linux.
  fs.writeFileSync(path.join(home, 'bin', 'java.exe'), '');
  fs.writeFileSync(path.join(home, 'bin', 'javac.exe'), '');
  const scan = discoverJava({
    platform: 'win32',
    env: { Path: path.join(home, 'bin') + ';C:\\missing' },
    roots: [],
    probe: () => 'javac 21.0.1',
  });
  assert.equal(scan.homes[0]?.home, home);
  assert.equal(
    mergeEnvironment({
      machine: { JAVA_HOME: 'system', Path: 'sys' },
      user: { JAVA_HOME: 'user', PATH: 'userbin' },
      env: { java_home: 'process', Path: 'proc' },
      platform: 'win32',
    }).JAVA_HOME,
    'process',
  );
});

test('invalid Maven candidates are skipped and probes use the selected JDK environment', (t) => {
  const root = temp(t);
  const broken = fakeMaven(root, 'broken');
  const working = fakeMaven(root, 'working');
  const seen = [];
  const found = discoverMaven({
    env: {
      PATH: path.join(broken, 'bin') + path.delimiter + path.join(working, 'bin'),
      JAVA_HOME: 'selected',
    },
    roots: [],
    probe: (bin, args, timeout, env) => {
      seen.push(env.JAVA_HOME);
      return bin.includes('working') ? 'Apache Maven 3.9.11' : '';
    },
  });
  assert.equal(found?.home, working);
  assert.deepEqual(seen, ['selected', 'selected']);
});

test('archive matching is bounded and distinguishes portable packages from installers', (t) => {
  const root = temp(t);
  for (const name of [
    'OpenJDK8U-jdk_x64_windows_hotspot_8u504.zip',
    'apache-maven-3.9.11-bin.tar.gz',
    'jdk-21.msi',
    'unrelated.zip',
  ])
    fs.writeFileSync(path.join(root, name), '');
  const archives = discoverArchives({ roots: [root] });
  assert.equal(archives.length, 3);
  assert.equal(archives.find((item) => item.path.endsWith('.msi')).portable, false);
});

test('discovery finds JDKs in non-standard folders such as Jdk8/Jdk17', (t) => {
  const root = temp(t);
  fakeJdk(root, 'Jdk8', '1.8.0_401');
  fakeJdk(root, 'Jdk17', '17.0.9');
  fs.mkdirSync(path.join(root, 'not-a-jdk', 'bin'), { recursive: true });

  const scan = discoverJava({
    platform: process.platform,
    env: { PATH: '', USERPROFILE: root, HOME: root },
    homedir: root,
    roots: [root],
    probe: fixtureProbe,
  });
  assert.deepEqual(
    scan.homes.map((item) => item.major),
    [17, 8],
  );
  assert.ok(scan.homes.every((item) => item.javac && item.home));
  assert.ok(scan.homes.every((item) => !item.home.endsWith('not-a-jdk')));
});

test('discovery honors JAVA_HOME and project toolchains', (t) => {
  const root = temp(t);
  const jdk = fakeJdk(root, 'custom-jdk', '21.0.1');
  const scan = discoverJava({
    platform: process.platform,
    env: { PATH: '', JAVA_HOME: jdk },
    homedir: root,
    roots: [],
    probe: fixtureProbe,
  });
  assert.equal(scan.homes.length, 1);
  assert.equal(scan.homes[0].major, 21);
  assert.equal(scan.homes[0].source, 'env:JAVA_HOME');
});

test('Maven discovery checks env, PATH and common folders', (t) => {
  const root = temp(t);
  const maven = fakeMaven(root, 'apache-maven-3.9.11');
  const scan = discoverMaven({
    platform: process.platform,
    env: { PATH: '', MAVEN_HOME: maven },
    homedir: root,
    roots: [],
    probe: fixtureProbe,
  });
  assert.equal(scan.home, maven);
  assert.equal(scan.path, path.join(maven, 'bin', win ? 'mvn.cmd' : 'mvn'));
  const byRoot = discoverMaven({
    platform: process.platform,
    env: { PATH: '' },
    homedir: root,
    roots: [root],
    probe: fixtureProbe,
  });
  assert.equal(byRoot.path, scan.path);
  assert.equal(
    discoverMaven({ platform: process.platform, env: { PATH: '' }, homedir: root, roots: [] }),
    null,
  );
});

test('Node discovery reuses the current runtime and reports npm when present', () => {
  const scan = discoverNode({ env: { PATH: '' }, fallbackNode: process.execPath });
  if (Number(process.versions.node.split('.')[0]) === 20) {
    assert.equal(scan, null, 'Node 20 can host the plugin but cannot build this Vite template');
    return;
  }
  assert.ok(scan);
  assert.equal(scan.node, process.execPath);
  assert.match(scan.version, /^\d+\./);
});

test('environment scan and guidance cover Windows and Linux installation paths', () => {
  const text = formatEnvironmentScan({
    java: { homes: [{ major: 8, home: 'C:\\Java\\Jdk8' }] },
    maven: null,
    node: { version: '24.1.0', npmVersion: '11.0.0' },
    npm: 'npm.cmd',
  });
  assert.match(text, /JDK 8 @ C:\\Java\\Jdk8/);
  assert.match(text, /未发现 Maven/);
  assert.match(text, /Node 24\.1\.0 \/ npm 11\.0\.0/);

  const windows = installGuidance({ jdk: 8, needMaven: true, platform: 'win32' }).join('\n');
  assert.match(windows, /winget install/);
  assert.match(windows, /temurin8/);
  const linux = installGuidance({ jdk: 17, needMaven: true, platform: 'linux' }).join('\n');
  assert.match(linux, /apt install openjdk-17-jdk/);
  assert.match(linux, /apt install maven/);
  const mac = installGuidance({ jdk: 21, needMaven: false, platform: 'darwin' }).join('\n');
  assert.match(mac, /brew install --cask temurin@21/);
  assert.ok(
    javaRoots({ platform: 'linux', env: {}, homedir: '/home/dev' }).includes('/usr/lib/jvm'),
  );
  assert.ok(
    mavenRoots({ platform: 'linux', env: {}, homedir: '/home/dev' }).includes('/usr/share/maven'),
  );
});
