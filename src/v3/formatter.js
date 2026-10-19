import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { configPath, parseConfig } from './change.js';
import { exists, readText } from './util/fsx.js';
import { git } from './util/git.js';
import { appendRun } from './runs.js';
import { detectQuality } from './quality.js';

export function formatterCommand(root, worktree = root, stack = null) {
  const file = configPath(root);
  if (exists(file)) {
    const config = parseConfig(readText(file));
    const command = config?.formatter?.command;
    if (Array.isArray(command) && command.length > 0) return command.map(String);
  }
  const detected = detectQuality({ root, worktree, stack }).format;
  return Array.isArray(detected) ? detected : [];
}

export function runFormatter({ root, worktree, change, task }) {
  const command = formatterCommand(root, worktree);
  if (command.length === 0) {
    const skipDir = path.join(root, '.specgate', 'runs');
    fs.mkdirSync(skipDir, { recursive: true });
    const report = path.join(skipDir, `format-${change}-${task.id}.md`);
    fs.writeFileSync(
      report,
      `# 格式化报告\n\n- task: ${task.id}\n- status: not-configured\n- 说明：未配置 formatter.command，跳过\n`,
      'utf8',
    );
    appendRun(root, {
      change,
      task: task.id,
      role: 'formatter',
      worktree,
      commit: null,
      durationMs: 0,
      result: 'skip',
    });
    return { ok: true, skipped: true, report };
  }
  const head = git(worktree, ['rev-parse', 'HEAD']);
  const branch = `sg-fmt/${change}/${task.id}-${Date.now()}`;
  const target = path.join(root, '.specgate', 'worktrees', change, `fmt-${task.id}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    git(root, ['worktree', 'add', '-b', branch, target, head]);
  } catch (error) {
    return {
      ok: false,
      code: 'FORMAT_WORKTREE_FAILED',
      message: String(error.stderr || error.message),
    };
  }
  const dir = path.join(target, 'openspec', 'changes', change, 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  const report = path.join(dir, 'format-report.md');
  const copyDir = path.join(root, '.specgate', 'runs');
  fs.mkdirSync(copyDir, { recursive: true });
  const copy = path.join(copyDir, `format-${change}-${task.id}.md`);
  try {
    const started = Date.now();
    const run = spawnSync(command[0], command.slice(1), {
      cwd: target,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    const durationMs = Date.now() - started;
    const status = run.status ?? 1;
    let changed = [];
    try {
      changed = git(target, ['status', '--porcelain']).split('\n').filter(Boolean);
    } catch {
      changed = [];
    }
    const lines = [
      '# 格式化报告',
      '',
      `- task: ${task.id}`,
      `- command: ${command.join(' ')}`,
      `- exitCode: ${status}`,
      `- durationMs: ${durationMs}`,
      `- changed: ${changed.length}`,
      `- worktree: ${target}`,
      '',
      '```',
      `${run.stdout || ''}${run.stderr || ''}`.trim(),
      '```',
    ];
    fs.writeFileSync(report, `${lines.join('\n')}\n`, 'utf8');
    fs.copyFileSync(report, copy);
    if (status !== 0) {
      appendRun(root, {
        change,
        task: task.id,
        role: 'formatter',
        worktree: target,
        commit: null,
        durationMs,
        result: 'fail',
        error: `exit ${status}`,
      });
      return {
        ok: false,
        code: 'FORMAT_FAILED',
        message: `formatter 退出码 ${status}`,
        report: copy,
      };
    }
    git(target, ['add', '-A']);
    git(target, ['commit', '-q', '-m', `format ${task.id}`]);
    git(worktree, ['merge', '--ff-only', branch]);
    const commit = git(worktree, ['rev-parse', 'HEAD']);
    appendRun(root, {
      change,
      task: task.id,
      role: 'formatter',
      worktree: target,
      commit,
      durationMs,
      result: 'pass',
    });
    return { ok: true, skipped: false, report: copy, changed: changed.length, durationMs };
  } finally {
    try {
      git(root, ['worktree', 'remove', '--force', target]);
    } catch {
      // ignore cleanup
    }
    try {
      git(root, ['branch', '-D', branch]);
    } catch {
      // ignore cleanup
    }
  }
}
