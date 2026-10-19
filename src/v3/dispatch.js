import { poolDispatch } from './pool.js';

/** Dispatch a role turn. implementer/tester use the per-repo pool; reviewer stays fresh. */
export function createDispatcher(runtime) {
  return async function dispatch({
    role,
    task,
    worktree,
    prompt,
    skills = [],
    parent,
    root,
    change,
  }) {
    const scripted = runtime.agentRunner();
    if (typeof scripted === 'function') {
      const result = await scripted({ role, task, worktree, prompt, skills });
      return {
        ok: result?.ok !== false,
        text: String(result?.text || ''),
        code: result?.code,
        message: result?.message,
      };
    }

    const agents = runtime.service('agents');
    if (!agents || typeof agents.create !== 'function') {
      return {
        ok: false,
        code: 'AGENTS_UNAVAILABLE',
        message: '宿主不提供 agents 服务，无法派发子 Agent',
      };
    }

    let projectRoot = root;
    let currentChange = change;
    if (!projectRoot || !currentChange) {
      const project = runtime.project(parent);
      if (!projectRoot) projectRoot = project.root;
      if (!currentChange) currentChange = project.state?.change || 'unknown';
    }

    return poolDispatch({
      runtime,
      role,
      root: projectRoot,
      change: currentChange,
      worktree,
      prompt,
      skills,
      parent,
      task,
    });
  };
}
