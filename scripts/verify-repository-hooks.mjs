// Exercise the final candidate gate without staging or committing the source repository.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectSnapshot } from './quality-gate.mjs';
const source = process.cwd();
const parent = fs.mkdtempSync(path.join(source, '.specgate', 'hq-'));
const root = path.join(parent, 'repo');
fs.mkdirSync(root, { recursive: true });
const names = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: source, encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
for (const name of new Set(names)) {
  const from = path.join(source, name);
  if (!fs.existsSync(from)) continue;
  const to = path.join(root, name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
git(['init', '-q']);
git(['config', 'core.hooksPath', path.join(parent, 'no-hooks')]);
git(['config', 'core.autocrlf', 'false']);
git(['config', 'user.name', 'SpecGate hook acceptance']);
git(['config', 'user.email', 'hook-acceptance@local']);
git(['add', '-A']);
fs.symlinkSync(
  path.join(source, 'node_modules'),
  path.join(root, 'node_modules'),
  process.platform === 'win32' ? 'junction' : 'dir',
);
process.env.SG_RUFF ||= 'ruff';
await inspectSnapshot({ root, ref: 'index', stage: 'commit' });
// Only this generated fixture owns the baseline commit used for pre-push evidence.
git(['commit', '-qm', 'isolated hook candidate']);
await inspectSnapshot({ root, ref: 'HEAD', base: null, stage: 'push' });
console.log('Final candidate commit/push gate passed; fixture: ' + root);
