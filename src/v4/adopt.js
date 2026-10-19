import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir, exists, readText, writeText } from '../v3/util/fsx.js';
import { initProject, configPath, patchConfigRequirements } from '../v3/change.js';
import { writeRequirementsBaseline } from '../v3/requirements.js';
import { WORKSPACE_FILE, readWorkspace, scanWorkspace } from './workspace.js';

function git(root, args) {
  return spawnSync(
    'git',
    ['-c', 'user.name=SpecGate', '-c', 'user.email=specgate@local', ...args],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
    },
  );
}

function detectSides(root) {
  const sides = [];
  for (const [id, dir] of [
    ['api', 'api'],
    ['web', 'web'],
    ['api', 'backend'],
    ['web', 'frontend'],
  ]) {
    const target = path.join(root, dir);
    if (!exists(target)) continue;
    const stack = exists(path.join(target, 'pom.xml'))
      ? 'java'
      : exists(path.join(target, 'requirements.txt')) || exists(path.join(target, 'pyproject.toml'))
        ? 'python'
        : 'node';
    if (!sides.some((side) => side.path === dir)) {
      sides.push({ id, path: dir, stack, role: id === 'web' ? 'frontend' : 'backend' });
    }
  }
  if (sides.length === 0) {
    sides.push({ id: 'api', path: '.', stack: 'node', role: 'backend' });
  }
  return sides;
}

function workspaceYaml(sides) {
  return [
    'version: 4',
    'topology: adopt',
    'backend: ' + (sides.find((side) => side.role === 'backend')?.stack || 'none'),
    'frontend: ' + (sides.find((side) => side.role === 'frontend')?.stack || 'none'),
    'contracts: contracts/openapi.yaml',
    'merge: no-ff',
    'sides:',
    ...sides.map(
      (side) =>
        '  - id: ' +
        side.id +
        '\n    path: ' +
        side.path +
        '\n    stack: ' +
        side.stack +
        '\n    role: ' +
        side.role,
    ),
    '',
  ].join('\n');
}

function baselineReq(sideRoot) {
  initProject(sideRoot);
  const config = readText(configPath(sideRoot));
  writeText(
    configPath(sideRoot),
    config
      .replace(/^workflowVersion:\s*3$/m, 'workflowVersion: 4')
      .replace(/^schemaVersion:\s*3$/m, 'schemaVersion: 4'),
  );
  patchConfigRequirements(sideRoot, { enabled: true, version: 'v1.0' });
  writeRequirementsBaseline(
    sideRoot,
    {
      functional: ['存量系统基线'],
      nonFunctional: [],
      constraints: [],
      acceptance: ['记录现有系统边界、技术栈、构建/测试命令'],
    },
    { version: 'v1.0' },
  );
}

function commitAssets(root) {
  if (!exists(path.join(root, '.git'))) return { status: 0, skipped: true };
  const paths = ['.specgate', 'openspec'];
  const add = git(root, ['add', '--', ...paths]);
  if (add.status !== 0) return add;
  const commit = git(root, [
    'commit',
    '--no-gpg-sign',
    '-q',
    '-m',
    'chore(specgate): 接入现有项目并写入存量基线',
    '--',
    ...paths,
  ]);
  return commit;
}

/**
 * 存量接入：只读扫描后原地加 .specgate/openspec 与存量基线；
 * 不移动代码、不生成 CRUD、不提交用户未提交改动。
 */
export function adoptWorkspace({ root }) {
  const existing = readWorkspace(root);
  if (existing)
    return { ok: true, skipped: true, message: '已是 v4 workspace', workspace: existing };
  const scan = scanWorkspace(root);
  if (scan.kind === 'v3') {
    return { ok: false, code: 'V3_PROJECT', message: 'v3 项目保持 v3，不自动迁移' };
  }
  if (scan.kind === 'empty') {
    return { ok: false, code: 'EMPTY_PROJECT', message: '空目录请使用 /sg-init --v4' };
  }

  const sides = detectSides(root);
  ensureDir(path.join(root, '.specgate'));
  ensureDir(path.join(root, 'contracts'));
  writeText(path.join(root, WORKSPACE_FILE), workspaceYaml(sides));
  writeText(
    path.join(root, '.specgate', 'state.json'),
    JSON.stringify(
      {
        schemaVersion: 4,
        workflowVersion: 4,
        phase: 'IDLE',
        change: null,
        topology: 'adopt',
        sides: sides.map((side) => side.path),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );

  for (const side of sides) {
    baselineReq(path.join(root, side.path));
  }
  const committed = commitAssets(root);
  if (committed.status !== 0) {
    return {
      ok: false,
      code: 'ADOPT_COMMIT_FAILED',
      message: committed.stderr || 'git commit 失败',
    };
  }
  return {
    ok: true,
    skipped: false,
    root,
    sides: sides.map((side) => side.path),
    committed: !committed.skipped,
    message: '存量接入完成：' + sides.map((side) => side.path + '=' + side.stack).join('，'),
  };
}

export function summarizeAdopt(result) {
  if (!result || result.ok === false) {
    return '存量接入失败（' + (result?.code || 'ERROR') + '）：' + (result?.message || '未知错误');
  }
  if (result.skipped) return '存量接入跳过：' + (result.message || '已接入');
  return [
    '存量接入完成（--adopt）',
    '模块：' + (result.sides || []).join('、'),
    '已写入：.specgate/workspace.yaml、各模块 openspec/REQ.md（REQ-001 存量系统基线）',
    '未改动代码、未生成 CRUD；用户未提交改动未被提交。',
    '下一步：/sg-change <name>',
  ].join('\n');
}
