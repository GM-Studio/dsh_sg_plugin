// 动态调度与冲突串行化（M6 / SNA-0603、SNA-0604）。
//
// 目标：
// - AC-26 宿主能力不足时按实际可用能力调度，不伪造并发会话；
// - AC-27 文件权限冲突、资源互斥或未稳定的共享接口被识别后协调或串行；
// - D08 默认最多 4 个执行 agent（不含主控），单 agent 单次上限 30 分钟。

/** D08 默认上界（执行 agent，不含主控）。 */
export const MAX_CONCURRENT_AGENTS = 4;
/** 单 agent 单次运行上限：30 分钟。 */
export const MAX_AGENT_RUNTIME_MS = 30 * 60 * 1000;

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * 计算实际可用的并发槽位。
 * 宿主能力不足时按实际可用下调，绝不伪造并发会话（AC-26）。
 */
export function availableSlots({ hostCapacity = null, budget = MAX_CONCURRENT_AGENTS } = {}) {
  const limit = Number.isSafeInteger(budget) && budget > 0 ? budget : MAX_CONCURRENT_AGENTS;
  // 未探测到宿主能力：按 1 处理，而不是假设 4 个槽位存在。
  if (!Number.isSafeInteger(hostCapacity) || hostCapacity <= 0)
    return {
      ok: true,
      slots: Math.min(limit, 1),
      limit,
      hostCapacity: null,
      probed: false,
      reason: 'host-capacity-unprobed',
    };
  return {
    ok: true,
    slots: Math.min(limit, hostCapacity),
    limit,
    hostCapacity,
    probed: true,
    reason: hostCapacity < limit ? 'host-capacity-limited' : null,
  };
}

/** 两个任务的文件权限是否相交（AC-27）。 */
function filesOverlap(left = [], right = []) {
  const normalize = (pattern) => String(pattern).replace(/\/+$/, '');
  for (const a of left) {
    for (const b of right) {
      const na = normalize(a);
      const nb = normalize(b);
      if (na === nb) return { overlapping: [na] };
      // 前缀关系视为重叠：src/a/** 与 src/a/b.js
      if (na.endsWith('/**') && nb.startsWith(na.slice(0, -3))) return { overlapping: [na, nb] };
      if (nb.endsWith('/**') && na.startsWith(nb.slice(0, -3))) return { overlapping: [na, nb] };
    }
  }
  return null;
}

/**
 * 识别任务之间的冲突。
 * 三类：文件权限重叠、共享资源互斥、共享接口未稳定。
 */
export function detectConflicts({ tasks = [] } = {}) {
  if (!Array.isArray(tasks)) return failure('SCHEDULER_INPUT_INVALID', 'tasks 必须是数组');
  const conflicts = [];
  const list = tasks.filter((task) => object(task) && typeof task.id === 'string');

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const left = list[i];
      const right = list[j];

      const files = filesOverlap(
        Array.isArray(left.allowedFiles) ? left.allowedFiles : [],
        Array.isArray(right.allowedFiles) ? right.allowedFiles : [],
      );
      if (files)
        conflicts.push({
          type: 'file-overlap',
          tasks: [left.id, right.id],
          detail: files.overlapping,
        });

      const leftResources = Array.isArray(left.sharedResources) ? left.sharedResources : [];
      const rightResources = Array.isArray(right.sharedResources) ? right.sharedResources : [];
      const shared = leftResources.filter((entry) => rightResources.includes(entry));
      if (shared.length > 0)
        conflicts.push({ type: 'shared-resource', tasks: [left.id, right.id], detail: shared });

      // 未稳定接口：一方提供契约、另一方消费，而契约任务尚未完成。
      const provides = left.providesInterface ?? null;
      const consumes = Array.isArray(right.consumesInterfaces) ? right.consumesInterfaces : [];
      if (provides && consumes.includes(provides) && left.stable !== true)
        conflicts.push({
          type: 'unstable-interface',
          tasks: [left.id, right.id],
          detail: [provides],
        });
      const rightProvides = right.providesInterface ?? null;
      const leftConsumes = Array.isArray(left.consumesInterfaces) ? left.consumesInterfaces : [];
      if (rightProvides && leftConsumes.includes(rightProvides) && right.stable !== true)
        conflicts.push({
          type: 'unstable-interface',
          tasks: [right.id, left.id],
          detail: [rightProvides],
        });
    }
  }

  return { ok: true, conflicts, hasConflicts: conflicts.length > 0 };
}

/**
 * 选择本轮要并行执行的任务。
 * 规则：按层序推进，冲突任务串行化，总数不超过可用槽位。
 */
export function selectBatch({ layers = [], completed = [], tasks = [], slots = 1 } = {}) {
  if (!Array.isArray(layers)) return failure('SCHEDULER_INPUT_INVALID', 'layers 必须是数组');
  const byId = new Map(
    (Array.isArray(tasks) ? tasks : [])
      .filter((task) => object(task) && typeof task.id === 'string')
      .map((task) => [task.id, task]),
  );
  const done = new Set(Array.isArray(completed) ? completed : []);
  const selected = [];
  const deferred = [];

  for (const layer of layers) {
    const ready = layer.filter((id) => {
      if (done.has(id)) return false;
      const task = byId.get(id);
      if (!task) return false;
      return (Array.isArray(task.deps) ? task.deps : []).every((dep) => done.has(dep));
    });
    for (const id of ready) {
      if (selected.length >= Math.max(1, slots)) {
        deferred.push({ task: id, reason: 'slot-limit' });
        continue;
      }
      // 与已选任务冲突则本轮让位，串行执行。
      const conflicts = detectConflicts({
        tasks: [byId.get(id), ...selected.map((entry) => byId.get(entry))].filter(Boolean),
      });
      const relevant = conflicts.ok
        ? conflicts.conflicts.filter((entry) => entry.tasks.includes(id))
        : [];
      if (relevant.length > 0) {
        deferred.push({ task: id, reason: 'conflict', conflicts: relevant });
        continue;
      }
      selected.push(id);
    }
    if (selected.length >= Math.max(1, slots)) break;
  }

  return {
    ok: true,
    selected,
    deferred,
    slots: Math.max(1, slots),
    // 明确没有伪造并发：本轮实际并发数不超过槽位。
    actualConcurrency: selected.length,
  };
}

/**
 * 调度决策依据（可审计）。
 * 需求要求说明串行或并行的理由，而不是简单按任务数等比例增加 agent。
 */
export function explainDecision({ layer, slots, conflicts = [], hostCapacity = null } = {}) {
  return {
    layer: Array.isArray(layer) ? [...layer] : [],
    slots,
    hostCapacity,
    conflictCount: Array.isArray(conflicts) ? conflicts.length : 0,
    rationale: [
      'slots=' +
        String(slots) +
        '（宿主能力 ' +
        String(hostCapacity ?? 'unprobed') +
        '，上界 ' +
        MAX_CONCURRENT_AGENTS +
        '）',
      '冲突数=' + String(Array.isArray(conflicts) ? conflicts.length : 0) + '，冲突任务串行',
      '并发数不随任务数等比例放大',
    ],
  };
}
