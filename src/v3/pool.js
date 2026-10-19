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
    await entry.handle.dispose?.();
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
  if (next >= config.breakerFailures) return true;
  return false;
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

async function createEntry({ agents, key, role, worktree, parent, config }) {
  const handle = await agents.create({
    sessionId: randomUUID(),
    parentAgent: parent,
    agentOptions: { ...(parent?.options || {}) },
    meta: { cwd: worktree, origin: 'subagent' },
    setup(agentCtx) {
      const systemPrompt = agentCtx.get?.('systemPrompt');
      if (systemPrompt && typeof systemPrompt.context === 'function') {
        systemPrompt.context({
          name: 'specgate-v3-role',
          order: 50,
          text: ROLE_PROMPTS[role] || '',
        });
      }
    },
  });
  stats.created += 1;
  stats.misses += 1;
  startMaintenance();
  return {
    id: handle.agent.id,
    handle,
    agent: handle.agent,
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
  };
}

async function acquireEntry({ agents, key, role, worktree, parent, config, change }) {
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
      const created = await createEntry({ agents, key, role, worktree, parent, config });
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
  return [
    `task=${task?.id || '-'}`,
    `ac=${(task?.ac || []).join(',')}`,
    `result=${head || '(empty)'}`,
  ].join(' ');
}

async function runOnEntry({ entry, worktree, prompt, skills, summary, workingDirectory, change }) {
  if (workingDirectory && typeof workingDirectory.set === 'function') {
    await workingDirectory.set(entry.agent, worktree);
  }
  entry.agent.followup({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: buildPrompt({ role: entry.role, prompt, skills, summary }) }],
    source: { kind: 'specgate-v3' },
  });
  await entry.agent.whenIdle();
  const messages = entry.agent.session.deriveMessages();
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const text = (assistant?.content || [])
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
  entry.tasks += 1;
  entry.chars = messageChars(entry.agent);
  entry.lastChange = change;
  return text;
}

async function freshRun({ agents, role, worktree, prompt, skills, parent }) {
  const handle = await agents.create({
    sessionId: randomUUID(),
    parentAgent: parent,
    agentOptions: { ...(parent?.options || {}) },
    meta: { cwd: worktree, origin: 'subagent' },
    setup(agentCtx) {
      const systemPrompt = agentCtx.get?.('systemPrompt');
      if (systemPrompt && typeof systemPrompt.context === 'function') {
        systemPrompt.context({
          name: 'specgate-v3-role',
          order: 50,
          text: ROLE_PROMPTS[role] || '',
        });
      }
    },
  });
  stats.created += 1;
  try {
    handle.agent.followup({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: buildPrompt({ role, prompt, skills, summary: null }) }],
      source: { kind: 'specgate-v3' },
    });
    await handle.agent.whenIdle();
    const messages = handle.agent.session.deriveMessages();
    const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
    const text = (assistant?.content || [])
      .filter((block) => block && block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    return { ok: true, text };
  } finally {
    stats.disposed += 1;
    try {
      await handle.dispose?.();
    } catch {
      // best effort
    }
  }
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
  const agents = runtime.service('agents');
  const workingDirectory = runtime.service('workingDirectory');

  if (role === 'reviewer' || !config.enabled || !workingDirectory) {
    await acquireChangeSlot(change, config.maxLeasedPerChange);
    try {
      return await freshRun({ agents, role, worktree, prompt, skills, parent });
    } finally {
      releaseChangeSlot(change);
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
  let text = '';
  try {
    entry = await acquireEntry({ agents, key, role, worktree, parent, config, change });
    text = await runOnEntry({
      entry,
      worktree,
      prompt,
      skills,
      summary: entry.lastSummary,
      workingDirectory,
      change,
    });
    noteSuccess(root, role);
    return {
      ok: true,
      text,
      agent: { id: entry.id, reused: entry.tasks > 1, tasks: entry.tasks },
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
      entry.lastSummary = summaryOf(task, text);
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
  return {
    updatedAt: new Date().toISOString(),
    stats: { ...stats },
    roles,
  };
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
