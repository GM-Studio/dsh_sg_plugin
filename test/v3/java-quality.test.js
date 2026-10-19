import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectQuality, inferStack } from '../../src/v3/quality.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-quality-'));
}

function writePom(root, extra = '') {
  fs.writeFileSync(
    path.join(root, 'pom.xml'),
    `<project><build><plugins>${extra}</plugins></build></project>`,
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'mvnw'), '#!/bin/sh\n', 'utf8');
  fs.writeFileSync(path.join(root, 'mvnw.cmd'), '@echo off\n', 'utf8');
}

test('inferStack 识别 Maven 项目', () => {
  const root = tempRoot();
  writePom(root);
  assert.equal(inferStack(root), 'java');
});

test('detectQuality 识别 Spotless/Checkstyle/PMD/SpotBugs', () => {
  const root = tempRoot();
  writePom(
    root,
    '<plugin><artifactId>spotless-maven-plugin</artifactId></plugin>' +
      '<plugin><artifactId>maven-checkstyle-plugin</artifactId></plugin>' +
      '<plugin><artifactId>pmd-maven-plugin</artifactId></plugin>' +
      '<plugin><artifactId>spotbugs-maven-plugin</artifactId></plugin>',
  );
  const stages = detectQuality({ root, worktree: root });
  assert.match(stages.format.join(' '), /spotless:apply/);
  assert.match(stages.lint.join(' '), /checkstyle:check/);
  assert.match(stages.typecheck.join(' '), /compile/);
  assert.match(stages.static.join(' '), /verify/);
});

test('detectQuality 无插件时只保留编译检查', () => {
  const root = tempRoot();
  writePom(root);
  const stages = detectQuality({ root, worktree: root });
  assert.equal(stages.format, undefined);
  assert.equal(stages.lint, undefined);
  assert.match(stages.typecheck.join(' '), /compile/);
});

test('detectQuality 使用配置覆盖', () => {
  const root = tempRoot();
  writePom(root);
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'config.yaml'),
    'quality:\n  format: ["custom-format"]\n',
    'utf8',
  );
  const stages = detectQuality({ root, worktree: root });
  assert.deepEqual(stages.format, ['custom-format']);
});
