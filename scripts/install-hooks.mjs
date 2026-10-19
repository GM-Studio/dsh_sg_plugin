#!/usr/bin/env node
// Copies the versioned hooks in scripts/git-hooks into the repository's hook
// directory. Run after a fresh clone: npm run hooks:install
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();
const hooksPath = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const hooksDir = path.resolve(root, hooksPath);
const sourceDir = path.join(root, 'scripts', 'git-hooks');

mkdirSync(hooksDir, { recursive: true });

for (const name of ['pre-commit', 'pre-push']) {
  const source = path.join(sourceDir, name);
  const target = path.join(hooksDir, name);
  const content = readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
  writeFileSync(target, content, { mode: 0o755 });
  try {
    chmodSync(target, 0o755);
  } catch {
    // Windows has no POSIX mode bits; Git for Windows executes hooks via sh.
  }
  console.log(`[hooks:install] ${name} -> ${target}`);
}

console.log('[hooks:install] 完成。提交时执行审查+格式化，push 时执行完整审查+格式检查。');
