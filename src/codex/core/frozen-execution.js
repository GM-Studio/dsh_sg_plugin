import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson, hashValue } from '../events.js';

const MARKER = '.specgate-frozen-execution.json';
const CACHE_SUFFIX = path.join(
  'specgate-tests',
  '.cache',
  'm2',
  'org',
  'jacoco',
  'org.jacoco.agent',
  '0.8.13',
  'org.jacoco.agent-0.8.13-runtime.jar',
);
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const digest = (value) => 'sha256:' + hashValue(value);
const bytesHash = (value) => 'sha256:' + createHash('sha256').update(value).digest('hex');
const invalid = (message) => {
  throw Object.assign(new Error(message), { code: 'FROZEN_EXECUTION_INVALID' });
};

function inside(root, target) {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}

function relativeFile(value) {
  return (
    typeof value === 'string' &&
    value.length <= 399 &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    value
      .split('/')
      .every(
        (part) =>
          part &&
          !['.', '..'].includes(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}

// Check parents before creating descendants; recursive mkdir could follow an
// already existing junction outside the controlled temporary directory.
function directory(target, create = false) {
  const absolute = path.resolve(target);
  let current = path.parse(absolute).root;
  for (const component of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (create) {
      try {
        fs.mkdirSync(current, { mode: 0o700 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    const entry = fs.lstatSync(current);
    if (entry.isSymbolicLink() || !entry.isDirectory())
      invalid('Frozen execution parent is not an ordinary directory');
  }
  return absolute;
}

function readOrdinary(file, maximum = MAX_FILE_BYTES) {
  directory(path.dirname(file));
  const entry = fs.lstatSync(file);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink > 1 || entry.size > maximum)
    invalid('Frozen execution requires ordinary bounded files');
  return fs.readFileSync(file);
}

function inspectCache(root) {
  const pending = [{ target: root, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const { target, depth } = pending.pop();
    if (++visited > 100000 || depth > 48)
      invalid('Frozen execution cache exceeds inspection bounds');
    const entry = fs.lstatSync(target);
    if (entry.isSymbolicLink() || (!entry.isDirectory() && (!entry.isFile() || entry.nlink > 1)))
      invalid('Frozen execution cache contains a link or special file');
    if (entry.isDirectory()) {
      for (const name of fs.readdirSync(target))
        pending.push({ target: path.join(target, name), depth: depth + 1 });
    }
  }
}

/** Use the canonical snapshot unless Windows tool caches could exceed MAX_PATH.
 * The mirror contains only frozen assets; generated Maven/npm caches remain in
 * place between red, green and post-format runs for this project and testsHash.
 */
export function prepareFrozenExecution({
  projectRoot,
  testsDirectory,
  manifestPath,
  testsHash,
  platform = process.platform,
  temporaryRoot = os.tmpdir(),
}) {
  if (platform !== 'win32' || path.join(testsDirectory, CACHE_SUFFIX).length < 260)
    return { directory: testsDirectory, canonicalDirectory: testsDirectory, copied: false };
  try {
    if (!projectRoot || !manifestPath || !/^sha256:[a-f0-9]{64}$/.test(testsHash || ''))
      invalid('Long frozen snapshots require a canonical manifest and tests hash');
    const project = fs.realpathSync(directory(projectRoot));
    const source = directory(testsDirectory);
    if (!inside(project, source) || path.dirname(path.resolve(manifestPath)) !== source)
      invalid('Frozen snapshot or manifest belongs to another project');
    const manifestBytes = readOrdinary(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (
      digest(manifest) !== testsHash ||
      !manifest.files ||
      Array.isArray(manifest.files) ||
      typeof manifest.files !== 'object'
    )
      invalid('Canonical frozen manifest hash or file index is invalid');
    const files = Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b));
    if (
      !files.length ||
      files.length > 4096 ||
      !Object.hasOwn(manifest.files, 'specgate-tests/runner.mjs')
    )
      invalid('Canonical frozen file index is empty, oversized or missing its runner');
    let totalBytes = 0;
    const entries = files.map(([relative, expected]) => {
      if (
        !relativeFile(relative) ||
        relative === MARKER ||
        relative === path.basename(manifestPath) ||
        !/^sha256:[a-f0-9]{64}$/.test(expected)
      )
        invalid('Frozen file index contains an unsafe path or hash');
      const contents = readOrdinary(path.join(source, relative));
      const text = contents.toString('utf8');
      if (digest(text) !== expected || !Buffer.from(text, 'utf8').equals(contents))
        invalid('Canonical frozen file hash or encoding changed: ' + relative);
      totalBytes += contents.length;
      if (totalBytes > MAX_ASSET_BYTES) invalid('Frozen execution assets exceed their byte limit');
      return { relative, contents, hash: expected, bytesHash: bytesHash(contents) };
    });
    const cacheParent = path.join(path.resolve(temporaryRoot), 'sgfx');
    const mirror = path.join(
      cacheParent,
      hashValue(project).slice(0, 10) + '-' + testsHash.slice(7, 19),
    );
    if (path.join(mirror, CACHE_SUFFIX).length >= 260)
      invalid('The temporary directory is too long for a safe frozen execution cache');
    const marker = {
      schemaVersion: 1,
      kind: 'specgate-frozen-execution',
      projectRoot: project,
      testsHash,
      canonicalDirectory: source,
      manifestPath: path.resolve(manifestPath),
      manifestBytesHash: bytesHash(manifestBytes),
      source: manifest.source || null,
      files: entries.map(({ relative, hash, bytesHash: fileHash }) => ({
        relative,
        hash,
        bytesHash: fileHash,
      })),
    };
    directory(cacheParent, true);
    let reused = false;
    try {
      fs.mkdirSync(mirror, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      reused = true;
    }
    directory(mirror);
    const markerPath = path.join(mirror, MARKER);
    if (reused) {
      inspectCache(mirror);
      if (
        canonicalJson(JSON.parse(readOrdinary(markerPath).toString('utf8'))) !==
        canonicalJson(marker)
      )
        invalid('Frozen execution cache identity does not match its project and manifest');
    }
    for (const entry of [
      ...entries,
      { relative: path.basename(manifestPath), contents: manifestBytes },
    ]) {
      const target = path.join(mirror, entry.relative);
      if (!inside(mirror, target)) invalid('Frozen execution file escaped its cache');
      if (!reused) {
        directory(path.dirname(target), true);
        fs.writeFileSync(target, entry.contents, { flag: 'wx', mode: 0o600 });
      }
      if (!readOrdinary(target).equals(entry.contents))
        invalid('Frozen execution copy changed: ' + entry.relative);
      if (!readOrdinary(path.join(source, entry.relative)).equals(entry.contents))
        invalid('Canonical frozen input changed during copying: ' + entry.relative);
    }
    if (!reused)
      fs.writeFileSync(markerPath, canonicalJson(marker) + '\n', { flag: 'wx', mode: 0o600 });
    inspectCache(mirror);
    return {
      directory: mirror,
      canonicalDirectory: source,
      copied: true,
      reused,
      markerPath,
      testsHash,
    };
  } catch (error) {
    if (error.code === 'FROZEN_EXECUTION_INVALID') throw error;
    invalid('Cannot verify the frozen execution snapshot: ' + error.message);
  }
}
