import fs from 'node:fs';
import path from 'node:path';
import { mergeEnvironment, readPersistentEnvironment } from './java/java-env.js';

const cache = new WeakMap();
// Git control operations must also reuse installed Git when the MCP process has
// an old PATH. Resolve the executable without mutating process or user settings.
export function gitExecutable(env = process.env) {
  const delimiter = process.platform === 'win32' ? ';' : ':';
  const name = process.platform === 'win32' ? 'git.exe' : 'git';
  const find = (value) =>
    String(value || '')
      .split(delimiter)
      .filter(Boolean)
      .slice(0, 128)
      .map((dir) => path.join(dir.replace(/^"|"$/g, ''), name))
      .find((file) => {
        try {
          return fs.statSync(file).isFile();
        } catch {
          return false;
        }
      });
  const immediate = find(env.PATH || env.Path);
  if (immediate) return immediate;
  const remembered = cache.get(env);
  if (remembered && Date.now() < remembered.expires) return remembered.path;
  const merged = mergeEnvironment({ ...readPersistentEnvironment({ env }), env });
  const common =
    process.platform === 'win32'
      ? [path.join(env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd')]
      : ['/usr/local/bin', '/usr/bin', '/bin'];
  const executable = find([merged.PATH, ...common].join(delimiter)) || 'git';
  cache.set(env, { path: executable, expires: Date.now() + 2000 });
  return executable;
}
