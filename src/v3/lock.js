import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, exists, readJsonSafe, writeText } from './util/fsx.js';

export const DEFAULT_STALE_MS = 10 * 60 * 1000;

export function lockPath(root) {
  return path.join(root, '.specgate', 'run.lock');
}

export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return error && error.code === 'EPERM';
  }
}

export function inspect(root) {
  const file = lockPath(root);
  if (!exists(file)) return { ok: true, locked: false, holder: null, ageMs: null };
  const raw = readJsonSafe(file);
  if (!raw || !raw.pid) {
    return { ok: true, locked: false, corrupt: true, holder: null, ageMs: null };
  }
  const startedAt = Date.parse(raw.startedAt || '');
  const ageMs = Number.isFinite(startedAt) ? Date.now() - startedAt : Number.POSITIVE_INFINITY;
  const alive = isProcessAlive(raw.pid);
  return { ok: true, locked: alive, holder: raw, ageMs, alive };
}

export function acquire(root, { force = false, staleMs = DEFAULT_STALE_MS } = {}) {
  const file = lockPath(root);
  ensureDir(path.dirname(file));

  const current = inspect(root);
  if (current.locked) {
    const stale = !Number.isFinite(current.ageMs) || current.ageMs > staleMs;
    if (!stale && !force) {
      return {
        ok: false,
        code: 'LOCKED',
        message: `已有运行中的进程（pid ${current.holder.pid}）`,
        fix: '等它结束，或确认进程已死时使用 --force',
        holder: current.holder,
      };
    }
  }

  const record = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    host: process.env.COMPUTERNAME || process.env.HOSTNAME || '',
  };
  try {
    writeText(file, `${JSON.stringify(record)}\n`);
  } catch (error) {
    return {
      ok: false,
      code: 'LOCK_WRITE_FAILED',
      message: `写入运行锁失败：${error.message}`,
      fix: '检查 .specgate 目录权限',
    };
  }
  return { ok: true, record };
}

export function release(root) {
  const file = lockPath(root);
  const raw = readJsonSafe(file);
  if (!raw) {
    try {
      fs.unlinkSync(file);
    } catch {
      // already gone
    }
    return { ok: true, released: false };
  }
  if (raw.pid !== process.pid) {
    return {
      ok: false,
      code: 'NOT_OWNER',
      message: `运行锁属于进程 ${raw.pid}，当前进程 ${process.pid} 不能释放`,
      fix: '只释放自己持有的锁',
    };
  }
  try {
    fs.unlinkSync(file);
  } catch (error) {
    return {
      ok: false,
      code: 'LOCK_RELEASE_FAILED',
      message: error.message,
      fix: '手工删除 .specgate/run.lock',
    };
  }
  return { ok: true, released: true };
}
