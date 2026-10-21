import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir, exists, readText, writeText } from './util/fsx.js';
import { applyDeltaToText } from './openspec/apply.js';
import { collectDelta } from './phase.js';
import { patchState } from './state.js';
import { createDispatcher } from './dispatch.js';
import { readConfig } from './change.js';
import { bootstrapCodeFiles, bootstrapTouched } from './bootstrap-code.js';

const BUILD_STACKS = ['java', 'node', 'python'];

export function supportsBootstrapBuild(stack) {
  return BUILD_STACKS.includes(String(stack || ''));
}

function runCommand(root, command, args = [], options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
    timeout: options.timeout || 600000,
  });
  return {
    command: [command, ...args].join(' '),
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? String(result.error.message || result.error) : null,
    durationMs: Date.now() - started,
  };
}

function writeCode(root, stack, context) {
  const files = bootstrapCodeFiles(stack, context);
  const written = [];
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    ensureDir(path.dirname(target));
    writeText(target, content);
    written.push(relative);
  }
  return written;
}

function mavenCommand(root, args) {
  const wrapper = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
  return exists(path.join(root, wrapper)) ? [wrapper, args] : ['mvn', args];
}

async function runQuality({ root, stack, change, runtime, agent, qualityRunner }) {
  if (typeof qualityRunner === 'function') {
    const custom = await qualityRunner({ root, stack, change });
    return custom && typeof custom.ok === 'boolean' ? custom : { ok: true, stages: [] };
  }
  const stages = [];
  if (stack === 'java') {
    const format = mavenCommand(root, ['-B', '-ntp', 'spotless:apply']);
    stages.push({ name: 'format', ...runCommand(root, format[0], format[1]) });
    const lint = mavenCommand(root, ['-B', '-ntp', 'checkstyle:check']);
    stages.push({ name: 'lint', ...runCommand(root, lint[0], lint[1]) });
    const test = mavenCommand(root, ['-B', '-ntp', 'verify']);
    stages.push({ name: 'test', ...runCommand(root, test[0], test[1]) });
  } else if (stack === 'node') {
    const packageFile = path.join(root, 'package.json');
    const pkg = exists(packageFile) ? JSON.parse(readText(packageFile)) : {};
    if (pkg.scripts && pkg.scripts.format) {
      stages.push({ name: 'format', ...runCommand(root, 'npm', ['run', 'format']) });
    }
    if (pkg.scripts && pkg.scripts.lint) {
      stages.push({ name: 'lint', ...runCommand(root, 'npm', ['run', 'lint']) });
    }
    stages.push({ name: 'test', ...runCommand(root, 'node', ['--test', 'test/items.test.mjs']) });
  } else if (stack === 'python') {
    stages.push({ name: 'test', ...runCommand(root, 'python', ['-m', 'pytest', '-q', 'tests']) });
  }
  const failed = stages.find((stage) => stage.status !== 0);
  if (failed) {
    return {
      ok: false,
      code: 'BOOTSTRAP_QUALITY_FAILED',
      message: failed.name + ' 失败（exit ' + failed.status + '）',
      stages,
    };
  }

  let review = { ok: true, skipped: true, reason: 'reviewer 不可用' };
  if (runtime && agent) {
    const dispatcher = createDispatcher(runtime);
    const files = Object.keys(bootstrapCodeFiles(stack, {}));
    const prompt = [
      '你是 SpecGate reviewer。只读审查当前工作区新增的 MVP 框架代码：',
      ...files,
      '重点检查：接口契约、参数校验、错误码、测试覆盖、明显缺陷。',
      '只输出一个 JSON 对象：{"verdict":"pass"|"fail","blocking":[{"file":"...","line":1,"evidence":"...","reason":"..."}]}。',
    ].join('\n');
    const dispatched = await dispatcher({
      role: 'reviewer',
      task: { id: 'mvp-review', title: 'MVP 框架审查' },
      worktree: root,
      prompt,
      parent: agent,
      root,
      change,
    });
    if (dispatched.ok) {
      const match = String(dispatched.text || '').match(/\{[\s\S]*\}/);
      let parsed = null;
      try {
        parsed = match ? JSON.parse(match[0]) : null;
      } catch {
        parsed = null;
      }
      if (parsed && parsed.verdict === 'pass') {
        review = { ok: true, skipped: false, verdict: 'pass', text: dispatched.text };
      } else {
        return {
          ok: false,
          code: 'BOOTSTRAP_REVIEW_FAILED',
          message:
            'reviewer 未通过：' + (parsed ? JSON.stringify(parsed.blocking || []) : '无有效 JSON'),
          stages,
          review: { ok: false, text: dispatched.text },
        };
      }
    } else {
      review = {
        ok: true,
        skipped: true,
        reason: dispatched.code || dispatched.message || 'reviewer 不可用',
      };
    }
  }
  return { ok: true, stages, review };
}

function reportText({ stack, written, quality }) {
  const fence = '\x60\x60\x60';
  const lines = [
    '# MVP 框架生成报告',
    '',
    '- stack: ' + stack,
    '- generated: ' + written.length + ' 个文件',
  ];
  for (const file of written) lines.push('- A ' + file);
  lines.push('', '## 质量阶段', '');
  for (const stage of quality.stages || []) {
    lines.push('### ' + stage.name);
    lines.push('');
    lines.push('- command: ' + stage.command);
    lines.push('- exitCode: ' + stage.status);
    lines.push('- durationMs: ' + stage.durationMs);
    lines.push('');
    lines.push(fence + 'text');
    lines.push((stage.stdout + stage.stderr).trim().slice(0, 4000));
    lines.push(fence);
    lines.push('');
  }
  lines.push('## 审查', '');
  lines.push(
    quality.review && quality.review.skipped
      ? '- 跳过：' + (quality.review.reason || 'reviewer 不可用')
      : '- reviewer verdict=' + (quality.review ? quality.review.verdict : 'unknown'),
  );
  lines.push('');
  return lines.join('\n');
}

function markTasksDone(root, change) {
  const file = path.join(root, 'openspec', 'changes', change, 'tasks.md');
  if (!exists(file)) return;
  writeText(file, readText(file).replace(/^(\s*-\s*)\[ \]/gm, '$1[x]'));
}

function renameWithRetry(from, to) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(error.code) || attempt === 7)
        throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
  throw lastError;
}

function archiveBootstrap(root, change) {
  for (const file of collectDelta(root, change)) {
    const specsPath = path.join(root, 'openspec', 'specs', file.capability, 'spec.md');
    const current = exists(specsPath) ? readText(specsPath) : '';
    const applied = applyDeltaToText(current, file.text);
    if (!applied.ok) return { ok: false, message: applied.errors.join('; ') };
    ensureDir(path.dirname(specsPath));
    writeText(specsPath, applied.text);
  }
  const day = new Date().toISOString().slice(0, 10);
  const from = path.join(root, 'openspec', 'changes', change);
  const to = path.join(root, 'openspec', 'changes', 'archive', day + '-' + change);
  ensureDir(path.dirname(to));
  renameWithRetry(from, to);
  patchState(root, (draft) => {
    draft.phase = 'IDLE';
    draft.change = null;
    draft.type = null;
    draft.tasks = {};
    draft.touched = { modify: [], delete: [], bootstrap: [] };
    draft.integration = null;
    draft.plan = {
      designHash: null,
      casesHash: null,
      mappingHash: null,
      touchedHash: null,
      planHash: null,
      cmdHash: null,
      argv: [],
      cwd: '.',
      approvedAt: null,
    };
  });
  const add = runCommand(root, 'git', ['add', '-A']);
  if (add.status === 0) {
    runCommand(root, 'git', [
      '-c',
      'user.name=SpecGate',
      '-c',
      'user.email=specgate@local',
      'commit',
      '-q',
      '-m',
      'chore(' + change + '): 归档 MVP 框架变更',
    ]);
  }
  return { ok: true, archivedPath: to };
}

export async function autoBuildBootstrap({
  root,
  change = 'mvp-scaffold',
  stack,
  context = {},
  runtime = null,
  agent = null,
  qualityRunner = null,
}) {
  if (!supportsBootstrapBuild(stack))
    return { ok: true, skipped: true, reason: 'unsupported-stack' };
  const written = writeCode(root, stack, context);
  const quality = await runQuality({ root, stack, change, runtime, agent, qualityRunner });
  const report = path.join(root, 'docs', 'mvp-scaffold-report.md');
  ensureDir(path.dirname(report));
  writeText(report, reportText({ stack, written, quality }));
  if (!quality.ok) {
    ensureDir(path.join(root, 'openspec', 'changes', change, 'reviews'));
    writeText(
      path.join(root, 'openspec', 'changes', change, 'reviews', 'bootstrap-failure.md'),
      reportText({ stack, written, quality }),
    );
    return {
      ok: false,
      code: quality.code || 'BOOTSTRAP_QUALITY_FAILED',
      message: quality.message || '生成后质量检查失败',
      report: 'docs/mvp-scaffold-report.md',
      stages: quality.stages || [],
    };
  }
  markTasksDone(root, change);
  const archived = archiveBootstrap(root, change);
  if (!archived.ok) return archived;
  return {
    ok: true,
    archived: true,
    archivedPath: path.relative(root, archived.archivedPath).split(path.sep).join('/'),
    report: 'docs/mvp-scaffold-report.md',
    phases: (quality.stages || []).map((stage) => stage.name),
    review: quality.review || null,
    generated: written,
    touched: bootstrapTouched(stack, context),
  };
}

/**
 * 在 sg-init 返回 H1_PENDING 后自动生成 CRUD 代码、跑质量与审查，成功则归档。
 */
export async function maybeBuildBootstrap({
  root,
  result,
  runtime = null,
  agent = null,
  qualityRunner = null,
}) {
  if (
    !result ||
    !result.ok ||
    result.phase !== 'H1_PENDING' ||
    result.change !== 'mvp-scaffold' ||
    result.mode !== 'new'
  ) {
    return { ok: true, skipped: true };
  }
  let subagents = null;
  try {
    subagents =
      runtime && typeof runtime.service === 'function' ? runtime.service('subagents') : null;
  } catch {
    subagents = null;
  }
  if (!subagents || typeof subagents.startActivation !== 'function') {
    return { ok: true, skipped: true, reason: 'subagents-unavailable' };
  }
  const config = readConfig(root) || {};
  const stack = config.stack;
  if (!supportsBootstrapBuild(stack)) return { ok: true, skipped: true };
  const built = await autoBuildBootstrap({
    root,
    change: 'mvp-scaffold',
    stack,
    context: config.java || {},
    runtime,
    agent,
    qualityRunner,
  });
  if (!built.ok) return built;
  return {
    ok: true,
    built,
    result: {
      ...result,
      phase: 'IDLE',
      change: null,
      archived: true,
      generated: built.generated,
      archivedPath: built.archivedPath,
      report: built.report,
      phases: built.phases,
      review: built.review,
    },
  };
}
