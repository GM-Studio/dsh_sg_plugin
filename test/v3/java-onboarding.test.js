import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initProject, readConfig } from '../../src/v3/change.js';
import { onboardExistingJava } from '../../src/v3/init.js';
import { suggestSuites } from '../../src/v3/suites.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-onboard-'));
}

function writeMaven(root) {
  const pom = `<project>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>2.7.18</version></parent>
  <properties><java.version>8</java.version></properties>
</project>`;
  fs.writeFileSync(path.join(root, 'pom.xml'), pom, 'utf8');
  fs.writeFileSync(path.join(root, 'mvnw'), '#!/bin/sh\n', 'utf8');
  return pom;
}

test('onboardExistingJava 生成配置/环境报告/接入文档且不修改 pom', () => {
  const root = tempRoot();
  const originalPom = writeMaven(root);
  initProject(root);
  const result = onboardExistingJava(root);
  assert.ok(result);
  assert.equal(result.configWritten, true);
  assert.equal(fs.readFileSync(path.join(root, 'pom.xml'), 'utf8'), originalPom);
  const config = readConfig(root);
  assert.equal(config.stack, 'java');
  assert.equal(config.suites[0].kind, 'maven');
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'env.json')));
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'env-report.md')));
  const doc = fs.readFileSync(path.join(root, 'docs', 'java-onboarding.md'), 'utf8');
  assert.match(doc, /未修改 `pom\.xml`/);
  assert.match(doc, /Maven Wrapper/);
});

test('onboardExistingJava 重复接入幂等', () => {
  const root = tempRoot();
  writeMaven(root);
  initProject(root);
  onboardExistingJava(root);
  const first = fs.readFileSync(path.join(root, '.specgate', 'config.yaml'), 'utf8');
  const second = onboardExistingJava(root);
  assert.equal(second.configWritten, false);
  assert.equal(fs.readFileSync(path.join(root, '.specgate', 'config.yaml'), 'utf8'), first);
});

test('suggestSuites 建议 Maven backend suite', () => {
  const root = tempRoot();
  writeMaven(root);
  const suggestions = suggestSuites(root);
  const backend = suggestions.find((item) => item.id === 'backend');
  assert.ok(backend);
  assert.equal(backend.kind, 'maven');
  assert.equal(backend.jdk, '8');
});
