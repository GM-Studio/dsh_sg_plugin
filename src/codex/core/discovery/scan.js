import fs from 'node:fs';
import path from 'node:path';

export const SCAN_LIMITS = Object.freeze({
  maxDirectories: 256,
  maxDepth: 12,
  maxEntries: 25000,
  maxMetadataBytes: 8 * 1024 * 1024,
});
function segmentMatches(pattern, value) {
  if (value.startsWith('.') && !pattern.startsWith('.')) return false;
  let p = 0,
    v = 0,
    star = -1,
    resume = 0;
  while (v < value.length) {
    if (p < pattern.length && pattern[p] === value[v]) {
      p++;
      v++;
    } else if (pattern[p] === '*') {
      star = p++;
      resume = v;
    } else if (star >= 0) {
      p = star + 1;
      v = ++resume;
    } else return false;
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}
function patternMatches(pattern, value) {
  const parts = pattern.split('/'),
    values = value.split('/'),
    memo = new Map();
  const match = (p, v) => {
    const key = p + ':' + v;
    if (memo.has(key)) return memo.get(key);
    let result;
    if (p === parts.length) result = v === values.length;
    else if (parts[p] === '**')
      result =
        match(p + 1, v) || (v < values.length && !values[v].startsWith('.') && match(p, v + 1));
    else result = v < values.length && segmentMatches(parts[p], values[v]) && match(p + 1, v + 1);
    memo.set(key, result);
    return result;
  };
  return match(0, 0);
}
export function workspaceOwner(workspaces, relative) {
  return (
    workspaces
      .filter((w) => {
        const rel = path.posix.relative(w.root, relative) || '.';
        return (
          !rel.startsWith('../') &&
          (rel === '.' ||
            (w.patterns.some((p) => !p.startsWith('!') && patternMatches(p, rel)) &&
              !w.patterns.some((p) => p.startsWith('!') && patternMatches(p.slice(1), rel))))
        );
      })
      .sort((a, b) => b.root.length - a.root.length)[0] || null
  );
}

export function scanDirectories({ root, skip, ...options }) {
  const limits = {
    ...SCAN_LIMITS,
    ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)),
  };
  for (const [key, max] of Object.entries({
    maxDirectories: 4096,
    maxDepth: 32,
    maxEntries: 100000,
    maxMetadataBytes: 64 * 1024 * 1024,
  }))
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > max)
      throw Object.assign(new Error('Invalid scan budget ' + key), {
        code: 'STACK_DETECT_INVALID',
      });
  const scan = {
    complete: true,
    truncated: false,
    limits,
    entries: 0,
    metadataBytes: 0,
    issues: [],
  };
  const candidates = [],
    queue = ['.'],
    queued = new Set(queue),
    entries = new Map(),
    cache = new Map(),
    workspaces = [];
  const issue = (code, relative, truncated = false) => {
    scan.complete = false;
    scan.truncated ||= truncated;
    if (
      scan.issues.length < 128 &&
      !scan.issues.some((i) => i.code === code && i.path === relative)
    )
      scan.issues.push({ code, path: relative });
  };
  const readText = (relative) => {
    if (cache.has(relative)) return cache.get(relative);
    let fd;
    let value = '';
    try {
      const full = path.join(root, relative),
        stat = fs.lstatSync(full);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
        issue('UNSAFE_METADATA', relative);
        return '';
      }
      if (stat.size > 1024 * 1024 || scan.metadataBytes + stat.size > limits.maxMetadataBytes) {
        issue('METADATA_LIMIT', relative, true);
        return '';
      }
      fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const actual = fs.fstatSync(fd);
      if (
        actual.dev !== stat.dev ||
        actual.ino !== stat.ino ||
        actual.nlink !== 1 ||
        !actual.isFile()
      ) {
        issue('METADATA_CHANGED', relative);
        return '';
      }
      const bytes = Buffer.alloc(stat.size + 1),
        count = fs.readSync(fd, bytes, 0, bytes.length, 0);
      if (count !== stat.size) {
        issue('METADATA_CHANGED', relative);
        return '';
      }
      scan.metadataBytes += count;
      value = bytes.subarray(0, count).toString('utf8');
    } catch {
      issue('METADATA_UNREADABLE', relative);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      cache.set(relative, value);
    }
    return value;
  };
  const safeDirectory = (relative) => {
    const parts = relative === '.' ? [] : relative.split('/');
    let full = root;
    for (const part of parts) {
      full = path.join(full, part);
      try {
        const stat = fs.lstatSync(full);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
      } catch {
        return false;
      }
    }
    return true;
  };
  const enqueue = (relative, declared = false) => {
    relative = path.posix.normalize(relative);
    if (queued.has(relative)) return;
    if (relative.split('/').length > limits.maxDepth) {
      issue('DEPTH_LIMIT', relative, true);
      return;
    }
    if (queued.size >= limits.maxDirectories) {
      issue('DIRECTORY_LIMIT', relative, true);
      return;
    }
    if (!safeDirectory(relative)) {
      if (declared) issue('WORKSPACE_PATH_MISSING_OR_UNSAFE', relative);
      return;
    }
    queued.add(relative);
    queue.push(relative);
  };
  const declarations = (relative, names) => {
    const prefix = relative === '.' ? '' : relative + '/';
    let pkg = {};
    const configurations = [];
    if (names.has('package.json'))
      try {
        pkg = JSON.parse(readText(prefix + 'package.json'));
        if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
          issue('MANIFEST_INVALID', prefix + 'package.json');
          pkg = {};
        }
        if (pkg.workspaces !== undefined) {
          const patterns = Array.isArray(pkg.workspaces)
            ? pkg.workspaces
            : pkg.workspaces?.packages;
          if (!Array.isArray(patterns)) issue('WORKSPACE_CONFIG_INVALID', prefix + 'package.json');
          else configurations.push({ kind: 'npm', patterns, source: prefix + 'package.json' });
        }
      } catch {
        issue('MANIFEST_INVALID', prefix + 'package.json');
      }
    if (names.has('pnpm-workspace.yaml')) {
      const text = readText(prefix + 'pnpm-workspace.yaml'),
        patterns = [];
      let active = false;
      for (const line of text.split(/\r?\n/)) {
        if (/^packages\s*:/.test(line)) {
          active = true;
          if (!/^packages\s*:\s*(?:#.*)?$/.test(line))
            issue('WORKSPACE_CONFIG_UNSUPPORTED', prefix + 'pnpm-workspace.yaml');
          continue;
        }
        if (!active || /^\s*(?:#.*)?$/.test(line)) continue;
        if (/^\S/.test(line)) {
          active = false;
          continue;
        }
        const match = /^\s+-\s+(?:'([^']*)'|"([^"]*)"|([^#\s]+))\s*(?:#.*)?$/.exec(line);
        if (!match) issue('WORKSPACE_CONFIG_UNSUPPORTED', prefix + 'pnpm-workspace.yaml');
        else patterns.push(match[1] ?? match[2] ?? match[3]);
      }
      configurations.push({ kind: 'pnpm', patterns, source: prefix + 'pnpm-workspace.yaml' });
    }
    if (names.has('go.work')) {
      const text = readText(prefix + 'go.work').replace(/\/\/[^\n]*/g, '');
      const patterns = [];
      let active = false;
      for (const raw of text.split(/\r?\n/)) {
        let line = raw.trim();
        if (!line) continue;
        if (/^use\s*\(\s*$/.test(line)) {
          active = true;
          continue;
        }
        if (active && line === ')') {
          active = false;
          continue;
        }
        if (/^use\s+/.test(line)) line = line.replace(/^use\s+/, '');
        else if (!active) continue;
        try {
          patterns.push(
            line.startsWith('"')
              ? JSON.parse(line)
              : /^`[^`]+`$/.test(line)
                ? line.slice(1, -1)
                : /^\S+$/.test(line)
                  ? line
                  : (() => {
                      throw Error();
                    })(),
          );
        } catch {
          issue('WORKSPACE_CONFIG_UNSUPPORTED', prefix + 'go.work');
        }
      }
      if (active) issue('WORKSPACE_CONFIG_INVALID', prefix + 'go.work');
      configurations.push({ kind: 'go', patterns, source: prefix + 'go.work' });
    }
    for (const config of configurations) {
      const patterns = [];
      if (config.patterns.length > 128) {
        issue('WORKSPACE_PATTERN_LIMIT', config.source, true);
        continue;
      }
      for (let pattern of config.patterns) {
        if (
          typeof pattern !== 'string' ||
          !pattern ||
          pattern.length > 1024 ||
          /[\0\r\n{}[\]?$]/.test(pattern)
        ) {
          issue('WORKSPACE_PATTERN_UNSUPPORTED', config.source);
          continue;
        }
        const negative = pattern.startsWith('!');
        pattern = (negative ? pattern.slice(1) : pattern)
          .replaceAll('\\', '/')
          .replace(/^\.\//, '')
          .replace(/\/{2,}/g, '/')
          .replace(/\/$/, '');
        if (
          !pattern ||
          path.posix.isAbsolute(pattern) ||
          /^[A-Za-z]:/.test(pattern) ||
          pattern.split('/').some((p) => p === '..' || skip.has(p))
        ) {
          issue('WORKSPACE_PATH_OUTSIDE_OR_UNSUPPORTED', config.source);
          continue;
        }
        patterns.push((negative ? '!' : '') + pattern);
        if (!negative) {
          const first = pattern.split('/').findIndex((p) => p.includes('*'));
          const literal = first < 0 ? pattern : pattern.split('/').slice(0, first).join('/');
          if (literal) {
            const target = path.posix.join(relative, literal);
            if (first < 0 || safeDirectory(target)) enqueue(target, true);
          }
        }
      }
      workspaces.push({
        kind: config.kind,
        root: relative,
        source: config.source,
        patterns,
        packageManager:
          config.kind === 'go'
            ? 'go'
            : config.kind === 'pnpm'
              ? 'pnpm'
              : String(pkg.packageManager || '').split('@')[0] ||
                (names.has('pnpm-lock.yaml') ? 'pnpm' : names.has('yarn.lock') ? 'yarn' : 'npm'),
      });
    }
  };
  for (let index = 0; index < queue.length; index++) {
    const relative = queue[index];
    if (!safeDirectory(relative)) {
      issue('DIRECTORY_CHANGED', relative);
      continue;
    }
    let handle;
    const found = [];
    try {
      handle = fs.opendirSync(path.join(root, relative));
      let entry;
      while ((entry = handle.readSync())) {
        if (scan.entries >= limits.maxEntries) {
          issue('ENTRY_LIMIT', relative, true);
          break;
        }
        scan.entries++;
        found.push(entry);
      }
    } catch {
      issue('DIRECTORY_UNREADABLE', relative);
    } finally {
      handle?.closeSync();
    }
    candidates.push(relative);
    entries.set(relative, found);
    const names = new Set(found.filter((e) => e.isFile()).map((e) => e.name));
    declarations(relative, names);
    for (const entry of found.sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        skip.has(entry.name) ||
        (entry.isDirectory() && entry.name.startsWith('.') && entry.name !== '.github')
      )
        continue;
      const child = relative === '.' ? entry.name : relative + '/' + entry.name;
      if (entry.isSymbolicLink()) issue('SYMLINK_SKIPPED', child);
      else if (entry.isDirectory()) enqueue(child);
    }
    if (scan.entries >= limits.maxEntries) {
      if (index + 1 < queue.length) issue('ENTRY_LIMIT', relative, true);
      break;
    }
  }
  scan.directories = candidates.length;
  return { candidates, entries, workspaces, scan, readText, issue };
}
