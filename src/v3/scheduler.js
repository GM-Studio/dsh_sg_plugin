export function buildWaves(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const level = new Map();
  const visiting = new Set();

  const depth = (id) => {
    if (level.has(id)) return level.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const deps = (byId.get(id)?.deps || []).filter((dep) => byId.has(dep));
    const value = deps.length ? Math.max(...deps.map(depth)) + 1 : 0;
    visiting.delete(id);
    level.set(id, value);
    return value;
  };

  for (const task of tasks) depth(task.id);
  const waves = [];
  for (const task of tasks) {
    const index = level.get(task.id) || 0;
    if (!waves[index]) waves[index] = [];
    waves[index].push(task.id);
  }
  return waves;
}

/** Pick the current wave and the next batch of runnable tasks. */
export function readyBatch(state, maxParallel = 2) {
  const tasks = Object.values(state.tasks || {});
  if (tasks.length === 0) return { done: true, waveIndex: -1, batch: [], waveTaskIds: [] };
  const merged = new Set(tasks.filter((task) => task.status === 'merged').map((task) => task.id));
  const waves = buildWaves(tasks);

  const waveIndex = waves.findIndex((ids) =>
    ids.some((id) => state.tasks[id]?.status !== 'merged'),
  );
  if (waveIndex < 0) return { done: true, waveIndex: -1, batch: [], waveTaskIds: [] };

  const runnable = waves[waveIndex].filter((id) => {
    const task = state.tasks[id];
    if (!task) return false;
    const retryable = task.status === 'pending' || (task.status === 'failed' && (task.attempts || 0) < 3);
    return retryable && (task.deps || []).every((dep) => merged.has(dep));
  });

  const parallel = runnable.filter((id) => state.tasks[id].parallel).slice(0, maxParallel);
  const batch = parallel.length > 0 ? parallel : runnable.slice(0, 1);
  return { done: false, waveIndex, batch, waveTaskIds: waves[waveIndex], runnable };
}
