#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const sourceDir = fileURLToPath(new URL('./git-hooks/', import.meta.url));
export function installHooks({ root, check = false } = {}) {
  root ||= execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const hooksDir = path.resolve(
    root,
    execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
  );
  const plans = ['pre-commit', 'pre-push'].map((name) => {
    const content = readFileSync(path.join(sourceDir, name), 'utf8').replace(/\r\n/g, '\n');
    const target = path.join(hooksDir, name);
    const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current !== null && current !== content && current !== content.replace('--check', '--fix'))
      throw new Error('Preserving custom hook: ' + target);
    return { name, target, content, matches: current === content };
  });
  if (check) {
    for (const item of plans)
      console.log(
        item.name + ': ' + (item.matches ? 'current' : 'missing/stale') + ' ' + item.target,
      );
    if (plans.some((item) => !item.matches)) throw new Error('Run npm run hooks:install');
    return plans;
  }
  mkdirSync(hooksDir, { recursive: true });
  for (const item of plans) {
    writeFileSync(item.target, item.content, { mode: 0o755 });
    chmodSync(item.target, 0o755);
    console.log('[hooks:install] ' + item.name + ' -> ' + item.target);
  }
  return plans;
}
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    installHooks({ check: process.argv.includes('--check') });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
