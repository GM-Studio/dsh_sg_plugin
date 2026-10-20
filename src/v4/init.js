import { answerOf } from '../v3/requirements.js';
import { buildWorkspace } from './build.js';
import { wireSubmodules } from './workspace-change.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exists } from '../v3/util/fsx.js';
import {
  createWorkspaceLayout,
  resolveSelection,
  scanWorkspace,
  WORKSPACE_FILE,
  workspaceSummary,
} from './workspace.js';

const BACKEND_OPTIONS = ['node', 'python', 'java', 'none'];
const FRONTEND_OPTIONS = ['vue', 'react', 'none'];

async function askSelection({ userQuestions, agent, signal }) {
  const answer = await userQuestions.ask({
    questions: [
      {
        id: 'sg-v4-backend',
        header: '后端技术栈',
        question: '选择后端技术栈：node / python / java / none',
        options: BACKEND_OPTIONS.map((value) => ({
          label: value,
          description: value === 'java' ? '推荐' : '',
        })),
      },
      {
        id: 'sg-v4-frontend',
        header: '前端技术栈',
        question: '选择前端技术栈：vue / react / none',
        options: FRONTEND_OPTIONS.map((value) => ({
          label: value,
          description: value === 'react' ? '推荐' : '',
        })),
      },
    ],
    agent,
    signal,
  });
  return {
    backend: answerOf(answer, 0) || 'none',
    frontend: answerOf(answer, 1) || 'none',
  };
}

export function resolveInitRoot(cwd, input, options = {}) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: true, root: cwd };
  let value = raw;
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) {
    value = path.join(os.homedir(), value.slice(1));
  }
  const absolute = path.isAbsolute(value) ? value : path.resolve(cwd, value);
  const root = path.normalize(absolute);
  if (fs.existsSync(root)) {
    let stat;
    try {
      stat = fs.statSync(root);
    } catch (error) {
      return { ok: false, code: 'E_PATH_INVALID', message: '路径不可访问：' + root };
    }
    if (!stat.isDirectory()) {
      return { ok: false, code: 'E_PATH_NOT_DIR', message: '不是目录：' + root };
    }
    return { ok: true, root };
  }
  if (options.create === false) {
    return { ok: false, code: 'E_PATH_NOT_FOUND', message: '目录不存在：' + root };
  }
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch (error) {
    return { ok: false, code: 'E_PATH_CREATE_FAILED', message: '无法创建目录：' + root };
  }
  return { ok: true, root, created: true };
}

export function shouldUseV4Default(root, options = {}) {
  if (options.v3) return false;
  if (process.env.NODE_TEST_CONTEXT) return false;
  if (exists(path.join(root, WORKSPACE_FILE))) return true;
  if (exists(path.join(root, '.specgate', 'config.yaml'))) return false;
  return scanWorkspace(root).kind === 'empty';
}

export async function startV4Init({
  root,
  userQuestions,
  agent,
  signal,
  backend = null,
  frontend = null,
  preset = null,
  qualityRunner = null,
}) {
  const scan = scanWorkspace(root);
  if (scan.kind === 'v4') {
    return {
      ok: true,
      skipped: true,
      phase: 'IDLE',
      message: workspaceSummary(root),
      workspace: scan.workspace,
    };
  }
  if (scan.kind === 'existing') {
    return { ok: false, code: 'EXISTING_PROJECT', message: '存量仓库请使用 /sg-init --adopt' };
  }
  if (scan.kind === 'v3') {
    return {
      ok: false,
      code: 'V3_PROJECT',
      message: '当前是 v3 项目，保持 v3 行为；v4 只用于新项目或 --adopt',
    };
  }

  let selection = resolveSelection({ backend, frontend, preset });
  if (!selection.ok && userQuestions && typeof userQuestions.ask === 'function') {
    const picked = await askSelection({ userQuestions, agent, signal });
    selection = resolveSelection(picked);
  }
  if (!selection.ok) return selection;

  const created = createWorkspaceLayout({ root, selection });
  if (!created.ok) return created;
  const built = await buildWorkspace({ root, selection, qualityRunner });
  if (!built.ok) {
    return {
      ok: false,
      code: 'BUILD_FAILED',
      message:
        '脚手架/CRUD/质量阶段失败：' +
        built.results
          .map(
            (item) =>
              (item.side || 'side') + '=' + (item.reason || item.message || item.code || '失败'),
          )
          .join('；') +
        '；详见各 side 的 docs/mvp-scaffold-report.md',
      results: built.results,
    };
  }
  const wired = wireSubmodules({ root, sides: selection.sides });
  if (!wired.ok) {
    return {
      ok: false,
      code: 'SUBMODULE_FAILED',
      message: wired.message || 'submodule 接入失败',
      build: built,
    };
  }
  return {
    ...created,
    phase: 'IDLE',
    build: built,
    submodules: wired,
    message:
      'v4 workspace：' +
      selection.sides.map((side) => side.path + '=' + side.stack).join('，') +
      '；默认 REQ-001 搭建框架',
  };
}

export function summarizeV4Result(result) {
  if (!result || result.ok === false) {
    return 'v4 初始化失败（' + (result?.code || 'ERROR') + '）：' + (result?.message || '未知错误');
  }
  if (result.skipped) {
    return (
      'SpecGate v4 workspace 已存在（幂等跳过）：' +
      (result.message || '') +
      '\n下一步：/sg-change <name>'
    );
  }
  const built = result.build?.results || [];
  return [
    'SpecGate v4 workspace 已创建（Phase 2：布局 + 后端 CRUD + Git）',
    '子模块：' + (result.sides || []).join('、'),
    '根配置：.specgate/workspace.yaml',
    '默认需求：每个 submodule 的 openspec/REQ.md v1.0（REQ-001 搭建框架）',
    ...built.map(
      (item) =>
        '- ' +
        (item.side || '?') +
        '：' +
        (item.skipped
          ? '跳过（' + item.reason + '）'
          : '提交 ' + String(item.commit || '').slice(0, 8)),
    ),
    '子模块：' + (result.submodules?.modules || 0) + ' 个',
    '下一步：/sg-change <name>（需求盘问与并行门控将在后续接入）',
  ].join('\n');
}
