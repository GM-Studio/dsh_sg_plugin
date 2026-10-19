import path from 'node:path';
import { load } from './state.js';
import { readConfig } from './change.js';

function relativeTo(root, absolute) {
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, '/');
}

export function checkWrite(runtime, exec) {
  if (!exec || (exec.name !== 'write' && exec.name !== 'edit')) return undefined;
  const args = exec.arguments || {};
  const filePath = args.file_path || args.path;
  if (!filePath || typeof filePath !== 'string') return undefined;

  const root = path.resolve(runtime.getCwd(exec.agent));
  const relative = relativeTo(root, path.resolve(root, filePath));
  if (!relative) return undefined;

  if (relative.startsWith('.specgate/')) {
    return 'SpecGate v3：.specgate/ 由编排器维护，agent 不能写入。';
  }
  if (relative.startsWith('openspec/specs/')) {
    return 'SpecGate v3：openspec/specs/ 只能由归档事务修改。';
  }
  if (relative.endsWith('acceptance.md')) {
    return 'SpecGate v3：acceptance.md 由编排器生成，agent 不能写入。';
  }

  const loaded = load(root);
  if (!loaded.ok) return undefined;
  const config = readConfig(root);
  if (!config || Number(config.workflowVersion) < 3) return undefined;

  const state = loaded.state;
  if (state.phase === 'H1_PENDING') {
    const prefix = `openspec/changes/${state.change}/`;
    const frozen = [
      `${prefix}design.md`,
      `${prefix}tasks.md`,
      `${prefix}specs/`,
      `${prefix}tests/`,
    ];
    if (
      frozen.includes(relative) ||
      relative.startsWith(`${prefix}specs/`) ||
      relative.startsWith(`${prefix}tests/`) ||
      relative.startsWith('src/') ||
      relative.startsWith('tests/')
    ) {
      return `SpecGate v3：H1 尚未批准，不能写 ${relative}。先完成 /sg-approve H1。`;
    }
  }
  return undefined;
}

export function registerGuards(ctx, runtime) {
  if (!ctx.tools || typeof ctx.tools.guard !== 'function') return () => {};
  const dispose = ctx.tools.guard((exec) => checkWrite(runtime, exec));
  return () => {
    try {
      if (typeof dispose === 'function') dispose();
    } catch {
      // ignore teardown errors
    }
  };
}
