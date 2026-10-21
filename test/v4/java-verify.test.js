import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyJavaProject } from '../../src/v4/java-verify.js';

const exe = (name) => (process.platform === 'win32' ? name + '.exe' : name);

function writeJava(root, name, version) {
  const home = path.join(root, name);
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'bin', exe('javac')), '');
  fs.writeFileSync(path.join(home, 'bin', exe('java')), '');
  fs.writeFileSync(path.join(home, 'release'), 'JAVA_VERSION="' + version + '"' + '\n');
  return home;
}

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-verify-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('verify rejects a non-Java workspace without writing', async (t) => {
  const root = temp(t);
  const result = await verifyJavaProject({ root, env: { PATH: '' } });
  assert.equal(result.code, 'E_NOT_JAVA_PROJECT');
  assert.equal(fs.existsSync(path.join(root, '.specgate', 'verify-report.json')), false);
});

test('verify blocks honestly when the local toolchain is missing', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'monorepo.json'),
    JSON.stringify({
      version: 1,
      topology: 'monorepo',
      stack: 'java-vue',
      preset: 'jdk17-boot3.5',
    }),
  );
  const result = await verifyJavaProject({
    root,
    env: { PATH: '' },
    scan: { javaRoots: [], mavenRoots: [], homedir: root },
    install: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'VERIFY_BLOCKED');
  assert.match(result.message, /JDK 17/);
  const report = JSON.parse(
    fs.readFileSync(path.join(root, '.specgate', 'verify-report.json'), 'utf8'),
  );
  assert.equal(report.status, 'blocked');
  assert.equal(report.preset, 'jdk17-boot3.5');
  assert.deepEqual(report.stages, []);
  assert.match(result.message, /安装建议/);
  assert.equal(report.reconciliation.expected, 7);
  assert.equal(report.reconciliation.notRun, 7);
});

test('blocked retry invalidates previous success and writes a distinct run report', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, '.specgate'));
  fs.writeFileSync(
    path.join(root, '.specgate/monorepo.json'),
    JSON.stringify({ stack: 'java-vue', preset: 'jdk17-boot3.5' }),
  );
  fs.writeFileSync(
    path.join(root, '.specgate/init-report.json'),
    JSON.stringify({
      schemaVersion: 2,
      phase: 'SMOKE_PASSED',
      initializationComplete: true,
      verification: { ok: true },
    }),
  );
  const run = () =>
    verifyJavaProject({
      root,
      env: { PATH: '' },
      scan: { javaRoots: [], mavenRoots: [], homedir: root },
      install: false,
    });
  const first = await run();
  const second = await run();
  assert.notEqual(first.report.runId, second.report.runId);
  const init = JSON.parse(fs.readFileSync(path.join(root, '.specgate/init-report.json')));
  assert.equal(init.initializationComplete, false);
  assert.equal(init.phase, 'VERIFY_BLOCKED');
  assert.equal(init.verification.runId, second.report.runId);
});

test('missing toolchain asks for custom paths before installation and respects cancellation', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, '.specgate'));
  fs.writeFileSync(
    path.join(root, '.specgate/monorepo.json'),
    JSON.stringify({ stack: 'java-vue', preset: 'jdk8-boot2.7' }),
  );
  let asked = 0;
  const result = await verifyJavaProject({
    root,
    env: { PATH: '' },
    scan: { javaRoots: [], mavenRoots: [], homedir: root },
    install: true,
    userQuestions: {
      ask: async ({ questions }) => {
        asked++;
        assert.match(questions[0].question, /自定义/);
        return { answers: [{ selected: ['取消'] }] };
      },
    },
  });
  assert.equal(asked, 1);
  assert.equal(result.code, 'VERIFY_CANCELLED');
  assert.equal(fs.existsSync(path.join(root, '.specgate/toolchains')), false);
});

test('preflight discovers a non-PATH Jdk8 folder and still blocks for JDK 17', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'monorepo.json'),
    JSON.stringify({
      version: 1,
      topology: 'monorepo',
      stack: 'java-vue',
      preset: 'jdk17-boot3.5',
    }),
  );
  writeJava(root, 'Jdk8', '1.8.0_401');
  const progress = [];
  const result = await verifyJavaProject({
    root,
    env: { PATH: '' },
    install: false,
    scan: { javaRoots: [root], mavenRoots: [], homedir: root, probe: () => 'javac 1.8.0_401' },
    onProgress: (event) => progress.push(event),
  });
  assert.equal(result.code, 'VERIFY_BLOCKED');
  assert.match(result.message, /JDK 8 @/);
  assert.match(result.message, /缺少本地验证前置条件：JDK 17、Maven/);
  assert.equal(result.report.environment.java[0].major, 8);
  assert.equal(result.report.environment.java[0].source, 'dir');
  assert.match(result.report.guidance, /安装建议/);
  assert.equal(progress[0].phase, 'scan');
  assert.equal(fs.existsSync(path.join(root, '.specgate', 'verify-report.json')), true);
});

test('preflight fails closed instead of downloading when install is disabled', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'monorepo.json'),
    JSON.stringify({
      version: 1,
      topology: 'monorepo',
      stack: 'java-vue',
      preset: 'jdk21-boot3.5',
    }),
  );
  const result = await verifyJavaProject({
    root,
    env: { PATH: '' },
    install: false,
    scan: { javaRoots: [], mavenRoots: [], homedir: root },
  });
  assert.equal(result.code, 'VERIFY_BLOCKED');
  assert.deepEqual(result.report.environment.provisioned, []);
  assert.equal(fs.existsSync(path.join(root, '.specgate', 'toolchains')), false);
});

test('custom installation paths are validated, persisted and reused without downloading', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, '.specgate'));
  fs.mkdirSync(path.join(root, 'backend'));
  fs.writeFileSync(
    path.join(root, '.specgate/monorepo.json'),
    JSON.stringify({ stack: 'java-vue', preset: 'jdk17-boot3.5' }),
  );
  const jdk = writeJava(root, 'custom-java', '17.0.9');
  const maven = path.join(root, 'custom-maven');
  fs.mkdirSync(path.join(maven, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(maven, 'bin', process.platform === 'win32' ? 'mvn.cmd' : 'mvn'), '');
  const result = await verifyJavaProject({
    root,
    install: false,
    env: { PATH: '' },
    scan: {
      javaRoots: [],
      mavenRoots: [],
      homedir: root,
      probe: (bin) => (/mvn/.test(bin) ? 'Apache Maven 3.9.11' : 'javac 17.0.9'),
    },
    userQuestions: {
      ask: async () => ({
        answers: [
          { custom: path.join(jdk, 'bin', exe('javac')) },
          { custom: path.join(maven, 'bin') },
        ],
      }),
    },
  });
  assert.equal(result.report.environment.java[0].home, jdk);
  assert.equal(result.report.environment.maven.version, '3.9.11');
  assert.deepEqual(result.report.environment.provisioned, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '.specgate/toolchain-paths.json'))), {
    javaHome: jdk,
    mavenHome: maven,
  });
  assert.equal(fs.existsSync(path.join(root, '.specgate/verify.lock')), false);
});

test('an active verification lock is never overwritten', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, '.specgate'));
  fs.writeFileSync(path.join(root, '.specgate/monorepo.json'), '{}');
  fs.writeFileSync(path.join(root, '.specgate/verify.lock'), JSON.stringify({ pid: process.pid }));
  const result = await verifyJavaProject({ root });
  assert.equal(result.code, 'VERIFY_LOCKED');
  assert.equal(fs.existsSync(path.join(root, '.specgate/verify-report.json')), false);
});

test('a corrupt initialization report yields visible failure instead of stale success or an uncaught exception', async (t) => {
  const root = temp(t);
  fs.mkdirSync(path.join(root, '.specgate'));
  fs.writeFileSync(
    path.join(root, '.specgate/monorepo.json'),
    JSON.stringify({ stack: 'java-vue', preset: 'jdk8-boot2.7' }),
  );
  fs.writeFileSync(path.join(root, '.specgate/init-report.json'), '{invalid');
  const result = await verifyJavaProject({ root, install: false });
  assert.equal(result.code, 'VERIFY_FAILED');
  assert.equal(result.report.ok, false);
  assert.equal(result.report.status, 'failed');
  assert.equal(fs.existsSync(path.join(root, '.specgate/verify.lock')), false);
});
