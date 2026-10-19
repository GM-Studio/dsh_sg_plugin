import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { configPath, parseConfig } from './change.js';
import { exists, readText } from './util/fsx.js';
import { appendRun } from './runs.js';

function bin(worktree, name) {
  const base = path.join(worktree, 'node_modules', '.bin', name);
  if (exists(base)) return base;
  if (exists(`${base}.cmd`)) return `${base}.cmd`;
  return null;
}

function configured(root, stage) {
  const file = configPath(root);
  if (!exists(file)) return null;
  const config = parseConfig(readText(file));
  const command = config?.quality?.[stage];
  return Array.isArray(command) && command.length > 0 ? command.map(String) : null;
}

export function inferStack(worktree) {
  if (
    exists(path.join(worktree, 'pyproject.toml')) ||
    exists(path.join(worktree, 'requirements.txt'))
  ) {
    return 'python';
  }
  try {
    const pkg = JSON.parse(readText(path.join(worktree, 'package.json')));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.vue || deps.nuxt) return 'vue';
    if (deps.react || deps.next) return 'react';
  } catch {
    // fall through
  }
  return 'node';
}

export function detectQuality({ root, worktree, stack }) {
  const resolved = stack || inferStack(worktree);
  const stages = {};
  for (const stage of ['format', 'lint', 'typecheck']) {
    const override = configured(root, stage);
    if (override) {
      stages[stage] = override;
      continue;
    }
    if (resolved === 'python') {
      const ruff = bin(worktree, 'ruff');
      const mypy = bin(worktree, 'mypy');
      if (stage === 'format' && ruff) stages.format = [ruff, 'format', '.'];
      if (stage === 'lint' && ruff) stages.lint = [ruff, 'check', '.'];
      if (stage === 'typecheck' && mypy) stages.typecheck = [mypy, '.'];
      continue;
    }
    if (stage === 'format') {
      const prettier = bin(worktree, 'prettier');
      if (prettier) stages.format = [prettier, '--write', '.'];
    } else if (stage === 'lint') {
      const eslint = bin(worktree, 'eslint');
      if (eslint) stages.lint = [eslint, '.'];
    } else if (stage === 'typecheck') {
      const tsc = resolved === 'vue' ? bin(worktree, 'vue-tsc') : bin(worktree, 'tsc');
      if (tsc) stages.typecheck = [tsc, '--noEmit'];
    }
  }
  return stages;
}

export function runQualityStage({ root, worktree, change, task, stage, stack }) {
  const command = detectQuality({ root, worktree, stack })[stage];
  if (!command) return { ok: true, skipped: true, stage };
  const dir = path.join(worktree, 'openspec', 'changes', change, 'reviews');
  fs.mkdirSync(dir, { recursive: true });
  const report = path.join(dir, `${stage}-report.md`);
  const started = Date.now();
  const run = spawnSync(command[0], command.slice(1), {
    cwd: worktree,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  const durationMs = Date.now() - started;
  const status = run.status ?? 1;
  fs.writeFileSync(
    report,
    `# ${stage} 报告\n\n- task: ${task.id}\n- command: ${command.join(' ')}\n- exitCode: ${status}\n- durationMs: ${durationMs}\n\n\`\`\`\n${`${run.stdout || ''}${run.stderr || ''}`.trim()}\n\`\`\`\n`,
    'utf8',
  );
  appendRun(root, {
    change,
    task: task.id,
    role: stage,
    worktree,
    commit: null,
    durationMs,
    result: status === 0 ? 'pass' : 'fail',
    error: status === 0 ? null : `exit ${status}`,
  });
  return { ok: status === 0, skipped: false, status, report, durationMs };
}
