import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists, readText } from '../util/fsx.js';

export function readPythonRequirement(root, { suite, config } = {}) {
  if (suite?.python) return String(suite.python);
  if (config?.python) return String(config.python);
  const versionFile = path.join(root, '.python-version');
  if (exists(versionFile)) {
    const value = readText(versionFile).trim();
    if (value) return value;
  }
  const runtimeFile = path.join(root, 'runtime.txt');
  if (exists(runtimeFile)) {
    const value = readText(runtimeFile)
      .trim()
      .replace(/^python-/, '');
    if (value) return value;
  }
  const pyproject = path.join(root, 'pyproject.toml');
  if (exists(pyproject)) {
    const text = readText(pyproject);
    const match = /requires-python\s*=\s*["']([^"']+)["']/.exec(text);
    if (match) return match[1];
  }
  return null;
}

function minorOf(version) {
  const match = /^(\d+)\.(\d+)/.exec(String(version).trim());
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : null;
}

export function satisfiesPython(version, requirement) {
  if (!requirement) return true;
  const current = minorOf(version);
  if (!current) return false;
  const text = String(requirement).trim();

  const exact = /^3\.(\d+)$/.exec(text);
  if (exact) return current.major === 3 && current.minor === Number(exact[1]);

  const bounds = [...text.matchAll(/([<>]=?)?\s*3\.(\d+)/g)].map((match) => ({
    op: match[1] || '',
    minor: Number(match[2]),
  }));
  if (bounds.length === 0) return current.major === 3;

  let min = 0;
  let max = 99;
  for (const bound of bounds) {
    if (bound.op === '>' || bound.op === '>=')
      min = Math.max(min, bound.minor + (bound.op === '>' ? 1 : 0));
    else if (bound.op === '<' || bound.op === '<=')
      max = Math.min(max, bound.minor - (bound.op === '<' ? 1 : 0));
    else if (bound.op === '') min = Math.max(min, bound.minor);
  }
  return current.major === 3 && current.minor >= min && current.minor <= max;
}

export function venvPythonPath(root) {
  return process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python');
}

export function pythonVersion(bin, args = [], env = process.env) {
  const result = spawnSync(bin, [...args, '-V'], { encoding: 'utf8', windowsHide: true, env });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  const match = /Python\s+(\d+\.\d+\.\d+)/.exec(output);
  if (result.status !== 0 || !match) {
    return { ok: false, message: output || 'python -V 失败' };
  }
  return { ok: true, version: match[1] };
}

function interpreterFor(requirement) {
  const exact = /^3\.(\d+)$/.exec(String(requirement || '').trim());
  if (process.platform === 'win32') {
    return exact ? ['py', [`-3.${exact[1]}`]] : ['py', ['-3']];
  }
  return exact ? [`python3.${exact[1]}`, []] : ['python3', []];
}

export function ensureVenv({ root, suite, config, env = process.env }) {
  const requirement = readPythonRequirement(root, { suite, config });
  const venvPath = path.join(root, '.venv');
  const target = venvPythonPath(root);

  if (exists(target)) {
    const current = pythonVersion(target, [], env);
    if (!current.ok) {
      return { ok: false, code: 'PYTHON_NOT_FOUND', message: `.venv 无法执行：${current.message}` };
    }
    if (!satisfiesPython(current.version, requirement)) {
      return {
        ok: false,
        code: 'PYTHON_VERSION_MISMATCH',
        message: `.venv 版本 ${current.version} 不满足 ${requirement}；不会自动删除或重建`,
      };
    }
    return { ok: true, python: target, version: current.version, venv: venvPath, reused: true };
  }

  const [bin, prefix] = interpreterFor(requirement);
  const probe = pythonVersion(bin, prefix, env);
  if (!probe.ok) {
    return { ok: false, code: 'PYTHON_NOT_FOUND', message: `找不到可用的 Python 解释器 ${bin}` };
  }
  if (!satisfiesPython(probe.version, requirement)) {
    return {
      ok: false,
      code: 'PYTHON_VERSION_MISMATCH',
      message: `默认解释器 ${probe.version} 不满足 ${requirement}`,
    };
  }

  fs.mkdirSync(root, { recursive: true });
  const created = spawnSync(bin, [...prefix, '-m', 'venv', venvPath], {
    encoding: 'utf8',
    windowsHide: true,
    env,
  });
  if (created.status !== 0) {
    return {
      ok: false,
      code: 'VENV_CREATE_FAILED',
      message: `创建 .venv 失败：${String(created.stderr || '').slice(-400)}`,
    };
  }

  const verified = pythonVersion(target, [], env);
  if (!verified.ok) {
    return {
      ok: false,
      code: 'VENV_CREATE_FAILED',
      message: `venv 创建后无法执行：${verified.message}`,
    };
  }
  return { ok: true, python: target, version: verified.version, venv: venvPath, created: true };
}
