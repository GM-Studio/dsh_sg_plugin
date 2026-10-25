import { canonicalJson } from '../events.js';
import { updateProjectFacts } from '../state-machine.js';
import { emptyState, load } from './state.js';

export function init(root) {
  const current = load(root);
  if (current.ok) return { ...current, reused: true };
  if (current.code !== 'STATE_MISSING') return current;
  return { ok: true, state: emptyState(), reused: false };
}

// Compatibility callers may record project observations, never workflow state.
export function patchState(root, mutate) {
  const current = init(root);
  if (!current.ok) return current;
  const draft = structuredClone(current.state);
  if (mutate(draft) === false) return { ok: false, code: 'PATCH_ABORTED' };
  const workflow = (state) =>
    Object.fromEntries(
      Object.entries(state).filter(([key]) => !['initialization', 'runtime'].includes(key)),
    );
  if (canonicalJson(workflow(draft)) !== canonicalJson(workflow(current.state)))
    return {
      ok: false,
      code: 'LEGACY_WORKFLOW_READ_ONLY',
      message: 'Legacy workflow mutation is disabled; use the authoritative Change kernel',
    };
  const saved = updateProjectFacts(root, (facts) => {
    facts.runtime = draft.runtime;
    if (draft.initialization) facts.initialization = draft.initialization;
  });
  return saved.ok ? { ...saved, state: draft } : saved;
}
