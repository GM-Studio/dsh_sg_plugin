const NEXT_ACTION = {
  IDLE: '执行 /sg-change <name> --type <feature|modify|fix|remove> 创建 change',
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
    type: state.type,
    phase: state.phase,
    nextAction: nextActionFor(state),
    tasks: taskSummary(state),
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
    `阶段：${data.phase}`,
    `下一步：${data.nextAction}`,
    `任务：共 ${data.tasks.total}，merged ${data.tasks.merged}，失败 ${data.tasks.failed}，进行中 ${data.tasks.running}`,
    `证据：headSeq=${data.evidence?.headSeq ?? 0}`,
  ];
  if (data.blockedReason) lines.push(`阻塞：${data.blockedReason}`);
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
