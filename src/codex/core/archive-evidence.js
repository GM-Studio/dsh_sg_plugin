import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const fail = (message) => {
  throw Object.assign(new Error(message), { code: 'ARCHIVE_EVIDENCE_CONFLICT' });
};
// Read only ordinary, bounded evidence files. Existing archive bytes are immutable.
export function archiveEvidence(root, changeId, archived = false) {
  const source = path.join(
      root,
      archived ? '.specgate/codex/archive' : '.specgate/codex/changes',
      changeId,
    ),
    files = [],
    queue = [source];
  let total = 0,
    directories = 0;
  if (!fs.existsSync(source))
    return { files, hash: createHash('sha256').update('[]').digest('hex') };
  let parent = root;
  for (const part of path.relative(root, source).split(path.sep)) {
    parent = path.join(parent, part);
    const stat = fs.lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Unsafe archive evidence parent');
  }
  while (queue.length) {
    const directory = queue.shift(),
      stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || ++directories > 4096)
      fail('Unsafe or oversized archive evidence tree');
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        directory === source &&
        ['archive-report.json', 'cleanup-report.json'].includes(entry.name)
      ) {
        if (archived) continue;
        fail('Source evidence uses a reserved archive report name');
      }
      const file = path.join(directory, entry.name),
        relative = path.relative(source, file).replaceAll('\\', '/'),
        stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || (stat.nlink > 1 && stat.isFile()))
        fail('Archive source contains a symlink/hardlink');
      if (stat.isDirectory()) queue.push(file);
      else if (stat.isFile()) {
        total += stat.size;
        if (files.length >= 10000 || total > 256 * 1024 * 1024)
          fail('Archive evidence exceeds its bounded scan');
        files.push({
          path: relative,
          hash: createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
        });
      } else fail('Archive source is not an ordinary file');
    }
  }
  return { source, files, hash: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
}

export function copyArchiveEvidence(root, relative, snapshot, write) {
  for (const entry of snapshot.files) {
    const bytes = fs.readFileSync(path.join(snapshot.source, entry.path));
    if (createHash('sha256').update(bytes).digest('hex') !== entry.hash)
      fail('Source evidence changed during archival');
    write(root, `${relative}/${entry.path}`, bytes);
  }
}
