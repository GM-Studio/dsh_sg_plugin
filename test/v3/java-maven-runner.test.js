import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMavenSuite, runOneSuite } from '../../src/v3/suites.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-maven-'));
}

function fakeJava() {
  return {
    ok: true,
    version: '17',
    javaHome: '/fake/jdk',
    javac: '/fake/jdk/bin/javac',
    source: 'fake',
    origin: 'fake',
    env: process.env,
  };
}

function fakeMaven(script) {
  return {
    ok: true,
    bin: process.execPath,
    argsPrefix: [script],
    version: 'fake',
    wrapper: false,
  };
}

function writeRunner(root, body) {
  const file = path.join(root, 'fake-maven.mjs');
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

test('runMavenSuite 执行并解析 JUnit/JaCoCo', () => {
  const root = tempRoot();
  const script = writeRunner(
    root,
    `import fs from 'node:fs';
import path from 'node:path';
fs.mkdirSync('target/surefire-reports', { recursive: true });
fs.writeFileSync('target/surefire-reports/TEST-A.xml',
  '<testsuite><testcase classname="com.example.ATest" name="ok[AC-001]"/></testsuite>');
fs.mkdirSync('target/site/jacoco', { recursive: true });
fs.writeFileSync('target/site/jacoco/jacoco.xml',
  '<report><counter type="LINE" missed="1" covered="9"/><counter type="BRANCH" missed="1" covered="3"/></report>');
`,
  );
  const result = runMavenSuite({
    suite: { id: 'backend', kind: 'maven', cwd: '.', goals: ['verify'] },
    worktree: root,
    root,
    resolveJavaFn: fakeJava,
    resolveMavenFn: () => fakeMaven(script),
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.report.cases.length, 1);
  assert.equal(result.report.cases[0].ac[0], 'AC-001');
  assert.equal(result.coverage.lines.rate, 0.9);
  assert.equal(result.coverage.branches.rate, 0.75);
  assert.equal(result.java.version, '17');
});

test('runMavenSuite JDK 失败返回错误码', () => {
  const root = tempRoot();
  const result = runMavenSuite({
    suite: { id: 'backend', kind: 'maven', cwd: '.', goals: ['verify'] },
    worktree: root,
    root,
    resolveJavaFn: () => ({ ok: false, code: 'JDK_NOT_FOUND', message: 'no jdk' }),
    resolveMavenFn: () => fakeMaven('x'),
  });
  assert.equal(result.code, 'JDK_NOT_FOUND');
  assert.equal(result.exitCode, -1);
});

test('runMavenSuite 构建失败返回 BUILD_FAILED', () => {
  const root = tempRoot();
  const script = writeRunner(root, 'process.exit(1);\n');
  const result = runMavenSuite({
    suite: { id: 'backend', kind: 'maven', cwd: '.', goals: ['verify'] },
    worktree: root,
    root,
    resolveJavaFn: fakeJava,
    resolveMavenFn: () => fakeMaven(script),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.code, 'BUILD_FAILED');
});

test('runMavenSuite 报告缺失返回 TEST_REPORT_MISSING', () => {
  const root = tempRoot();
  const script = writeRunner(root, 'process.exit(0);\n');
  const result = runMavenSuite({
    suite: { id: 'backend', kind: 'maven', cwd: '.', goals: ['verify'] },
    worktree: root,
    root,
    resolveJavaFn: fakeJava,
    resolveMavenFn: () => fakeMaven(script),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.code, 'TEST_REPORT_MISSING');
});

test('runOneSuite 接入 maven runner 并暴露覆盖率', () => {
  const root = tempRoot();
  const source = path.join(root, 'src', 'test', 'java', 'com', 'example', 'ATest.java');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'class ATest {}', 'utf8');
  const result = runOneSuite({
    suite: { id: 'backend', kind: 'maven', cwd: '.', goals: ['verify'] },
    root,
    worktree: root,
    acs: new Set(['AC-001']),
    knownAcs: new Set(['AC-001']),
    changedFiles: [],
    requireChangedFiles: false,
    plan: { mapping: { requirements: [{ ac: 'AC-001', suite: 'backend' }] } },
    mavenRunner: () => ({
      exitCode: 0,
      stderr: '',
      report: {
        schemaVersion: 1,
        runner: 'maven',
        suite: 'backend',
        cases: [
          {
            id: 'TC-001',
            ac: ['AC-001'],
            status: 'pass',
            file: 'src/test/java/com/example/ATest.java',
          },
        ],
      },
      coverage: {
        lines: { covered: 9, missed: 1, rate: 0.9 },
        branches: { covered: 4, missed: 1, rate: 0.8 },
      },
      java: { version: '17', javaHome: '/fake', source: 'fake' },
      maven: { bin: 'mvnw', version: '3.9.11', wrapper: true },
    }),
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.coverage.lines.rate, 0.9);
  assert.equal(result.runtime.java.version, '17');
  assert.equal(result.runtime.maven.wrapper, true);
});
