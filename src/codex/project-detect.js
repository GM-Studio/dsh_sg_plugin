import { gitExecutable } from './core/git-runtime.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitSafeDirectory } from './git-path.js';
import { detectStack } from './core/discovery/stack.js';
import { discoverModules } from './core/discovery/modules.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  'target',
  'coverage',
  '.specgate',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
]);
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
    gitExecutable(),
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
  // A source checkout's ignored dependencies do not exist in a fresh worktree.
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

function frontendCommands(root, directory, risks, module) {
  const packageJson = path.join(root, directory, 'package.json');
  const manager = module?.packageManager || packageManager(path.dirname(packageJson));
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
    install:
      module?.workspaceRoot !== undefined && module.workspaceRoot !== cwd
        ? []
        : [installCommand({ cwd, directory: path.dirname(packageJson), manager, prefix })].filter(
            Boolean,
          ),
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

    // FR-01 / AC-01：不再要求 Maven + 前端 package 根。
    // 任意仓库都得到观察与能力清单；缺失部分进入 gaps，而不是整体拒绝。
    const stack = detectStack({ root });
    if (!stack.ok) return stack;
    // AC-02：按真实构建文件识别模块，不凭目录名补造前后端。
    const discovered = discoverModules({
      root,
      candidates: ['.', ...stack.scanned.filter((entry) => entry !== '.')],
    });
    if (!discovered.ok) return discovered;
    const java = fs.existsSync(path.join(root, 'backend', 'pom.xml'))
      ? 'backend'
      : fs.existsSync(path.join(root, 'pom.xml'))
        ? 'root'
        : null;
    const frontends = [
      ...new Set([
        ...frontendRoots(root),
        ...stack.modules
          .filter((entry) => entry.buildSystems.includes('npm'))
          .map((entry) => entry.root),
      ]),
    ].sort();

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
      const found = frontendCommands(
        root,
        frontend,
        risks,
        stack.modules.find((m) => m.root === frontend),
      );
      for (const key of Object.keys(frontendFound)) frontendFound[key].push(...found[key]);
    }
    for (const workspace of stack.workspaces || []) {
      if (
        workspace.kind === 'go' ||
        !frontends.some(
          (frontend) =>
            stack.modules.find((m) => m.root === frontend)?.workspaceRoot === workspace.root,
        )
      )
        continue;
      if (!frontendFound.install.some((command) => command.cwd === workspace.root))
        frontendFound.install.push(
          installCommand({
            cwd: workspace.root,
            directory: path.join(root, workspace.root),
            manager: workspace.packageManager,
            prefix: 'workspace-' + workspace.root.replace(/[^A-Za-z0-9._-]/g, '-'),
          }),
        );
    }
    const managers = new Set(
      frontends.map(
        (frontend) =>
          stack.modules.find((m) => m.root === frontend)?.packageManager ||
          packageManager(path.join(root, frontend)),
      ),
    );
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
    for (const module of stack.modules) {
      const cwd = module.root;
      const prefix = module.id.replace(/[^A-Za-z0-9._-]/g, '-');
      if (module.buildSystems.includes('go')) {
        commands.install.push({ id: prefix + '-go-deps', cwd, argv: ['go', 'mod', 'download'] });
        commands.build.push({ id: prefix + '-go-build', cwd, argv: ['go', 'build', './...'] });
        commands.test.push({ id: prefix + '-go-test', cwd, argv: ['go', 'test', './...'] });
      }
      if (module.buildSystems.includes('python')) {
        const directory = path.join(root, cwd);
        const uv = fs.existsSync(path.join(directory, 'uv.lock'));
        const poetry = fs.existsSync(path.join(directory, 'poetry.lock'));
        const executable = uv ? 'uv' : poetry ? 'poetry' : 'python';
        if (!uv && !poetry)
          commands.install.push({
            id: prefix + '-python-venv',
            cwd,
            argv: [
              'python',
              '-c',
              'import pathlib,venv; target=pathlib.Path(".venv"); venv.EnvBuilder(with_pip=True).create(target) if not (target/"pyvenv.cfg").is_file() else print("Reusing project virtual environment")',
            ],
          });
        if (uv || poetry)
          commands.install.push({
            id: prefix + '-python-deps',
            cwd,
            argv: uv
              ? ['uv', 'sync', '--frozen']
              : ['poetry', 'install', '--sync', '--no-interaction'],
          });
        else if (fs.existsSync(path.join(directory, 'requirements.txt')))
          commands.install.push({
            id: prefix + '-python-deps',
            cwd,
            argv: ['python', '-m', 'pip', 'install', '-r', 'requirements.txt'],
          });
        else if (fs.existsSync(path.join(directory, 'pyproject.toml')))
          commands.install.push({
            id: prefix + '-python-deps',
            cwd,
            argv: ['python', '-m', 'pip', 'install', '-e', '.'],
          });
        const prefixArgs = uv ? ['run', '--frozen'] : poetry ? ['run'] : [];
        commands.test.push({
          id: prefix + '-python-test',
          cwd,
          argv: [
            executable,
            ...prefixArgs,
            ...(uv || poetry ? ['python'] : []),
            '-m',
            fs.existsSync(path.join(directory, 'pytest.ini')) ||
            fs.existsSync(path.join(directory, 'conftest.py'))
              ? 'pytest'
              : 'unittest',
            ...(fs.existsSync(path.join(directory, 'pytest.ini')) ||
            fs.existsSync(path.join(directory, 'conftest.py'))
              ? []
              : ['discover']),
          ],
        });
      }
      if (module.buildSystems.includes('gradle')) {
        commands.build.push({ id: prefix + '-gradle-build', cwd, argv: ['gradle', 'build'] });
        commands.test.push({ id: prefix + '-gradle-test', cwd, argv: ['gradle', 'test'] });
      }
      if (
        module.buildSystems.includes('maven') &&
        !commands.test.some((entry) => entry.cwd === cwd && entry.argv[0] === 'mvn')
      ) {
        commands.build.push({
          id: prefix + '-maven-build',
          cwd,
          argv: ['mvn', '-B', '-ntp', 'verify'],
        });
        commands.test.push({
          id: prefix + '-maven-test',
          cwd,
          argv: ['mvn', '-B', '-ntp', 'test'],
        });
      }
    }
    const idCounts = new Map();
    for (const command of Object.values(commands).flat())
      idCounts.set(command.id, (idCounts.get(command.id) || 0) + 1);
    const usedIds = new Set();
    for (const [kind, records] of Object.entries(commands)) {
      for (const command of records) {
        if (
          idCounts.get(command.id) > 1 ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(command.id) ||
          usedIds.has(command.id)
        ) {
          const stem =
            String(command.id)
              .replace(/[^A-Za-z0-9._-]/g, '-')
              .replace(/^[^A-Za-z0-9]+/, '')
              .slice(0, 100) || 'command';
          const seed = JSON.stringify([kind, command.cwd, command.argv]);
          let nonce = 0;
          do {
            command.id =
              stem +
              '-' +
              createHash('sha256')
                .update(seed + ':' + nonce++)
                .digest('hex')
                .slice(0, 16);
          } while (usedIds.has(command.id));
        }
        usedIds.add(command.id);
      }
    }
    if (commands.test.length === 0) risks.push('No test command was discovered.');
    if (status?.status === 0 && status.stdout.trim())
      risks.push('The worktree has uncommitted or untracked files.');
    // 前后端约定只在对应模块真实存在时才表达，不补造不存在的模块（AC-02）。
    const hasFrontend = frontends.length > 0;
    const conventions = {
      ...(detectedPackage ? { backendPackage: detectedPackage } : {}),
      ...(hasFrontend
        ? {
            frontendDefaultLocale: 'zh-CN',
            frontendLocales: ['zh-CN'],
            frontendFramework: frontendFramework(root, frontends),
          }
        : {}),
    };
    // stack 是描述性标签：Java+前端仍报 java-vue（既有语义），其余由检测结果给出。
    let stackLabel = stack.stack;
    if (java && hasFrontend) stackLabel = 'java-vue';
    return {
      ok: true,
      root,
      mode: 'adopted',
      stack: stackLabel,
      modules: { backend: java, frontends },
      // 技术栈无关的观察与能力清单（FR-01）。
      buildSystems: stack.buildSystems,
      languages: stack.languages,
      capabilities: stack.capabilities,
      observations: stack.observations,
      detectedModules: stack.modules,
      // 通用模块列表（含角色与入口）。modules.{backend,frontends} 保留兼容，
      // 退场条件见 docs/implementation/stack-neutral-adoption/01-binding-matrix.md。
      moduleList: discovered.modules,
      moduleRoles: discovered.roles,
      moduleObservations: discovered.observations,
      gaps: [...stack.gaps, ...discovered.gaps],
      lockfiles: stack.lockfiles,
      scan: stack.scan,
      workspaces: stack.workspaces,
      packageManager: managers.size === 1 ? [...managers][0] : 'mixed',
      conventions,
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
