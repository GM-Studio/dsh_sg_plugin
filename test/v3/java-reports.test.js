import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findJunitFiles,
  findJacocoFiles,
  parseJavaJunitFiles,
  collectJavaReports,
} from '../../src/v3/java-reports.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-reports-'));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function xml(className, testName) {
  return `<testsuite><testcase classname="${className}" name="${testName}"/></testsuite>`;
}

test('findJunitFiles 发现 surefire/failsafe 报告并跳过 node_modules', () => {
  const root = tempRoot();
  write(
    path.join(root, 'a', 'target', 'surefire-reports', 'TEST-A.xml'),
    xml('com.example.ATest', 'a[AC-001]'),
  );
  write(
    path.join(root, 'b', 'target', 'failsafe-reports', 'TEST-B.xml'),
    xml('com.example.BTest', 'b[AC-002]'),
  );
  write(
    path.join(root, 'node_modules', 'x', 'target', 'surefire-reports', 'TEST-X.xml'),
    '<testsuite/>',
  );
  const files = findJunitFiles(root);
  assert.equal(files.length, 2);
  assert.ok(files.every((file) => !file.includes('node_modules')));
});

test('parseJavaJunitFiles 聚合与去重', () => {
  const root = tempRoot();
  const a = path.join(root, 'a', 'target', 'surefire-reports', 'TEST-A.xml');
  const b = path.join(root, 'b', 'target', 'surefire-reports', 'TEST-B.xml');
  write(a, xml('com.example.ATest', 'same[AC-001]'));
  write(b, xml('com.example.ATest', 'same[AC-001]'));
  const report = parseJavaJunitFiles([a, b], { suiteId: 'backend', cwd: root, worktree: root });
  assert.equal(report.runner, 'maven');
  assert.equal(report.cases.length, 1);
  assert.equal(report.cases[0].id, 'TC-001');
  assert.equal(report.cases[0].file, 'src/test/java/com/example/ATest.java');
});

test('collectJavaReports 无报告返回 TEST_REPORT_MISSING', () => {
  const root = tempRoot();
  const result = collectJavaReports(root, { suiteId: 'backend', worktree: root });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TEST_REPORT_MISSING');
  assert.match(result.message, /surefire/);
});

test('findJacocoFiles 发现 Maven/Gradle 覆盖率报告', () => {
  const root = tempRoot();
  write(path.join(root, 'a', 'target', 'site', 'jacoco', 'jacoco.xml'), '<report/>');
  write(
    path.join(root, 'b', 'build', 'reports', 'jacoco', 'test', 'jacocoTestReport.xml'),
    '<report/>',
  );
  const files = findJacocoFiles(root);
  assert.equal(files.length, 2);
});
