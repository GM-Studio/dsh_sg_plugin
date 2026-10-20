import test from 'node:test';
import assert from 'node:assert/strict';
import { planProvisioning, provisionSummary, toolchainEnv } from '../../src/v4/provision.js';

function env(overrides = {}) {
  return {
    platform: 'win32',
    arch: 'x64',
    sandbox: { scope: 'project' },
    tools: {
      node: [{ source: 'dsh', path: 'C:/dsh/node.exe', version: '24.0.0' }],
      pnpm: [
        {
          source: 'dsh',
          path: 'C:/dsh/pnpm.cjs',
          kind: 'node-script',
          node: 'C:/dsh/node.exe',
          version: '11.28.5',
        },
      ],
      python: [{ source: 'dsh', path: 'C:/dsh/python.exe', version: '3.12.14' }],
      uv: [],
      java: [],
      mvn: [],
      gradle: [],
    },
    ...overrides,
  };
}

test('v4.1 工具链：Node/pnpm 复用 DSH 运行时，不下载', () => {
  const plan = planProvisioning({
    environment: env(),
    selection: { sides: [{ stack: 'node', nodeVersion: '22', packageManager: 'pnpm' }] },
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.tools.pnpm.version, '11.28.5');
  assert.match(provisionSummary(plan), /复用/);
  assert.match(provisionSummary(plan), /镜像/);
});

test('v4.1 工具链：Java 缺 JDK/Maven 时计划国内镜像下载', () => {
  const plan = planProvisioning({
    environment: env(),
    selection: { sides: [{ stack: 'java', jdk: '21', buildTool: 'maven' }] },
  });
  assert.equal(plan.ok, true);
  const jdk = plan.actions.find((item) => item.tool === 'jdk');
  const maven = plan.actions.find((item) => item.tool === 'maven');
  assert.match(jdk.url, /mirrors\.huaweicloud\.com/);
  assert.match(maven.url, /maven\.aliyun\.com/);
  assert.match(provisionSummary(plan), /下载/);
});

test('v4.1 工具链：Python uv 缺失时计划 pip 镜像安装', () => {
  const plan = planProvisioning({
    environment: env(),
    selection: { sides: [{ stack: 'python', pythonVersion: '3.12', packageManager: 'uv' }] },
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.actions[0].tool, 'uv');
  assert.equal(plan.actions[0].kind, 'pip-install');
  assert.match(provisionSummary(plan), /pip 国内镜像/);
});

test('v4.1 工具链：PATH 同时设置 PATH/Path，Windows 子进程可找到 node', () => {
  const result = toolchainEnv({
    node: { path: 'C:/dsh/node.exe' },
    python: { path: 'C:/dsh/python.exe' },
  });
  assert.match(result.PATH, /C:\/dsh/);
  assert.equal(result.Path, result.PATH);
  assert.ok(result.ComSpec);
});
