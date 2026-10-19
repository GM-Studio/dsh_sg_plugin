import path from 'node:path';
import { atomicWrite, ensureDir, exists, readText } from './util/fsx.js';

export const SCHEMA_VERSION = 3;

export const PHASES = [
  'IDLE',
  'H1_PENDING',
  'PLAN',
  'H2_PENDING',
  'EXECUTING',
  'INTEGRATING',
  'H3_PENDING',
  'ARCHIVING',
  'DONE',
  'BLOCKED',
  'ABORTED',
];

export const CHANGE_TYPES = ['feature', 'modify', 'fix', 'remove'];

export function nowIso() {
  return new Date().toISOString();
}

export function statePath(root) {
  return path.join(root, '.specgate', 'state.json');
}

function blankApproval() {
  return { artifactHash: null, issuedAt: null, expiresAt: null, consumedAt: null };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function emptyState(patch = {}) {
  const stamp = nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    workflowVersion: 3,
    change: null,
    type: null,
    phase: 'IDLE',
    baseCommit: null,
    baseline: { specsBase: null, artifactHash: null, approvedAt: null },
    plan: {
      designHash: null,
      casesHash: null,
      mappingHash: null,
      touchedHash: null,
      planHash: null,
      cmdHash: null,
      argv: [],
      cwd: '.',
      approvedAt: null,
    },
    tasks: {},
    waves: [],
    integration: null,
    touched: { modify: [], delete: [], bootstrap: [] },
    approvals: { H1: blankApproval(), H2: blankApproval(), H3: blankApproval() },
    skills: { suggested: [], injected: [] },
    evidence: { headSeq: 0, headHash: null },
    blockedReason: null,
    options: [],
    createdAt: stamp,
    updatedAt: stamp,
    ...patch,
  };
}

export function validateState(state) {
  const errors = [];
  if (!isPlainObject(state)) {
    return { ok: false, errors: ['state 必须是对象'] };
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${SCHEMA_VERSION}`);
  }
  if (state.workflowVersion !== 3) {
    errors.push('workflowVersion 必须为 3');
  }
  if (!PHASES.includes(state.phase)) {
    errors.push(`非法 phase：${String(state.phase)}`);
  }
  if (state.change !== null && typeof state.change !== 'string') {
    errors.push('change 必须是 string 或 null');
  }
  if (state.type !== null && !CHANGE_TYPES.includes(state.type)) {
    errors.push(`非法 type：${String(state.type)}`);
  }
  if (!isPlainObject(state.tasks)) {
    errors.push('tasks 必须是对象');
  }
  if (!Array.isArray(state.waves)) {
    errors.push('waves 必须是数组');
  }
  if (!isPlainObject(state.touched)) {
    errors.push('touched 必须是对象');
  } else {
    for (const key of ['modify', 'delete', 'bootstrap']) {
      if (!Array.isArray(state.touched[key])) errors.push(`touched.${key} 必须是数组`);
    }
  }
  if (!isPlainObject(state.approvals)) {
    errors.push('approvals 必须是对象');
  } else {
    for (const gate of ['H1', 'H2', 'H3']) {
      if (!isPlainObject(state.approvals[gate])) errors.push(`approvals.${gate} 缺失`);
    }
  }
  if (!isPlainObject(state.evidence)) {
    errors.push('evidence 必须是对象');
  } else if (!Number.isInteger(state.evidence.headSeq)) {
    errors.push('evidence.headSeq 必须是整数');
  }
  if (!isPlainObject(state.baseline)) errors.push('baseline 必须是对象');
  if (!isPlainObject(state.plan)) errors.push('plan 必须是对象');
  return { ok: errors.length === 0, errors };
}

export function load(root) {
  const file = statePath(root);
  if (!exists(file)) {
    return {
      ok: false,
      code: 'STATE_MISSING',
      message: '未找到 .specgate/state.json，项目未初始化为 v3',
      fix: '先执行 /sg-init',
    };
  }

  let raw;
  try {
    raw = readText(file);
  } catch (error) {
    return {
      ok: false,
      code: 'STATE_READ_FAILED',
      message: `读取状态失败：${error.message}`,
      fix: '检查 .specgate 目录权限',
    };
  }

  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      code: 'STATE_INVALID',
      message: '.specgate/state.json 不是合法 JSON',
      fix: '修复或删除该文件后重新初始化',
    };
  }

  const validation = validateState(state);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'STATE_INVALID',
      message: validation.errors.join('; '),
      fix: '修复或删除 .specgate/state.json 后重新初始化',
    };
  }
  return { ok: true, state };
}

export function save(root, state) {
  const validation = validateState(state);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'STATE_INVALID',
      message: validation.errors.join('; '),
      fix: '构造合法状态后重试',
    };
  }
  const next = { ...state, updatedAt: nowIso() };
  try {
    ensureDir(path.dirname(statePath(root)));
    atomicWrite(statePath(root), `${JSON.stringify(next, null, 2)}\n`);
  } catch (error) {
    return {
      ok: false,
      code: 'STATE_WRITE_FAILED',
      message: `写入状态失败：${error.message}`,
      fix: '检查 .specgate 目录权限或其他进程占用',
    };
  }
  return { ok: true, state: next };
}

export function init(root, patch = {}) {
  const file = statePath(root);
  if (exists(file)) {
    const loaded = load(root);
    if (!loaded.ok) return loaded;
    return { ok: true, state: loaded.state, reused: true };
  }
  const state = emptyState(patch);
  const saved = save(root, state);
  if (!saved.ok) return saved;
  return { ok: true, state: saved.state, reused: false };
}

export function patchState(root, mutator) {
  const loaded = load(root);
  if (!loaded.ok) return loaded;
  const draft = structuredClone(loaded.state);
  const result = mutator(draft);
  if (result === false) {
    return {
      ok: false,
      code: 'PATCH_ABORTED',
      message: '状态修改被取消',
      fix: '检查调用方逻辑',
    };
  }
  return save(root, draft);
}
