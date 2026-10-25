import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, hashValue } from '../events.js';

const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
export function createAuditAnchor(
  projectRoot,
  anchorRoot = process.env.SPECGATE_ANCHOR_ROOT || path.join(os.homedir(), '.specgate', 'anchors'),
) {
  const root = path.resolve(anchorRoot);
  const relative = path.relative(projectRoot, root);
  if (
    !relative ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  )
    fail('UNSAFE_PATH', 'Audit anchor must be outside the project tree');
  const file = path.join(root, hashValue(projectRoot) + '.jsonl');
  function guard(create = false) {
    const parents = [];
    let current = root;
    while (true) {
      parents.unshift(current);
      const next = path.dirname(current);
      if (next === current) break;
      current = next;
    }
    for (const parent of parents) {
      if (!fs.existsSync(parent)) {
        if (!create) return false;
        fs.mkdirSync(parent, { mode: 0o700 });
      }
      const stat = fs.lstatSync(parent);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        fail('UNSAFE_PATH', 'Unsafe audit anchor directory');
    }
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
        fail('UNSAFE_PATH', 'Unsafe audit anchor file');
    }
    return true;
  }
  function last() {
    if (!guard() || !fs.existsSync(file)) return null;
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (!size) fail('ANCHOR_INVALID', 'Audit anchor is empty');
      const buffer = Buffer.alloc(Math.min(size, 8192));
      fs.readSync(fd, buffer, 0, buffer.length, size - buffer.length);
      const text = buffer.toString('utf8');
      if (!text.endsWith('\n')) fail('ANCHOR_INVALID', 'Audit anchor has an incomplete record');
      const record = JSON.parse(text.trimEnd().split('\n').at(-1));
      const { hash, ...body } = record;
      if (!Number.isSafeInteger(body.version) || body.version < 1 || hashValue(body) !== hash)
        fail('ANCHOR_INVALID', 'Audit anchor record is invalid');
      return record;
    } catch (error) {
      if (error.code?.startsWith('ANCHOR_')) throw error;
      fail('ANCHOR_INVALID', 'Cannot read audit anchor');
    } finally {
      fs.closeSync(fd);
    }
  }
  function verify(events) {
    const anchor = last();
    if (!anchor) {
      if (events.length)
        fail('ANCHOR_MISSING', 'Audit anchor is missing; retained history requires inspection');
      return;
    }
    const event = events[anchor.version - 1];
    if (!event || event.hash !== anchor.headHash || event.changeId !== anchor.changeId)
      fail('ANCHOR_ROLLBACK', 'History differs from its external monotonic anchor');
    if (events.length !== anchor.version)
      fail('ANCHOR_BEHIND', 'Audit anchor is behind history; recovery requires inspection');
  }
  function append(event) {
    guard(true);
    const body = {
      changeId: event.changeId,
      version: event.sequence,
      headHash: event.hash,
      updatedAt: new Date().toISOString(),
    };
    const fd = fs.openSync(file, 'a', 0o600);
    try {
      fs.writeFileSync(fd, canonicalJson({ ...body, hash: hashValue(body) }) + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  return { verify, append };
}
