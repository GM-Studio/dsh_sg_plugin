import path from 'node:path';
import { load, patchState } from '../v3/state.js';
import { checkM1, checkM2 } from '../v3/phase.js';
import { readConfig } from '../v3/change.js';
import { readWorkspace } from './workspace.js';
import { runWorkspaceSides } from './scheduler.js';

export function gateForPhase(phase) {
  if (phase === 'H1_PENDING') return 'H1';
  if (phase === 'H2_PENDING') return 'H2';
  if (phase === 'H3_PENDING') return 'H3';
  if (phase === 'EXECUTING') return 'execute';
  if (phase === 'INTEGRATING') return 'integrate';
  if (phase === 'PLAN') return 'M2';
  if (phase === 'ARCHIVING') return 'archive';
  return null;
}

/** 驱动一个 side 到下一个门；不自动批准 H1/H2/H3。 */
export function driveSide({ root, side }) {
  const sideRoot = path.join(root, side.path);
  const loaded = load(sideRoot);
  if (!loaded.ok || !loaded.state) {
    return { ok: false, side, error: loaded.message || 'state missing' };
  }
  const state = loaded.state;
  if (state.phase === 'H1_PENDING') {
    const m1 = checkM1({ root: sideRoot, state });
    return { ok: m1.ok, side, phase: state.phase, gate: 'H1', errors: m1.errors };
  }
  if (state.phase === 'PLAN') {
    const config = readConfig(sideRoot);
    const m2 = checkM2({ root: sideRoot, state, config });
    if (!m2.ok) return { ok: false, side, phase: state.phase, gate: 'M2', errors: m2.errors };
    patchState(sideRoot, (draft) => {
      draft.phase = 'H2_PENDING';
      draft.plan = {
        designHash: m2.hashes.designHash,
        casesHash: m2.hashes.casesHash,
        mappingHash: m2.hashes.mappingHash,
        touchedHash: m2.hashes.touchedHash,
        planHash: m2.planHash,
        cmdHash: m2.cmdHash,
        argv: m2.command?.argv || [],
        cwd: m2.command?.cwd || '.',
        approvedAt: null,
      };
    });
    return { ok: true, side, phase: 'H2_PENDING', gate: 'H2' };
  }
  return { ok: true, side, phase: state.phase, gate: gateForPhase(state.phase) };
}

export async function driveWorkspace({ root }) {
  const workspace = readWorkspace(root);
  if (!workspace) return { ok: false, code: 'NOT_WORKSPACE', message: '不是 v4 workspace' };
  return runWorkspaceSides({
    root,
    runner: async (side) => {
      const result = driveSide({ root, side });
      if (result.ok === false) throw new Error((result.errors || [result.error]).join('; '));
      return result;
    },
  });
}

export function summarizeDrive(result) {
  if (!result || result.ok === false) {
    return 'workspace 驱动失败：' + (result?.message || '未知错误');
  }
  return [
    'workspace 已驱动到下一门：',
    ...result.results.map((item) => {
      if (!item.ok) return '- ' + item.side.path + '：失败 ' + (item.error || '');
      return '- ' + item.side.path + '：' + item.phase + (item.gate ? ' → 等待 ' + item.gate : '');
    }),
  ].join('\n');
}
