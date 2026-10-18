import path from 'node:path';
import { ensureDir, readJsonIfExists, writeJson } from './util.js';

export const QUALITY_STAGES = ['format', 'test', 'review'];
export const MAX_ATTEMPTS = 2;

function qualityPath(root) {
  return path.join(path.resolve(root), '.specgate', 'state', 'quality.json');
}

export function readQualityState(root) {
  return (
    readJsonIfExists(qualityPath(root)) || {
      stages: {},
      blocked: false,
    }
  );
}

export function stageAttempts(root, stage) {
  const state = readQualityState(root);
  return Number(state.stages?.[stage]?.attempts) || 0;
}

export function isQualityBlocked(root) {
  return readQualityState(root).blocked === true;
}

export function recordQualityResult(root, stage, ok, detail = '') {
  const state = readQualityState(root);
  const current = state.stages?.[stage] || { attempts: 0, lastVerdict: null };
  if (ok) {
    state.stages = {
      ...(state.stages || {}),
      [stage]: { attempts: 0, lastVerdict: 'pass', detail },
    };
    state.blocked = false;
  } else {
    const attempts = Number(current.attempts || 0) + 1;
    state.stages = {
      ...(state.stages || {}),
      [stage]: { attempts, lastVerdict: 'fail', detail },
    };
    if (attempts >= MAX_ATTEMPTS) state.blocked = true;
  }
  state.updatedAt = new Date().toISOString();
  ensureDir(path.dirname(qualityPath(root)));
  writeJson(qualityPath(root), state);
  return state;
}

export function clearQualityState(root) {
  const state = { stages: {}, blocked: false, updatedAt: new Date().toISOString() };
  ensureDir(path.dirname(qualityPath(root)));
  writeJson(qualityPath(root), state);
  return state;
}
