import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverSuites, validatePlan } from '../../src/v3/plan.js';
import { initProject, createChange } from '../../src/v3/change.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-suite-'));
}

function planFixture(overrides = {}) {
  return {
    designText: '# 方案\n\n## 目标与非目标\nx\n\n## 任务图\nT-001\n\n## AC 到用例\nx\n\n## 风险\n无\n',
    tasks: [
      { id: 'T-001', title: 'x', ac: ['AC-001'], deps: [], parallel: false },
    ],
    tasksErrors: [],
    cases: [{ id: 'TC-001', ac: ['AC-001'], layer: 'unit', description: 'x' }],
    casesErrors: [],
    mapping: {
      requirements: [
        { ac: 'AC-001', covers: ['REQ-001'], tasks: ['T-001'], cases: ['TC-001'], suite: 'web' },
      ],
      automation: [],
    },
    mappingError: null,
    touched: { modify: [], delete: [], bootstrap: [] },
    touchedError: null,
    ...overrides,
  };
}

test('discoverSuites 解析 node 与 pytest 套件并各自算 cmdHash', () => {
  const root = tempRoot();
  initProject(root);
  createChange(root, { name: 'suite-demo', type: 'feature' });
  const config = {
    workflowVersion: 3,
    suites: [
      { id: 'web', kind: 'node-test', command: ['node', 'sg-test.mjs'], cwd: '.' },
      { id: 'api', kind: 'pytest', cwd: '.', pytestArgs: ['-q', 'tests'] },
    ],
  };
  const result = discoverSuites(root, config);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.suites.length, 2);
  assert.equal(result.suites[0].source, 'config');
  assert.equal(result.suites[1].source, 'pytest');
  assert.notEqual(result.suites[0].cmdHash, result.suites[1].cmdHash);
});

test('discoverSuites 对 v3.0 配置回退到 package.json test:json', () => {
  const root = tempRoot();
  initProject(root);
  createChange(root, { name: 'legacy-demo', type: 'feature' });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ scripts: { 'test:json': 'node sg-test.mjs' } }),
    'utf8',
  );
  const result = discoverSuites(root, { workflowVersion: 3, testing: { command: [] } });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.suites.length, 1);
  assert.equal(result.suites[0].id, 'default');
  assert.deepEqual(result.suites[0].argv.slice(-1), ['test:json']);
});

test('多套件时 mapping 缺 suite 被拒', () => {
  const root = tempRoot();
  const plan = planFixture({
    mapping: {
      requirements: [
        { ac: 'AC-001', covers: ['REQ-001'], tasks: ['T-001'], cases: ['TC-001'] },
      ],
    },
  });
  const result = validatePlan({
    root,
    change: 'c',
    plan,
    deltaAcs: new Set(['AC-001']),
    deltaReqs: new Set(['REQ-001']),
    config: {},
    suites: [{ id: 'web', kind: 'node-test', argv: [], cwd: '.' }, { id: 'api', kind: 'pytest', argv: [], cwd: '.' }],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /缺少 suite/);
});

test('mapping 指向不存在 suite 被拒', () => {
  const root = tempRoot();
  const plan = planFixture();
  plan.mapping.requirements[0].suite = 'nope';
  const result = validatePlan({
    root,
    change: 'c',
    plan,
    deltaAcs: new Set(['AC-001']),
    deltaReqs: new Set(['REQ-001']),
    config: {},
    suites: [{ id: 'web', kind: 'node-test', argv: [], cwd: '.' }],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /suite 不存在/);
});

test('合法多套件 mapping 通过', () => {
  const root = tempRoot();
  const plan = planFixture();
  const result = validatePlan({
    root,
    change: 'c',
    plan,
    deltaAcs: new Set(['AC-001']),
    deltaReqs: new Set(['REQ-001']),
    config: {},
    suites: [{ id: 'web', kind: 'node-test', argv: ['node'], cwd: '.' }, { id: 'api', kind: 'pytest', argv: [], cwd: '.' }],
  });
  assert.equal(result.ok, true, result.errors.join('; '));
});
