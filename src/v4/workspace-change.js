import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir, exists, readText, writeText } from '../v3/util/fsx.js';
import { createChange } from '../v3/change.js';
import { collectRequirements, answerOf } from '../v3/requirements.js';
import { load } from '../v3/state.js';
import { readWorkspace } from './workspace.js';

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

function ensureRootRepo(root) {
  if (!exists(path.join(root, '.git'))) {
    const init = git(root, ['init', '-q']);
    if (init.status !== 0) return init;
  }
  return { status: 0 };
}

function existingSubmodules(root) {
  return (
    exists(path.join(root, '.gitmodules')) &&
    readText(path.join(root, '.gitmodules')).includes('[submodule')
  );
}

/**
 * 把已构建的 side 仓库接成根 submodule：本地裸仓库 + .gitmodules + gitlink。
 * 幂等：已有 .gitmodules 时跳过。
 */
export function wireSubmodules({ root, sides }) {
  const repo = ensureRootRepo(root);
  if (repo.status !== 0) return { ok: false, message: repo.stderr };
  if (existingSubmodules(root)) return { ok: true, skipped: true };
  ensureDir(path.join(root, '.specgate', 'repos'));
  if (!exists(path.join(root, '.gitignore'))) {
    writeText(path.join(root, '.gitignore'), '.specgate/repos/\n');
  }
  const modules = [];
  for (const side of sides) {
    const sideRoot = path.join(root, side.path);
    if (!exists(path.join(sideRoot, '.git'))) {
      return { ok: false, message: side.path + ' 不是 git 仓库' };
    }
    const bare = path.join(root, '.specgate', 'repos', side.id + '.git');
    if (!exists(bare)) {
      const init = git(root, ['init', '--bare', '-q', bare]);
      if (init.status !== 0) return { ok: false, message: init.stderr };
    }
    const push = git(sideRoot, ['push', '--tags', bare, 'main']);
    if (push.status !== 0) return { ok: false, message: push.stderr };
    modules.push(
      '[submodule "' +
        side.id +
        '"]\n  path = ' +
        side.path +
        '\n  url = ./.specgate/repos/' +
        side.id +
        '.git',
    );
    const add = git(root, ['add', side.path]);
    if (add.status !== 0) return { ok: false, message: add.stderr };
  }
  writeText(path.join(root, '.gitmodules'), modules.join('\n') + '\n');
  const commitPaths = ['.gitmodules', '.gitignore'];
  for (const relative of ['.specgate/workspace.yaml', '.specgate/init-report.json', 'contracts']) {
    if (exists(path.join(root, relative))) commitPaths.push(relative);
  }
  const addAll = git(root, ['add', ...commitPaths]);
  if (addAll.status !== 0) return { ok: false, message: addAll.stderr };
  const commit = git(root, [
    'commit',
    '--no-gpg-sign',
    '-q',
    '-m',
    'chore(workspace): 接入 api/web 子模块',
  ]);
  if (commit.status !== 0) return { ok: false, message: commit.stderr };
  return { ok: true, skipped: false, modules: modules.length };
}

function selectedSides(workspace, raw) {
  const all = workspace.raw;
  const regex = /-\s+id:\s*(\S+)\n\s+path:\s*(\S+)\n\s+stack:\s*(\S+)\n\s+role:\s*(\S+)/g;
  const sides = [];
  let match = regex.exec(all);
  while (match) {
    sides.push({ id: match[1], path: match[2], stack: match[3], role: match[4] });
    match = regex.exec(all);
  }
  if (!raw) return sides;
  const wanted = new Set(
    String(raw)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
  return sides.filter((side) => wanted.has(side.id) || wanted.has(side.path));
}

/**
 * 根 change：创建 .specgate/changes/<name>.json，并在选定 side 内创建同名 change。
 * Phase 4b：需求盘问与并行门控尚未接入；这里只做 change 编排。
 */
/**
 * 先盘问需求并确认；确认前不写任何文件。
 */
export async function prepareWorkspaceChange({
  root,
  name,
  type = 'feature',
  sides = null,
  userQuestions,
  agent,
  signal,
}) {
  const workspace = readWorkspace(root);
  if (!workspace) return { ok: false, code: 'NOT_WORKSPACE', message: '不是 v4 workspace' };
  const selected = selectedSides(workspace, sides);
  if (!selected.length) return { ok: false, code: 'NO_SIDES', message: '没有可用的 side' };
  if (!userQuestions || typeof userQuestions.ask !== 'function') {
    return {
      ok: false,
      code: 'QUESTIONS_UNAVAILABLE',
      message: '当前宿主没有问答通道；未写入任何文件',
    };
  }
  let requirements;
  try {
    requirements = await collectRequirements({ userQuestions, agent, signal });
  } catch (error) {
    return { ok: false, code: 'QUESTIONS_UNAVAILABLE', message: String(error?.message || error) };
  }
  if (!requirements.functional.length) {
    return { ok: false, code: 'E_REQ_NO_FUNCTIONAL', message: '没有功能需求；未写入任何文件' };
  }
  const summary = [
    '# SpecGate v4 workspace change 确认',
    '',
    'change：' + name + '（' + type + '）',
    '子模块：' + selected.map((side) => side.path).join('、'),
    '',
    '- 功能：' + (requirements.functional.join('；') || '（空）'),
    '- 非功能：' + (requirements.nonFunctional.join('；') || '（空）'),
    '- 约束：' + (requirements.constraints.join('；') || '（空）'),
    '- 验收：' + (requirements.acceptance.join('；') || '（空）'),
    '',
    '确认后才会写入 REQ 增量、创建根/子 change。',
  ].join('\n');
  let answer;
  try {
    answer = await userQuestions.ask({
      questions: [
        {
          id: 'sg-v4-change-confirm',
          header: 'SpecGate workspace change 确认',
          question: summary,
          options: [
            { label: '确认', description: '写入需求并创建根/子 change' },
            { label: '取消', description: '不写入任何文件' },
          ],
        },
      ],
      agent,
      signal,
    });
  } catch (error) {
    return { ok: false, code: 'CONFIRM_FAILED', message: String(error?.message || error) };
  }
  if (answerOf(answer) !== '确认') {
    return { ok: false, code: 'CANCELLED', message: '用户取消；未写入任何文件' };
  }
  return { ok: true, requirements, sides: selected };
}

export function startWorkspaceChange({
  root,
  name,
  type = 'feature',
  sides = null,
  requirements = null,
}) {
  const workspace = readWorkspace(root);
  if (!workspace) return { ok: false, code: 'NOT_WORKSPACE', message: '不是 v4 workspace' };
  const selected = selectedSides(workspace, sides);
  if (!selected.length) return { ok: false, code: 'NO_SIDES', message: '没有可用的 side' };
  const created = [];
  for (const side of selected) {
    const sideRoot = path.join(root, side.path);
    const state = load(sideRoot);
    if (!state.ok || !state.state)
      return { ok: false, code: 'SIDE_NOT_READY', message: side.path + ' 未初始化' };
    const result = createChange(sideRoot, { name, type });
    if (!result.ok) return { ...result, side: side.path };
    created.push(side.path);
    if (requirements) {
      const dir = path.join(sideRoot, 'openspec', 'changes', name);
      writeText(
        path.join(dir, 'requirements.md'),
        [
          '# 需求摘要',
          '',
          '- 功能：' + requirements.functional.join('；'),
          '- 非功能：' + requirements.nonFunctional.join('；'),
          '- 约束：' + requirements.constraints.join('；'),
          '- 验收：' + requirements.acceptance.join('；'),
          '',
        ].join('\n'),
      );
    }
  }
  const dir = path.join(root, '.specgate', 'changes');
  ensureDir(dir);
  writeText(
    path.join(dir, name + '.json'),
    JSON.stringify(
      {
        schemaVersion: 4,
        name,
        type,
        sides: selected.map((side) => side.path),
        status: 'H1_PENDING',
        requirements,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  const stateFile = path.join(root, '.specgate', 'state.json');
  const state = JSON.parse(readText(stateFile));
  state.phase = 'H1_PENDING';
  state.change = name;
  state.type = type;
  state.updatedAt = new Date().toISOString();
  writeText(stateFile, JSON.stringify(state, null, 2) + '\n');
  return { ok: true, name, type, sides: created };
}

/**
 * 两侧都归档后：更新根 submodule 指针、提交、打 tag，根回到 IDLE。
 */
export function finalizeWorkspaceChange({ root, name = null }) {
  const dir = path.join(root, '.specgate', 'changes');
  if (!exists(dir)) return { ok: false, code: 'NO_CHANGES', message: '没有 workspace change' };
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
  if (!files.length) return { ok: false, code: 'NO_CHANGES', message: '没有 workspace change' };
  const target = name ? name + '.json' : files[0];
  const file = path.join(dir, target);
  if (!exists(file))
    return { ok: false, code: 'CHANGE_NOT_FOUND', message: '找不到 change：' + target };
  const record = JSON.parse(readText(file));
  const pending = [];
  for (const side of record.sides || []) {
    if (exists(path.join(root, side, 'openspec', 'changes', record.name))) pending.push(side);
  }
  if (pending.length) {
    return {
      ok: false,
      code: 'PENDING',
      message: '仍有子模块未归档：' + pending.join('、'),
      pending,
    };
  }
  const add = git(root, ['add', ...(record.sides || [])]);
  if (add.status !== 0) return { ok: false, message: add.stderr };
  const commit = git(root, [
    'commit',
    '--no-gpg-sign',
    '-q',
    '-m',
    'chore(workspace): 更新子模块指针',
  ]);
  if (commit.status !== 0) return { ok: false, message: commit.stderr };
  git(root, ['tag', record.name]);
  record.status = 'ARCHIVED';
  record.archivedAt = new Date().toISOString();
  writeText(file, JSON.stringify(record, null, 2) + '\n');
  const stateFile = path.join(root, '.specgate', 'state.json');
  const state = JSON.parse(readText(stateFile));
  state.phase = 'IDLE';
  state.change = null;
  state.type = null;
  state.updatedAt = new Date().toISOString();
  writeText(stateFile, JSON.stringify(state, null, 2) + '\n');
  return { ok: true, name: record.name, tag: record.name, sides: record.sides };
}

export function summarizeFinalize(result) {
  if (!result || result.ok === false) {
    const pending = result?.pending ? '\n待归档：' + result.pending.join('、') : '';
    return (
      'workspace 收尾未完成（' +
      (result?.code || 'ERROR') +
      '）：' +
      (result?.message || '未知错误') +
      pending
    );
  }
  return (
    'workspace change 已收尾：' + result.name + '\n已更新 submodule 指针并打 tag：' + result.tag
  );
}

export function summarizeWorkspaceChange(result) {
  if (!result || result.ok === false) {
    return (
      '创建 workspace change 失败（' +
      (result?.code || 'ERROR') +
      '）：' +
      (result?.message || '未知错误')
    );
  }
  return (
    '已创建 workspace change：' +
    result.name +
    '（' +
    result.type +
    '）\n子模块：' +
    result.sides.join('、') +
    '\n下一步：在各子模块执行 /sg-run'
  );
}
