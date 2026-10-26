import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPATIBILITY,
  majorOf,
  assessTool,
  assessEnvironment,
  requirementsFromProject,
} from '../src/codex/core/env/compatibility.js';

const probe = (overrides = {}) => ({
  path: '/tool/bin/tool',
  version: '17.0.9',
  arch: 'x64',
  exitCode: 0,
  ...overrides,
});

test('three compatibility states exist and unknown is one of them', () => {
  assert.deepEqual([...COMPATIBILITY].sort(), ['compatible', 'incompatible', 'unknown']);
});

test('an existing tool with an unusable version is incompatible, not ok', () => {
  // AC-09：文件存在不等于环境通过。
  const result = assessTool({
    tool: 'jdk',
    probe: probe({ version: '11.0.2' }),
    requirement: { majors: [17, 21] },
  });
  assert.equal(result.state, 'incompatible');
  assert.equal(result.reason, 'version-mismatch');
  assert.match(result.detail, /expected one of 17\/21, got 11/);
});

test('a tool below the minimum version is incompatible', () => {
  const result = assessTool({
    tool: 'node',
    probe: probe({ version: '18.2.0' }),
    requirement: { minVersion: 20 },
  });
  assert.equal(result.state, 'incompatible');
  assert.equal(result.reason, 'version-below-minimum');
});

test('an architecture mismatch is incompatible', () => {
  const result = assessTool({
    tool: 'jdk',
    probe: probe({ arch: 'arm64' }),
    requirement: { arch: 'x64' },
  });
  assert.equal(result.state, 'incompatible');
  assert.equal(result.reason, 'arch-mismatch');
});

test('a probe that exited non-zero keeps its stderr and is incompatible', () => {
  const result = assessTool({
    tool: 'maven',
    probe: probe({ exitCode: 1, stderr: 'JAVA_HOME is not set' }),
    requirement: {},
  });
  assert.equal(result.state, 'incompatible');
  assert.equal(result.reason, 'probe-failed');
  assert.match(result.detail, /JAVA_HOME/);
});

test('a probe timeout is unknown, never a pass', () => {
  const result = assessTool({
    tool: 'git',
    probe: probe({ timedOut: true }),
    requirement: { minVersion: 2 },
  });
  assert.equal(result.state, 'unknown');
  assert.equal(result.reason, 'probe-timeout');
  assert.notEqual(result.state, 'compatible');
});

test('a tool with no real executable path is incompatible', () => {
  for (const path of [undefined, '', null]) {
    const result = assessTool({ tool: 'jdk', probe: probe({ path }), requirement: {} });
    assert.equal(result.state, 'incompatible', String(path));
    assert.equal(result.reason, 'no-executable-path');
  }
});

test('an unreadable version is unknown rather than compatible', () => {
  const result = assessTool({
    tool: 'jdk',
    probe: probe({ version: 'unknown-build' }),
    requirement: { majors: [17] },
  });
  assert.equal(result.state, 'unknown');
  assert.equal(result.reason, 'version-unreadable');
});

test('a matching tool with a real path and version is compatible', () => {
  const result = assessTool({
    tool: 'jdk',
    probe: probe({ version: '17.0.18' }),
    requirement: { majors: [17, 21] },
  });
  assert.equal(result.state, 'compatible');
  assert.equal(result.path, '/tool/bin/tool');
});

test('unknown and incompatible both keep the environment not ready', () => {
  for (const overrides of [{ version: '11.0.2' }, { timedOut: true }]) {
    const assessed = assessEnvironment({
      requirements: { jdk: { majors: [17] }, git: { minVersion: 2 } },
      probes: { jdk: probe(overrides), git: probe({ version: '2.49.0' }) },
    });
    assert.equal(assessed.ok, true);
    assert.equal(assessed.environmentReady, false, JSON.stringify(overrides));
  }
});

test('the environment is ready only when every tool is compatible', () => {
  const assessed = assessEnvironment({
    requirements: { jdk: { majors: [17] }, git: { minVersion: 2 } },
    probes: { jdk: probe({ version: '17.0.18' }), git: probe({ version: '2.49.0' }) },
  });
  assert.equal(assessed.environmentReady, true);
  assert.equal(assessed.incompatible.length, 0);
  assert.equal(assessed.unknown.length, 0);
});

test('environment readiness never implies build, test or review results', () => {
  const assessed = assessEnvironment({
    requirements: { git: { minVersion: 2 } },
    probes: { git: probe({ version: '2.49.0' }) },
  });
  assert.equal(assessed.environmentReady, true);
  assert.equal(assessed.projectBuildPassed, false, 'AC-15：环境通过不蕴含构建通过');
  assert.equal(assessed.projectTestsPassed, false);
  assert.equal(assessed.reviewPassed, false);
  assert.equal(assessed.workflowVerification, 'not-run');
});

test('an empty probe set is never reported as ready', () => {
  const assessed = assessEnvironment({ requirements: {}, probes: {} });
  assert.equal(assessed.environmentReady, false, '没有探测就没有通过');
});

test('project requirements follow the actual build systems present', () => {
  const maven = requirementsFromProject({ buildSystems: ['maven'] });
  assert.deepEqual(maven.jdk.majors, [8, 11, 17, 21]);
  assert.ok(maven.maven);
  assert.equal(maven.node, undefined, 'Maven 项目不得无端要求 node');
  assert.ok(maven.git, 'git 始终需要');

  const python = requirementsFromProject({ buildSystems: ['python'] });
  assert.ok(python.python);
  assert.equal(python.jdk, undefined, 'Python 项目不得无端要求 jdk');
});

test('version parsing handles the common shapes', () => {
  const cases = [
    ['17.0.9', 17],
    ['1.8.0_392', 8],
    ['temurin-21.0.1', 21],
    ['2.49.0.windows.2', 2],
    ['', null],
    [null, null],
  ];
  for (const [input, expected] of cases) assert.equal(majorOf(input), expected, String(input));
});
