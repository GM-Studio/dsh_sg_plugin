import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const hash = (data) => createHash('sha256').update(data).digest('hex');
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};

// Publish only the planned files. Staging can live on a different drive and no
// sibling of the user's target directory needs to be renamed or written.
export function publishInitialization({
  source,
  target,
  snapshot,
  files,
  managedPaths = [],
  existingGit = false,
  beforeWrite,
}) {
  const originals = new Map(snapshot.entries.map((entry) => [entry.path, entry]));
  const managed = new Set(managedPaths);
  const createdDirectories = [];
  const created = new Set();
  const journal = [];
  const ensureDirectory = (directory) => {
    const relative = path.relative(target, directory).split(path.sep).join('/');
    if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative))
      fail('UNSAFE_INIT_PATH', '发布路径超出目标目录');
    if (fs.existsSync(directory)) {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        fail('UNSAFE_INIT_PATH', '发布目录不是普通目录');
      if (relative && !originals.has(relative) && !created.has(directory))
        fail('INIT_PREVIEW_STALE', '发布前目录已变化：' + relative);
      return;
    }
    if (directory !== target) ensureDirectory(path.dirname(directory));
    fs.mkdirSync(directory);
    created.add(directory);
    createdDirectories.push(directory);
  };
  const replace = (file, content, mode) => {
    const temporary = path.join(path.dirname(file), '.sg-init-' + randomUUID() + '.tmp');
    try {
      fs.writeFileSync(temporary, content, { flag: 'wx', mode });
      fs.renameSync(temporary, file);
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* already promoted */
      }
    }
  };
  try {
    if (!snapshot.exists) {
      if (fs.existsSync(target)) fail('INIT_PREVIEW_STALE', '发布前目标目录已出现');
      fs.mkdirSync(target, { recursive: true });
      created.add(target);
      createdDirectories.push(target);
    }
    ensureDirectory(target);
    for (const relative of files) {
      if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..'))
        fail('UNSAFE_INIT_PATH', '发布文件路径无效');
      const file = path.join(target, relative);
      const staged = path.join(source, relative);
      const content = fs.readFileSync(staged);
      const mode = fs.statSync(staged).mode;
      const nextHash = hash(content);
      const original = originals.get(relative);
      if (original && original.type !== 'file')
        fail('INIT_PATH_CONFLICT', '发布文件与已有目录冲突：' + relative);
      if (original?.hash === nextHash) continue;
      if (original && !managed.has(relative) && !(existingGit && relative.startsWith('.git/')))
        fail('INIT_RETAINED_FILE_CHANGED', '拒绝改写保留文件：' + relative);
      beforeWrite?.(relative);
      ensureDirectory(path.dirname(file));
      let previous = null;
      if (original) {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink())
          fail('UNSAFE_INIT_PATH', '已有文件类型发生变化：' + relative);
        previous = fs.readFileSync(file);
        if (hash(previous) !== original.hash)
          fail('INIT_PREVIEW_STALE', '已有文件发生变化：' + relative);
        replace(file, content, original.mode || mode);
      } else {
        fs.writeFileSync(file, content, { flag: 'wx', mode });
      }
      journal.push({ file, previous, mode: original?.mode || mode, nextHash });
    }
    return { publishedFiles: journal.length };
  } catch (error) {
    const retained = [];
    for (const entry of journal.reverse()) {
      try {
        const stat = fs.lstatSync(entry.file);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          hash(fs.readFileSync(entry.file)) !== entry.nextHash
        ) {
          retained.push(entry.file);
          continue;
        }
        if (entry.previous === null) fs.unlinkSync(entry.file);
        else replace(entry.file, entry.previous, entry.mode);
      } catch {
        retained.push(entry.file);
      }
    }
    for (const directory of createdDirectories.reverse()) {
      try {
        fs.rmdirSync(directory);
      } catch {
        /* preserve nonempty directories */
      }
    }
    if (retained.length)
      fail(
        'INIT_RECOVERY_REQUIRED',
        '发布失败；保留发生外部变化的文件，请检查：' + retained.join('、'),
      );
    throw error;
  }
}
