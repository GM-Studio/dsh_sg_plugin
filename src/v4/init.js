import { answerOf, collectRequirements } from '../v3/requirements.js';
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
import { applyDetailsToSide, defaultSideDetails, resolveDependencies } from './catalog.js';
import { askApproval, skipQuality } from './approval.js';
import { askWizard, summarizeSelection } from './wizard.js';

async function askRequirements({ userQuestions, agent, signal }) {
  const requirements = await collectRequirements({ userQuestions, agent, signal });
  const summary = [
    '需求确认',
    '',
    '- 功能：' + (requirements.functional.join('；') || '（空）'),
    '- 非功能：' + (requirements.nonFunctional.join('；') || '（空）'),
    '- 约束：' + (requirements.constraints.join('；') || '（空）'),
    '- 验收：' + (requirements.acceptance.join('；') || '（空）'),
    '',
    '确认后才会写入需求文稿与代码。',
  ].join('\n');
  const answer = await userQuestions.ask({
    questions: [
      {
        id: 'sg-v4-requirements-confirm',
        header: '需求确认',
        question: summary,
        options: [{ label: '确认' }, { label: '取消' }],
      },
    ],
    agent,
    signal,
  });
  if (answerOf(answer) !== '确认') return { ok: false, code: 'CANCELLED' };
  return { ok: true, requirements };
}

function resumeSelection(scan) {
  const backend = scan.workspace.backend;
  const frontend = scan.workspace.frontend;
  const selection = resolveSelection({ backend, frontend });
  if (!selection.ok) return selection;
  const parsed = new Map((scan.sides || []).map((side) => [side.id, side]));
  selection.sides = selection.sides.map((side) => {
    const previous = parsed.get(side.id) || {};
    const details = {
      ...defaultSideDetails(side.stack, previous.framework),
      ...previous,
      runtimeVersion: previous.runtimeVersion || defaultSideDetails(side.stack).runtimeVersion,
    };
    if (side.stack === 'java') details.jdk = details.runtimeVersion;
    if (side.stack === 'python') details.pythonVersion = details.runtimeVersion;
    if (side.stack === 'node') details.nodeVersion = details.runtimeVersion;
    return applyDetailsToSide(
      side,
      details,
      resolveDependencies(
        { ...side, ...details },
        previous.depsPreset || 'recommended',
        previous.optionalDeps || [],
      ),
    );
  });
  return selection;
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
  initial = null,
}) {
  const canAsk = Boolean(userQuestions && typeof userQuestions.ask === 'function');
  const scan = scanWorkspace(root);
  if (scan.kind === 'v4') {
    const sides = scan.sides || [];
    const pending = sides.filter(
      (side) => !exists(path.join(root, side.path, '.specgate', 'bootstrap.done')),
    );
    if (!pending.length && exists(path.join(root, '.gitmodules'))) {
      return {
        ok: true,
        skipped: true,
        phase: 'IDLE',
        message: workspaceSummary(root),
        workspace: scan.workspace,
      };
    }
    const selection = resumeSelection(scan);
    if (!selection.ok) return selection;
    const approved = canAsk
      ? (await askApproval({ userQuestions, agent, signal, selection })) === 'approved'
      : false;
    const built = await buildWorkspace({
      root,
      selection,
      qualityRunner: approved ? qualityRunner : skipQuality(),
      approval: approved ? 'approved' : 'skipped',
    });
    if (!built.ok) {
      return {
        ok: false,
        code: 'BUILD_FAILED',
        message:
          '恢复构建失败：' +
          built.results
            .map(
              (item) =>
                (item.side || 'side') + '=' + (item.reason || item.message || item.code || '失败'),
            )
            .join('；'),
        results: built.results,
      };
    }
    const wired = wireSubmodules({ root, sides });
    return {
      ok: true,
      resumed: true,
      phase: 'IDLE',
      build: built,
      submodules: wired,
      approved,
      selection,
      message: workspaceSummary(root),
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

  let selection = null;
  let requirements = null;
  let approved = false;
  let decided = false;
  let rounds = 0;
  let wizardInitial = initial || {};
  while (rounds < 3) {
    rounds += 1;
    const picked = await askWizard({
      userQuestions,
      agent,
      signal,
      initial: wizardInitial,
      preset,
      backend,
      frontend,
    });
    if (!picked.ok) return picked;
    selection = picked;

    requirements = null;
    if (canAsk) {
      const asked = await askRequirements({ userQuestions, agent, signal });
      if (!asked.ok) return asked;
      requirements = asked.requirements;
    }

    if (!canAsk) {
      approved = false;
      decided = true;
      break;
    }

    const decision = await askApproval({ userQuestions, agent, signal, selection });
    if (decision === 'modify') {
      wizardInitial = { backend: selection.backend, frontend: selection.frontend };
      continue;
    }
    approved = decision === 'approved';
    decided = true;
    break;
  }
  if (!selection || !decided) {
    return { ok: false, code: 'CANCELLED', message: '未完成技术栈选择或审批' };
  }

  const created = createWorkspaceLayout({
    root,
    selection,
    requirements,
    approval: approved ? 'approved' : 'skipped',
  });
  if (!created.ok) return created;
  const built = await buildWorkspace({
    root,
    selection,
    qualityRunner: approved ? qualityRunner : skipQuality(),
    approval: approved ? 'approved' : 'skipped',
  });
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
    approved,
    selection,
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
  const degraded = built.some((item) => item.degraded);
  const lines = [
    'SpecGate v4 workspace 已创建（技术栈向导 + 依赖选择 + 审批）',
    '技术栈：',
    summarizeSelection(result.selection),
    '根配置：.specgate/workspace.yaml',
    '默认需求：每个 submodule 的 openspec/REQ.md v1.0（REQ-001 搭建框架）',
    '审批：' + (result.approved ? '已批准安装/质量阶段' : '未批准，已跳过安装与质量执行'),
  ];
  for (const item of built) {
    const status = item.skipped
      ? '跳过（' + (item.reason || 'skipped') + '）'
      : item.degraded
        ? 'degraded（质量失败，代码已提交）'
        : '提交 ' + String(item.commit || '').slice(0, 8);
    lines.push('- ' + (item.side || '?') + '：' + status);
  }
  if (degraded) lines.push('注意：至少一端质量阶段失败，详见各端 docs/mvp-scaffold-report.md');
  lines.push('子模块：' + (result.submodules?.modules || 0) + ' 个');
  lines.push('下一步：/sg-change <name>');
  return lines.join('\n');
}
