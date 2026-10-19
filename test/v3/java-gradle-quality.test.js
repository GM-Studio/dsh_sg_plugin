import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateJavaSelection } from '../../src/v3/java-detect.js';
import { detectQuality } from '../../src/v3/quality.js';

test('Java 兼容矩阵严格校验', () => {
  assert.equal(validateJavaSelection({ jdk: '8', bootVersion: '2.7.x' }).ok, true);
  assert.equal(validateJavaSelection({ jdk: '11', bootVersion: '2.7.x' }).ok, true);
  assert.equal(validateJavaSelection({ jdk: '17', bootVersion: '2.7.x' }).ok, true);
  assert.equal(validateJavaSelection({ jdk: '17', bootVersion: '3.x' }).ok, true);
  assert.equal(validateJavaSelection({ jdk: '21', bootVersion: '3.x' }).ok, true);
  assert.equal(validateJavaSelection({ jdk: '21', bootVersion: '2.7.x' }).ok, false);
  assert.equal(validateJavaSelection({ jdk: '8', bootVersion: '3.x' }).ok, false);
  assert.equal(validateJavaSelection({ jdk: '13', bootVersion: '2.7.x' }).ok, false);
});

test('Gradle 质量阶段识别 spotless/checkstyle/spotbugs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-gradle-'));
  fs.writeFileSync(
    path.join(root, 'build.gradle'),
    "plugins { id 'java'; id 'com.diffplug.spotless'; id 'checkstyle'; id 'com.github.spotbugs' }\n",
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'gradlew'), '#!/bin/sh\n', 'utf8');
  const stages = detectQuality({ root, worktree: root, stack: 'java' });
  assert.ok(stages.format.some((item) => item.includes('spotlessApply')));
  assert.ok(stages.lint.some((item) => item.includes('checkstyleMain')));
  assert.ok(stages.typecheck.some((item) => item.includes('compileJava')));
  assert.ok(stages.static.some((item) => item.includes('spotbugsMain')));
});
