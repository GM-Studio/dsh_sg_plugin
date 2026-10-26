import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DISCOVERY_BOUNDS,
  normalizeBounds,
  discoverExecutable,
  discoveryRoots,
} from '../src/codex/core/env/discovery-bounds.js';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-bounds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeFile(root, relative, content = '') {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function snapshot(root) {
  const out = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        out.push('d:' + path.relative(root, target));
        visit(target);
      } else out.push('f:' + path.relative(root, target) + ':' + fs.statSync(target).size);
    }
  };
  visit(root);
  return out.sort();
}

test('discovery is read-only: the file tree is byte-identical afterwards', (t) => {
  const root = workspace(t);
  writeFile(root, 'jdk-17/bin/tool', 'x');
  writeFile(root, 'bin/tool', 'y');
  const before = snapshot(root);
  discoverExecutable({ name: 'tool', roots: [root], platform: 'linux' });
  assert.deepEqual(snapshot(root), before, '发现不得写入任何文件');
});

test('discovery reports that it performed no writes and no network access', (t) => {
  const root = workspace(t);
  const result = discoverExecutable({ name: 'tool', roots: [root], platform: 'linux' });
  assert.equal(result.ok, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.performedWrites, false, 'AC-10：只读检查不得写配置');
  assert.equal(result.performedNetwork, false, 'AC-10：只读检查不得下载');
});

test('the number of inspected roots is capped and the truncation is reported', (t) => {
  const root = workspace(t);
  for (let index = 0; index < 12; index += 1) fs.mkdirSync(path.join(root, 'r' + index));
  const roots = Array.from({ length: 12 }, (_, index) => path.join(root, 'r' + index));
  const result = discoverExecutable({
    name: 'tool',
    roots,
    platform: 'linux',
    bounds: { maxRoots: 5 },
  });
  assert.equal(result.inspectedRoots.length, 5, '根目录数必须受上限约束');
  assert.equal(result.truncated, true);
  assert.equal(result.complete, false);
});

test('a directory with too many entries is capped rather than fully walked', (t) => {
  const root = workspace(t);
  for (let index = 0; index < 40; index += 1) fs.mkdirSync(path.join(root, 'child-' + index));
  // 把可执行放在第 30 个目录之后：超出条目上限时应被发现不到。
  fs.mkdirSync(path.join(root, 'child-39', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'child-39', 'bin', 'tool'), 'x');
  const result = discoverExecutable({
    name: 'tool',
    roots: [root],
    platform: 'linux',
    bounds: { maxDirectoryEntries: 8 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.candidates, [], '超过条目上限的子目录不应被检查');
});

test('a timeout stops discovery and is reported instead of thrown', (t) => {
  const root = workspace(t);
  for (let index = 0; index < 10; index += 1) fs.mkdirSync(path.join(root, 'r' + index));
  const roots = Array.from({ length: 10 }, (_, index) => path.join(root, 'r' + index));
  let calls = 0;
  const now = () => {
    calls += 1;
    return calls > 2 ? 10_000_000 : 0;
  };
  const result = discoverExecutable({ name: 'tool', roots, platform: 'linux', now });
  assert.equal(result.ok, true, '超时不得抛出');
  assert.equal(result.timedOut, true);
  assert.equal(result.complete, false);
});

test('direct and bin-nested layouts are both discovered', (t) => {
  const root = workspace(t);
  writeFile(root, 'direct/tool', 'x');
  writeFile(root, 'nested/jdk-17/bin/tool', 'x');
  const result = discoverExecutable({
    name: 'tool',
    roots: [path.join(root, 'direct'), path.join(root, 'nested')],
    platform: 'linux',
  });
  assert.equal(result.candidates.length, 2, JSON.stringify(result.candidates));
  assert.ok(result.candidates.some((entry) => entry.endsWith(path.join('direct', 'tool'))));
  assert.ok(result.candidates.some((entry) => entry.endsWith(path.join('bin', 'tool'))));
});

test('windows executable suffixes are considered', (t) => {
  const root = workspace(t);
  writeFile(root, 'jdk/bin/tool.exe', 'x');
  const result = discoverExecutable({ name: 'tool', roots: [root], platform: 'win32' });
  assert.ok(result.candidates.some((entry) => entry.endsWith('tool.exe')));
});

test('candidates per tool are capped to bound memory and time', (t) => {
  const root = workspace(t);
  for (let index = 0; index < 30; index += 1) writeFile(root, 'r' + index + '/bin/tool', 'x');
  const roots = Array.from({ length: 30 }, (_, index) => path.join(root, 'r' + index));
  const result = discoverExecutable({
    name: 'tool',
    roots,
    platform: 'linux',
    bounds: { maxCandidatesPerTool: 3 },
  });
  assert.ok(result.candidates.length <= 3, JSON.stringify(result.candidates.length));
  assert.equal(result.truncated, true);
});

test('discovery roots are bounded and never enumerate the whole disk', () => {
  const roots = discoveryRoots({
    env: { PATH: ['/a', '/b', '/c'].join(':') },
    platform: 'linux',
    home: '/home/u',
  });
  assert.ok(roots.length <= DISCOVERY_BOUNDS.maxRoots);
  for (const root of roots) assert.equal(typeof root, 'string');
  // 不应出现盘符根或单独的 /。
  for (const root of roots) assert.notEqual(root, '/');
});

test('invalid bounds are refused rather than silently clamped', () => {
  for (const bounds of [
    { maxRoots: 0 },
    { maxDepth: -2 },
    { maxMilliseconds: 1.5 },
    { maxDirectoryEntries: 'x' },
  ]) {
    const result = normalizeBounds(bounds);
    assert.equal(result.ok, false, JSON.stringify(bounds));
    assert.equal(result.code, 'DISCOVERY_BOUNDS_INVALID');
  }
});

test('invalid input is refused', () => {
  for (const name of ['', null, 3]) {
    assert.equal(discoverExecutable({ name }).ok, false);
  }
  assert.equal(discoverExecutable({ name: 'x', roots: 'nope' }).code, 'DISCOVERY_INPUT_INVALID');
});

test('a missing root is skipped without aborting the whole discovery', (t) => {
  const root = workspace(t);
  writeFile(root, 'good/bin/tool', 'x');
  const result = discoverExecutable({
    name: 'tool',
    roots: [path.join(root, 'does-not-exist'), path.join(root, 'good')],
    platform: 'linux',
  });
  assert.equal(result.ok, true);
  assert.equal(result.candidates.length, 1, '个别根缺失不应中断发现');
});
