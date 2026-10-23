import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalJson, hashValue } from '../events.js';
import { createInitialControlState } from '../core/control/domain.js';

const failure = (code, message) => ({ ok: false, code, message });
const exists = (target) => {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};
const clone = (value) => JSON.parse(JSON.stringify(value));

function verifyEventChain(content) {
  if (!content) return { ok: true, events: [], headHash: null, state: createInitialControlState() };
  if (!content.endsWith('\n'))
    return failure('AUDIT_CORRUPT', 'Control event history has an incomplete tail');
  const events = [];
  let previousHash = null;
  for (const [index, line] of content.slice(0, -1).split('\n').entries()) {
    try {
      const event = JSON.parse(line);
      const { hash, ...body } = event;
      if (
        event.schemaVersion !== 1 ||
        event.sequence !== index + 1 ||
        event.state?.schemaVersion !== 1 ||
        event.state?.version !== event.sequence ||
        event.previousHash !== previousHash ||
        typeof event.type !== 'string' ||
        !Number.isFinite(Date.parse(event.timestamp)) ||
        !/^[a-f0-9]{64}$/.test(hash || '') ||
        hashValue(body) !== hash
      )
        return failure('AUDIT_CORRUPT', `Control event ${index + 1} failed integrity`);
      events.push(event);
      previousHash = hash;
    } catch {
      return failure('AUDIT_CORRUPT', `Control event ${index + 1} is unreadable`);
    }
  }
  return {
    ok: true,
    events,
    headHash: previousHash,
    state: events.at(-1)?.state || createInitialControlState(),
  };
}

function safeDirectory(target) {
  const stat = exists(target);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw Object.assign(new Error('Control store path is unsafe'), { code: 'UNSAFE_PATH' });
  return true;
}

function safeFile(target) {
  const stat = exists(target);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1)
    throw Object.assign(new Error('Control store file is unsafe'), { code: 'UNSAFE_PATH' });
  return true;
}

export function readControlStore(root) {
  try {
    if (typeof root !== 'string' || !path.isAbsolute(root))
      return failure('UNSAFE_PATH', 'Control Store root must be absolute');
    let ancestor = path.resolve(root);
    for (let depth = 0; depth <= 128; depth++) {
      const stat = exists(ancestor);
      if (stat && (stat.isSymbolicLink() || !stat.isDirectory()))
        return failure('UNSAFE_PATH', 'Control store path is unsafe');
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      if (depth === 128) return failure('UNSAFE_PATH', 'Control store path exceeds depth bound');
      ancestor = parent;
    }
    if (!safeDirectory(root)) return { ok: true, state: createInitialControlState() };
    const events = path.join(root, 'events.jsonl');
    const snapshotPath = path.join(root, 'state.json');
    for (const file of [events, snapshotPath])
      if (safeFile(file) && fs.statSync(file).size > 64 * 1024 * 1024)
        return failure('CONTROL_STATUS_TOO_LARGE', '控制面日志过大，请使用控制台查看');
    const verified = verifyEventChain(exists(events) ? fs.readFileSync(events, 'utf8') : '');
    if (!verified.ok || !exists(snapshotPath)) return verified;
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    const version = snapshot?.state?.version;
    const event =
      Number.isSafeInteger(version) && version > 0 ? verified.events[version - 1] : null;
    return event &&
      snapshot.headHash === event.hash &&
      canonicalJson(snapshot.state) === canonicalJson(event.state)
      ? verified
      : failure('AUDIT_CORRUPT', 'Control snapshot differs from its event chain');
  } catch (error) {
    return failure(error.code || 'CONTROL_STATUS_UNAVAILABLE', '控制面只读状态不可用');
  }
}

export function createControlStore({
  root,
  clock = Date.now,
  lockTimeoutMs = 5000,
  ownerId = null,
} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    throw new TypeError('Control Store root must be an absolute path');
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 0 || lockTimeoutMs > 60000)
    throw new TypeError('lockTimeoutMs must be bounded');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const resolved = fs.realpathSync(root);
  safeDirectory(resolved);
  const eventsPath = path.join(resolved, 'events.jsonl');
  const snapshotPath = path.join(resolved, 'state.json');
  const lockPath = path.join(resolved, 'write.lock');
  const token = randomUUID();

  function ensureFilesSafe() {
    safeFile(eventsPath);
    safeFile(snapshotPath);
  }

  function read() {
    safeDirectory(resolved);
    ensureFilesSafe();
    const snapshotContent = exists(snapshotPath) ? fs.readFileSync(snapshotPath, 'utf8') : null;
    const content = exists(eventsPath) ? fs.readFileSync(eventsPath, 'utf8') : '';
    const verified = verifyEventChain(content);
    if (!verified.ok) return verified;
    if (snapshotContent !== null) {
      try {
        const snapshot = JSON.parse(snapshotContent);
        const version = snapshot?.state?.version;
        const matching =
          Number.isSafeInteger(version) && version > 0 ? verified.events[version - 1] : null;
        if (
          !Number.isSafeInteger(version) ||
          version < 1 ||
          version > verified.events.length ||
          !matching ||
          snapshot.headHash !== matching.hash ||
          canonicalJson(snapshot.state) !== canonicalJson(matching.state)
        )
          return failure('AUDIT_CORRUPT', 'Control snapshot differs from its event chain');
      } catch {
        return failure('AUDIT_CORRUPT', 'Control snapshot is unreadable');
      }
    }
    return verified;
  }

  function writeSnapshot(state, headHash) {
    safeFile(snapshotPath);
    const temporary = path.join(resolved, `.state-${randomUUID()}.tmp`);
    let promoted = false;
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, canonicalJson({ state, headHash }) + '\n');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, snapshotPath);
      promoted = true;
    } finally {
      if (!promoted) {
        try {
          fs.rmSync(temporary, { force: true, maxRetries: 20, retryDelay: 100 });
        } catch {
          // preserve the original write or rename failure; the temp file was never published
        }
      }
    }
  }

  function append(event) {
    safeFile(eventsPath);
    const fd = fs.openSync(eventsPath, 'a', 0o600);
    try {
      fs.writeFileSync(fd, canonicalJson(event) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      writeSnapshot(event.state, event.hash);
    } catch {
      // The append-only event remains the commit point.
    }
  }

  function lockOwner() {
    try {
      return JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  function pidAlive(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code !== 'ESRCH';
    }
  }

  function releaseLock() {
    const owner = lockOwner();
    if (owner?.token !== token) {
      const error = new Error('Control lock ownership changed');
      error.code = 'STORE_BUSY';
      throw error;
    }
    fs.unlinkSync(path.join(lockPath, 'owner.json'));
    fs.rmdirSync(lockPath);
  }

  async function acquireLock() {
    const deadline = Date.now() + lockTimeoutMs;
    while (true) {
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        fs.writeFileSync(
          path.join(lockPath, 'owner.json'),
          JSON.stringify({ pid: process.pid, token }),
          {
            flag: 'wx',
            mode: 0o600,
          },
        );
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const owner = lockOwner();
        if (owner && !pidAlive(owner.pid)) {
          try {
            if (lockOwner()?.token === owner.token) {
              fs.rmSync(path.join(lockPath, 'owner.json'), { force: true });
              fs.rmdirSync(lockPath);
            }
          } catch {
            // Another writer may have recovered it first.
          }
        }
      }
      if (Date.now() >= deadline) {
        const error = new Error('Control store is busy');
        error.code = 'STORE_BUSY';
        throw error;
      }
      await delay(20);
    }
  }

  async function mutate(operation) {
    if (typeof operation !== 'function') throw new TypeError('Control mutation is required');
    let locked = false;
    try {
      await acquireLock();
      locked = true;
      const readResult = read();
      if (!readResult.ok) return readResult;
      const state = clone(readResult.state);
      const outcome = await operation(state, {
        now: new Date(clock()).toISOString(),
        clock: clock(),
        ownerId,
      });
      if (!outcome?.ok) return outcome || failure('CONTROL_MUTATION_FAILED', 'Mutation failed');
      state.version = readResult.state.version + 1;
      const body = {
        schemaVersion: 1,
        sequence: state.version,
        timestamp: new Date(clock()).toISOString(),
        type: outcome.type,
        payload: outcome.payload || {},
        previousHash: readResult.headHash,
        state,
      };
      const event = { ...body, hash: hashValue(body) };
      append(event);
      return {
        ok: true,
        state: clone(state),
        event: clone(event),
        ...(outcome.result || {}),
      };
    } catch (error) {
      const known = new Set(['AUDIT_CORRUPT', 'STORE_BUSY', 'UNSAFE_PATH']);
      return failure(
        known.has(error.code) ? error.code : 'CONTROL_STORE_FAILED',
        known.has(error.code) ? error.message : 'Control store operation failed',
      );
    } finally {
      if (locked) {
        try {
          releaseLock();
        } catch {
          // A failed release remains visible through the bounded lock timeout.
        }
      }
    }
  }

  return Object.freeze({
    root: resolved,
    inspect: async () => {
      try {
        const result = read();
        return result.ok
          ? { ok: true, state: clone(result.state), version: result.state.version }
          : result;
      } catch (error) {
        return failure(error.code || 'CONTROL_STORE_FAILED', error.message);
      }
    },
    mutate,
  });
}
