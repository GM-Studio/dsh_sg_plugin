import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists } from '../v3/util/fsx.js';
import { toolchainEnv } from './provision.js';
import { mirrorEnv } from './mirrors.js';

function hasCommand(command) {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(finder, [command], { encoding: 'utf8', stdio: 'ignore' }).status === 0;
}

function run(root, command, args = [], options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(command),
    timeout: options.timeout || 600000,
    env: { ...process.env, ...(options.env || {}) },
  });
  return {
    name: options.name || command,
    command: [command, ...args].join(' '),
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error ? String(result.error.message || result.error) : ''),
    durationMs: Date.now() - started,
  };
}

function resolvePython(toolchain) {
  if (toolchain?.python?.path) return toolchain.python.path;
  if (hasCommand('python')) return 'python';
  if (hasCommand('py')) return 'py';
  return null;
}

function venvPython(root) {
  const candidate =
    process.platform === 'win32'
      ? path.join(root, '.venv', 'Scripts', 'python.exe')
      : path.join(root, '.venv', 'bin', 'python');
  return exists(candidate) ? candidate : null;
}

function resolvePm(pm) {
  if (process.platform === 'win32' && hasCommand(pm + '.cmd')) return pm + '.cmd';
  if (hasCommand(pm)) return pm;
  return null;
}

function writeReviewReport(root, side) {
  const report = path.join(root, 'docs', 'review-report.md');
  const skip = new Set(['node_modules', '.git', 'target', 'build', '.venv', 'dist']);
  const findings = [];
  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|mjs|ts|tsx|jsx|vue|py|java|md)$/.test(entry.name)) continue;
      let text = '';
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/\b(TODO|FIXME|XXX)\b/.test(line)) {
          findings.push(
            path.relative(root, full).replace(/\\/g, '/') + ':' + (index + 1) + ' ' + line.trim(),
          );
        }
      });
    }
  }
  walk(root);
  const body = [
    '# 自动化走查报告',
    '',
    '- side: ' + (side.id || side.stack),
    '- findings: ' + findings.length,
    '',
    ...(findings.length ? findings.map((item) => '- ' + item) : ['- 未发现 TODO/FIXME/XXX 标记。']),
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(report), { recursive: true });
  fs.writeFileSync(report, body, 'utf8');
  return {
    name: 'review',
    command: '内置走查',
    status: 0,
    stdout: body,
    stderr: '',
    durationMs: 0,
  };
}

function javaPlan(root, side, toolchain) {
  const gradle = side.buildTool === 'gradle';
  const wrapper = path.join(
    root,
    gradle
      ? process.platform === 'win32'
        ? 'gradlew.bat'
        : 'gradlew'
      : process.platform === 'win32'
        ? 'mvnw.cmd'
        : 'mvnw',
  );
  const managed = gradle ? toolchain?.gradle?.path : toolchain?.maven?.path;
  const command =
    managed || (exists(wrapper) ? wrapper : gradle ? resolvePm('gradle') : resolvePm('mvn'));
  if (!command) return null;
  if (gradle) {
    const prefix = toolchain?.mirrorFiles?.gradleInit
      ? ['-I', toolchain.mirrorFiles.gradleInit]
      : [];
    return [
      ['install', command, [...prefix, 'dependencies'], 600000],
      ['format', command, [...prefix, 'spotlessApply'], 300000],
      ['lint', command, [...prefix, 'checkstyleMain', 'checkstyleTest'], 300000],
      ['test', command, [...prefix, 'check'], 300000],
    ];
  }
  const prefix = toolchain?.mirrorFiles?.mavenSettings
    ? ['-s', toolchain.mirrorFiles.mavenSettings]
    : [];
  return [
    ['install', command, [...prefix, '-B', '-ntp', 'dependency:go-offline'], 600000],
    ['format', command, [...prefix, '-B', '-ntp', 'spotless:apply'], 300000],
    ['lint', command, [...prefix, '-B', '-ntp', 'checkstyle:check'], 300000],
    ['test', command, [...prefix, '-B', '-ntp', 'verify'], 300000],
  ];
}

function pythonPlan(root, side, toolchain) {
  const python = resolvePython(toolchain);
  if (!python) return null;
  const py2 = String(side.pythonVersion || side.runtimeVersion) === '2.7';
  const stages = [];
  const uv = toolchain?.uv?.path;
  if (uv && side.packageManager === 'uv') {
    const venv = path.join(
      root,
      '.venv',
      process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'python.exe' : 'python',
    );
    stages.push(['install', uv, ['venv', '.venv'], 300000]);
    stages.push([
      'deps',
      uv,
      ['pip', 'install', '--python', venv, '-r', 'requirements.txt'],
      600000,
    ]);
  } else {
    if (!py2) stages.push(['install', python, ['-m', 'venv', '.venv'], 300000]);
    stages.push([
      'deps',
      py2 ? python : 'VENV',
      ['-m', 'pip', 'install', '-r', 'requirements.txt'],
      600000,
    ]);
  }
  const runner = py2 ? python : 'VENV';
  if (py2) {
    stages.push(['format', runner, ['-m', 'autopep8', '--in-place', '-r', '.'], 300000]);
    stages.push(['lint', runner, ['-m', 'flake8', '.'], 300000]);
  } else {
    stages.push(['format', runner, ['-m', 'ruff', 'format', '.'], 300000]);
    stages.push(['lint', runner, ['-m', 'ruff', 'check', '.'], 300000]);
  }
  stages.push(['test', runner, ['-m', 'pytest', '-q', 'tests'], 300000]);
  return stages;
}

function nodeRunner(side, toolchain) {
  const pm = side.packageManager || 'pnpm';
  if (pm === 'pnpm') {
    const pnpm = toolchain?.pnpm;
    if (pnpm?.kind === 'node-script' && pnpm.node) {
      return { command: pnpm.node, prefix: [pnpm.path] };
    }
    if (pnpm?.path) return { command: pnpm.path, prefix: [] };
    const fallback = resolvePm('pnpm') || resolvePm('npm');
    return fallback ? { command: fallback, prefix: [] } : null;
  }
  const command = resolvePm(pm);
  return command ? { command, prefix: [] } : null;
}

function nodePlan(root, side, toolchain) {
  const runner = nodeRunner(side, toolchain);
  if (!runner) return null;
  const pm = side.packageManager || 'pnpm';
  const runScript = (script) => (pm === 'yarn' ? [script] : ['run', script]);
  return [
    ['install', runner.command, [...runner.prefix, 'install'], 600000],
    ['format', runner.command, [...runner.prefix, ...runScript('format')], 300000],
    ['lint', runner.command, [...runner.prefix, ...runScript('lint')], 300000],
    ['test', runner.command, [...runner.prefix, ...runScript('test')], 300000],
  ];
}

function isIgnoredBuilds(stage) {
  return /ERR_PNPM_IGNORED_BUILDS/.test(String(stage.stderr || '') + String(stage.stdout || ''));
}

export function executePlan({ root, side, toolchain = null }) {
  let stages;
  if (side.stack === 'java') stages = javaPlan(root, side, toolchain);
  else if (side.stack === 'python') stages = pythonPlan(root, side, toolchain);
  else stages = nodePlan(root, side, toolchain);
  if (!stages) {
    return {
      ok: true,
      skipped: true,
      reason: '未找到可用的构建/运行时工具链',
      stages: [],
    };
  }
  const baseEnv = toolchain ? toolchainEnv(toolchain) : process.env;
  let env =
    toolchain?.mirrors && toolchain?.mirrorFiles
      ? mirrorEnv(toolchain.mirrors, toolchain.mirrorFiles, baseEnv)
      : baseEnv;
  if (side.stack === 'java') {
    const projectRoot = path.resolve(root, '..');
    const localRepo = path.join(projectRoot, '.specgate', 'm2repo');
    env = {
      ...env,
      MAVEN_OPTS: [env.MAVEN_OPTS, '-Dmaven.repo.local=' + localRepo].filter(Boolean).join(' '),
    };
  }
  const results = [];
  for (const [name, command, args, timeout] of stages) {
    let resolved = command;
    if (command === 'VENV') resolved = venvPython(root);
    if (command === 'UV') resolved = toolchain?.uv?.path;
    if (!resolved) {
      const missing = {
        name,
        command,
        status: 1,
        stdout: '',
        stderr: 'toolchain executable not found',
        durationMs: 0,
      };
      results.push(missing);
      return {
        ok: false,
        code: 'BOOTSTRAP_QUALITY_FAILED',
        message: name + ' 失败（toolchain executable not found）',
        failedStage: name,
        stages: results,
      };
    }
    let stage = run(root, resolved, args, { name, timeout, env });
    if (name === 'install' && stage.status !== 0 && isIgnoredBuilds(stage)) {
      const retry = run(root, resolved, [...args, '--ignore-scripts'], { name, timeout, env });
      if (retry.status === 0) {
        retry.warning = 'pnpm ignored build scripts; installed with --ignore-scripts';
        stage = retry;
      }
    }
    results.push(stage);
    if (stage.status !== 0) {
      return {
        ok: false,
        code: 'BOOTSTRAP_QUALITY_FAILED',
        message: name + ' 失败（exit ' + stage.status + '）',
        failedStage: name,
        stages: results,
      };
    }
  }
  results.push(writeReviewReport(root, side));
  return { ok: true, stages: results };
}
