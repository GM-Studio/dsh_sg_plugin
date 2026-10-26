import fs from 'node:fs';
import path from 'node:path';

export const CODEX_LOCK = '.specgate/codex-verify.lock';
// A verification can legitimately run for hours on a cold Maven/npm cache. Only
// reclaim the lock after a live pid check fails or this long age is exceeded.
const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function lockOwner(lockPath) {
  try {
    const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    return owner && typeof owner === 'object' ? owner : null;
  } catch {
    return null;
  }
}

export function staleVerificationLock(lockPath) {
  const owner = lockOwner(lockPath);
  if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) return !processAlive(owner.pid);
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

/** Read-only summary used by sg_project_status; never clears or writes anything. */
export function verificationSnapshot({ root } = {}) {
  try {
    if (typeof root !== 'string' || !path.isAbsolute(root))
      return { status: 'unknown', ok: false, code: 'VERIFY_PATH_INVALID' };
    const lockPath = path.join(root, CODEX_LOCK);
    const owner = fs.existsSync(lockPath) ? lockOwner(lockPath) : null;
    const stale = owner ? staleVerificationLock(lockPath) : false;
    let report = null;
    try {
      report = JSON.parse(
        fs.readFileSync(path.join(root, '.specgate/codex-verify-report.json'), 'utf8'),
      );
    } catch {
      /* Missing or interrupted reports are reported below. */
    }
    const passed = Boolean(
      report && report.ok === true && report.v1Complete === true && report.status === 'verified',
    );
    const status = owner
      ? stale
        ? 'stale-lock'
        : 'running'
      : passed
        ? 'passed'
        : report?.status || 'not-run';
    return {
      status,
      ok: passed && !owner,
      runId: report?.runId || null,
      checkedAt: report?.checkedAt || report?.finishedAt || null,
      report: '.specgate/codex-verify-report.json',
      lock: owner ? { ...owner, stale } : null,
      nextAction: owner
        ? stale
          ? 'RUN_SG_VERIFY'
          : 'WAIT_FOR_VERIFY'
        : passed
          ? 'FINALIZE_BASELINE'
          : 'RUN_SG_VERIFY',
      message: owner
        ? stale
          ? '上次验证已中断并遗留锁；重新执行 sg_project_verify（或 sg_verify）会自动清理后继续。'
          : '验证正在运行，请等待结束。'
        : passed
          ? '已有当前完整验证证据，可建立项目基线。'
          : '尚未完成真实验证；执行 sg_project_verify（或 sg_verify）写入验证证据。',
    };
  } catch (error) {
    return {
      status: 'unknown',
      ok: false,
      code: 'VERIFY_SNAPSHOT_FAILED',
      message: error.message,
      nextAction: 'RUN_SG_VERIFY',
    };
  }
}
