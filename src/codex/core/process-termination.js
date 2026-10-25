import { spawnSync } from 'node:child_process';

// Delivery commands start in their own POSIX process group. Windows taskkill
// can start successfully and still exit unsuccessfully (including DLL startup
// failures); both outcomes require a direct fallback instead of waiting forever.
export function terminateProcessTree(child, platform = process.platform) {
  if (
    !Number.isSafeInteger(child?.pid) ||
    child.pid <= 0 ||
    (child.exitCode !== null && child.exitCode !== undefined)
  )
    return;
  try {
    if (platform === 'win32') {
      const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 5000,
      });
      if (result.status !== 0) child.kill('SIGKILL');
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* The close event remains the observed outcome. */
    }
  }
}
