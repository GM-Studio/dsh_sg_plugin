import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectJavaProject } from '../../src/v3/java-detect.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-java-detect-'));
}

function writeFile(root, relative, content = '') {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

test('识别 Maven、Spring Boot、JDK 与模块', () => {
  const root = tempRoot();
  writeFile(
    root,
    'pom.xml',
    `<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>2.7.18</version>
  </parent>
  <properties>
    <java.version>8</java.version>
    <maven.compiler.release>17</maven.compiler.release>
  </properties>
  <modules>
    <module>web</module>
    <module>service</module>
  </modules>
</project>
`,
  );

  const result = detectJavaProject(root, { env: {} });
  assert.equal(result.ok, true);
  assert.equal(result.buildTool, 'maven');
  assert.equal(result.gradleDsl, null);
  assert.equal(result.bootVersion, '2.7.18');
  assert.equal(result.jdk, '17');
  assert.equal(result.jdkSource, 'pom');
  assert.deepEqual(result.modules, ['web', 'service']);
  assert.deepEqual(result.wrapper, { maven: false, gradle: false });
  assert.ok(
    result.evidence.some(
      (item) => item.file === 'pom.xml' && item.field === 'maven.compiler.release',
    ),
  );
});

test('Maven JDK 回退顺序 release → source → target → java.version', () => {
  const root = tempRoot();
  writeFile(
    root,
    'pom.xml',
    `<project>
  <properties>
    <maven.compiler.source>11</maven.compiler.source>
    <maven.compiler.target>8</maven.compiler.target>
    <java.version>1.8</java.version>
  </properties>
</project>
`,
  );
  const result = detectJavaProject(root, { env: {} });
  assert.equal(result.jdk, '11');
  assert.equal(result.jdkSource, 'pom');
  assert.ok(
    result.evidence.some((item) => item.field === 'maven.compiler.source' && item.value === '11'),
  );

  const fallbackRoot = tempRoot();
  writeFile(
    fallbackRoot,
    'pom.xml',
    '<project><properties><java.version>1.8</java.version></properties></project>\n',
  );
  const fallback = detectJavaProject(fallbackRoot, { env: {} });
  assert.equal(fallback.jdk, '8');
});

test('识别 spring-boot-dependencies BOM 与属性占位符', () => {
  const root = tempRoot();
  writeFile(
    root,
    'pom.xml',
    `<project>
  <properties>
    <spring-boot.version>3.2.5</spring-boot.version>
  </properties>
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-dependencies</artifactId>
        <version>\${spring-boot.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
</project>
`,
  );
  const result = detectJavaProject(root, { env: {} });
  assert.equal(result.bootVersion, '3.2.5');
  assert.equal(result.jdk, null);
  assert.ok(
    result.evidence.some(
      (item) => item.field === 'spring-boot-dependencies' && item.value === '3.2.5',
    ),
  );
});

test('识别 Gradle Groovy 项目与 include 模块', () => {
  const root = tempRoot();
  writeFile(
    root,
    'build.gradle',
    `plugins {
  id 'org.springframework.boot' version '3.2.0'
}

sourceCompatibility = '17'

dependencies {
  implementation 'org.springframework.boot:spring-boot-starter-web'
}
`,
  );
  writeFile(root, 'settings.gradle', "include 'web', 'api'\ninclude ':core'\n");

  const result = detectJavaProject(root, { env: {} });
  assert.equal(result.ok, true);
  assert.equal(result.buildTool, 'gradle');
  assert.equal(result.gradleDsl, 'groovy');
  assert.equal(result.bootVersion, '3.2.0');
  assert.equal(result.jdk, '17');
  assert.equal(result.jdkSource, 'gradle');
  assert.deepEqual(result.modules, ['web', 'api', 'core']);
  assert.ok(
    result.evidence.some((item) => item.file === 'build.gradle' && item.field === 'buildTool'),
  );
});

test('识别 Gradle Kotlin DSL 与 java.toolchain', () => {
  const root = tempRoot();
  writeFile(
    root,
    'build.gradle.kts',
    `plugins {
    id("org.springframework.boot") version "2.7.18"
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(17)
    }
}
`,
  );
  writeFile(root, 'settings.gradle.kts', 'include(":service")\n');

  const result = detectJavaProject(root, { env: {} });
  assert.equal(result.buildTool, 'gradle');
  assert.equal(result.gradleDsl, 'kotlin');
  assert.equal(result.bootVersion, '2.7.18');
  assert.equal(result.jdk, '17');
  assert.equal(result.jdkSource, 'gradle');
  assert.deepEqual(result.modules, ['service']);
  assert.ok(
    result.evidence.some(
      (item) => item.file === 'build.gradle.kts' && item.field === 'java.toolchain',
    ),
  );
});

test('Gradle targetCompatibility 与 JavaVersion 常量归一化', () => {
  const root = tempRoot();
  writeFile(
    root,
    'build.gradle',
    "targetCompatibility = JavaVersion.VERSION_1_8\nsourceCompatibility = '1.8'\n",
  );
  const result = detectJavaProject(root, { env: {} });
  assert.equal(result.jdk, '8');
  assert.ok(
    result.evidence.some((item) => item.field === 'sourceCompatibility' && item.value === '8'),
  );
});

test('识别 Maven/Gradle Wrapper', () => {
  const root = tempRoot();
  writeFile(root, 'pom.xml', '<project/>\n');
  writeFile(root, 'mvnw', '#!/bin/sh\n');
  writeFile(root, '.mvn/wrapper/maven-wrapper.properties', 'distributionUrl=https://example\n');
  writeFile(root, 'gradlew', '#!/bin/sh\n');
  writeFile(root, 'gradle/wrapper/gradle-wrapper.properties', 'distributionUrl=https://example\n');

  const result = detectJavaProject(root, { env: {} });
  assert.deepEqual(result.wrapper, { maven: true, gradle: true });
  assert.ok(result.evidence.some((item) => item.field === 'wrapper' && item.value === 'maven'));
  assert.ok(result.evidence.some((item) => item.field === 'wrapper' && item.value === 'gradle'));
});

test('空目录不识别为 Java 项目', () => {
  const root = tempRoot();
  const result = detectJavaProject(root, { env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.buildTool, null);
  assert.equal(result.gradleDsl, null);
  assert.equal(result.bootVersion, null);
  assert.equal(result.jdk, null);
  assert.equal(result.jdkSource, null);
  assert.deepEqual(result.wrapper, { maven: false, gradle: false });
  assert.deepEqual(result.modules, []);
  assert.deepEqual(result.evidence, []);
});

test('回退到 .java-version 与 JAVA_HOME', () => {
  const root = tempRoot();
  writeFile(root, 'pom.xml', '<project/>\n');
  writeFile(root, '.java-version', '21\n');
  const versioned = detectJavaProject(root, { env: {} });
  assert.equal(versioned.jdk, '21');
  assert.equal(versioned.jdkSource, '.java-version');

  const homeRoot = tempRoot();
  const javaHome = path.join(homeRoot, 'jdk-11.0.21');
  fs.mkdirSync(javaHome, { recursive: true });
  const fromHome = detectJavaProject(homeRoot, { env: { JAVA_HOME: javaHome } });
  assert.equal(fromHome.jdk, '11');
  assert.equal(fromHome.jdkSource, 'JAVA_HOME');

  const releaseRoot = tempRoot();
  const releaseHome = path.join(releaseRoot, 'custom-jdk');
  fs.mkdirSync(releaseHome, { recursive: true });
  fs.writeFileSync(path.join(releaseHome, 'release'), 'JAVA_VERSION="17.0.9"\n', 'utf8');
  const fromRelease = detectJavaProject(releaseRoot, { env: { JAVA_HOME: releaseHome } });
  assert.equal(fromRelease.jdk, '17');
});
