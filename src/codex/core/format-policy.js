import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateProjectProfile } from '../project-model.js';

const excluded = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.ruff_cache',
  '.mypy_cache',
  '.pytest_cache',
  'target',
  'build',
  'dist',
  'coverage',
  'vendor',
  '.gradle',
]);
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};
function text(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
    fail('FORMAT_CONFIGURATION_INVALID', `Unsafe or oversized formatter configuration: ${file}`);
  return fs.readFileSync(file, 'utf8');
}
function json(file) {
  try {
    return JSON.parse(text(file));
  } catch (error) {
    fail(
      error.code || 'FORMAT_CONFIGURATION_INVALID',
      `Invalid formatter configuration: ${file}: ${error.message}`,
    );
  }
}
function directory(root, relative) {
  if (
    typeof relative !== 'string' ||
    (relative !== '.' &&
      (!relative ||
        relative.includes('\\') ||
        relative.split('/').some((part) => !part || part === '.' || part === '..'))) ||
    path.isAbsolute(relative) ||
    /^[A-Za-z]:/.test(relative)
  )
    fail('FORMAT_CONFIGURATION_INVALID', 'Formatter cwd must stay inside the project');
  let current = root;
  for (const part of relative === '.' ? [] : relative.split('/')) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      fail(
        'FORMAT_CONFIGURATION_INVALID',
        'Formatter cwd contains a symlink or is not a directory',
      );
  }
  return current;
}
function argv(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 128 &&
    value.every(
      (arg) =>
        typeof arg === 'string' && arg.length > 0 && arg.length <= 8192 && !/[\r\n\0]/.test(arg),
    )
  );
}

// A bounded walk also supplies the before/after fingerprint for check-only commands.
// Symlinks are fingerprinted, never traversed; configurations and cwd reject them.
export function formatSourceSnapshot(root) {
  const files = [],
    directories = [];
  const queue = [{ dir: root, depth: 0 }];
  let bytes = 0,
    count = 0;
  while (queue.length) {
    const { dir, depth } = queue.shift();
    if (++count > 4096 || depth > 32)
      fail(
        'FORMAT_DISCOVERY_LIMIT',
        'Formatter scan exceeded 4096 directories or depth 32; narrow the project',
      );
    directories.push(dir);
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const file = path.join(dir, entry.name),
        relative = path.relative(root, file).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) queue.push({ dir: file, depth: depth + 1 });
      } else {
        if (files.length >= 60000)
          fail('FORMAT_DISCOVERY_LIMIT', 'Formatter scan exceeded 60000 files');
        if (entry.isSymbolicLink()) files.push([relative, 'link:' + fs.readlinkSync(file)]);
        else if (entry.isFile()) {
          const size = fs.statSync(file).size;
          bytes += size;
          if (bytes > 256 * 1024 * 1024)
            fail('FORMAT_DISCOVERY_LIMIT', 'Formatter scan exceeded 256 MiB');
          files.push([relative, createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
        } else fail('FORMAT_CONFIGURATION_INVALID', `Unsupported source entry: ${relative}`);
      }
    }
  }
  return {
    directories,
    files,
    hash: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  };
}

function nodeCommands(root, cwd, mode, pkg) {
  const pm = pkg.packageManager?.match(/^(npm|pnpm|yarn)@(\d+\.\d+\.\d+)(?:\+.*)?$/);
  if (pkg.packageManager && !pm)
    fail(
      'FORMAT_CONFIGURATION_INVALID',
      'Unsupported packageManager; configure an explicit formatter command',
    );
  const locks = [
    ['npm', 'package-lock.json'],
    ['npm', 'npm-shrinkwrap.json'],
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
  ].filter(([, file]) => fs.existsSync(path.join(cwd, file)));
  const managers = [...new Set(locks.map(([name]) => name))];
  if (managers.length > 1 || (pm && managers.some((name) => name !== pm[1])))
    fail('FORMAT_CONFIGURATION_INVALID', 'Package-manager declaration and lock files conflict');
  const manager = pm?.[1] || managers[0] || 'npm';
  const scripts = pkg.scripts || {};
  const name =
    mode === 'check'
      ? ['format:check', 'format-check'].find((name) => typeof scripts[name] === 'string')
      : ['format:write', 'format:fix', 'format'].find(
          (name) => typeof scripts[name] === 'string',
        ) || ['format:check', 'format-check'].find((name) => typeof scripts[name] === 'string');
  if (!name)
    fail(
      'FORMAT_COMMAND_MISSING',
      `No ${mode} formatter script at ${path.relative(root, cwd) || '.'}`,
    );
  const script = scripts[name];
  const actualMode =
    /check/.test(name) ||
    (/\s--(?:check|list-different)(?:\s|$)/.test(script) &&
      !/\s--(?:write|fix)(?:\s|$)/.test(script))
      ? 'check'
      : 'apply';
  const commands = [];
  if (pm)
    commands.push({
      command: manager,
      args: ['--version'],
      cwd,
      mode: 'probe',
      expectedVersion: pm[2],
    });
  const hasDependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0;
  if (hasDependencies && !fs.existsSync(path.join(cwd, 'node_modules'))) {
    if (mode === 'check')
      fail(
        'FORMAT_DEPENDENCIES_MISSING',
        'Check mode will not install missing dependencies; prepare them with approval first',
      );
    if (!managers.length)
      fail(
        'FORMAT_DEPENDENCIES_MISSING',
        'Formatter dependency installation requires a declared lock file and an already approved cache',
      );
    const args =
      manager === 'npm'
        ? ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']
        : manager === 'pnpm'
          ? ['install', '--offline', '--frozen-lockfile', '--ignore-scripts']
          : Number(pm?.[2]?.split('.')[0] || 1) >= 2
            ? ['install', '--immutable', '--mode=skip-builds']
            : [
                'install',
                '--offline',
                '--frozen-lockfile',
                '--ignore-scripts',
                '--non-interactive',
              ];
    commands.push({ command: manager, args, cwd, mode: 'prepare' });
  }
  commands.push({ command: manager, args: ['run', name], cwd, mode: actualMode });
  return commands;
}

export function resolveFormatPolicy(worktree, mode = 'apply', { projectRoot = worktree } = {}) {
  if (!['apply', 'check'].includes(mode))
    fail('FORMAT_CONFIGURATION_INVALID', 'Formatter mode must be apply or check');
  const root = fs.realpathSync(worktree),
    snapshot = formatSourceSnapshot(root),
    commands = [],
    covered = new Set();
  const configurationRoot = fs.realpathSync(projectRoot);
  const policy = path.join(configurationRoot, '.specgate/format.json');
  const configurationHashes = [];
  if (fs.existsSync(policy)) {
    directory(configurationRoot, '.specgate');
    const body = json(policy);
    configurationHashes.push(body);
    if (
      body.schemaVersion !== 1 ||
      Object.keys(body).some((key) => !['schemaVersion', 'commands'].includes(key)) ||
      !Array.isArray(body.commands) ||
      !body.commands.length ||
      body.commands.length > 100
    )
      fail('FORMAT_CONFIGURATION_INVALID', 'Invalid explicit formatter policy');
    const ids = new Set();
    for (const entry of body.commands) {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        !/^[A-Za-z0-9._-]{1,128}$/.test(entry.id) ||
        ids.has(entry.id) ||
        Object.keys(entry).some((key) => !['id', 'cwd', 'check', 'apply'].includes(key)) ||
        (!entry.check && !entry.apply) ||
        (entry.check && !argv(entry.check)) ||
        (entry.apply && !argv(entry.apply))
      )
        fail('FORMAT_CONFIGURATION_INVALID', 'Invalid explicit formatter argv record');
      ids.add(entry.id);
      const cwd = directory(root, entry.cwd),
        selected = mode === 'check' ? entry.check : entry.apply || entry.check;
      if (!selected) fail('FORMAT_COMMAND_MISSING', `No check command configured for ${entry.id}`);
      commands.push({
        command: selected[0],
        args: selected.slice(1),
        cwd,
        mode: selected === entry.check ? 'check' : 'apply',
      });
      covered.add(cwd);
    }
  }
  const profile = path.join(configurationRoot, '.specgate/codex/project.json');
  if (fs.existsSync(profile)) {
    directory(configurationRoot, '.specgate/codex');
    const body = json(profile),
      valid = validateProjectProfile(body);
    if (!valid.ok) fail(valid.code, valid.message);
    configurationHashes.push(body);
    for (const entry of body.commands.format) {
      const cwd = directory(root, entry.cwd);
      if (covered.has(cwd)) continue;
      if (
        /^(?:npm|pnpm|yarn)(?:\.cmd)?$/.test(entry.argv[0]) &&
        entry.argv[1] === 'run' &&
        fs.existsSync(path.join(cwd, 'package.json'))
      ) {
        commands.push(...nodeCommands(root, cwd, mode, json(path.join(cwd, 'package.json'))));
        continue;
      }
      const isCheck = entry.argv.some((arg) =>
        /^(?:--check|format:check|spotless:check|spotlessCheck)$/.test(arg),
      );
      if (mode === 'check' && !isCheck)
        fail(
          'FORMAT_COMMAND_MISSING',
          `Profile command ${entry.id} has no explicit check mode; add .specgate/format.json`,
        );
      commands.push({
        command: entry.argv[0],
        args: entry.argv.slice(1),
        cwd,
        mode: isCheck ? 'check' : 'apply',
        timeoutMs: entry.timeoutMs,
      });
      // Multiple profile commands in the same module must all run.
    }
    for (const entry of body.commands.format) covered.add(directory(root, entry.cwd));
  }
  for (const cwd of snapshot.directories) {
    if (path.relative(root, cwd).split(path.sep).includes('.specgate') || covered.has(cwd))
      continue;
    if (fs.existsSync(path.join(cwd, 'package.json'))) {
      const pkg = json(path.join(cwd, 'package.json'));
      // Workspace aggregation manifests without source or format scripts delegate to their modules.
      if (!(
        pkg.workspaces && !Object.keys(pkg.scripts || {}).some((name) => name.startsWith('format'))
      ))
        commands.push(...nodeCommands(root, cwd, mode, pkg));
    }
    if (fs.existsSync(path.join(cwd, 'pom.xml'))) {
      const pom = text(path.join(cwd, 'pom.xml'));
      if (!/<artifactId>\s*spotless-maven-plugin\s*<\/artifactId>/.test(pom))
        fail(
          'FORMAT_COMMAND_MISSING',
          `No declared Maven formatter at ${path.relative(root, cwd) || '.'}`,
        );
      const wrapper = path.join(cwd, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
      if (fs.existsSync(wrapper))
        fail(
          'FORMAT_CONFIGURATION_INVALID',
          'Maven wrappers may bootstrap downloads; configure an approved explicit formatter command or reuse installed Maven',
        );
      commands.push({
        command: 'mvn',
        args: ['--offline', mode === 'check' ? 'spotless:check' : 'spotless:apply'],
        cwd,
        mode,
      });
    }
    if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
      const config = text(path.join(cwd, 'pyproject.toml'));
      const tool = /^\s*\[tool\.ruff(?:\.[^\]]+)?\]/m.test(config)
        ? 'ruff'
        : /^\s*\[tool\.black\]/m.test(config)
          ? 'black'
          : null;
      if (!tool)
        fail(
          'FORMAT_COMMAND_MISSING',
          `No declared Python formatter at ${path.relative(root, cwd) || '.'}`,
        );
      commands.push({
        command: tool,
        args:
          tool === 'ruff'
            ? ['format', ...(mode === 'check' ? ['--check'] : []), '.']
            : [...(mode === 'check' ? ['--check'] : []), '.'],
        cwd,
        mode,
      });
    }
    if (fs.existsSync(path.join(cwd, 'go.mod'))) {
      const files = snapshot.files
        .map(([name]) => name)
        .filter(
          (name) =>
            name.endsWith('.go') &&
            (cwd === root || name.startsWith(path.relative(root, cwd).replaceAll('\\', '/') + '/')),
        )
        .map((name) => path.relative(cwd, path.join(root, name)));
      if (!files.length) fail('FORMAT_COMMAND_MISSING', 'Go module has no source to format');
      for (let offset = 0; offset < files.length; offset += 64)
        commands.push({
          command: 'gofmt',
          args: [mode === 'check' ? '-l' : '-w', ...files.slice(offset, offset + 64)],
          cwd,
          mode,
          nonemptyFails: mode === 'check',
        });
    }
  }
  if (!commands.length)
    fail(
      'FORMAT_COMMAND_MISSING',
      'No project formatter command is configured; declare .specgate/format.json for custom stacks',
    );
  return {
    commands,
    mode,
    sourceHash: snapshot.hash,
    configurationHash: createHash('sha256')
      .update(JSON.stringify(configurationHashes))
      .digest('hex'),
  };
}
