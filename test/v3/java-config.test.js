import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseConfig, readSuites, validateSuites } from '../../src/v3/change.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-config-'));
}

function mavenSuite(overrides = {}) {
  return {
    id: 'backend',
    kind: 'maven',
    command: [],
    cwd: '.',
    legacy: false,
    jdk: '8',
    buildTool: 'maven',
    goals: ['-B', '-ntp', 'verify'],
    reportGlob: 'target/surefire-reports/TEST-*.xml',
    jacocoGlob: 'target/site/jacoco/jacoco.xml',
    ...overrides,
  };
}

test('parseConfig 解析 java/quality/coverage 与 maven suite', () => {
  const config = parseConfig(`workflowVersion: 3
stack: java
java:
  jdk: 8
  buildTool: maven
  bootVersion: "2.7.18"
  modules: ["web", "data-jpa"]
quality:
  profile: strict
coverage:
  blocking: true
  lines: 80
  branches: 70
suites:
  - id: backend
    kind: maven
    cwd: "."
    jdk: "8"
    buildTool: maven
    goals: ["-B", "-ntp", "verify"]
    reportGlob: "target/surefire-reports/TEST-*.xml"
    jacocoGlob: "target/site/jacoco/jacoco.xml"
    timeoutMinutes: 30
`);
  assert.equal(config.stack, 'java');
  assert.equal(config.java.jdk, 8);
  assert.equal(config.java.bootVersion, '2.7.18');
  assert.deepEqual(config.java.modules, ['web', 'data-jpa']);
  assert.equal(config.quality.profile, 'strict');
  assert.equal(config.coverage.blocking, true);
  assert.equal(config.suites[0].kind, 'maven');
  assert.deepEqual(config.suites[0].goals, ['-B', '-ntp', 'verify']);
});

test('readSuites 为 maven suite 补齐字段', () => {
  const config = parseConfig(`workflowVersion: 3
suites:
  - id: backend
    kind: maven
    cwd: "."
`);
  const suites = readSuites(config);
  assert.equal(suites.length, 1);
  assert.equal(suites[0].kind, 'maven');
  assert.deepEqual(suites[0].goals, []);
  assert.equal(suites[0].jdk, null);
  assert.equal(suites[0].buildTool, null);
  assert.equal(suites[0].reportGlob, null);
  assert.equal(suites[0].jacocoGlob, null);
});

test('readSuites 保持旧配置兼容', () => {
  const config = parseConfig(`workflowVersion: 3
testing:
  command: ["node", "sg-test.mjs"]
`);
  const suites = readSuites(config);
  assert.equal(suites[0].kind, 'node-test');
  assert.equal(suites[0].legacy, true);
  assert.deepEqual(suites[0].goals, []);
});

test('validateSuites 接受合法 maven suite', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>', 'utf8');
  const result = validateSuites(root, [mavenSuite()]);
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('validateSuites 拒绝缺少 pom.xml 的 maven suite', () => {
  const root = tempRoot();
  const result = validateSuites(root, [mavenSuite()]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /pom\.xml/);
});

test('validateSuites 拒绝非法 jdk/buildTool/goals', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>', 'utf8');
  const result = validateSuites(root, [
    mavenSuite({ id: 'bad-jdk', jdk: '9' }),
    mavenSuite({ id: 'bad-tool', buildTool: 'ant' }),
    mavenSuite({ id: 'bad-goals', goals: 'verify' }),
  ]);
  assert.equal(result.ok, false);
  const joined = result.errors.join('; ');
  assert.match(joined, /jdk 不合法/);
  assert.match(joined, /buildTool 不合法/);
  assert.match(joined, /goals 必须是数组/);
});

test('validateSuites 拒绝 maven suite cwd 逃逸', () => {
  const root = tempRoot();
  const result = validateSuites(root, [mavenSuite({ cwd: '..' })]);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /逃逸/);
});
