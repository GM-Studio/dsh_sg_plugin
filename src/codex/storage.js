import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalJson, verifyEventChain } from './events.js';
import { hasSensitiveInput } from './core/sensitive-input.js';

const failure = (code, message) => Object.assign(new Error(message), { code });
const exists = (target) => {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

export function createStorage(projectRoot, { lockTimeoutMs = 5000 } = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot)
    throw new TypeError('projectRoot is required');
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 0 || lockTimeoutMs > 60000)
    throw new TypeError('lockTimeoutMs must be a bounded nonnegative integer');
  const root = fs.realpathSync(projectRoot);
  const directory = path.join(root, '.specgate', 'codex');
  const eventsPath = path.join(directory, 'events.jsonl');
  const snapshotPath = path.join(directory, 'state.json');
  const lockPath = path.join(directory, 'write.lock');
  const guardPath = path.join(directory, 'acquisition.lock');

  function checkPath(target, kind = 'file') {
    const stat = exists(target);
    if (
      stat &&
      (stat.isSymbolicLink() ||
        (kind === 'directory' ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1))
    )
      throw failure('UNSAFE_PATH', 'State storage contains an unsafe path');
    return stat;
  }

  function inspectDirectories(create = false) {
    for (const target of [path.join(root, '.specgate'), directory]) {
      if (!checkPath(target, 'directory')) {
        if (!create) return false;
        try {
          fs.mkdirSync(target);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
        checkPath(target, 'directory');
      }
    }
    return true;
  }

  function syncDirectory() {
    // Windows does not permit fsync on a directory. File data is still fsynced;
    // POSIX also persists the directory entry for a newly created WAL/snapshot.
    if (process.platform === 'win32') return;
    const fd = fs.openSync(directory, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  function persistSnapshot(state, headHash) {
    checkPath(snapshotPath);
    const temporary = path.join(directory, `.state-${randomUUID()}.tmp`);
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
      syncDirectory();
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

  function read(initialState, { recover = false } = {}) {
    if (!inspectDirectories())
      return { state: initialState(), headHash: null, events: [], recovered: false };
    checkPath(eventsPath);
    checkPath(snapshotPath);
    const verified = verifyEventChain(
      exists(eventsPath) ? fs.readFileSync(eventsPath, 'utf8') : '',
    );
    if (!verified.ok) throw failure(verified.code, verified.message);
    let snapshot = null;
    if (exists(snapshotPath)) {
      try {
        snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      } catch {
        throw failure('AUDIT_CORRUPT', 'Snapshot is unreadable; evidence was retained');
      }
      if (!Number.isSafeInteger(snapshot?.state?.version) || snapshot.state.version < 1)
        throw failure('AUDIT_CORRUPT', 'Snapshot version is invalid');
      if (snapshot.state.version > verified.events.length)
        throw failure('SNAPSHOT_AHEAD', 'Snapshot refers to missing audit events');
      const matching = verified.events[snapshot.state.version - 1];
      if (
        snapshot.headHash !== matching.hash ||
        canonicalJson(snapshot.state) !== canonicalJson(matching.state)
      )
        throw failure('AUDIT_CORRUPT', 'Snapshot differs from its committed audit event');
    }
    const state = verified.events.at(-1)?.state ?? initialState();
    const needsRecovery = state.version > (snapshot?.state?.version ?? 0);
    let snapshotPending = false;
    if (needsRecovery && recover) {
      try {
        persistSnapshot(state, verified.headHash);
      } catch {
        snapshotPending = true;
      }
    }
    return {
      state,
      headHash: verified.headHash,
      events: verified.events,
      recovered: needsRecovery,
      snapshotPending,
    };
  }

  function inspect(initialState) {
    if (!inspectDirectories())
      return { state: initialState(), headHash: null, events: [], recovered: false };
    const fingerprint = () =>
      [eventsPath, snapshotPath].map((target) => {
        const stat = checkPath(target);
        return stat ? `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` : null;
      });
    const before = fingerprint();
    let inspected;
    let problem;
    try {
      inspected = read(initialState);
    } catch (error) {
      problem = error;
    }
    if (canonicalJson(before) !== canonicalJson(fingerprint()))
      throw failure('STORE_BUSY', 'State changed during inspection; read it again');
    if (problem) throw problem;
    return inspected;
  }

  function owner(target) {
    const ownerPath = path.join(target, 'owner.json');
    checkPath(ownerPath);
    try {
      return JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
    } catch {
      return null;
    }
  }

  function definitelyDead(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return error.code === 'ESRCH';
    }
  }

  function release(target, token) {
    if (owner(target)?.token !== token) throw failure('STORE_BUSY', 'State lock ownership changed');
    fs.unlinkSync(path.join(target, 'owner.json'));
    fs.rmdirSync(target);
  }

  function claim(target, token) {
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'owner.json'), JSON.stringify({ pid: process.pid, token }), {
      flag: 'wx',
      mode: 0o600,
    });
  }

  async function withLock(operation) {
    inspectDirectories(true);
    const deadline = Date.now() + lockTimeoutMs;
    const token = randomUUID();
    while (true) {
      let guarded = false;
      let claimed = false;
      try {
        checkPath(guardPath, 'directory');
        claim(guardPath, token);
        guarded = true;
        if (checkPath(lockPath, 'directory')) {
          const previous = owner(lockPath);
          if (previous && definitelyDead(previous.pid)) release(lockPath, previous.token);
        }
        if (!exists(lockPath)) {
          claim(lockPath, token);
          claimed = true;
        }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      } finally {
        if (guarded) release(guardPath, token);
      }
      if (claimed) break;
      if (Date.now() >= deadline)
        throw failure(
          'STORE_BUSY',
          'State writer is busy; retained locks require inspection if their acquisition was interrupted',
        );
      await delay(Math.min(20, Math.max(1, deadline - Date.now())));
    }
    try {
      return await operation();
    } finally {
      release(lockPath, token);
    }
  }

  function append(event) {
    if (hasSensitiveInput(event))
      throw failure(
        'SENSITIVE_INPUT',
        'Apparent credentials cannot be persisted in workflow history',
      );
    checkPath(eventsPath);
    const first = !exists(eventsPath);
    const fd = fs.openSync(eventsPath, 'a', 0o600);
    try {
      fs.writeFileSync(fd, canonicalJson(event) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (first) syncDirectory();
    // The durable WAL record is the commit point. A failed snapshot must never
    // turn an already committed operation into an apparent retryable failure.
    try {
      persistSnapshot(event.state, event.hash);
      return { snapshotPending: false };
    } catch {
      return { snapshotPending: true };
    }
  }

  return { read, inspect, withLock, append, inspectDirectories };
}
