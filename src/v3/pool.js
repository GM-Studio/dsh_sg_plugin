import { randomUUID } from 'node:crypto';
import { readConfig } from './change.js';
import { patchState } from './state.js';

const ROLE_PROMPTS = {
  implementer:
    '你是 implementer。只修改源码与 docs，不要碰 tests、openspec/specs 或 change 包。完成后在 worktree 内 git commit，并只回复完成摘要与 commit hash。',
  tester:
    '你是 tester。只允许新增 openspec/changes/<change>/tests/automation/**，或修改 H2 清单内的测试文件。不要改源码。完成后 git commit。',
};

const DEFAULT_CONFIG = {
  enabled: true,
  poolSize: 2,
  maxLeasedPerChange: 6,
  reuseTasks: 3,
  contextThreshold: 0.7,
  contextTokens: 128000,
  ttlMinutes: 10,
  breakerFailures: 2,
};

const pools = new Map();
const changeSlots = new Map();
const breakers = new Map();
const stats = {
  created: 0,
  disposed: 0,
  reused: 0,
  recycled: 0,
  leases: 0,
  hits: 0,
  misses: 0,
  failures: 0,
};

let maintenance = null;

function poolConfig(config) {
  const raw = config?.pool || {};
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    enabled: raw.enabled === undefined ? DEFAULT_CONFIG.enabled : raw.enabled !== false,
    poolSize: Number(raw.poolSize) > 0 ? Number(raw.poolSize) : DEFAULT_CONFIG.poolSize,
    maxLeasedPerChange:
      Number(raw.maxLeasedPerChange) > 0
        ? Number(raw.maxLeasedPerChange)
        : DEFAULT_CONFIG.maxLeasedPerChange,
    reuseTasks: Number(raw.reuseTasks) > 0 ? Number(raw.reuseTasks) : DEFAULT_CONFIG.reuseTasks,
    contextThreshold:
      Number(raw.contextThreshold) > 0 && Number(raw.contextThreshold) <= 1
        ? Number(raw.contextThreshold)
        : DEFAULT_CONFIG.contextThreshold,
    contextTokens:
      Number(raw.contextTokens) > 0 ? Number(raw.contextTokens) : DEFAULT_CONFIG.contextTokens,
    ttlMinutes: Number(raw.ttlMinutes) > 0 ? Number(raw.ttlMinutes) : DEFAULT_CONFIG.ttlMinutes,
    breakerFailures:
      Number(raw.breakerFailures) > 0
        ? Number(raw.breakerFailures)
        : DEFAULT_CONFIG.breakerFailures,
  };
}

function poolKey(root, role) {
  return `${root}::${role}`;
}

function ensurePool(key) {
  if (!pools.has(key)) pools.set(key, { entries: [], waiters: [] });
  return pools.get(key);
}

function messageChars(agent) {
  try {
    const messages = agent?.session?.deriveMessages?.() || [];
    return JSON.stringify(messages).length;
  } catch {
    return 0;
  }
}

function shouldRecycle(entry, config) {
  if (entry.tasks >= config.reuseTasks) return true;
  const tokens = Math.ceil((entry.chars || 0) / 4);
  return tokens >= config.contextTokens * config.contextThreshold;
}

async function disposeEntry(key, entry, reason) {
  const pool = pools.get(key);
  if (pool) {
    const index = pool.entries.indexOf(entry);
    if (index >= 0) pool.entries.splice(index, 1);
    const waiter = pool.waiters.shift();
    if (waiter) waiter();
  }
  if (entry.disposed) return;
  entry.disposed = true;
  stats.disposed += 1;
  if (reason === 'recycle') stats.recycled += 1;
  try {
    await entry.activation?.dispose?.();
  } catch {
    // best effort
  }
}

async function expireIdle(config, now = Date.now()) {
  for (const [key, pool] of pools) {
    for (const entry of [...pool.entries]) {
      if (entry.leased) continue;
      const ttlMinutes = entry.config?.ttlMinutes || config.ttlMinutes;
      if (now - entry.lastUsedAt >= ttlMinutes * 60 * 1000) {
        await disposeEntry(key, entry, 'ttl');
      }
    }
  }
}

function startMaintenance() {
  if (maintenance) return;
  maintenance = setInterval(() => {
    expireIdle(DEFAULT_CONFIG).catch(() => {});
  }, 60 * 1000);
  maintenance.unref?.();
}

function stopMaintenance() {
  if (maintenance) {
    clearInterval(maintenance);
    maintenance = null;
  }
}

function breakerKey(root, role) {
  return `${root}::${role}`;
}

function isBreakerOpen(root, role, config) {
  return (breakers.get(breakerKey(root, role)) || 0) >= config.breakerFailures;
}

function noteFailure(root, role, config) {
  const key = breakerKey(root, role);
  const next = (breakers.get(key) || 0) + 1;
  breakers.set(key, next);
  return next >= config.breakerFailures;
}

function noteSuccess(root, role) {
  breakers.set(breakerKey(root, role), 0);
}

async function acquireChangeSlot(change, max) {
  if (!changeSlots.has(change)) changeSlots.set(change, { count: 0, waiters: [] });
  const slot = changeSlots.get(change);
  while (slot.count >= max) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => slot.waiters.push(resolve));
  }
  slot.count += 1;
}

function releaseChangeSlot(change) {
  const slot = changeSlots.get(change);
  if (!slot) return;
  slot.count = Math.max(0, slot.count - 1);
  const waiter = slot.waiters.shift();
  if (waiter) waiter();
}

function buildPrompt({ role, prompt, skills, summary }) {
  return [
    ROLE_PROMPTS[role] || '',
    ...(skills || []).map((item) => item.text || ''),
    summary ? `上一个任务摘要：\n${summary}` : '',
    prompt,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function textOf(output) {
  return (output || [])
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function pickProvider(subagents) {
  const list = typeof subagents.list === 'function' ? subagents.list() : [];
  return list[0];
}

async function startChild({ runtime, role, worktree, text, parent }) {
  const subagents = runtime.service('subagents');
  if (!subagents || typeof subagents.startActivation !== 'function') {
    throw new Error('subagents service unavailable');
  }
  const provider = pickProvider(subagents);
  if (!provider) throw new Error('no subagent provider registered');
  const signal = new AbortController().signal;
  const activation = await subagents.startActivation({
    provider,
    label: `specgate-${role}`,
    request: {
      cwd: worktree,
      prompt: [{ type: 'text', text }],
      parent,
      signal,
      agentOptions: { ...(parent?.options || {}) },
    },
    delivery: 'caller',
    signal,
  });
  const result = await activation.result;
  return {
    activation,
    childId: activation.childId,
    text: textOf(result.output),
    stopReason: result.stopReason,
  };
}

async function continueChild({ runtime, entry, worktree, text, parent }) {
  const subagents = runtime.service('subagents');
  const agents = runtime.service('agents');
  const workingDirectory = runtime.service('workingDirectory');
  let child = agents?.get?.(entry.childId);
  if (!child) {
    try {
      const resolved = await runtime.service('sessionController')?.resolveAgent?.(entry.childId);
      child = resolved?.agent;
    } catch {
      child = undefined;
    }
  }
  if (child && workingDirectory?.set) await workingDirectory.set(child, worktree);
  await subagents.sendMessage(parent, entry.childId, [{ type: 'text', text }], {
    signal: new AbortController().signal,
  });
  await subagents.waitForChildren(parent);
  if (child?.whenIdle) await child.whenIdle();
  const session = runtime.service('sessions')?.get?.(entry.childId);
  const messages = session?.deriveMessages?.() || child?.session?.deriveMessages?.() || [];
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
  return textOf(assistant?.content);
}

async function createEntry({ runtime, key, role, worktree, parent, config, change, text }) {
  const child = await startChild({ runtime, role, worktree, text, parent });
  stats.created += 1;
  stats.misses += 1;
  startMaintenance();
  return {
    id: child.childId,
    childId: child.childId,
    activation: child.activation,
    role,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    tasks: 0,
    chars: 0,
    lastChange: null,
    lastSummary: null,
    leased: false,
    disposed: false,
    config,
    firstText: child.text,
  };
}

async function acquireEntry({ runtime, key, role, worktree, parent, config, change, text }) {
  const pool = ensurePool(key);
  await expireIdle(config);
  for (;;) {
    const idle = pool.entries.find((entry) => !entry.leased && !entry.disposed);
    if (idle) {
      if (shouldRecycle(idle, config)) {
        await disposeEntry(key, idle, 'recycle');
        continue;
      }
      idle.leased = true;
      idle.lastUsedAt = Date.now();
      stats.reused += 1;
      stats.hits += 1;
      return idle;
    }
    if (pool.entries.length < config.poolSize) {
      const created = await createEntry({ runtime, key, role, worktree, parent, config, change, text });
      created.leased = true;
      pool.entries.push(created);
      return created;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => pool.waiters.push(resolve));
  }
}

function releaseEntry(key, entry) {
  entry.leased = false;
  entry.lastUsedAt = Date.now();
  const pool = pools.get(key);
  const waiter = pool?.waiters.shift();
  if (waiter) waiter();
}

function summaryOf(task, text) {
  const head = String(text || '').replace(/\s+/g, ' ').slice(0, 400);
  return [`task=${task?.id || '-'}`, `ac=${(task?.ac || []).join(',')}`, `result=${head || '(empty)'}`].join(
    ' ',
  );
}

export function resolvePoolConfig(root) {
  return poolConfig(readConfig(root) || {});
}

export async function poolDispatch({
  runtime,
  role,
  root,
  change,
  worktree,
  prompt,
  skills = [],
  parent,
  task,
}) {
  const config = resolvePoolConfig(root);
  const text = buildPrompt({ role, prompt, skills, summary: null });

  if (role === 'reviewer' || !config.enabled) {
    await acquireChangeSlot(change, config.maxLeasedPerChange);
    try {
      const child = await startChild({ runtime, role, worktree, text, parent });
      stats.created += 1;
      await child.activation?.dispose?.();
      return { ok: true, text: child.text, agent: { id: child.childId, reused: false, tasks: 1 } };
    } catch (error) {
      return {
        ok: false,
        code: 'DISPATCH_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      releaseChangeSlot(change);
      persistPool(root);
    }
  }

  if (isBreakerOpen(root, role, config)) {
    return {
      ok: false,
      code: 'AGENT_BREAKER_OPEN',
      message: `${role} 连续失败已熔断，请人工处理后重试`,
    };
  }

  await acquireChangeSlot(change, config.maxLeasedPerChange);
  const key = poolKey(root, role);
  let entry = null;
  let resultText = '';
  try {
    entry = await acquireEntry({ runtime, key, role, worktree, parent, config, change, text });
    if (entry.tasks === 0) {
      resultText = entry.firstText;
    } else {
      const summary = entry.lastSummary ? `上一个任务摘要：\n${entry.lastSummary}\n\n` : '';
      const full = [
        `工作目录：${worktree}`,
        '请先使用 working_directory 工具切换到该目录，再执行任务。',
        '',
        `${summary}${text}`,
      ].join('\n');
      resultText = await continueChild({ runtime, entry, worktree, text: full, parent });
    }
    entry.tasks += 1;
    entry.chars = Math.max(entry.chars, text.length + resultText.length);
    entry.lastChange = change;
    noteSuccess(root, role);
    return {
      ok: true,
      text: resultText,
      agent: { id: entry.childId, reused: entry.tasks > 1, tasks: entry.tasks },
    };
  } catch (error) {
    stats.failures += 1;
    const opened = noteFailure(root, role, config);
    if (entry) await disposeEntry(key, entry, 'failure');
    return {
      ok: false,
      code: opened ? 'AGENT_BREAKER_OPEN' : 'DISPATCH_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (entry && !entry.disposed) {
      entry.lastSummary = summaryOf(task, resultText);
      releaseEntry(key, entry);
    }
    releaseChangeSlot(change);
    persistPool(root);
  }
}

export function persistPool(root) {
  if (!root) return;
  try {
    patchState(root, (draft) => {
      draft.pool = poolSnapshot(root);
    });
  } catch {
    // state may be unavailable in scripted tests
  }
}

export function poolSnapshot(root) {
  const roles = {};
  for (const [key, pool] of pools) {
    const [repo, role] = key.split('::');
    if (repo !== root) continue;
    roles[role] = {
      size: pool.entries.filter((entry) => !entry.disposed).length,
      leased: pool.entries.filter((entry) => entry.leased && !entry.disposed).length,
      idle: pool.entries.filter((entry) => !entry.leased && !entry.disposed).length,
      entries: pool.entries
        .filter((entry) => !entry.disposed)
        .map((entry) => ({
          id: entry.id,
          tasks: entry.tasks,
          lastChange: entry.lastChange,
          lastUsedAt: new Date(entry.lastUsedAt).toISOString(),
        })),
    };
  }
  return { updatedAt: new Date().toISOString(), stats: { ...stats }, roles };
}

export async function poolDisposeChange(root, change) {
  for (const [key, pool] of pools) {
    const [repo] = key.split('::');
    if (repo !== root) continue;
    for (const entry of [...pool.entries]) {
      if (!entry.leased && entry.lastChange === change) {
        await disposeEntry(key, entry, 'archive');
      }
    }
  }
  persistPool(root);
}

export async function poolDisposeAll() {
  stopMaintenance();
  for (const [key, pool] of pools) {
    for (const entry of [...pool.entries]) {
      await disposeEntry(key, entry, 'shutdown');
    }
  }
  pools.clear();
  changeSlots.clear();
  breakers.clear();
  for (const key of Object.keys(stats)) stats[key] = 0;
}

export function poolStats() {
  return { ...stats };
}
