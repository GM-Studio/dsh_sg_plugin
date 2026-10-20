import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists } from '../v3/util/fsx.js';

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

function resolvePython() {
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

function javaPlan(root, side) {
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
  const command = exists(wrapper) ? wrapper : gradle ? resolvePm('gradle') : resolvePm('mvn');
  if (!command) return null;
  if (gradle) {
    return [
      ['install', command, ['dependencies'], 600000],
      ['format', command, ['spotlessApply'], 300000],
      ['lint', command, ['checkstyleMain', 'checkstyleTest'], 300000],
      ['test', command, ['check'], 300000],
    ];
  }
  return [
    ['install', command, ['-B', '-ntp', 'dependency:go-offline'], 600000],
    ['format', command, ['-B', '-ntp', 'spotless:apply'], 300000],
    ['lint', command, ['-B', '-ntp', 'checkstyle:check'], 300000],
    ['test', command, ['-B', '-ntp', 'verify'], 300000],
  ];
}

function pythonPlan(root, side) {
  const python = resolvePython();
  if (!python) return null;
  const py2 = String(side.pythonVersion || side.runtimeVersion) === '2.7';
  const stages = [];
  // Python 2.7 has no stdlib venv; use the interpreter directly and warn in README.
  if (!py2) stages.push(['install', python, ['-m', 'venv', '.venv'], 300000]);
  const runner = py2 ? python : 'VENV';
  stages.push(['deps', runner, ['-m', 'pip', 'install', '-r', 'requirements.txt'], 600000]);
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

function nodePlan(root, side) {
  const pm = side.packageManager || 'pnpm';
  const command = resolvePm(pm);
  if (!command) return null;
  const runScript = (script) => (pm === 'yarn' ? [script] : ['run', script]);
  return [
    ['install', command, ['install'], 600000],
    ['format', command, runScript('format'), 300000],
    ['lint', command, runScript('lint'), 300000],
    ['test', command, runScript('test'), 300000],
  ];
}

export function executePlan({ root, side }) {
  let stages;
  if (side.stack === 'java') stages = javaPlan(root, side);
  else if (side.stack === 'python') stages = pythonPlan(root, side);
  else stages = nodePlan(root, side);
  if (!stages) {
    return {
      ok: true,
      skipped: true,
      reason: '未找到可用的构建/运行时工具链',
      stages: [],
    };
  }
  const results = [];
  for (const [name, command, args, timeout] of stages) {
    const resolved = command === 'VENV' ? venvPython(root) : command;
    if (!resolved) {
      const missing = {
        name,
        command: 'VENV',
        status: 1,
        stdout: '',
        stderr: 'venv python not found',
        durationMs: 0,
      };
      results.push(missing);
      return {
        ok: false,
        code: 'BOOTSTRAP_QUALITY_FAILED',
        message: name + ' 失败（venv python not found）',
        failedStage: name,
        stages: results,
      };
    }
    const stage = run(root, resolved, args, { name, timeout });
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
