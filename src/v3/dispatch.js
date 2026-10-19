import { poolDispatch } from './pool.js';

/**
 * Dispatch one role turn.
 *
 * implementer/tester go through the per-repo Agent pool, which is built on the
 * DSH subagents service (`startActivation` / `sendMessage` / `waitForChildren`).
 * reviewer always gets a fresh child so its judgement stays independent.
 * A scripted `agentRunner` (tests) bypasses the pool entirely.
 */
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

    const subagents = runtime.service('subagents');
    if (!subagents || typeof subagents.startActivation !== 'function') {
      return {
        ok: false,
        code: 'SUBAGENTS_UNAVAILABLE',
        message: '宿主不提供 subagents 服务，无法派发子 Agent',
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
