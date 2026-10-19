import path from 'node:path';
import { load } from '../v3/state.js';
import { readWorkspace } from './workspace.js';

function sidesOf(workspace) {
  const regex = /-\s+id:\s*(\S+)\n\s+path:\s*(\S+)\n\s+stack:\s*(\S+)\n\s+role:\s*(\S+)/g;
  const sides = [];
  let match = regex.exec(workspace.raw);
  while (match) {
    sides.push({ id: match[1], path: match[2], stack: match[3], role: match[4] });
    match = regex.exec(workspace.raw);
  }
  return sides;
}

export function inspectSide({ root, side, change = null }) {
  const sideRoot = path.join(root, side.path);
  const loaded = load(sideRoot);
  const state = loaded.ok ? loaded.state : null;
  return {
    id: side.id,
    path: side.path,
    stack: side.stack,
    role: side.role,
    phase: state?.phase || 'UNKNOWN',
    change: state?.change || null,
    archived: change ? state?.change !== change : false,
  };
}

/**
 * 并发检查所有 side；runner 可注入（测试用）。
 * 单侧失败不影响其他侧，结果按 settled 返回。
 */
export async function runWorkspaceSides({ root, change = null, runner = null }) {
  const workspace = readWorkspace(root);
  if (!workspace) return { ok: false, code: 'NOT_WORKSPACE', message: '不是 v4 workspace' };
  const sides = sidesOf(workspace);
  const execute = runner || ((side) => Promise.resolve(inspectSide({ root, side, change })));
  const settled = await Promise.allSettled(sides.map((side) => execute(side)));
  const results = settled.map((item, index) => {
    const side = sides[index];
    if (item.status === 'fulfilled') return { ok: true, side, ...item.value };
    return { ok: false, side, error: String(item.reason?.message || item.reason) };
  });
  return {
    ok: results.every((item) => item.ok),
    results,
    sides: sides.map((side) => side.id),
  };
}

export function summarizeWorkspaceSides(result) {
  if (!result || result.ok === false) {
    return 'workspace 并发检查失败：' + (result?.message || '未知错误');
  }
  return [
    'workspace 并发状态：',
    ...result.results.map(
      (item) =>
        '- ' +
        item.side.path +
        '：' +
        (item.ok
          ? item.phase + (item.change ? '（' + item.change + '）' : '')
          : '失败 ' + item.error),
    ),
  ].join('\n');
}
