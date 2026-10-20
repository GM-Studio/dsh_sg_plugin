import fs from 'node:fs';
import path from 'node:path';

// Scoped to exact live agent objects: a resumed/replaced agent may explicitly retry.
const deliveries = new WeakMap();
function tokenKey(value) {
  if (Array.isArray(value)) return '[' + value.map(tokenKey).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + tokenKey(value[key]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
const pendingPath = (root) => path.join(root, '.specgate', 'init-pending.json');
function pending(root, token) {
  const file = pendingPath(root);
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Pending state must not be a symlink');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  return !value.completed && tokenKey(value.token) === tokenKey(token) ? value : null;
}
function live(runtime, agent) {
  const agents = runtime?.service?.('agents');
  return !agents || (typeof agents.get === 'function' && agents.get(agent.id) === agent);
}
function record(root, token, agent, status, error) {
  try {
    const value = pending(root, token);
    if (!value) return;
    value.handoff = {
      status,
      agentId: agent.id,
      at: new Date().toISOString(),
      ...(error ? { error: String(error) } : {}),
    };
    fs.writeFileSync(pendingPath(root), JSON.stringify(value, null, 2) + '\n');
  } catch {
    /* Missing/replaced pending state must never be recreated. */
  }
}

/** Slash-command adapter ONLY. Tools should return the prompt to their active turn.
 * queued means scheduled, not accepted/completed; completion always resolves.
 * setImmediate leaves command normalization/command-done outside the new model turn.
 */
export function queueJavaInitHandoff({ runtime, agent, signal, result, createMessage } = {}) {
  const no = (reason) => ({ queued: false, reason });
  if (result?.code !== 'MAIN_AGENT_PENDING' || result?.report?.quality?.generateOnly)
    return no('not-pending');
  if (
    !result.root ||
    !result.token ||
    typeof result.mainAgentPrompt !== 'string' ||
    !result.mainAgentPrompt.trim()
  )
    return no('invalid-handoff');
  if (!agent || typeof agent.followup !== 'function') return no('followup-unavailable');
  if (signal?.aborted) return no('aborted');
  try {
    if (!live(runtime, agent)) return no('agent-not-live');
    if (!pending(result.root, result.token)) return no('stale-token');
  } catch {
    return no('pending-unavailable');
  }
  let entries = deliveries.get(agent);
  if (!entries) {
    entries = new Map();
    deliveries.set(agent, entries);
  }
  const key = path.resolve(result.root) + '\0' + tokenKey(result.token);
  if (entries.has(key)) return no('duplicate');
  let resolve;
  const completion = new Promise((done) => {
    resolve = done;
  });
  entries.set(key, completion);
  setImmediate(async () => {
    let accepted = false;
    const check = () => {
      if (signal?.aborted) throw new Error('aborted');
      if (!live(runtime, agent)) throw new Error('agent-not-live');
      if (!pending(result.root, result.token)) throw new Error('stale-token');
    };
    try {
      check();
      const factory = createMessage || (await import('@deepseek-ai/dsh-llm')).createUserMessage;
      check(); // Import/factory may yield while cancellation or replacement happens.
      if (typeof factory !== 'function') throw new Error('message-factory-unavailable');
      const message = await factory({
        content: [{ type: 'text', text: result.mainAgentPrompt }],
        source: {
          kind: 'specgate',
          form: 'notice',
          summary: 'Initialization quality continuation',
        },
      });
      check();
      if (!message || typeof message.id !== 'string' || message.role !== 'user')
        throw new Error('message-factory-returned-invalid-message');
      await agent.followup(message);
      accepted = true;
      record(result.root, result.token, agent, 'accepted');
      resolve({ accepted: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      record(result.root, result.token, agent, 'error', reason);
      resolve({ accepted: false, reason });
    } finally {
      if (!accepted) entries.delete(key);
    }
  });
  return { queued: true, reason: 'scheduled', completion };
}
