import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hasSensitiveInput } from './sensitive-input.js';

const failure = (code, message) => ({ ok: false, code, message });
const hash = (value) => createHash('sha256').update(value).digest('hex');

function safeRelative(relative) {
  return (
    typeof relative === 'string' &&
    relative.length > 0 &&
    relative.length <= 1024 &&
    !path.isAbsolute(relative) &&
    ![...relative].some((character) => character.charCodeAt(0) < 32) &&
    !/^[A-Za-z]:/.test(relative) &&
    relative
      .split(/[\\/]/)
      .every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}

function inspectExisting(root, relative, { allowMissing = true } = {}) {
  const parts = relative.split(/[\\/]/);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT' && allowMissing)
        return { ok: true, target: path.join(root, relative) };
      return failure('ARTIFACT_READ_FAILED', 'Artifact path cannot be inspected');
    }
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1))
      return failure('UNSAFE_ARTIFACT_PATH', 'Artifact paths cannot contain symlinks or hardlinks');
    if (index < parts.length - 1 && !stat.isDirectory())
      return failure('UNSAFE_ARTIFACT_PATH', 'Artifact parent is not an ordinary directory');
    if (index === parts.length - 1 && !stat.isFile() && !stat.isDirectory())
      return failure('UNSAFE_ARTIFACT_PATH', 'Artifact target is not an ordinary file');
  }
  return { ok: true, target: current };
}

export function createArtifactStore({ projectRoot, maximumBytes = 8 * 1024 * 1024 } = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot)
    throw new TypeError('projectRoot is required');
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw new TypeError('maximumBytes must be a positive integer');
  const root = fs.realpathSync(projectRoot);

  function resolve(relative) {
    if (!safeRelative(relative))
      return failure('UNSAFE_ARTIFACT_PATH', 'Artifact path must be a bounded relative path');
    const target = path.resolve(root, relative);
    const rel = path.relative(root, target);
    if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel))
      return failure('UNSAFE_ARTIFACT_PATH', 'Artifact path escaped the project');
    return inspectExisting(root, relative);
  }

  function readContent(relative) {
    const checked = resolve(relative);
    if (!checked.ok) return checked;
    if (!fs.existsSync(checked.target)) return failure('ARTIFACT_MISSING', 'Artifact is missing');
    try {
      const stat = fs.lstatSync(checked.target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)
        return failure('UNSAFE_ARTIFACT_PATH', 'Artifact must be an ordinary single-link file');
      if (stat.size > maximumBytes)
        return failure('ARTIFACT_TOO_LARGE', 'Artifact exceeds its limit');
      const content = fs.readFileSync(checked.target);
      return { ok: true, content, hash: hash(content) };
    } catch {
      return failure('ARTIFACT_READ_FAILED', 'Artifact cannot be read safely');
    }
  }

  function readJson(relative) {
    const read = readContent(relative);
    if (!read.ok) return read;
    try {
      let value;
      try {
        value = JSON.parse(read.content.toString('utf8'));
      } catch {
        return failure('ARTIFACT_INVALID', 'Artifact is not valid JSON');
      }
      return { ok: true, value, hash: read.hash };
    } catch {
      return failure('ARTIFACT_INVALID', 'Artifact is not valid JSON');
    }
  }

  function readText(relative) {
    const read = readContent(relative);
    if (!read.ok) return read;
    return { ok: true, value: read.content.toString('utf8'), hash: read.hash };
  }

  function writeContent(relative, content, invalidCode, invalidMessage) {
    const checked = resolve(relative);
    if (!checked.ok) return checked;
    if (typeof content !== 'string') return failure(invalidCode, invalidMessage);
    if (hasSensitiveInput(content))
      return failure(
        'SENSITIVE_ARTIFACT',
        'Remove apparent credentials before persisting artifacts',
      );
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > maximumBytes) return failure('ARTIFACT_TOO_LARGE', 'Artifact exceeds its limit');
    const digest = hash(content);
    try {
      if (fs.existsSync(checked.target)) {
        const existing = fs.readFileSync(checked.target);
        return existing.equals(Buffer.from(content))
          ? { ok: true, path: relative, hash: digest }
          : failure('ARTIFACT_CONFLICT', 'Immutable artifact already exists with other content');
      }
      fs.mkdirSync(path.dirname(checked.target), { recursive: true });
      const parent = inspectExisting(root, path.dirname(relative));
      if (!parent.ok) return parent;
      const temporary = path.join(
        path.dirname(checked.target),
        `.${path.basename(checked.target)}.${randomUUID()}.tmp`,
      );
      let promoted = false;
      try {
        fs.writeFileSync(temporary, content, { flag: 'wx' });
        try {
          fs.renameSync(temporary, checked.target);
          promoted = true;
        } catch (error) {
          fs.rmSync(temporary, { force: true });
          if (error.code === 'EEXIST' || error.code === 'EPERM') {
            if (!fs.existsSync(checked.target))
              return failure('ARTIFACT_WRITE_FAILED', 'Artifact cannot be promoted safely');
            const existing = fs.readFileSync(checked.target);
            return existing.equals(Buffer.from(content))
              ? { ok: true, path: relative, hash: digest }
              : failure(
                  'ARTIFACT_CONFLICT',
                  'Immutable artifact already exists with other content',
                );
          }
          throw error;
        }
      } finally {
        if (!promoted) {
          try {
            fs.rmSync(temporary, { force: true, maxRetries: 20, retryDelay: 100 });
          } catch {
            // preserve the original write or rename failure; the temp file was never published
          }
        }
      }
      return { ok: true, path: relative, hash: digest };
    } catch {
      return failure('ARTIFACT_WRITE_FAILED', 'Artifact cannot be written safely');
    }
  }

  function writeJson(relative, value) {
    let content;
    try {
      content = JSON.stringify(value, null, 2) + '\n';
    } catch {
      return failure('ARTIFACT_INVALID', 'Artifact must be JSON serializable');
    }
    return writeContent(
      relative,
      content,
      'ARTIFACT_INVALID',
      'Artifact must be JSON serializable',
    );
  }

  function writeText(relative, value) {
    return writeContent(relative, value, 'ARTIFACT_INVALID', 'Artifact text must be a string');
  }

  return Object.freeze({ readJson, readText, writeJson, writeText });
}
