import path from 'node:path';
import { exists, readText } from '../v3/util/fsx.js';
import { load } from '../v3/state.js';
import { readWorkspace } from './workspace.js';

function readJson(file) {
  if (!exists(file)) return null;
  try {
    return JSON.parse(readText(file));
  } catch {
    return null;
  }
}

/** workspace.yaml 里的 sides 顺序块（与 scheduler 的解析保持一致）。 */
export function workspaceSideList(workspace) {
  if (!workspace) return [];
  const sides = [];
  const regex = /-\s+id:\s*(\S+)\n\s+path:\s*(\S+)\n\s+stack:\s*(\S+)\n\s+role:\s*(\S+)/g;
  let match = regex.exec(workspace.raw);
  while (match) {
    sides.push({ id: match[1], path: match[2], stack: match[3], role: match[4] });
    match = regex.exec(workspace.raw);
  }
  return sides;
}

function gateOf(phase) {
  if (phase === 'H1_PENDING' || phase === 'H2_PENDING' || phase === 'H3_PENDING') {
    return phase.replace('_PENDING', '');
  }
  return null;
}

function nextActionFor({ change, sides }) {
  if (!change) return '执行 sg_change <name> --type feature 创建第一个 change';
  const waiting = sides.find((side) => gateOf(side.phase));
  if (waiting) {
    return (
      waiting.path +
      ' 等待人工门 ' +
      gateOf(waiting.phase) +
      '（sg_approve 或 /sg-approve）；批准后执行 sg_run'
    );
  }
  const unknown = sides.find((side) => side.phase === 'UNKNOWN');
  if (unknown) return '子模块 ' + unknown.path + ' 状态不可读，先执行 sg_init 恢复';
  return '执行 sg_run 推进各端到下一门';
}

/**
 * v4 workspace 根的只读状态：根 state.json 是 schemaVersion 4，不能走 v3 的 load()。
 * 这里单独解析根状态，再逐端读取各自（v3 schema）的 phase。
 */
export function workspaceStatusData(root) {
  const workspace = readWorkspace(root);
  if (!workspace) {
    return {
      initialized: false,
      root,
      code: 'NOT_WORKSPACE',
      message: '不是 v4 workspace',
      nextAction: '/sg-init',
    };
  }
  const state = readJson(path.join(root, '.specgate', 'state.json')) || {};
  const sides = workspaceSideList(workspace).map((side) => {
    const loaded = load(path.join(root, side.path));
    return {
      ...side,
      phase: loaded.ok ? loaded.state.phase : 'UNKNOWN',
      change: loaded.ok ? loaded.state.change : null,
      error: loaded.ok ? null : loaded.message || 'state 不可读',
    };
  });
  const change = state.change || null;
  const phase =
    state.phase ||
    (sides.length && sides.every((side) => side.phase === 'IDLE') ? 'IDLE' : 'ACTIVE');
  return {
    initialized: state.projectReq ? state.projectReq.initialized === true : true,
    baseline: state.projectReq || null,
    initialization: readJson(path.join(root, '.specgate', 'init-report.json')),
    kind: 'v4',
    workflowVersion: 4,
    root,
    profile: workspace.profile || 'full',
    backend: workspace.backend,
    frontend: workspace.frontend,
    phase,
    change,
    type: state.type || null,
    sides,
    nextAction:
      state.projectReq && !state.projectReq.initialized
        ? '初始化尚未完成；保留残留，人工处理或换目录后重新确认，不自动续跑'
        : state.phase === 'BASELINE_PENDING_SYNC'
          ? '需求基线待同步；仅重试已批准的保存，或重新完成确认；禁止下一项 change'
          : nextActionFor({ change, sides }),
  };
}

export function renderWorkspaceStatus(data) {
  if (!data || data.initialized === false) {
    return [
      'SpecGate v4 workspace',
      '项目：' + (data?.root || ''),
      '状态：未初始化（' + (data?.code || 'NOT_WORKSPACE') + '）',
      '下一步：' + (data?.nextAction || '/sg-init'),
    ].join('\n');
  }
  const lines = [
    'SpecGate v4 workspace',
    '项目：' + data.root,
    '技术栈：backend=' + (data.backend || 'none') + '，frontend=' + (data.frontend || 'none'),
    '模式：' + data.profile + '（minimal=只写契约，full=含骨架与质量）',
    '阶段：' +
      data.phase +
      (data.change ? '（change：' + data.change + '）' : '（无进行中的 change）'),
    '子模块：',
  ];
  if (!data.sides.length) lines.push('- （无）');
  for (const side of data.sides) {
    lines.push(
      '- ' +
        side.path +
        '（' +
        side.stack +
        '）：' +
        side.phase +
        (side.change ? '（' + side.change + '）' : ''),
    );
  }
  lines.push('下一步：' + data.nextAction);
  return lines.join('\n');
}
