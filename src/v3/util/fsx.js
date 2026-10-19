import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

export function readJsonSafe(filePath) {
  try {
    return JSON.parse(readText(filePath));
  } catch {
    return null;
  }
}

export function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Write a file atomically: temp file in the same directory, fsync, then rename.
 * Windows may reject rename while another process holds the target; retry briefly.
 */
export function atomicWrite(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  let handle;
  try {
    handle = fs.openSync(tmp, 'w');
    fs.writeFileSync(handle, content, 'utf8');
    fs.fsyncSync(handle);
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        // ignore close errors, rename below reports the real problem
      }
    }
  }

  const retryable = new Set(['EPERM', 'EBUSY', 'EACCES']);
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      fs.renameSync(tmp, filePath);
      return filePath;
    } catch (error) {
      lastError = error;
      if (!retryable.has(error.code)) break;
      sleepSync(15 * (attempt + 1));
    }
  }

  try {
    fs.unlinkSync(tmp);
  } catch {
    // ignore cleanup failure
  }
  throw lastError;
}
