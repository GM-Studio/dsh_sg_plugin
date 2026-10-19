import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJunitXml, resolveJavaTestFile } from '../../src/v3/suites.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-java-junit-'));
}

test('parseJunitXml 支持 maven runner 与 Java 文件解析', () => {
  const root = tempRoot();
  const source = path.join(
    root,
    'src',
    'test',
    'java',
    'com',
    'example',
    'DemoApplicationTests.java',
  );
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'class DemoApplicationTests {}', 'utf8');
  const xml = `<?xml version="1.0"?>
<testsuite name="com.example.DemoApplicationTests">
  <testcase classname="com.example.DemoApplicationTests" name="health[AC-001]"/>
  <testcase classname="com.example.DemoApplicationTests" name="version[AC-002]"><failure/></testcase>
</testsuite>`;
  const report = parseJunitXml(xml, {
    suiteId: 'backend',
    cwd: root,
    worktree: root,
    runner: 'maven',
    fileResolver: (name, ctx) => resolveJavaTestFile(ctx.cwd, ctx.worktree, name),
  });
  assert.equal(report.runner, 'maven');
  assert.equal(report.cases[0].file, 'src/test/java/com/example/DemoApplicationTests.java');
  assert.deepEqual(report.cases[0].ac, ['AC-001']);
});

test('resolveJavaTestFile 处理内部类', () => {
  const root = tempRoot();
  const source = path.join(root, 'src', 'test', 'java', 'com', 'example', 'DemoTest.java');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'class DemoTest {}', 'utf8');
  const file = resolveJavaTestFile(root, root, 'com.example.DemoTest$Nested');
  assert.equal(file, 'src/test/java/com/example/DemoTest.java');
});

test('resolveJavaTestFile 文件缺失时返回候选路径', () => {
  const root = tempRoot();
  const file = resolveJavaTestFile(root, root, 'com.example.MissingTest');
  assert.equal(file, 'src/test/java/com/example/MissingTest.java');
});

test('parseJunitXml 默认仍为 pytest', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'test_x.py'), '', 'utf8');
  const report = parseJunitXml(
    '<testsuite><testcase classname="tests.test_x" name="x[AC-001]"/></testsuite>',
    { suiteId: 'api', cwd: root, worktree: root },
  );
  assert.equal(report.runner, 'pytest');
  assert.equal(report.cases[0].file, 'tests/test_x.py');
});
