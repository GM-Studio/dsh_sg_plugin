import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanEnv, writeEnvReport } from '../../src/v3/env-scan.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-env-'));
}

test('scanEnv 识别 Java 项目与质量插件', () => {
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, 'pom.xml'),
    `<project>
  <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>2.7.18</version></parent>
  <properties><java.version>8</java.version></properties>
  <modules><module>app</module></modules>
  <build><plugins>
    <plugin><artifactId>spotless-maven-plugin</artifactId></plugin>
    <plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>
    <plugin><artifactId>jacoco-maven-plugin</artifactId></plugin>
  </plugins></build>
</project>`,
    'utf8',
  );
  fs.writeFileSync(path.join(root, '.java-version'), '8\n', 'utf8');
  fs.writeFileSync(path.join(root, 'mvnw'), '#!/bin/sh\n', 'utf8');

  const env = scanEnv(root);
  const java = env.workspaces.find((item) => item.stack === 'java');
  assert.ok(java);
  assert.equal(java.packageManager, 'maven');
  assert.equal(java.java.jdk, '8');
  assert.equal(java.java.bootVersion, '2.7.18');
  assert.equal(java.tools.maven, 'ready');
  assert.equal(java.tools.spotless, 'ready');
  assert.equal(java.tools.checkstyle, 'ready');
  assert.equal(java.tools.jacoco, 'ready');
  assert.equal(java.tools.pmd, 'missing');
  assert.equal(java.tools.spotbugs, 'missing');

  const files = writeEnvReport(root, env);
  const report = fs.readFileSync(files.mdFile, 'utf8');
  assert.match(report, /java:/);
  assert.match(report, /spotless/);
});
