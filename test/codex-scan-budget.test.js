import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_BUDGET,
  SKIP_CONFIG_FILE,
  isSecretName,
  normalizeBudget,
  scanRepository,
} from '../src/codex/core/discovery/budget.js';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-budget-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, content = '') {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const paths = (entries) => entries.map((entry) => entry.path).sort();

test('exceeding the file budget stops expansion and reports the unscanned range', (t) => {
  const root = workspace(t);
  for (let index = 0; index < 8; index += 1) write(root, 'f' + index + '.txt', 'x');
  const result = scanRepository({ root, budget: { maxFiles: 3 } });
  assert.equal(result.ok, true);
  assert.equal(result.complete, false);
  assert.equal(result.truncated, true);
  assert.equal(result.stats.files, 3);
  assert.ok(result.unscanned.length > 0, '未扫描范围必须显式列出');
  // 未扫描的文件不得出现在 scanned 中。
  for (const entry of result.unscanned)
    assert.equal(
      result.scanned.some((item) => item.path === entry),
      false,
    );
});

test('a file above the single-file budget is skipped without being read', (t) => {
  const root = workspace(t);
  write(root, 'big.txt', 'y'.repeat(2048));
  write(root, 'small.txt', 'ok');
  const result = scanRepository({ root, budget: { maxFileBytes: 1024 } });
  assert.deepEqual(paths(result.scanned), ['small.txt']);
  const skipped = result.skipped.find((entry) => entry.path === 'big.txt');
  assert.equal(skipped.reason, 'exceeds-file-budget');
  assert.equal(skipped.bytes, 2048);
});

test('dependency directories are skipped and counted, not analysed', (t) => {
  const root = workspace(t);
  write(root, 'src/app.js', 'console.log(1);');
  for (const directory of ['node_modules', '.git', 'dist', 'target', 'coverage', '.venv'])
    write(root, directory + '/inside.txt', 'x');
  const result = scanRepository({ root });
  assert.deepEqual(paths(result.scanned), ['src/app.js']);
  const skippedPaths = paths(result.skipped);
  for (const directory of ['node_modules', '.git', 'dist', 'target', 'coverage', '.venv'])
    assert.ok(skippedPaths.includes(directory), directory + ' 应被跳过');
  for (const entry of result.skipped) assert.equal(entry.reason, 'dependency-or-artifact');
});

test('a repository can declare its own skip directories so real source is not starved', (t) => {
  const root = workspace(t);
  write(root, 'src/app.js', 'console.log(1);');
  // 项目特有的工具状态目录：体积可能远大于源码，必须先跳过，否则预算被其耗尽。
  for (const directory of ['.runtime', '.npm-cache', '.my-cache'])
    write(root, directory + '/bulk.bin', 'x'.repeat(4096));
  // 通用默认只收录跨项目共识项，项目特有目录由仓库自己声明。
  write(
    root,
    SKIP_CONFIG_FILE,
    JSON.stringify({ skipDirectories: ['.runtime', '.npm-cache', '.my-cache'] }),
  );
  const result = scanRepository({ root, budget: { maxTotalBytes: 1024 * 1024 } });
  assert.deepEqual(
    paths(result.scanned),
    [SKIP_CONFIG_FILE, 'src/app.js'].sort(),
    '真实源码与配置本身都应被扫描',
  );
  assert.equal(result.complete, true, '跳过已声明目录后扫描应完整');
  const skippedPaths = paths(result.skipped);
  for (const directory of ['.runtime', '.npm-cache', '.my-cache'])
    assert.ok(skippedPaths.includes(directory), directory + ' 应被跳过');
  assert.deepEqual(result.declaredSkipDirectories, ['.runtime', '.npm-cache', '.my-cache']);
});

test('an undeclared tool-state directory is NOT silently skipped', (t) => {
  // 这是反例：SpecGate 不得硬编码某个项目的目录名。
  const root = workspace(t);
  write(root, 'src/app.js', 'console.log(1);');
  write(root, '.runtime/bulk.bin', 'x'.repeat(4096));
  const result = scanRepository({ root });
  assert.equal(result.declaredSkipDirectories.length, 0);
  assert.ok(
    paths(result.scanned).includes('.runtime/bulk.bin'),
    '未声明的目录必须被扫描，不能被硬编码跳过',
  );
});

test('an invalid skip config is ignored rather than breaking the scan', (t) => {
  const root = workspace(t);
  write(root, 'src/app.js', 'console.log(1);');
  for (const content of [
    'not json',
    '{"skipDirectories":"nope"}',
    '{"skipDirectories":[1,null,"ok","a/b","../x"]}',
  ]) {
    write(root, SKIP_CONFIG_FILE, content);
    const result = scanRepository({ root });
    assert.equal(result.ok, true, content);
    // 只接受合法的简单目录名。
    for (const entry of result.declaredSkipDirectories)
      assert.equal(
        typeof entry === 'string' && !entry.includes('/') && !entry.includes('..'),
        true,
        entry,
      );
  }
});

test('suspected secret files are skipped by name and never described as analysed', (t) => {
  const root = workspace(t);
  write(root, 'app.js', 'console.log(1);');
  for (const name of ['.env', '.env.local', 'server.pem', 'id_rsa', '.npmrc', 'secrets.json'])
    write(root, name, 'PLACEHOLDER');
  const result = scanRepository({ root });
  assert.deepEqual(paths(result.scanned), ['app.js']);
  const skipped = result.skipped.filter((entry) => entry.reason === 'suspected-secret');
  assert.equal(skipped.length, 6);
  // NFR-03：跳过的项不得出现在已分析清单里。
  for (const entry of skipped)
    assert.equal(
      result.scanned.some((item) => item.path === entry.path),
      false,
    );
});

test('a file whose content looks like a credential is analysed but marked redacted', (t) => {
  const root = workspace(t);
  write(root, 'config.js', 'const token = "abcdef123456";\n');
  const result = scanRepository({ root });
  assert.equal(result.scanned.length, 1, '内容命中不得让文件无法被分析');
  assert.equal(result.scanned[0].redacted, true);
  assert.equal(result.sensitive.length, 1);
  assert.equal(result.sensitive[0].path, 'config.js');
});

test('a source file holding the detection pattern itself is not treated as a credential', (t) => {
  const root = workspace(t);
  write(root, 'detector.js', 'const re = /(?:password|secret)[:=]\\s*[A-Za-z0-9]{8,}/i;\n');
  const result = scanRepository({ root });
  assert.equal(result.scanned.length, 1, '包含检测正则本身不得导致文件被排除');
  assert.equal(result.scanned[0].redacted, false, '正则源文本不是凭据，不应误报');
  assert.deepEqual(result.sensitive, []);
});

test('a real credential-shaped assignment redacts without removing the file', (t) => {
  const root = workspace(t);
  write(root, 'fixture.js', 'const sample = \'password = "hunter2hunter2"\';\n');
  const result = scanRepository({ root });
  assert.deepEqual(paths(result.scanned), ['fixture.js'], '仍须可被分析');
  assert.equal(result.scanned[0].redacted, true);
  assert.equal(result.sensitive.length, 1);
});

test('symlinks are neither followed nor counted as analysed', (t) => {
  const root = workspace(t);
  write(root, 'real.txt', 'x');
  try {
    fs.symlinkSync(path.join(root, 'real.txt'), path.join(root, 'link.txt'));
  } catch {
    t.skip('symlink not supported on this platform');
    return;
  }
  const result = scanRepository({ root });
  assert.deepEqual(paths(result.scanned), ['real.txt']);
  const link = result.skipped.find((entry) => entry.path === 'link.txt');
  assert.equal(link.reason, 'symlink');
});

test('a timeout returns partial results with a reason instead of throwing', (t) => {
  const root = workspace(t);
  for (let index = 0; index < 20; index += 1) write(root, 'd' + index + '/f.txt', 'x');
  let calls = 0;
  const now = () => {
    calls += 1;
    // 第 3 次取时后立即"超时"，模拟扫描被预算打断。
    return calls > 3 ? 10_000_000 : 0;
  };
  const result = scanRepository({ root, now });
  assert.equal(result.ok, true, '超时不得抛出');
  assert.equal(result.timedOut, true);
  assert.equal(result.complete, false);
  assert.ok(result.unscanned.length > 0, '必须保留未完成清单');
});

test('depth beyond the budget is recorded as unscanned rather than silently dropped', (t) => {
  const root = workspace(t);
  write(root, 'a/b/c/deep.txt', 'x');
  const result = scanRepository({ root, budget: { maxDepth: 1 } });
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.ok(result.unscanned.some((entry) => entry.includes('b')));
  assert.deepEqual(paths(result.scanned), []);
});

test('the approved OI-01 budget is the effective default', (t) => {
  // OI-01 于 2026-10-26 由用户确认为「沿用当前默认」。
  const root = workspace(t);
  write(root, 'a.txt', 'x');
  const result = scanRepository({ root });
  assert.equal(result.pendingBudgetConfirmation, false, '预算已批准，不应再标为待确认');
  assert.deepEqual(DEFAULT_BUDGET, {
    maxFiles: 20000,
    maxFileBytes: 1024 * 1024,
    maxTotalBytes: 64 * 1024 * 1024,
    maxMilliseconds: 60000,
    maxDepth: 12,
  });
  assert.deepEqual(result.budget, DEFAULT_BUDGET);
});

test('an invalid budget is refused instead of silently falling back', () => {
  for (const budget of [
    { maxFiles: 0 },
    { maxFiles: -1 },
    { maxFileBytes: 1.5 },
    { maxMilliseconds: 'soon' },
  ]) {
    const result = normalizeBudget(budget);
    assert.equal(result.ok, false, JSON.stringify(budget));
    assert.equal(result.code, 'SCAN_BUDGET_INVALID');
  }
});

test('an invalid root is refused', () => {
  for (const root of ['relative', null, 3]) {
    const result = scanRepository({ root });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SCAN_ROOT_INVALID');
  }
});

test('secret detection is name based and case aware', () => {
  for (const name of ['.env', '.env.production', 'a.pem', 'b.KEY', 'id_rsa', 'secrets.yaml'])
    assert.equal(isSecretName(name), true, name);
  for (const name of ['app.js', 'readme.md', 'package.json', 'notes.txt'])
    assert.equal(isSecretName(name), false, name);
});

test('scanning is read-only', (t) => {
  const root = workspace(t);
  write(root, 'src/a.js', 'console.log(1);');
  write(root, 'package.json', '{}');
  const snapshot = () => {
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
  };
  const before = snapshot();
  scanRepository({ root });
  assert.deepEqual(snapshot(), before);
});
