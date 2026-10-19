import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scaffoldFiles,
  configureSuites,
  collectContext,
  CONTEXT_FIELDS,
} from '../../src/v3/init.js';
import { parseConfig, readSuites, validateSuites } from '../../src/v3/change.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-init-'));
}

test('scaffoldFiles 生成默认 JDK8 Maven Boot2.7 项目', () => {
  const files = scaffoldFiles('java', { jdk: '8', bootVersion: '2.7.x', modules: 'minimal' });
  assert.ok(files['pom.xml']);
  assert.ok(files['mvnw']);
  assert.ok(files['mvnw.cmd']);
  assert.ok(files['src/main/java/com/example/demo/DemoApplication.java']);
  assert.ok(files['src/test/java/com/example/demo/HealthControllerTest.java']);
  assert.match(files['pom.xml'], /<version>2\.7\.18<\/version>/);
  assert.match(files['pom.xml'], /<java\.version>8<\/java\.version>/);
  assert.match(files['src/test/java/com/example/demo/HealthControllerTest.java'], /AC-001/);
});

test('scaffoldFiles 生成 JDK17 + Boot3 项目', () => {
  const files = scaffoldFiles('java', { jdk: '17', bootVersion: '3.x', modules: 'minimal+jpa' });
  assert.match(files['pom.xml'], /<version>3\.5\.16<\/version>/);
  assert.match(files['pom.xml'], /<java\.version>17<\/java\.version>/);
  assert.match(files['pom.xml'], /spring-boot-starter-data-jpa/);
});

test('configureSuites 写入 Java 配置与 maven suite', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project/>', 'utf8');
  configureSuites(root, 'java', { jdk: '11', bootVersion: '2.7.x', modules: 'minimal' });
  const config = parseConfig(fs.readFileSync(path.join(root, '.specgate', 'config.yaml'), 'utf8'));
  assert.equal(config.stack, 'java');
  assert.equal(config.java.jdk, 11);
  assert.equal(config.quality.profile, 'strict');
  assert.equal(config.coverage.lines, 80);
  const suites = readSuites(config);
  assert.equal(suites[0].kind, 'maven');
  assert.equal(suites[0].jdk, '11');
  const validation = validateSuites(root, suites);
  assert.equal(validation.ok, true, validation.errors.join('; '));
});

test('collectContext 只在 Java 技术栈询问 JDK/Boot/模块', async () => {
  const asked = [];
  const userQuestions = {
    async ask(payload) {
      asked.push(payload.questions[0].id);
      return { answers: [{ selected: payload.questions[0].options[0].label }] };
    },
  };
  const context = await collectContext({ userQuestions, initial: { stack: 'java' } });
  assert.ok(asked.includes('sg-init-jdk'));
  assert.ok(asked.includes('sg-init-bootVersion'));
  assert.ok(asked.includes('sg-init-modules'));
  assert.equal(context.jdk, '8');
  assert.equal(context.bootVersion, '2.7.x');
  assert.equal(context.modules, 'minimal');
});

test('collectContext 对 Node 技术栈跳过 Java 字段', async () => {
  const asked = [];
  const userQuestions = {
    async ask(payload) {
      asked.push(payload.questions[0].id);
      return { answers: [{ selected: payload.questions[0].options[0].label }] };
    },
  };
  await collectContext({ userQuestions, initial: { stack: 'node' } });
  assert.ok(!asked.includes('sg-init-jdk'));
  assert.ok(!asked.includes('sg-init-bootVersion'));
});

test('CONTEXT_FIELDS 包含 Java 栈选项', () => {
  const stack = CONTEXT_FIELDS.find((field) => field.key === 'stack');
  assert.ok(stack.options.includes('java'));
});

test('scaffoldFiles 生成 JDK17 + Gradle + Boot3 项目', () => {
  const files = scaffoldFiles('java', { jdk: '17', bootVersion: '3.x', buildTool: 'gradle' });
  assert.ok(files['build.gradle']);
  assert.ok(files['settings.gradle']);
  assert.ok(files['gradlew']);
  assert.ok(files['gradlew.bat']);
  assert.ok(!files['pom.xml']);
  assert.match(files['build.gradle'], /springframework\.boot/);
  assert.match(files['build.gradle'], /spotless/);
});

test('configureSuites 写入 gradle suite', () => {
  const root = tempRoot();
  configureSuites(root, 'java', { jdk: '17', bootVersion: '3.x', buildTool: 'gradle' });
  const config = parseConfig(fs.readFileSync(path.join(root, '.specgate', 'config.yaml'), 'utf8'));
  assert.equal(config.java.buildTool, 'gradle');
  const suites = readSuites(config);
  assert.equal(suites[0].kind, 'gradle');
  assert.equal(suites[0].buildTool, 'gradle');
});
