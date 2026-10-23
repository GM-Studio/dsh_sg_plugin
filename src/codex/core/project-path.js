import fs from 'node:fs';
import path from 'node:path';

export function canonicalProjectRoot(value) {
  if (typeof value !== 'string' || !value) return null;
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function sameProject(left, right) {
  const a = canonicalProjectRoot(left);
  const b = canonicalProjectRoot(right);
  if (!a || !b) return false;
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function workItemProjectRoot(item) {
  return item?.projectRoot || item?.project?.projectRoot || item?.project?.root || null;
}

// A cached server and a source checkout are both plugin directories. Never use
// either as the default business project, including their descendants.
export function insideSpecGateSource(input) {
  let directory = path.resolve(input);
  for (let depth = 0; depth < 128; depth++) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'plugin.json'), 'utf8'));
      if (
        manifest.name === 'specgate-codex' &&
        fs.existsSync(path.join(directory, 'src/codex/server.js'))
      )
        return true;
    } catch {
      /* Most ancestors do not contain a plugin manifest. */
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return false;
}
