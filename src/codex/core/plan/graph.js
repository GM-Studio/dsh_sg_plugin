// 任务图追溯与依赖分析（M6 / SNA-0601、SNA-0602）。
//
// 目标：
// - AC-23 独立模块产生可并行任务，依赖任务等待前置；
// - AC-24 无效/循环依赖或缺少必要输入的任务不被派发；
// - AC-25 任务可追溯到批准输入；自动调整仅限既定需求、权限与预算。

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * 拓扑分层：同一层内的任务互不依赖，因此可并行。
 * 存在环或悬空依赖时返回失败，而不是给出部分结果。
 */
export function scheduleLayers({ tasks = [] } = {}) {
  if (!Array.isArray(tasks)) return failure('PLAN_GRAPH_INVALID', 'tasks 必须是数组');
  const byId = new Map();
  for (const task of tasks) {
    if (!object(task) || typeof task.id !== 'string' || task.id.length === 0)
      return failure('PLAN_GRAPH_INVALID', '任务必须有合法 id');
    if (byId.has(task.id)) return failure('PLAN_GRAPH_INVALID', '任务 id 重复：' + task.id);
    byId.set(task.id, task);
  }

  // 悬空依赖：指向不存在的任务，绝不能静默忽略。
  const dangling = [];
  for (const task of byId.values())
    for (const dependency of Array.isArray(task.deps) ? task.deps : [])
      if (!byId.has(dependency)) dangling.push({ task: task.id, dependency });
  if (dangling.length > 0)
    return failure('PLAN_GRAPH_DANGLING', '存在指向不存在任务的依赖', { dangling });

  const layers = [];
  const placed = new Set();
  while (placed.size < byId.size) {
    const layer = [];
    for (const task of byId.values()) {
      if (placed.has(task.id)) continue;
      const deps = (Array.isArray(task.deps) ? task.deps : []).filter((id) => byId.has(id));
      if (deps.every((id) => placed.has(id))) layer.push(task.id);
    }
    // 一层都排不出来说明剩下的都在环里。
    if (layer.length === 0) {
      const remaining = [...byId.keys()].filter((id) => !placed.has(id));
      return failure('PLAN_GRAPH_CYCLE', '任务图存在循环依赖', { remaining });
    }
    layer.sort();
    for (const id of layer) placed.add(id);
    layers.push(layer);
  }

  return {
    ok: true,
    layers,
    // 最大并行度：最宽的那一层。
    maxWidth: layers.reduce((widest, layer) => Math.max(widest, layer.length), 0),
    depth: layers.length,
  };
}

/**
 * 校验任务是否具备被派发的必要条件（AC-24）。
 * 缺少 AC 映射、缺少文件边界、或依赖未完成，都不得派发。
 */
export function canDispatch({ task, completed = [] } = {}) {
  if (!object(task)) return failure('TASK_NOT_DISPATCHABLE', '任务必须是对象');
  const reasons = [];
  if (typeof task.id !== 'string' || task.id.length === 0) reasons.push('missing-id');
  if (!Array.isArray(task.acIds) || task.acIds.length === 0) reasons.push('missing-ac-mapping');
  if (!Array.isArray(task.allowedFiles) || task.allowedFiles.length === 0)
    reasons.push('missing-file-boundary');
  const deps = Array.isArray(task.deps) ? task.deps : [];
  const pending = deps.filter((id) => !completed.includes(id));
  if (pending.length > 0) reasons.push('dependencies-pending');
  if (reasons.length > 0)
    return { ok: false, code: 'TASK_NOT_DISPATCHABLE', reasons, pending, taskId: task.id ?? null };
  return { ok: true, taskId: task.id, pending: [] };
}

/**
 * 自动细分任务时的边界校验（AC-25）。
 * 子任务不得扩大父任务的文件权限、不得改变 AC 集合、不得放松验证。
 */
export function validateSubtask({ parent, child } = {}) {
  if (!object(parent) || !object(child)) return failure('SUBTASK_INVALID', '需要父任务与子任务');
  const problems = [];

  // 1. 文件权限必须是父集的子集。
  const parentFiles = new Set(Array.isArray(parent.allowedFiles) ? parent.allowedFiles : []);
  const widened = (Array.isArray(child.allowedFiles) ? child.allowedFiles : []).filter(
    (pattern) => !parentFiles.has(pattern),
  );
  if (widened.length > 0) problems.push({ code: 'FILE_SCOPE_WIDENED', files: widened });

  // 2. AC 集合不得扩大。
  const parentAcs = new Set(Array.isArray(parent.acIds) ? parent.acIds : []);
  const extraAcs = (Array.isArray(child.acIds) ? child.acIds : []).filter(
    (ac) => !parentAcs.has(ac),
  );
  if (extraAcs.length > 0) problems.push({ code: 'AC_SCOPE_WIDENED', acs: extraAcs });

  // 3. 验证不得被放松（子任务声明的验收项不得少于父任务）。
  const parentAcceptance = Array.isArray(parent.acceptance) ? parent.acceptance.length : 0;
  const childAcceptance = Array.isArray(child.acceptance) ? child.acceptance.length : 0;
  if (childAcceptance < parentAcceptance) problems.push({ code: 'ACCEPTANCE_RELAXED' });

  if (problems.length > 0)
    return { ok: false, code: 'SUBTASK_OUT_OF_BOUNDS', problems, taskId: child.id ?? null };
  return { ok: true, taskId: child.id ?? null, inheritedScope: parentFiles.size };
}

/**
 * 追溯：任务 → 批准输入（REQ/AC + 计划版本）。
 * 任何一个任务缺失追溯即整体不成立。
 */
export function traceTasks({ tasks = [], approvedAcs = [], planVersion = null } = {}) {
  if (!Array.isArray(tasks)) return failure('TRACE_INVALID', 'tasks 必须是数组');
  if (!Array.isArray(approvedAcs)) return failure('TRACE_INVALID', 'approvedAcs 必须是数组');
  const approved = new Set(approvedAcs);
  const untraceable = [];
  const traces = [];
  for (const task of tasks) {
    if (!object(task) || typeof task.id !== 'string') {
      untraceable.push({ task: null, reason: 'invalid-task' });
      continue;
    }
    const acs = Array.isArray(task.acIds) ? task.acIds : [];
    if (acs.length === 0) {
      untraceable.push({ task: task.id, reason: 'no-ac' });
      continue;
    }
    const unknown = acs.filter((ac) => !approved.has(ac));
    if (unknown.length > 0) {
      untraceable.push({ task: task.id, reason: 'ac-not-approved', unknown });
      continue;
    }
    if (typeof planVersion !== 'string' || planVersion.length === 0) {
      untraceable.push({ task: task.id, reason: 'no-plan-version' });
      continue;
    }
    traces.push({ task: task.id, acs: [...acs], planVersion });
  }
  return {
    ok: untraceable.length === 0,
    traces,
    untraceable,
    code: untraceable.length === 0 ? undefined : 'TRACE_INCOMPLETE',
  };
}
