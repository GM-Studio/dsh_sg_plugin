import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { configPath, parseConfig } from './change.js';
import { exists, readText } from './util/fsx.js';
import { git } from './util/git.js';

export function formatterCommand(root) {
  const file = configPath(root);
  if (!exists(file)) return [];
  const config = parseConfig(readText(file));
  const command = config?.formatter?.command;
  return Array.isArray(command) ? command.map(String) : [];
}

export function runFormatter({ root, worktree, change, task }) {
  const command = formatterCommand(root);
  if (command.length === 0) {
    const skipDir = path.join(root, '.specgate', 'runs');
    fs.mkdirSync(skipDir, { recursive: true });
    const report = path.join(skipDir, `format-${change}-${task.id}.md`);
    fs.writeFileSync(
      report,
      `# 格式化报告\n\n- task: ${task.id}\n- status: not-configured\n- 说明：未配置 formatter.command，跳过\n`,
      'utf8',
    );
    return { ok: true, skipped: true, report };
  }
  const dir = path.join(worktree, 'openspec', 'changes', change, 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  const report = path.join(dir, 'format-report.md');
  const started = Date.now();
  const run = spawnSync(command[0], command.slice(1), {
    cwd: worktree,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 8 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  const changed = git(worktree, ['status', '--porcelain']).split('\n').filter(Boolean);
  const lines = [
    '# 格式化报告',
    '',
    `- task: ${task.id}`,
    `- command: ${command.join(' ')}`,
    `- exitCode: ${run.status}`,
    `- durationMs: ${durationMs}`,
    `- changed: ${changed.length}`,
    '',
    '```',
    `${run.stdout || ''}${run.stderr || ''}`.trim(),
    '```',
  ];
  fs.writeFileSync(report, `${lines.join('\n')}\n`, 'utf8');
  if (run.status !== 0) {
    return { ok: false, code: 'FORMAT_FAILED', message: `formatter 退出码 ${run.status}`, report };
  }
  if (changed.length > 0) {
    git(worktree, ['add', '-A']);
    git(worktree, ['commit', '-q', '-m', `format ${task.id}`]);
  }
  return { ok: true, skipped: false, report, changed: changed.length, durationMs };
}
