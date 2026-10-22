import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitSafeDirectory } from './git-path.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SKIP = new Set(['.git', 'node_modules', 'dist', 'target', 'coverage', '.specgate']);
const MAX_ENTRIES = 25000;

const failure = (code, message) => ({ ok: false, code, message });

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function git(root, args, environment) {
  return spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${gitSafeDirectory(root)}`,
      '-c',
      'core.filemode=false',
      '-c',
      'core.autocrlf=true',
      ...args,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: environment,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    },
  );
}

function inspectFiles(root) {
  let entries = 0;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > MAX_ENTRIES)
        throw Object.assign(new Error('Project scan limit exceeded'), {
          code: 'PROJECT_SCAN_LIMIT',
        });
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join('/');
      if (entry.isSymbolicLink())
        throw Object.assign(new Error('Project contains a symlink'), {
          code: 'UNSAFE_PROJECT_PATH',
        });
      if (!entry.isDirectory() && (entry.isFile() ? fs.lstatSync(target).nlink > 1 : true))
        throw Object.assign(new Error('Project contains a hardlink or special file'), {
          code: 'UNSAFE_PROJECT_PATH',
        });
      if (entry.isDirectory() && !SKIP.has(entry.name) && relative !== '.specgate') visit(target);
    }
  };
  visit(root);
}

function packageManager(directory) {
  if (fs.existsSync(path.join(directory, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(directory, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(directory, 'package-lock.json'))) return 'npm';
  return 'npm';
}

function frontendFramework(root, frontends) {
  let vue = false;
  let react = false;
  for (const directory of frontends) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(root, directory, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const dependencies = {
      ...(manifest?.dependencies || {}),
      ...(manifest?.devDependencies || {}),
    };
    if (Object.hasOwn(dependencies, 'vue')) vue = true;
    if (Object.hasOwn(dependencies, 'react')) react = true;
  }
  return react && !vue ? 'react' : 'vue';
}

function frontendRoots(root) {
  const roots = new Set();
  const addChildren = (directory) => {
    if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).slice(0, 32)) {
      if (!entry.isDirectory() || SKIP.has(entry.name)) continue;
      const child = path.join(directory, entry.name);
      if (fs.existsSync(path.join(child, 'package.json')))
        roots.add(path.relative(root, child).split(path.sep).join('/'));
    }
  };
  for (const candidate of ['frontend', 'front-end']) {
    const directory = path.join(root, candidate);
    if (fs.existsSync(path.join(directory, 'package.json'))) roots.add(candidate);
    else addChildren(directory);
  }
  if (roots.size === 0 && fs.existsSync(path.join(root, 'package.json'))) roots.add('.');
  return [...roots].sort();
}

function installCommand({ cwd, directory, manager, prefix }) {
  if (fs.existsSync(path.join(directory, 'node_modules'))) return null;
  const argv =
    manager === 'pnpm'
      ? ['pnpm', 'install', '--frozen-lockfile']
      : manager === 'yarn'
        ? ['yarn', 'install', '--frozen-lockfile']
        : fs.existsSync(path.join(directory, 'package-lock.json'))
          ? ['npm', 'ci']
          : ['npm', 'install', '--no-package-lock'];
  return { id: `${prefix}-install`, cwd, argv };
}

function frontendCommands(root, directory, risks) {
  const packageJson = path.join(root, directory, 'package.json');
  const manager = packageManager(path.dirname(packageJson));
  let scripts;
  try {
    scripts = JSON.parse(fs.readFileSync(packageJson, 'utf8'))?.scripts;
  } catch {
    risks.push('Frontend package.json is invalid; frontend commands were not discovered.');
    return { install: [], build: [], test: [], lint: [], format: [], runtime: [] };
  }
  const cwd = path.relative(root, path.dirname(packageJson)).split(path.sep).join('/') || '.';
  const prefix =
    cwd === 'frontend'
      ? 'frontend'
      : `frontend-${cwd.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-|-$/g, '')}`;
  const command = (id, script) =>
    typeof scripts?.[script] === 'string'
      ? {
          id: `${prefix}-${script}`,
          cwd,
          argv:
            manager === 'npm'
              ? ['npm', 'run', script]
              : manager === 'yarn'
                ? ['yarn', script]
                : ['pnpm', script],
        }
      : null;
  return {
    install: [
      installCommand({ cwd, directory: path.dirname(packageJson), manager, prefix }),
    ].filter(Boolean),
    build: [command(`${prefix}-build`, 'build')].filter(Boolean),
    test: [command(`${prefix}-test`, 'test')].filter(Boolean),
    lint: [command(`${prefix}-lint`, 'lint')].filter(Boolean),
    format: [command(`${prefix}-format`, 'format')].filter(Boolean),
    runtime: [],
  };
}

function backendCommands(root) {
  const hasNested = fs.existsSync(path.join(root, 'backend', 'pom.xml'));
  const hasRoot = fs.existsSync(path.join(root, 'pom.xml'));
  if (!hasNested && !hasRoot) return { build: [], test: [] };
  const cwd = hasNested ? 'backend' : '.';
  return {
    build: [{ id: 'backend-build', cwd, argv: ['mvn', '-B', '-ntp', 'clean', 'verify'] }],
    test: [{ id: 'backend-test', cwd, argv: ['mvn', '-B', '-ntp', 'test'] }],
  };
}

function backendPackage(root, java) {
  const sourceRoot =
    java === 'backend'
      ? path.join(root, 'backend', 'src', 'main', 'java')
      : path.join(root, 'src', 'main', 'java');
  if (!fs.existsSync(sourceRoot)) return null;
  let inspected = 0;
  const pending = [sourceRoot];
  while (pending.length && inspected < 500) {
    const directory = pending.shift();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).slice(0, 200)) {
      if (entry.name.startsWith('.')) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && entry.name.endsWith('.java')) {
        inspected += 1;
        const head = fs.readFileSync(target, 'utf8').slice(0, 65536);
        const match = /^\s*package\s+([a-z][a-z0-9_.]*)\s*;/m.exec(head);
        if (match) return match[1];
      }
      if (inspected >= 500) break;
    }
  }
  return null;
}

function dirtyFiles(output) {
  const records = output.split('\0').filter(Boolean);
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;
    const state = record.slice(0, 2);
    files.push({ status: state, path: record.slice(3) });
    if (/[RC]/.test(state)) index += 1;
  }
  return files;
}

export function detectProject({ root: inputRoot } = {}) {
  try {
    if (typeof inputRoot !== 'string' || !path.isAbsolute(inputRoot))
      return failure('UNSAFE_PROJECT_PATH', 'Project root must be absolute');
    if (!fs.existsSync(inputRoot) || !fs.lstatSync(inputRoot).isDirectory())
      return failure('PROJECT_ROOT_MISSING', 'Project root is not an ordinary directory');
    const root = fs.realpathSync(inputRoot);
    if (inside(SOURCE_ROOT, root) || inside(root, SOURCE_ROOT))
      return failure('PROJECT_SOURCE_FORBIDDEN', 'The plugin source repository cannot be adopted');
    inspectFiles(root);

    const java = fs.existsSync(path.join(root, 'backend', 'pom.xml'))
      ? 'backend'
      : fs.existsSync(path.join(root, 'pom.xml'))
        ? 'root'
        : null;
    const frontends = frontendRoots(root);
    if (!java || frontends.length === 0)
      return failure(
        'PROJECT_STACK_UNSUPPORTED',
        'Only Java/Vue projects with a Maven and frontend package root are supported',
      );

    const environment = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
      ),
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    };
    const repository = git(root, ['rev-parse', '--show-toplevel'], environment);
    const repositoryRoot =
      repository.status === 0 ? fs.realpathSync(repository.stdout.trim()) : null;
    if (repositoryRoot && repositoryRoot !== root)
      return failure('PROJECT_GIT_ROOT_MISMATCH', 'The project root must be the Git root');
    const branch =
      repository.status === 0
        ? git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], environment)
        : null;
    const status =
      repository.status === 0
        ? git(root, ['status', '--porcelain=v1', '--untracked-files=all', '-z'], environment)
        : null;
    const remote =
      repository.status === 0 ? git(root, ['remote', 'get-url', 'origin'], environment) : null;
    const risks = [];
    const frontendFound = {
      install: [],
      build: [],
      test: [],
      lint: [],
      format: [],
      runtime: [],
    };
    for (const frontend of frontends) {
      const found = frontendCommands(root, frontend, risks);
      for (const key of Object.keys(frontendFound)) frontendFound[key].push(...found[key]);
    }
    const backendFound = backendCommands(root);
    const detectedPackage = backendPackage(root, java);
    const commands = {
      install: [...frontendFound.install],
      build: [...backendFound.build, ...frontendFound.build],
      test: [...backendFound.test, ...frontendFound.test],
      lint: [...frontendFound.lint],
      format: [...frontendFound.format],
      runtime: [...frontendFound.runtime],
    };
    if (commands.test.length === 0) risks.push('No test command was discovered.');
    if (status?.status === 0 && status.stdout.trim())
      risks.push('The worktree has uncommitted or untracked files.');
    return {
      ok: true,
      root,
      mode: 'adopted',
      stack: 'java-vue',
      modules: { backend: java, frontends },
      packageManager:
        frontends.length === 1 ? packageManager(path.join(root, frontends[0])) : 'mixed',
      conventions: {
        ...(detectedPackage ? { backendPackage: detectedPackage } : {}),
        frontendDefaultLocale: 'zh-CN',
        frontendLocales: ['zh-CN'],
        frontendFramework: frontendFramework(root, frontends),
      },
      commands,
      protectedPaths: fs.existsSync(path.join(root, '.env')) ? ['.env'] : [],
      risks,
      git: {
        repository: repository.status === 0,
        branch:
          branch?.status === 0 && branch.stdout.trim() !== 'HEAD' ? branch.stdout.trim() : null,
        clean: status?.status === 0 ? status.stdout.trim() === '' : null,
        dirtyFiles: status?.status === 0 ? dirtyFiles(status.stdout) : [],
        remoteUrl: remote?.status === 0 ? remote.stdout.trim() || null : null,
      },
    };
  } catch (error) {
    return failure(error.code || 'PROJECT_DETECTION_FAILED', error.message);
  }
}
