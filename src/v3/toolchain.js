import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { exists, readText, writeText } from './util/fsx.js';
import { appendRun } from './runs.js';
import { ensureVenv } from './env/python.js';

const REQUIRED = {
  node: ['prettier', 'eslint', 'eslint-config-prettier'],
  vue: ['prettier', 'eslint', 'eslint-config-prettier', 'eslint-plugin-vue', 'vue-tsc'],
  react: ['prettier', 'eslint', 'eslint-config-prettier'],
  python: ['ruff', 'mypy'],
};

const CONFIGS = {
  'ruff.toml': 'line-length = 100\n\n[lint]\nselect = ["E", "F", "I"]\n',
  'mypy.ini': '[mypy]\nignore_missing_imports = True\n',
};

function manager(root) {
  if (exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function installCommand(root, packages, managerName) {
  if (managerName === 'pnpm') return ['pnpm', ['add', '-D', ...packages]];
  if (managerName === 'yarn') return ['yarn', ['add', '-D', ...packages]];
  return ['npm', ['install', '-D', ...packages]];
}

function available(bin) {
  const run = spawnSync(bin, ['--version'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return run.status === 0;
}

function resolveManager(root, managerName) {
  const wanted = managerName || manager(root);
  if (wanted !== 'npm' && !available(wanted)) return 'npm';
  return wanted;
}

function baseInstallCommand(root, managerName) {
  if (managerName === 'pnpm') return ['pnpm', ['install', '--frozen-lockfile']];
  if (managerName === 'yarn') return ['yarn', ['install', '--immutable']];
  return ['npm', ['install']];
}

export function planToolchain(root, worktree = root, stack = null) {
  const pkgFile = path.join(worktree, 'package.json');
  const java =
    stack === 'java' ||
    stack === 'java-monorepo' ||
    exists(path.join(worktree, 'pom.xml')) ||
    exists(path.join(worktree, 'build.gradle')) ||
    exists(path.join(worktree, 'build.gradle.kts'));
  if (java) {
    return { ok: true, packages: [], configs: [], skipped: false, java: true, hasLockfile: true };
  }
  if (!exists(pkgFile)) {
    const python =
      stack === 'python' ||
      exists(path.join(worktree, 'pyproject.toml')) ||
      exists(path.join(worktree, 'requirements.txt'));
    if (!python) return { ok: true, packages: [], configs: [], skipped: true };
    const configs = ['ruff.toml', 'mypy.ini'].filter((file) => !exists(path.join(worktree, file)));
    return { ok: true, packages: [], configs, skipped: false, python: true, hasLockfile: true };
  }
  let pkg;
  try {
    pkg = JSON.parse(readText(pkgFile));
  } catch {
    return { ok: false, code: 'PACKAGE_INVALID', message: 'package.json 不是合法 JSON' };
  }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const required = REQUIRED[stack] || REQUIRED.node;
  const packages = required.filter((name) => !deps[name]);
  const python =
    stack === 'python' ||
    exists(path.join(worktree, 'pyproject.toml')) ||
    exists(path.join(worktree, 'requirements.txt'));
  const configs = python
    ? Object.keys(CONFIGS).filter((file) => !exists(path.join(worktree, file)))
    : [];
  const hasLockfile = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'].some((file) =>
    exists(path.join(root, file)),
  );
  return { ok: true, packages, configs, skipped: false, hasLockfile };
}

export function ensureToolchain({
  root,
  worktree,
  change,
  task,
  stack,
  install = true,
  managerName = null,
}) {
  const plan = planToolchain(root, worktree, stack);
  if (!plan.ok || plan.skipped) return plan;
  if (plan.java) return { ...plan, generated: [], installed: false };
  if (!plan.hasLockfile) return { ...plan, skipped: true, reason: 'NO_LOCKFILE' };
  const generated = [];
  for (const file of plan.configs) {
    writeText(path.join(worktree, file), CONFIGS[file]);
    generated.push(file);
  }
  if (plan.python) {
    if (!install) return { ...plan, generated, installed: false };
    const venv = ensureVenv({ root: worktree, suite: { python: null } });
    if (!venv.ok) return { ok: false, code: 'TOOLCHAIN_VENV_FAILED', message: venv.message };
    const started = Date.now();
    const run = spawnSync(venv.python, ['-m', 'pip', 'install', 'ruff', 'mypy'], {
      cwd: worktree,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    const durationMs = Date.now() - started;
    appendRun(root, {
      change,
      task: task.id,
      role: 'toolchain',
      worktree,
      commit: null,
      durationMs,
      result: run.status === 0 ? 'pass' : 'fail',
      error: run.status === 0 ? null : `exit ${run.status}`,
    });
    if (run.status !== 0) {
      return {
        ok: false,
        code: 'TOOLCHAIN_INSTALL_FAILED',
        message: `pip install ruff mypy 失败`,
        stderr: run.stderr,
      };
    }
    return { ...plan, generated, installed: true };
  }
  if (plan.packages.length === 0) {
    if (install && !exists(path.join(worktree, 'node_modules'))) {
      const [bin, args] = baseInstallCommand(root, resolveManager(root, managerName));
      const started = Date.now();
      const run = spawnSync(bin, args, {
        cwd: worktree,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        shell: process.platform === 'win32',
      });
      appendRun(root, {
        change,
        task: task.id,
        role: 'toolchain',
        worktree,
        commit: null,
        durationMs: Date.now() - started,
        result: run.status === 0 ? 'pass' : 'fail',
        error: run.status === 0 ? null : `exit ${run.status}`,
      });
      if (run.status !== 0) {
        return {
          ok: false,
          code: 'TOOLCHAIN_INSTALL_FAILED',
          message: `${bin} ${args.join(' ')} 失败`,
          stderr: run.stderr,
        };
      }
      return { ...plan, generated, installed: true };
    }
    appendRun(root, {
      change,
      task: task.id,
      role: 'toolchain',
      worktree,
      commit: null,
      durationMs: 0,
      result: generated.length > 0 ? 'config' : 'ready',
    });
    return { ...plan, generated, installed: false };
  }
  if (!install) return { ...plan, generated, installed: false };
  const [bin, args] = installCommand(root, plan.packages, resolveManager(root, managerName));
  const started = Date.now();
  const run = spawnSync(bin, args, {
    cwd: worktree,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  const durationMs = Date.now() - started;
  appendRun(root, {
    change,
    task: task.id,
    role: 'toolchain',
    worktree,
    commit: null,
    durationMs,
    result: run.status === 0 ? 'pass' : 'fail',
    error: run.status === 0 ? null : `exit ${run.status}`,
  });
  if (run.status !== 0) {
    return {
      ok: false,
      code: 'TOOLCHAIN_INSTALL_FAILED',
      message: `${bin} ${args.join(' ')} 失败`,
      stderr: run.stderr,
    };
  }
  return { ...plan, generated, installed: true };
}
