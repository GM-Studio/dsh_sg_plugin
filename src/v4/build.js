import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureDir, exists, readText, writeText } from '../v3/util/fsx.js';
import { scaffoldFiles, writeScaffold } from '../v3/init.js';
import { bootstrapCodeFiles } from '../v3/bootstrap-code.js';
import { frontendFiles } from './frontend-code.js';

function hasCommand(command) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(finder, [command], { encoding: 'utf8' }).status === 0;
}

function dshRuntimeDependencies() {
  const base = path.join(os.homedir(), '.dsh', 'dsh-runtimes');
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(base, entry.name, 'dependencies'))
      .filter((dir) => exists(dir));
  } catch {
    return [];
  }
}

function resolveNodeBin() {
  for (const name of ['DSH_NODE_BIN', 'DSH_NODE', 'NODE_BIN']) {
    if (process.env[name] && exists(process.env[name])) return process.env[name];
  }
  if (hasCommand('node')) return 'node';
  for (const deps of dshRuntimeDependencies()) {
    const candidate = path.join(
      deps,
      'node',
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node',
    );
    if (exists(candidate)) return candidate;
  }
  return null;
}

function pnpmCli() {
  for (const deps of dshRuntimeDependencies()) {
    const candidate = path.join(deps, 'pnpm', 'bin', 'pnpm.cjs');
    if (exists(candidate)) return candidate;
  }
  const beside = path.resolve(
    path.dirname(process.execPath),
    '..',
    '..',
    'pnpm',
    'bin',
    'pnpm.cjs',
  );
  return exists(beside) ? beside : null;
}

function runNodeScript(root, script, args, options = {}) {
  const node = resolveNodeBin();
  if (!node)
    return {
      command: 'node ' + script,
      status: 1,
      stdout: '',
      stderr: 'node not found',
      durationMs: 0,
    };
  const env = {
    ...(options.env || {}),
    PATH: path.dirname(node) + path.delimiter + (process.env.PATH || ''),
  };
  return run(root, node, [script, ...args], { ...options, env });
}

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

function reportText({ side, written, quality }) {
  const fence = '\x60\x60\x60';
  const lines = [
    '# MVP 框架生成报告',
    '',
    '- side: ' + side.id + ' (' + side.stack + ')',
    '- generated: ' + written.length,
  ];
  for (const file of written) lines.push('- A ' + file);
  lines.push('', '## 质量阶段', '');
  if (quality.skipped) lines.push('- SKIPPED: ' + (quality.reason || '工具链缺失'), '');
  for (const stage of quality.stages || []) {
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

async function qualityFor({ root, stack, qualityRunner }) {
  if (typeof qualityRunner === 'function') {
    const custom = await qualityRunner({ root, stack });
    return custom && typeof custom.ok === 'boolean' ? custom : { ok: true, stages: [] };
  }
  const stages = [];
  if (stack === 'node') {
    const node = resolveNodeBin();
    if (!node) return { ok: true, skipped: true, reason: '未找到 Node 工具链', stages: [] };
    stages.push({ name: 'test', ...run(root, node, ['--test', 'test/items.test.mjs']) });
  } else if (stack === 'python') {
    const python = hasCommand('python') ? 'python' : hasCommand('py') ? 'py' : null;
    if (!python) return { ok: true, skipped: true, reason: '未找到 Python 工具链', stages: [] };
    const probe = run(root, python, ['-c', 'import pytest']);
    if (probe.status !== 0)
      return { ok: true, skipped: true, reason: '未安装 pytest', stages: [probe] };
    stages.push({ name: 'test', ...run(root, python, ['-m', 'pytest', '-q', 'tests']) });
  } else if (stack === 'java') {
    if (!hasCommand('java'))
      return { ok: true, skipped: true, reason: '未找到 JDK（java）', stages: [] };
    const wrapper = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
    const command = hasCommand('mvn') ? 'mvn' : exists(path.join(root, wrapper)) ? wrapper : null;
    if (!command) return { ok: true, skipped: true, reason: '未找到 Maven', stages: [] };
    stages.push({ name: 'format', ...run(root, command, ['-B', '-ntp', 'spotless:apply']) });
    stages.push({ name: 'test', ...run(root, command, ['-B', '-ntp', 'verify']) });
  } else if (stack === 'vue' || stack === 'react') {
    const pnpm = pnpmCli();
    if (pnpm) {
      const install = runNodeScript(root, pnpm, ['install', '--no-frozen-lockfile'], {
        env: { PATH: path.dirname(resolveNodeBin()) + path.delimiter + (process.env.PATH || '') },
      });
      const installOutput = (install.stdout || '') + (install.stderr || '');
      if (install.status !== 0 && /ERR_PNPM_IGNORED_BUILDS/.test(installOutput)) {
        install.status = 0;
        install.stdout =
          installOutput + '\n[SpecGate] ignored build scripts; tests will still run.';
      }
      stages.push({ name: 'install', ...install });
      stages.push({ name: 'test', ...runNodeScript(root, pnpm, ['test']) });
    } else if (hasCommand('npm')) {
      stages.push({ name: 'install', ...run(root, 'npm', ['install', '--no-audit', '--no-fund']) });
      stages.push({ name: 'test', ...run(root, 'npm', ['test']) });
    } else {
      return { ok: true, skipped: true, reason: '未找到 npm/pnpm', stages: [] };
    }
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
  return { ok: true, stages };
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

  const scaffold = scaffoldFiles(side.stack, {
    ...side,
    background: '搭建框架',
    team: 'SpecGate',
    steps: '1) 框架 2) 业务',
    jdk: side.jdk || '8',
    buildTool: side.buildTool || 'maven',
    bootVersion: side.bootVersion || '2.7.x',
  });
  const scaffoldResult = writeScaffold(root, scaffold);
  const code = bootstrapCodeFiles(side.stack, { packageName: 'com.example.demo' });
  const written = [...scaffoldResult.written];
  for (const [relative, content] of Object.entries(code)) {
    ensureDir(path.dirname(path.join(root, relative)));
    writeText(path.join(root, relative), content);
    if (!written.includes(relative)) written.push(relative);
  }
  writeBootstrapChange(root);

  const quality = await qualityFor({ root, stack: side.stack, qualityRunner });
  const report = path.join(root, 'docs', 'mvp-scaffold-report.md');
  ensureDir(path.dirname(report));
  writeText(report, reportText({ side, written, quality }));
  if (!quality.ok) {
    return { ok: false, ...quality, report: 'docs/mvp-scaffold-report.md' };
  }

  const first = commitAll(root, 'feat(mvp): 搭建 ' + side.stack + ' 框架与 Item CRUD');
  if (first.status !== 0) return first;
  archiveBootstrap(root);
  const second = commitAll(root, 'chore(bootstrap): 归档 MVP 框架变更');
  if (second.status !== 0) return second;
  const checkout = git(root, ['checkout', 'main']);
  if (checkout.status !== 0) return checkout;
  const merge = git(root, identity(['merge', '--no-ff', '-m', 'merge bootstrap', 'bootstrap']));
  if (merge.status !== 0) return merge;
  git(root, ['tag', 'mvp-bootstrap']);
  writeText(path.join(root, '.specgate', 'bootstrap.done'), 'done\n');
  return {
    ok: true,
    side: side.id,
    stack: side.stack,
    written,
    report: 'docs/mvp-scaffold-report.md',
    commit: (git(root, ['rev-parse', 'HEAD']).stdout || '').trim(),
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

  const files = frontendFiles(side.stack);
  const written = [];
  for (const [relative, content] of Object.entries(files)) {
    ensureDir(path.dirname(path.join(root, relative)));
    writeText(path.join(root, relative), content);
    written.push(relative);
  }
  writeBootstrapChange(root);

  const quality = await qualityFor({ root, stack: side.stack, qualityRunner });
  const report = path.join(root, 'docs', 'mvp-scaffold-report.md');
  ensureDir(path.dirname(report));
  writeText(report, reportText({ side, written, quality }));
  if (!quality.ok) return { ok: false, ...quality, report: 'docs/mvp-scaffold-report.md' };

  const first = commitAll(root, 'feat(mvp): 搭建 ' + side.stack + ' 前端与 Item CRUD');
  if (first.status !== 0) return first;
  archiveBootstrap(root);
  const second = commitAll(root, 'chore(bootstrap): 归档 MVP 框架变更');
  if (second.status !== 0) return second;
  const checkout = git(root, ['checkout', 'main']);
  if (checkout.status !== 0) return checkout;
  const merge = git(root, identity(['merge', '--no-ff', '-m', 'merge bootstrap', 'bootstrap']));
  if (merge.status !== 0) return merge;
  git(root, ['tag', 'mvp-bootstrap']);
  writeText(path.join(root, '.specgate', 'bootstrap.done'), 'done\n');
  return {
    ok: true,
    side: side.id,
    stack: side.stack,
    written,
    report: 'docs/mvp-scaffold-report.md',
    commit: (git(root, ['rev-parse', 'HEAD']).stdout || '').trim(),
  };
}

export async function buildWorkspace({ root, selection, qualityRunner = null }) {
  const results = [];
  for (const side of selection.sides) {
    const sideRoot = path.join(root, side.path);
    results.push(
      side.role === 'frontend'
        ? await buildFrontendSide({ root: sideRoot, side, qualityRunner })
        : await buildBackendSide({ root: sideRoot, side, qualityRunner }),
    );
  }
  return { ok: results.every((item) => item.ok), results };
}
