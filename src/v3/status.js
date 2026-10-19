import path from 'node:path';
import { exists, readText } from './util/fsx.js';
import { renderEnvLine } from './env-scan.js';

const NEXT_ACTION = {
  IDLE: '执行 /sg-change <name> --type <feature|modify|fix|remove> 创建 change',
  H0_PENDING: '完成初始化确认（确认页即 H0）：/sg-init；旧项目也可用 sg_approve（gate="H0"）',
  H1_PENDING: '写 proposal + specs delta，然后执行 /sg-run',
  PLAN: '写 design/tasks/cases/mapping/touched，然后执行 /sg-run',
  H2_PENDING: '等待人执行 /sg-approve H2',
  EXECUTING: '执行 /sg-run 推进任务',
  INTEGRATING: '执行 /sg-run 做全量回归并生成验收报告',
  H3_PENDING: '等待人执行 /sg-approve H3',
  ARCHIVING: '执行 /sg-run 完成归档',
  BLOCKED: '处理阻塞后执行 /sg-run --retry',
  DONE: '已完成',
  ABORTED: '已中止',
};

export function nextActionFor(state) {
  return NEXT_ACTION[state?.phase] || '未知阶段';
}

export function taskSummary(state) {
  const tasks = Object.values(state?.tasks || {});
  const counts = { total: tasks.length, merged: 0, failed: 0, pending: 0, running: 0 };
  for (const task of tasks) {
    if (task.status === 'merged') counts.merged += 1;
    else if (task.status === 'failed' || task.status === 'reverted') counts.failed += 1;
    else if (task.status === 'pending') counts.pending += 1;
    else counts.running += 1;
  }
  return counts;
}

export function statusData(project) {
  const { root, state, stateError, config } = project;
  if (!state) {
    return {
      initialized: false,
      root,
      code: stateError?.code || 'STATE_MISSING',
      message: stateError?.message || '未初始化',
      nextAction: '/sg-init',
    };
  }
  return {
    initialized: true,
    root,
    workflowVersion: Number(config?.workflowVersion) || null,
    change: state.change,
    changeKey: state.changeKey || null,
    type: state.type,
    phase: state.phase,
    nextAction: nextActionFor(state),
    tasks: taskSummary(state),
    suites: state.plan?.suites || null,
    runtime: state.runtime || null,
    pool: state.pool || null,
    h0: state.h0 || null,
    requirementsSource: state.requirementsSource || null,
    requirementsVersion: state.requirementsVersion || null,
    requirementsDoc: state.requirementsDoc || null,
    context: state.context || null,
    env: (() => {
      try {
        const file = path.join(root, '.specgate', 'env.json');
        return exists(file) ? JSON.parse(readText(file)) : null;
      } catch {
        return null;
      }
    })(),
    evidence: state.evidence,
    blockedReason: state.blockedReason,
    skills: state.skills,
  };
}

export function renderStatus(project) {
  const data = statusData(project);
  if (!data.initialized) {
    return [
      'SpecGate v3',
      `项目：${data.root}`,
      `状态：未初始化（${data.code}）`,
      `下一步：${data.nextAction}`,
    ].join('\n');
  }

  const lines = [
    'SpecGate v3',
    `项目：${data.root}`,
    `Change：${data.change || '（无）'}${data.type ? `（${data.type}）` : ''}`,
    ...(data.changeKey ? [`changeKey：${data.changeKey}`] : []),
    ...(data.suites?.length ? [`套件：${data.suites.map((suite) => suite.id).join(', ')}`] : []),
    `阶段：${data.phase}`,
    `下一步：${data.nextAction}`,
    `任务：共 ${data.tasks.total}，merged ${data.tasks.merged}，失败 ${data.tasks.failed}，进行中 ${data.tasks.running}`,
    `证据：headSeq=${data.evidence?.headSeq ?? 0}`,
  ];
  if (data.blockedReason) lines.push(`阻塞：${data.blockedReason}`);
  if (data.phase === 'H0_PENDING' && data.context) {
    lines.push(`H0 背景：${data.context.background}`);
    lines.push(`H0 技术栈：${data.context.stack}`);
    lines.push(`H0 验收：${data.context.acceptance}`);
  }
  if (data.requirementsSource) {
    const source = data.requirementsSource;
    const where = source.path ? `（来源：${source.path}）` : '';
    lines.push(`需求文档：${source.doc || 'docs/requirements/REQ.md'}${where}`);
  }
  if (data.h0?.hash) {
    const approved = data.h0.approvedAt ? `，${data.h0.approvedAt}` : '';
    lines.push(
      `H0：已确认 ${String(data.h0.hash)
        .replace(/^sha256:/, '')
        .slice(0, 12)}…${approved}`,
    );
  }
  lines.push(renderEnvLine(data.env));
  if (data.pool?.stats) {
    const s = data.pool.stats;
    lines.push(
      `Agent 池：创建 ${s.created}，复用 ${s.reused}，销毁 ${s.disposed}，回收 ${s.recycled}，失败 ${s.failures}`,
    );
    for (const [role, info] of Object.entries(data.pool.roles || {})) {
      lines.push(`池 ${role}：size=${info.size} leased=${info.leased} idle=${info.idle}`);
    }
  }
  if (data.runtime?.suites) {
    for (const [id, runtime] of Object.entries(data.runtime.suites)) {
      const parts = [];
      if (runtime.node) parts.push(`Node ${runtime.node.version}（${runtime.node.tool}）`);
      if (runtime.python) parts.push(`Python ${runtime.python.version}（${runtime.python.venv}）`);
      if (runtime.install) {
        parts.push(
          `安装 ${runtime.install.state}${runtime.install.reason ? `:${runtime.install.reason}` : ''}`,
        );
      }
      if (runtime.lastRun) {
        parts.push(
          `上次 ${runtime.lastRun.ok ? 'pass' : 'fail'}${runtime.lastRun.exitCode !== null ? `(${runtime.lastRun.exitCode})` : ''}`,
        );
      }
      lines.push(`运行时 ${id}：${parts.join('，') || '-'}`);
    }
  }
  if (data.skills?.suggested?.length || data.skills?.injected?.length) {
    lines.push(
      `技能：建议 ${(data.skills.suggested || []).join(', ') || '无'}；注入 ${(data.skills.injected || []).join(', ') || '无'}`,
    );
  }
  if (data.workflowVersion !== null && data.workflowVersion < 3) {
    lines.push('注意：项目 workflowVersion<3，v3 只读。');
  }
  return lines.join('\n');
}
