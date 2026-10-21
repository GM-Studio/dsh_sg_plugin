import { poolDispatch } from './pool.js';
import fs from 'node:fs';
import path from 'node:path';
import { loadTemplateStyle, projectSourceHash } from './template-style.js';

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
    const style = loadTemplateStyle(worktree, {
      required: Boolean(root && fs.existsSync(path.join(root, '.specgate/template-style.json'))),
    });
    if (!style.ok) return style;
    if (!style.skipped) {
      prompt = prompt + '\n\n' + style.prompt;
      if (role === 'reviewer')
        prompt +=
          '\n走查 JSON 另须包含 sourceHash="' +
          projectSourceHash(worktree) +
          '"、templateManifestHash="' +
          style.manifestHash +
          '"、checklist 对象。checklist 的 layering/transactions/errors/authentication/files/templateStyle/tests 七项各为 {"status":"pass|fail","reason":"具体走查依据"}；不得把 lint 当作走查。';
      const directory = path.join(root || worktree, '.specgate/runs');
      fs.mkdirSync(directory, { recursive: true });
      fs.appendFileSync(
        path.join(directory, 'template-references.jsonl'),
        JSON.stringify({
          at: new Date().toISOString(),
          role,
          change,
          task: task?.id,
          worktree,
          version: style.version,
          manifestHash: style.manifestHash,
          references: style.references,
        }) + '\n',
      );
    }
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
