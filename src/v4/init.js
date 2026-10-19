import { answerOf } from '../v3/requirements.js';
import {
  createWorkspaceLayout,
  resolveSelection,
  scanWorkspace,
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

export async function startV4Init({
  root,
  userQuestions,
  agent,
  signal,
  backend = null,
  frontend = null,
  preset = null,
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
  return {
    ...created,
    phase: 'IDLE',
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
  return [
    'SpecGate v4 workspace 已创建（Phase 1：布局 + 默认 REQ）',
    '子模块：' + (result.sides || []).join('、'),
    '根配置：.specgate/workspace.yaml',
    '默认需求：每个 submodule 的 openspec/REQ.md v1.0（REQ-001 搭建框架）',
    '下一步：/sg-change <name>（Phase 2/3 将接入脚手架、CRUD、质量与归档）',
  ].join('\n');
}
