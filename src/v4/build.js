import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir, exists, readText, writeText } from '../v3/util/fsx.js';
import { scaffoldFiles, writeScaffold } from '../v3/init.js';
import { bootstrapCodeFiles } from '../v3/bootstrap-code.js';
import { frontendFiles } from './frontend-code.js';
import { executePlan } from './execution.js';
import { CATALOG_VERSION, findDependency, sideLabel } from './catalog.js';
import { v4PythonFiles } from './python-code.js';
import { v4NodeFiles } from './node-code.js';

function run(root, command, args = [], options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
    timeout: options.timeout || 600000,
    env: options.env ? { ...process.env, ...options.env } : process.env,
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

function git(root, args) {
  return run(root, 'git', args, { timeout: 120000 });
}

function identity(args) {
  return ['-c', 'user.name=SpecGate', '-c', 'user.email=specgate@local', ...args];
}

function commitAll(root, message) {
  const add = git(root, ['add', '-A']);
  if (add.status !== 0) return add;
  return git(root, identity(['commit', '--no-gpg-sign', '-q', '-m', message]));
}

function proposalText(stack) {
  return [
    '# 变更提案：MVP框架搭建',
    '',
    '## 问题',
    '新项目只有脚手架，没有可运行的 CRUD 样例。',
    '',
    '## 目标',
    '在 ' + stack + ' 上实现通用 Item CRUD：GET/POST/PUT/DELETE /api/items（含 /{id}），内存存储。',
    '',
    '## 非目标',
    '不做持久化、鉴权、分页。',
    '',
    '## 影响面',
    'Item 模型、存储、接口、测试。',
    '- 关联需求：REQ-001',
    '',
  ].join('\n');
}

function specText() {
  const rows = [
    ['AC-001', '列表返回数组'],
    ['AC-002', '查询存在的条目'],
    ['AC-003', '查询不存在的条目返回 404'],
    ['AC-004', '创建条目返回 201'],
    ['AC-005', '创建缺少 name 返回 400'],
    ['AC-006', '更新条目'],
    ['AC-007', '更新不存在返回 404'],
    ['AC-008', '删除条目返回 204'],
    ['AC-009', '删除不存在返回 404'],
    ['AC-010', '格式化/静态检查/测试通过'],
  ];
  return [
    '## ADDED Requirements',
    '',
    '### Requirement: MVP 框架与 Item CRUD 示例 (REQ-001)',
    '',
    '系统 SHALL 提供内存版 Item CRUD 示例。',
    '',
    ...rows.flatMap(([id, title]) => [
      '#### Scenario: ' + title + ' (' + id + ')',
      '',
      '- **WHEN** 调用对应接口',
      '- **THEN** 返回预期状态码与数据',
      '',
    ]),
  ].join('\n');
}

function tasksText() {
  return [
    '# 任务：MVP框架搭建',
    '',
    '## T-001 模型与读取',
    '<!-- sg:task {"id":"T-001","title":"模型与读取","ac":["AC-001","AC-002","AC-003"],"deps":[],"parallel":false} -->',
    '- [ ] 实现 Item、存储、GET 接口',
    '',
    '## T-002 写入接口',
    '<!-- sg:task {"id":"T-002","title":"写入接口","ac":["AC-004","AC-005","AC-006","AC-007","AC-008","AC-009"],"deps":["T-001"],"parallel":false} -->',
    '- [ ] 实现 POST/PUT/DELETE',
    '',
    '## T-003 测试与质量',
    '<!-- sg:task {"id":"T-003","title":"测试与质量","ac":["AC-010"],"deps":["T-001","T-002"],"parallel":false} -->',
    '- [ ] 补测试并跑格式化/静态检查',
    '',
  ].join('\n');
}

function writeBootstrapChange(root) {
  const dir = path.join(root, 'openspec', 'changes', 'bootstrap');
  ensureDir(path.join(dir, 'specs', 'mvp'));
  writeText(path.join(dir, 'proposal.md'), proposalText('backend'));
  writeText(path.join(dir, 'specs', 'mvp', 'spec.md'), specText());
  writeText(path.join(dir, 'tasks.md'), tasksText());
}

function archiveBootstrap(root) {
  const dir = path.join(root, 'openspec', 'changes', 'bootstrap');
  if (!exists(dir)) return;
  writeText(
    path.join(dir, 'tasks.md'),
    readText(path.join(dir, 'tasks.md')).replace(/^(\s*-\s*)\[ \]/gm, '$1[x]'),
  );
  const target = path.join(
    root,
    'openspec',
    'changes',
    'archive',
    new Date().toISOString().slice(0, 10) + '-bootstrap',
  );
  ensureDir(path.dirname(target));
  fs.renameSync(dir, target);
  ensureDir(path.join(root, 'openspec', 'specs', 'mvp'));
  writeText(path.join(root, 'openspec', 'specs', 'mvp', 'spec.md'), specText());
}

function dependencyLabels(side, ids) {
  return (ids || [])
    .map((id) => {
      const item = findDependency(side, id);
      return item ? item.label + (item.version ? ' ' + item.version : '') : id;
    })
    .join('、');
}

function reportText({ side, written, quality }) {
  const fence = '\x60\x60\x60';
  const deps = side.dependencies || {};
  const qualityStatus = quality?.skipped
    ? 'skipped'
    : quality?.ok === false
      ? 'degraded'
      : 'passed';
  const lines = [
    '# MVP 框架生成报告',
    '',
    '- side: ' + side.id + ' (' + side.stack + ')',
    '- stack: ' + sideLabel(side),
    '- generated: ' + written.length,
    '- depsPreset: ' + (deps.preset || '（无）'),
    '- required: ' + (dependencyLabels(side, deps.required) || '（无）'),
    '- optional: ' + (dependencyLabels(side, deps.optional) || '（无）'),
  ];
  if (deps.dropped?.length) {
    lines.push(
      '- dropped: ' + deps.dropped.map((item) => item.id + '（' + item.reason + '）').join('；'),
    );
  }
  lines.push('', '## 质量阶段', '', '- status: ' + qualityStatus);
  if (quality?.skipped) lines.push('- SKIPPED: ' + (quality.reason || '用户跳过'), '');
  if (quality?.ok === false) {
    lines.push(
      '- FAILED: ' + (quality.failedStage || 'unknown') + ' — ' + (quality.message || '失败'),
      '',
    );
  }
  for (const stage of quality?.stages || []) {
    lines.push(
      '### ' + stage.name,
      '',
      '- command: ' + stage.command,
      '- exitCode: ' + stage.status,
      '- durationMs: ' + stage.durationMs,
      '',
    );
    lines.push(fence + 'text');
    lines.push((stage.stdout + stage.stderr).trim().slice(0, 3000));
    lines.push(fence, '');
  }
  return lines.join('\n');
}

function stageSummary(stage) {
  return {
    name: stage.name,
    command: stage.command,
    status: stage.status,
    durationMs: stage.durationMs,
    output: (String(stage.stdout || '') + String(stage.stderr || '')).trim().slice(0, 2000),
  };
}

function writeSideReport(root, side, written, quality, commit = null) {
  const deps = side.dependencies || {};
  const payload = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    catalogVersion: CATALOG_VERSION,
    side: side.id,
    stack: side.stack,
    label: sideLabel(side),
    selection: {
      framework: side.framework,
      runtimeVersion: side.runtimeVersion,
      buildTool: side.buildTool,
      bootVersion: side.bootVersion,
      packageManager: side.packageManager,
      language: side.language,
    },
    dependencies: {
      preset: deps.preset || null,
      required: deps.required || [],
      optional: deps.optional || [],
      dropped: deps.dropped || [],
    },
    quality: {
      status: quality?.skipped ? 'skipped' : quality?.ok === false ? 'degraded' : 'passed',
      skipped: Boolean(quality?.skipped),
      degraded: quality?.ok === false,
      failedStage: quality?.failedStage || null,
      message: quality?.message || null,
      stages: (quality?.stages || []).map(stageSummary),
    },
    files: written,
    commit: commit || null,
  };
  ensureDir(path.join(root, '.specgate'));
  writeText(
    path.join(root, '.specgate', 'init-report.json'),
    JSON.stringify(payload, null, 2) + '\n',
  );
  return payload;
}

async function qualityFor({ root, side, qualityRunner }) {
  if (typeof qualityRunner === 'function') {
    const custom = await qualityRunner({ root, stack: side.stack, side });
    return custom && typeof custom.ok === 'boolean' ? custom : { ok: true, stages: [] };
  }
  try {
    return executePlan({ root, side });
  } catch (error) {
    return {
      ok: false,
      code: 'BOOTSTRAP_QUALITY_FAILED',
      message: error instanceof Error ? error.message : String(error),
      failedStage: 'executor',
      stages: [],
    };
  }
}

function ensureRepo(root) {
  if (!exists(path.join(root, '.git'))) {
    const init = git(root, ['init', '-q']);
    if (init.status !== 0) return init;
  }
  return { status: 0 };
}

function existingCommits(root) {
  const head = git(root, ['rev-parse', '--verify', 'HEAD']);
  return head.status === 0;
}

function prepareRepo(root, side) {
  const repo = ensureRepo(root);
  if (repo.status !== 0) return repo;
  if (!exists(path.join(root, 'README.md'))) {
    writeText(path.join(root, 'README.md'), '# ' + side.id + '\n\n' + side.stack + ' 子项目\n');
  }
  if (!existingCommits(root)) {
    const initial = commitAll(root, 'chore: 初始化 ' + side.id + ' 仓库');
    if (initial.status !== 0) return initial;
  }
  const branch = (git(root, ['branch', '--show-current']).stdout || '').trim();
  if (branch && branch !== 'main') {
    const renamed = git(root, ['branch', '-M', 'main']);
    if (renamed.status !== 0) return renamed;
  }
  const checkout = git(root, ['checkout', '-B', 'bootstrap']);
  if (checkout.status !== 0) return checkout;
  return { status: 0 };
}

function writeBackendFiles(root, side) {
  if (side.stack === 'python' || side.stack === 'node') {
    const files = side.stack === 'python' ? v4PythonFiles(side) : v4NodeFiles(side);
    const result = writeScaffold(root, files);
    return result.written;
  }
  const scaffold = scaffoldFiles(side.stack, {
    ...side,
    background: '搭建框架',
    team: 'SpecGate',
    steps: '1) 框架 2) 业务',
    jdk: side.jdk || side.runtimeVersion || '17',
    buildTool: side.buildTool || 'maven',
    bootVersion: side.bootVersion || '3.x',
    packageName: side.packageName || 'com.example.demo',
  });
  const scaffoldResult = writeScaffold(root, scaffold);
  const code = bootstrapCodeFiles(side.stack, {
    packageName: side.packageName || 'com.example.demo',
    ...side,
  });
  const written = [...scaffoldResult.written];
  for (const [relative, content] of Object.entries(code)) {
    ensureDir(path.dirname(path.join(root, relative)));
    writeText(path.join(root, relative), content);
    if (!written.includes(relative)) written.push(relative);
  }
  return written;
}

export async function buildBackendSide({ root, side, qualityRunner = null }) {
  if (side.role !== 'backend') return { ok: true, skipped: true, reason: 'not-backend' };
  if (!['node', 'python', 'java'].includes(side.stack)) {
    return { ok: true, skipped: true, reason: 'unsupported-backend' };
  }
  if (exists(path.join(root, '.specgate', 'bootstrap.done'))) {
    return { ok: true, skipped: true, reason: 'already-built' };
  }
  const prepared = prepareRepo(root, side);
  if (prepared.status !== 0) return prepared;

  const written = writeBackendFiles(root, side);
  writeBootstrapChange(root);

  const quality = await qualityFor({ root, side, qualityRunner });
  const degraded = quality?.ok === false;
  const report = path.join(root, 'docs', 'mvp-scaffold-report.md');
  ensureDir(path.dirname(report));
  writeText(report, reportText({ side, written, quality }));
  writeSideReport(root, side, written, quality, null);

  const suffix = degraded ? ' [degraded]' : '';
  const first = commitAll(root, 'feat(mvp): 搭建 ' + side.stack + ' 框架与 Item CRUD' + suffix);
  if (first.status !== 0) return first;
  archiveBootstrap(root);
  const second = commitAll(root, 'chore(bootstrap): 归档 MVP 框架变更' + suffix);
  if (second.status !== 0) return second;
  const checkout = git(root, ['checkout', 'main']);
  if (checkout.status !== 0) return checkout;
  const merge = git(
    root,
    identity(['merge', '--no-ff', '-m', 'merge bootstrap' + suffix, 'bootstrap']),
  );
  if (merge.status !== 0) return merge;
  git(root, ['tag', 'mvp-bootstrap']);
  writeText(path.join(root, '.specgate', 'bootstrap.done'), 'done\n');
  const commit = (git(root, ['rev-parse', 'HEAD']).stdout || '').trim();
  return {
    ok: true,
    side: side.id,
    stack: side.stack,
    written,
    report: 'docs/mvp-scaffold-report.md',
    commit,
    degraded,
    quality,
    qualityStatus: quality?.skipped ? 'skipped' : degraded ? 'degraded' : 'passed',
  };
}

export async function buildFrontendSide({ root, side, qualityRunner = null }) {
  if (side.role !== 'frontend') return { ok: true, skipped: true, reason: 'not-frontend' };
  if (!['vue', 'react'].includes(side.stack)) {
    return { ok: true, skipped: true, reason: 'unsupported-frontend' };
  }
  if (exists(path.join(root, '.specgate', 'bootstrap.done'))) {
    return { ok: true, skipped: true, reason: 'already-built' };
  }
  const prepared = prepareRepo(root, side);
  if (prepared.status !== 0) return prepared;

  const files = frontendFiles(side.stack, side);
  const written = [];
  for (const [relative, content] of Object.entries(files)) {
    ensureDir(path.dirname(path.join(root, relative)));
    writeText(path.join(root, relative), content);
    written.push(relative);
  }
  writeBootstrapChange(root);

  const quality = await qualityFor({ root, side, qualityRunner });
  const degraded = quality?.ok === false;
  const report = path.join(root, 'docs', 'mvp-scaffold-report.md');
  ensureDir(path.dirname(report));
  writeText(report, reportText({ side, written, quality }));
  writeSideReport(root, side, written, quality, null);

  const suffix = degraded ? ' [degraded]' : '';
  const first = commitAll(root, 'feat(mvp): 搭建 ' + side.stack + ' 前端与 Item CRUD' + suffix);
  if (first.status !== 0) return first;
  archiveBootstrap(root);
  const second = commitAll(root, 'chore(bootstrap): 归档 MVP 框架变更' + suffix);
  if (second.status !== 0) return second;
  const checkout = git(root, ['checkout', 'main']);
  if (checkout.status !== 0) return checkout;
  const merge = git(
    root,
    identity(['merge', '--no-ff', '-m', 'merge bootstrap' + suffix, 'bootstrap']),
  );
  if (merge.status !== 0) return merge;
  git(root, ['tag', 'mvp-bootstrap']);
  writeText(path.join(root, '.specgate', 'bootstrap.done'), 'done\n');
  const commit = (git(root, ['rev-parse', 'HEAD']).stdout || '').trim();
  return {
    ok: true,
    side: side.id,
    stack: side.stack,
    written,
    report: 'docs/mvp-scaffold-report.md',
    commit,
    degraded,
    quality,
    qualityStatus: quality?.skipped ? 'skipped' : degraded ? 'degraded' : 'passed',
  };
}

export async function buildWorkspace({ root, selection, qualityRunner = null, approval = null }) {
  const results = [];
  for (const side of selection.sides) {
    const sideRoot = path.join(root, side.path);
    results.push(
      side.role === 'frontend'
        ? await buildFrontendSide({ root: sideRoot, side, qualityRunner })
        : await buildBackendSide({ root: sideRoot, side, qualityRunner }),
    );
  }
  const payload = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    catalogVersion: CATALOG_VERSION,
    approval:
      approval ||
      (results.some((item) => item.qualityStatus === 'passed' || item.qualityStatus === 'degraded')
        ? 'approved'
        : 'skipped'),
    workspace: {
      backend: selection.backend,
      frontend: selection.frontend,
      sides: selection.sides.map((side) => ({
        id: side.id,
        path: side.path,
        stack: side.stack,
        role: side.role,
        label: sideLabel(side),
        dependencies: side.dependencies
          ? {
              preset: side.dependencies.preset || null,
              required: side.dependencies.required || [],
              optional: side.dependencies.optional || [],
              dropped: side.dependencies.dropped || [],
            }
          : null,
      })),
    },
    results: results.map((item) => ({
      side: item.side,
      stack: item.stack,
      ok: item.ok,
      skipped: Boolean(item.skipped),
      degraded: Boolean(item.degraded),
      qualityStatus:
        item.qualityStatus || (item.skipped ? 'skipped' : item.degraded ? 'degraded' : 'passed'),
      report: item.report || null,
      commit: item.commit || null,
      reason: item.reason || null,
    })),
  };
  ensureDir(path.join(root, '.specgate'));
  writeText(
    path.join(root, '.specgate', 'init-report.json'),
    JSON.stringify(payload, null, 2) + '\n',
  );
  return { ok: results.every((item) => item.ok), results };
}
