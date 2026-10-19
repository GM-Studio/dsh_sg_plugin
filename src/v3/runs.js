import fs from 'node:fs';
import path from 'node:path';
import { load, patchState } from './state.js';
import { exists } from './util/fsx.js';

const MAX_STATE_RUNS = 200;

export function runsFile(root, change) {
  return path.join(root, '.specgate', 'runs', `${change || 'unknown'}.jsonl`);
}

export function appendRun(root, entry) {
  const loaded = load(root);
  if (!loaded.ok) return loaded;
  const change = entry.change || loaded.state.change || 'unknown';
  const record = {
    at: new Date().toISOString(),
    change,
    task: entry.task || null,
    role: entry.role || 'unknown',
    agentId: entry.agentId || null,
    worktree: entry.worktree || null,
    commit: entry.commit || null,
    commands: entry.commands || [],
    durationMs: Number(entry.durationMs) || 0,
    result: entry.result || 'unknown',
    error: entry.error || null,
  };
  try {
    const file = runsFile(root, change);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // JSONL is best-effort; state still records the run
  }
  patchState(root, (draft) => {
    draft.runs = [...(draft.runs || []), record].slice(-MAX_STATE_RUNS);
  });
  return { ok: true, record };
}

export function readRuns(root, change, limit = 20) {
  const file = runsFile(root, change);
  if (!exists(file)) return [];
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function timelineLines(runs, limit = 20) {
  return runs.slice(-limit).map((run) => {
    const time = String(run.at || '')
      .replace('T', ' ')
      .slice(0, 19);
    const commit = String(run.commit || '-').slice(0, 8);
    return `${time}  ${run.role}  ${run.task || '-'}  ${run.result}  ${run.durationMs}ms  ${commit}`;
  });
}
