import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RETRYABLE_CLEANUP_ERRORS = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);

function validPrefix(prefix) {
  return (
    typeof prefix === 'string' &&
    prefix.length >= 2 &&
    prefix.length <= 80 &&
    prefix.endsWith('-') &&
    !prefix.includes('/') &&
    !prefix.includes('\\') &&
    prefix !== '.' &&
    prefix !== '..'
  );
}

function cleanupOptions(options = {}) {
  return {
    recursive: true,
    force: true,
    maxRetries: Number.isSafeInteger(options.maxRetries) ? options.maxRetries : 20,
    retryDelay: Number.isSafeInteger(options.retryDelay) ? options.retryDelay : 100,
  };
}

export function removeTemporaryDirectory(directory, options = {}) {
  if (!directory || !path.isAbsolute(directory))
    throw Object.assign(new Error('Temporary directory must be an absolute path'), {
      code: 'TEMP_PATH_INVALID',
    });
  try {
    fs.rmSync(directory, cleanupOptions(options));
  } catch (error) {
    if (!RETRYABLE_CLEANUP_ERRORS.has(error.code)) throw error;
    throw Object.assign(new Error(`Unable to remove temporary directory: ${directory}`), {
      code: 'TEMP_CLEANUP_FAILED',
      cause: error,
      directory,
    });
  }
}

export function createTemporaryDirectory(prefix, { parent = os.tmpdir(), ...options } = {}) {
  if (!validPrefix(prefix))
    throw Object.assign(new Error('Temporary directory prefix must be a safe name ending in -'), {
      code: 'TEMP_PREFIX_INVALID',
    });
  const resolvedParent = path.resolve(parent);
  fs.mkdirSync(resolvedParent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(resolvedParent, prefix));
  let cleaned = false;
  return {
    path: directory,
    cleanup() {
      if (cleaned) return;
      removeTemporaryDirectory(directory, options);
      cleaned = true;
    },
  };
}

export function temporaryEnvironment(directory, env = process.env) {
  return {
    ...env,
    TEMP: directory,
    TMP: directory,
    TMPDIR: directory,
  };
}

export async function withTemporaryDirectory(prefix, callback, options = {}) {
  if (typeof callback !== 'function')
    throw new TypeError('Temporary directory callback is required');
  const temporary = createTemporaryDirectory(prefix, options);
  let callbackError = null;
  let result;
  try {
    result = await callback(temporary.path);
  } catch (error) {
    callbackError = error;
  }
  let cleanupError = null;
  try {
    temporary.cleanup();
  } catch (error) {
    cleanupError = error;
  }
  if (callbackError) {
    if (cleanupError) {
      callbackError.cleanupError = cleanupError;
      process.stderr.write(`[specgate] temporary cleanup failed: ${cleanupError.message}\n`);
    }
    throw callbackError;
  }
  if (cleanupError) throw cleanupError;
  return result;
}
