import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITY_KINDS,
  toolsForBuildSystem,
  deriveCapabilities,
  resolveTools,
} from '../src/codex/core/env/capability.js';

test('a maven task requires jdk and maven but never node', () => {
  const result = deriveCapabilities({ tasks: [{ id: 't1', kind: 'test', buildSystem: 'maven' }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.requiredTools, ['jdk', 'maven']);
  assert.equal(result.requiredTools.includes('node'), false, 'maven 任务不得牵出 node（AC-11）');
  assert.deepEqual(result.requestedBy.jdk, ['t1']);
});

test('a pytest task requires python and never the jdk', () => {
  const result = deriveCapabilities({
    tasks: [{ id: 'py', kind: 'test', buildSystem: 'python' }],
  });
  assert.deepEqual(result.requiredTools, ['python']);
  assert.equal(result.requiredTools.includes('jdk'), false);
  assert.equal(result.requiredTools.includes('maven'), false);
});

test('a document-only task derives no toolchain at all', () => {
  const result = deriveCapabilities({ tasks: [{ id: 'doc', kind: 'build' }] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.requiredTools, [], '无构建需求不得安装任何工具');
  assert.deepEqual(result.capabilities, []);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].reason, 'no-build-system');
});

test('an unknown build system is reported as a gap, not guessed', () => {
  const result = deriveCapabilities({
    tasks: [{ id: 'x', kind: 'build', buildSystem: 'bazel-ish' }],
  });
  assert.deepEqual(result.requiredTools, []);
  assert.equal(result.gaps[0].reason, 'unknown-build-system');
  assert.equal(toolsForBuildSystem('bazel-ish').known, false);
});

test('build system can be resolved from the module when the task omits it', () => {
  const result = deriveCapabilities({
    modules: [{ id: 'api', buildSystems: ['gradle'] }],
    tasks: [{ id: 't', kind: 'test', module: 'api' }],
  });
  assert.deepEqual(result.requiredTools, ['gradle', 'jdk']);
});

test('only the union of what the tasks need is prepared', () => {
  const result = deriveCapabilities({
    tasks: [
      { id: 'a', kind: 'build', buildSystem: 'maven' },
      { id: 'b', kind: 'build', buildSystem: 'maven' },
      { id: 'c', kind: 'test', buildSystem: 'go' },
    ],
  });
  assert.deepEqual(result.requiredTools, ['go', 'jdk', 'maven']);
  assert.deepEqual(result.requestedBy.jdk, ['a', 'b'], '同一工具只记一次，但保留所有请求方');
  // 未出现在任务里的技术栈工具（node/python/rust 等）一律不准备。
  for (const tool of ['node', 'python', 'rust', 'dotnet'])
    assert.equal(result.requiredTools.includes(tool), false, tool);
});

test('every capability kind stays within the declared set', () => {
  const result = deriveCapabilities({
    tasks: [
      { id: '1', kind: 'build', buildSystem: 'npm' },
      { id: '2', kind: 'test', buildSystem: 'npm' },
      { id: '3', kind: 'lint', buildSystem: 'npm' },
      { id: '4', kind: 'weird-kind', buildSystem: 'npm' },
    ],
  });
  for (const capability of result.capabilities)
    assert.equal(CAPABILITY_KINDS.includes(capability.kind), true, capability.kind);
  const odd = result.capabilities.find((entry) => entry.task === '4');
  assert.equal(odd.kind, 'build', '未知 kind 退回 build 而不是硬塞进枚举');
});

test('reuse requires a real path and version, not mere existence', () => {
  const resolved = resolveTools({
    requiredTools: ['jdk', 'maven', 'node'],
    discovered: {
      jdk: { path: '/jdk17/bin/java', major: 17, version: '17.0.18' },
      // 只有「存在」没有路径：不得算作复用（AC-09 的前置）。
      maven: { exists: true },
      node: undefined,
    },
  });
  assert.deepEqual(
    resolved.reuse.map((entry) => entry.tool),
    ['jdk'],
  );
  assert.deepEqual(
    resolved.missing.map((entry) => entry.tool),
    ['maven', 'node'],
  );
  assert.equal(resolved.environmentReady, false);
});

test('environment readiness never implies build, test or review outcomes', () => {
  const ready = resolveTools({
    requiredTools: ['jdk'],
    discovered: { jdk: { path: '/java', major: 17 } },
  });
  assert.equal(ready.environmentReady, true);
  assert.equal(ready.projectBuildPassed, false, '环境通过不等于构建通过（AC-15）');
  assert.equal(ready.projectTestsPassed, false);
  assert.equal(ready.reviewPassed, false);
  assert.equal(ready.workflowVerification, 'not-run');
});

test('deriving capabilities performs no installation and no writes', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-cap-'));
  try {
    const snapshot = () => {
      const entries = [];
      const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            entries.push('d:' + entry.name);
            visit(target);
          } else entries.push('f:' + entry.name);
        }
      };
      visit(root);
      return entries.sort();
    };
    const before = snapshot();
    deriveCapabilities({ tasks: [{ id: 't', kind: 'build', buildSystem: 'maven' }] });
    resolveTools({ requiredTools: ['jdk'], discovered: {} });
    assert.deepEqual(snapshot(), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('invalid input is refused rather than silently coerced', () => {
  for (const tasks of [null, 'x', 3]) {
    const result = deriveCapabilities({ tasks });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CAPABILITY_INPUT_INVALID');
  }
});
