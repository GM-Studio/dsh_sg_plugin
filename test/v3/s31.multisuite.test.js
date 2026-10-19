import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  groupAcsBySuite,
  parseJunitXml,
  runAllSuites,
  runTaskSuites,
  suitesFromState,
} from '../../src/v3/suites.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-multi-'));
}

test('groupAcsBySuite 按 mapping 的 suite 分组', () => {
  const suites = [{ id: 'web' }, { id: 'api' }];
  const mapping = {
    requirements: [
      { ac: 'AC-001', suite: 'web' },
      { ac: 'AC-002', suite: 'api' },
      { ac: 'AC-003', suite: 'api' },
    ],
  };
  const groups = groupAcsBySuite(['AC-001', 'AC-002', 'AC-003'], mapping, suites);
  assert.deepEqual([...groups.get('web')], ['AC-001']);
  assert.deepEqual([...groups.get('api')], ['AC-002', 'AC-003']);
});

test('parseJunitXml 解析 pass/fail/skip 与 AC 标记', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'test_login.py'), '', 'utf8');
  const xml = `<?xml version="1.0"?>
<testsuites><testsuite name="pytest" tests="3">
  <testcase classname="tests.test_login" name="test_ok[AC-001]" />
  <testcase classname="tests.test_login" name="test_bad[AC-002]"><failure message="x"/></testcase>
  <testcase classname="tests.test_login" name="test_skip[AC-003]"><skipped/></testcase>
</testsuite></testsuites>`;
  const report = parseJunitXml(xml, { suiteId: 'api', cwd: root, worktree: root });
  assert.equal(report.suite, 'api');
  assert.equal(report.runner, 'pytest');
  assert.deepEqual(
    report.cases.map((item) => item.status),
    ['pass', 'fail', 'skip'],
  );
  assert.deepEqual(report.cases[0].ac, ['AC-001']);
  assert.equal(report.cases[0].file, 'tests/test_login.py');
});

test('suitesFromState 优先使用冻结的 suites', () => {
  const suites = suitesFromState(
    { plan: { suites: [{ id: 'web', kind: 'node-test', argv: ['node', 'x'], cwd: '.' }] } },
    { ok: true, argv: ['fallback'], cwd: '.' },
  );
  assert.equal(suites.length, 1);
  assert.deepEqual(suites[0].argv, ['node', 'x']);
});

function writeReporter(file, ac, target) {
  fs.writeFileSync(
    file,
    `import fs from 'node:fs';
fs.writeFileSync(process.env.SG_REPORT, JSON.stringify({
  schemaVersion: 1,
  cases: [{ id: 'TC-001', ac: ['${ac}'], status: 'pass', file: '${target}' }],
}));
`,
    'utf8',
  );
}

test('runAllSuites 执行两个套件并汇总', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'a.js'), '', 'utf8');
  fs.writeFileSync(path.join(root, 'b.js'), '', 'utf8');
  writeReporter(path.join(root, 'rep-a.mjs'), 'AC-001', 'a.js');
  writeReporter(path.join(root, 'rep-b.mjs'), 'AC-002', 'b.js');
  const suites = [
    { id: 'a', kind: 'command', argv: [process.execPath, 'rep-a.mjs'], cwd: '.' },
    { id: 'b', kind: 'command', argv: [process.execPath, 'rep-b.mjs'], cwd: '.' },
  ];
  const state = { plan: { suites } };
  const plan = {
    mapping: {
      requirements: [
        { ac: 'AC-001', suite: 'a' },
        { ac: 'AC-002', suite: 'b' },
      ],
    },
  };
  state.change = 'c';
  const result = runAllSuites({
    root,
    state,
    worktree: root,
    plan,
    knownAcs: new Set(['AC-001', 'AC-002']),
    changedFiles: [],
    fallbackCommand: null,
  });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.stats.total, 2);
  assert.equal(result.stats.suites, 2);
});

test('runTaskSuites 只跑任务 AC 所属套件，失败可定位', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'a.js'), '', 'utf8');
  fs.writeFileSync(path.join(root, 'boom.mjs'), 'process.exit(1);\n', 'utf8');
  writeReporter(path.join(root, 'rep-a.mjs'), 'AC-001', 'a.js');
  const suites = [
    { id: 'a', kind: 'command', argv: [process.execPath, 'rep-a.mjs'], cwd: '.' },
    { id: 'b', kind: 'command', argv: [process.execPath, 'boom.mjs'], cwd: '.' },
  ];
  const state = { change: 'c', plan: { suites } };
  const plan = { mapping: { requirements: [{ ac: 'AC-002', suite: 'b' }] } };
  const result = runTaskSuites({
    root,
    state,
    worktree: root,
    task: { id: 'T-001', ac: ['AC-002'] },
    plan,
    knownAcs: new Set(['AC-001', 'AC-002']),
    changedFiles: [],
    fallbackCommand: null,
    requireChangedFiles: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failedSuite, 'b');
});
