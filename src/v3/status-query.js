import path from 'node:path';
import { exists, readText } from './util/fsx.js';
import { load } from './state.js';
import { configPath, parseConfig } from './change.js';
import { renderStatus, statusData } from './status.js';
import { readRuns, timelineLines } from './runs.js';

export function resolveRepoPath(cwd, input) {
  const root = input ? path.resolve(cwd, input) : cwd;
  if (!exists(root)) {
    return { ok: false, code: 'PATH_NOT_FOUND', message: `路径不存在：${root}` };
  }
  if (!exists(path.join(root, '.specgate', 'state.json'))) {
    return { ok: false, code: 'STATE_MISSING', message: `不是 SpecGate 仓库：${root}` };
  }
  return { ok: true, root };
}

export function loadProjectAt(root) {
  const loaded = load(root);
  if (!loaded.ok) return loaded;
  const config = exists(configPath(root)) ? parseConfig(readText(configPath(root))) : {};
  return { ok: true, project: { root, state: loaded.state, config } };
}

export function statusRuns(project, limit = 20) {
  const change = project.state?.change;
  const fromFile = change ? readRuns(project.root, change, limit) : [];
  if (fromFile.length > 0) return fromFile;
  return (project.state?.runs || []).slice(-limit);
}

export function renderStatusAt(project, { verbose = false } = {}) {
  const base = renderStatus(project);
  if (!verbose) return base;
  const runs = statusRuns(project);
  if (runs.length === 0) return `${base}\n\n运行时间线：无记录`;
  return `${base}\n\n运行时间线（最近 ${runs.length} 条）：\n${timelineLines(runs).join('\n')}`;
}

export function statusJsonAt(project, { verbose = false } = {}) {
  const data = statusData(project);
  if (!verbose) return data;
  return { ...data, runs: statusRuns(project), reviews: project.state?.reviews || [] };
}
