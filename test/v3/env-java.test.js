import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  majorOfVersion,
  parseJavaVersion,
  parseJavacVersion,
  probeJdk,
  readJavaRequirement,
  resolveJava,
} from '../../src/v3/env/java.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-java-env-'));
}

function makeHome(parent, name) {
  const home = path.join(parent, name);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  return home;
}

/** Fake probe keyed by absolute JDK home; no real JDK/Maven is executed. */
function fakeProbe(versions) {
  return (javaHome) => {
    const version = versions.get(javaHome);
    if (!version) return { ok: false, javaHome, error: 'fake jdk missing' };
    return {
      ok: true,
      javaHome,
      javac: path.join(javaHome, 'bin', 'javac'),
      javaVersion: version,
      javacVersion: version,
    };
  };
}

test('解析常见发行版的 java/javac 版本输出', () => {
  assert.equal(parseJavaVersion('openjdk version "17.0.9" 2023-10-17'), '17.0.9');
  assert.equal(parseJavaVersion('java version "1.8.0_392"'), '1.8.0_392');
  assert.equal(parseJavaVersion('openjdk 21.0.1 2023-10-17 LTS'), '21.0.1');
  assert.equal(
    parseJavaVersion('Java(TM) SE Runtime Environment (build 1.8.0_392-b08)'),
    '1.8.0_392-b08',
  );
  assert.equal(parseJavacVersion('javac 17.0.9'), '17.0.9');
  assert.equal(parseJavacVersion('javac 1.8.0_392'), '1.8.0_392');
  assert.equal(majorOfVersion('1.8.0_392'), 8);
  assert.equal(majorOfVersion('17.0.9'), 17);
  assert.equal(majorOfVersion('temurin-21'), 21);
  assert.equal(majorOfVersion('not-a-version'), null);
});

test('readJavaRequirement 优先级：suite > .java-version > .sdkmanrc', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, '.java-version'), '11\n', 'utf8');
  fs.writeFileSync(path.join(root, '.sdkmanrc'), 'java=8.0.392-tem\n', 'utf8');
  const fromSuite = readJavaRequirement(root, { suite: { jdk: '17' } });
  assert.equal(fromSuite.requirement, '17');
  assert.equal(fromSuite.source, 'suite');
  assert.equal(readJavaRequirement(root, {}).requirement, '11');
  fs.unlinkSync(path.join(root, '.java-version'));
  assert.equal(readJavaRequirement(root, {}).requirement, '8.0.392-tem');
  assert.equal(readJavaRequirement(root, {}).source, '.sdkmanrc');
});

test('suite.jdk 优先，SDKMAN 命中请求版本', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, '.java-version'), '11\n', 'utf8');
  const javaHome11 = makeHome(root, 'jdk-11.0.21');
  const candidates = path.join(root, 'sdkman', 'candidates');
  const sdkman17 = makeHome(path.join(candidates, 'java'), '17.0.9-tem');
  const env = { PATH: '', JAVA_HOME: javaHome11, SDKMAN_CANDIDATES_DIR: candidates };

  const result = resolveJava({
    root,
    suite: { jdk: '17' },
    env,
    probe: fakeProbe(new Map([[sdkman17, '17.0.9']])),
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.source, 'suite');
  assert.equal(result.origin, 'SDKMAN');
  assert.equal(result.version, '17.0.9');
  assert.equal(result.javaHome, sdkman17);
  assert.equal(result.env.JAVA_HOME, sdkman17);
  assert.equal(result.env.PATH, `${path.join(sdkman17, 'bin')}${path.delimiter}`);
});

test('.java-version 优先于 JAVA_HOME，使用 SDKMAN 候选', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, '.java-version'), '11\n', 'utf8');
  const javaHome17 = makeHome(root, 'jdk-17.0.9');
  const candidates = path.join(root, 'sdkman', 'candidates');
  const sdkman11 = makeHome(path.join(candidates, 'java'), '11.0.21-tem');
  const env = { PATH: '', JAVA_HOME: javaHome17, SDKMAN_CANDIDATES_DIR: candidates };

  const result = resolveJava({
    root,
    env,
    probe: fakeProbe(
      new Map([
        [javaHome17, '17.0.9'],
        [sdkman11, '11.0.21'],
      ]),
    ),
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.source, '.java-version');
  assert.equal(result.origin, 'SDKMAN');
  assert.equal(result.version, '11.0.21');
});

test('.sdkmanrc 优先于 JAVA_HOME', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, '.sdkmanrc'), 'java=8.0.392-tem\n', 'utf8');
  const javaHome17 = makeHome(root, 'jdk-17.0.9');
  const candidates = path.join(root, 'sdkman', 'candidates');
  const sdkman8 = makeHome(path.join(candidates, 'java'), '8.0.392-tem');
  const env = { PATH: '', JAVA_HOME: javaHome17, SDKMAN_CANDIDATES_DIR: candidates };

  const result = resolveJava({
    root,
    env,
    probe: fakeProbe(
      new Map([
        [javaHome17, '17.0.9'],
        [sdkman8, '1.8.0_392'],
      ]),
    ),
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.source, '.sdkmanrc');
  assert.equal(result.version, '1.8.0_392');
});

test('无显式要求时使用 JAVA_HOME 并注入 JAVA_HOME/PATH', () => {
  const root = tempRoot();
  const javaHome = makeHome(root, 'jdk-17.0.9');
  const env = {
    PATH: ['/nonexistent-a', '/nonexistent-b'].join(path.delimiter),
    JAVA_HOME: javaHome,
  };

  const result = resolveJava({ root, env, probe: fakeProbe(new Map([[javaHome, '17.0.9']])) });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.source, 'JAVA_HOME');
  assert.equal(result.javaHome, javaHome);
  assert.equal(result.version, '17.0.9');
  assert.equal(result.env.JAVA_HOME, javaHome);
  assert.ok(result.env.PATH.startsWith(`${path.join(javaHome, 'bin')}${path.delimiter}`));
  assert.ok(result.env.PATH.includes('/nonexistent-a'));
  assert.equal(result.javac, path.join(javaHome, 'bin', 'javac'));
});

test('无 JAVA_HOME 时回退到系统 java', () => {
  const root = tempRoot();
  const javaHome = path.join(root, 'tools', 'jdk-21');
  const binDir = path.join(javaHome, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'java'), '', 'utf8');
  const env = { PATH: binDir };

  const result = resolveJava({
    root,
    env,
    probe: fakeProbe(new Map([[javaHome, '21.0.1']])),
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.source, 'PATH');
  assert.equal(result.origin, 'PATH');
  assert.equal(result.version, '21.0.1');
  assert.equal(result.javaHome, javaHome);
});

test('JDK 主版本不匹配返回 JDK_VERSION_MISMATCH', () => {
  const root = tempRoot();
  const javaHome = makeHome(root, 'jdk-17.0.9');
  const env = { PATH: '', JAVA_HOME: javaHome };

  const result = resolveJava({
    root,
    suite: { jdk: '17' },
    env,
    probe: fakeProbe(new Map([[javaHome, '11.0.21']])),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'JDK_VERSION_MISMATCH');
  assert.match(result.message, /JDK 17/);
  assert.match(result.message, /11\.0\.21/);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].status, 'mismatch');
});

test('JDK 缺失返回 JDK_NOT_FOUND 与已检测候选', () => {
  const emptyRoot = tempRoot();
  const empty = resolveJava({ root: emptyRoot, suite: { jdk: '17' }, env: { PATH: '' } });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, 'JDK_NOT_FOUND');
  assert.deepEqual(empty.candidates, []);
  assert.match(empty.message, /不会自动下载 JDK/);

  const root = tempRoot();
  const javaHome11 = makeHome(root, 'jdk-11.0.21');
  const env = { PATH: '', JAVA_HOME: javaHome11 };
  const notInstalled = resolveJava({
    root,
    suite: { jdk: '17' },
    env,
    probe: fakeProbe(new Map([[javaHome11, '11.0.21']])),
  });
  assert.equal(notInstalled.ok, false);
  assert.equal(notInstalled.code, 'JDK_NOT_FOUND');
  assert.equal(notInstalled.candidates.length, 1);
  assert.equal(notInstalled.candidates[0].version, '11.0.21');
  assert.match(notInstalled.message, /已检测/);
});

test('probeJdk 对不存在的 JDK 目录返回失败', () => {
  const root = tempRoot();
  const result = probeJdk(path.join(root, 'missing-jdk'), {});
  assert.equal(result.ok, false);
  assert.ok(result.error);
});
