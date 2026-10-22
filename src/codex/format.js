import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson, hashValue } from './events.js';
import { gitSafeDirectory } from './git-path.js';
import { commandSpec } from './core/java/verify-evidence.js';

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const digest = (value) => 'sha256:' + hashValue(value);
const fail = (code, message) => {
  throw Object.assign(new Error(message), { code });
};

function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
  );
}

function safeRelative(relative) {
  return (
    typeof relative === 'string' &&
    /^[A-Za-z0-9.][A-Za-z0-9._/-]{0,399}$/.test(relative) &&
    relative
      .split('/')
      .every(
        (part) =>
          part &&
          !['.', '..'].includes(part) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
      )
  );
}

function git(root, args, env = process.env) {
  const result = spawnSync('git', ['-c', `safe.directory=${gitSafeDirectory(root)}`, ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 60000,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0)
    fail(
      'FORMAT_GIT_FAILED',
      `git ${args.join(' ')}: ${String(result.stderr || result.stdout || 'Git failed').trim()}`,
    );
  return String(result.stdout || '').trim();
}

function status(root) {
  const result = spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${gitSafeDirectory(root)}`,
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 60000,
    },
  );
  if (result.status !== 0)
    fail('FORMAT_GIT_FAILED', String(result.stderr || result.stdout || 'Git failed').trim());
  return String(result.stdout || '').trimEnd();
}

function ensureDirectory(root, target) {
  if (!inside(root, target)) fail('UNSAFE_PATH', 'Format evidence escaped the project');
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      fs.mkdirSync(current, 0o700);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail('UNSAFE_PATH', 'Format evidence contains an unsafe directory');
  }
}

function writeEvidence(root, relative, content) {
  if (!safeRelative(relative)) fail('UNSAFE_PATH', 'Format evidence path is unsafe');
  const target = path.join(root, relative);
  ensureDirectory(root, path.dirname(target));
  let fd;
  try {
    fd = fs.openSync(target, 'wx', 0o600);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function command(specification, worktree) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let resolved;
  try {
    resolved = commandSpec(specification.command, specification.args);
  } catch (error) {
    return { ...failure('FORMAT_COMMAND_INVALID', error.message), startedAt, durationMs: 0 };
  }
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: specification.cwd,
    env: { ...process.env, ...(specification.env || {}) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: resolved.windowsVerbatimArguments,
    timeout: 10 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const record = {
    command: specification.command,
    args: specification.args,
    cwd: path.relative(worktree, specification.cwd).replace(/\\/g, '/') || '.',
    exitCode: result.status,
    signal: result.signal || null,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    stdout: String(result.stdout || '').slice(0, 8 * 1024 * 1024),
    stderr: String(result.stderr || '').slice(0, 8 * 1024 * 1024),
  };
  return result.status === 0 && !result.error
    ? { ok: true, ...record }
    : {
        ...failure('FORMAT_COMMAND_FAILED', String(result.error?.message || 'Formatter failed')),
        ...record,
      };
}

export function createNativeFormatter() {
  return async ({ worktree }) => {
    const commands = [];
    const backend = path.join(worktree, 'backend');
    const frontend = path.join(worktree, 'frontend');
    if (fs.existsSync(path.join(backend, 'pom.xml'))) {
      const wrapper = path.join(backend, process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw');
      if (fs.existsSync(wrapper)) {
        const executable = process.platform === 'win32' ? wrapper : 'bash';
        commands.push({
          command: executable,
          args: process.platform === 'win32' ? ['spotless:apply'] : [wrapper, 'spotless:apply'],
          cwd: backend,
        });
      }
    }
    if (fs.existsSync(path.join(frontend, 'package.json'))) {
      let pkg;
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(frontend, 'package.json'), 'utf8'));
      } catch {
        return failure('FORMAT_CONFIGURATION_INVALID', 'frontend/package.json is invalid');
      }
      if (typeof pkg.scripts?.format === 'string') {
        if (!fs.existsSync(path.join(frontend, 'node_modules'))) {
          commands.push({
            command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
            args: ['ci', '--no-audit', '--no-fund'],
            cwd: frontend,
          });
        }
        commands.push({
          command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
          args: ['run', 'format'],
          cwd: frontend,
        });
      }
    }
    if (!commands.length)
      return failure('FORMAT_COMMAND_MISSING', 'No project formatter command is configured');
    const results = [];
    for (const entry of commands) {
      const result = command(entry, worktree);
      results.push(result);
      if (!result.ok) return { ...result, commands: results };
    }
    return { ok: true, commands: results };
  };
}

export function createFormatService({ projectRoot, store, planService, formatter } = {}) {
  if (typeof projectRoot !== 'string' || !projectRoot)
    throw new TypeError('projectRoot is required');
  if (!store || typeof store.inspect !== 'function')
    throw new TypeError('A server state store is required');
  if (!planService || typeof planService.inspect !== 'function')
    throw new TypeError('A server plan service is required');
  const root = fs.realpathSync(projectRoot);
  const safeRoot = !inside(SOURCE_ROOT, root) && !inside(root, SOURCE_ROOT);
  const protect = async (operation) => {
    try {
      return await operation();
    } catch (error) {
      return failure(error.code || 'FORMAT_FAILED', error.message);
    }
  };

  async function current(args) {
    if (!safeRoot)
      return failure(
        'SOURCE_REPOSITORY_FORBIDDEN',
        'The plugin repository cannot host product formatting',
      );
    if (
      !object(args) ||
      Object.keys(args).some((key) => key !== 'expectedVersion') ||
      !Number.isSafeInteger(args.expectedVersion) ||
      args.expectedVersion < 0
    )
      return failure('INVALID_ARGUMENT', 'Only a nonnegative expectedVersion is accepted');
    const loaded = await store.inspect();
    if (!loaded.ok) return loaded;
    if (loaded.state.version !== args.expectedVersion)
      return {
        ...failure('VERSION_CONFLICT', 'Read the current state before retrying'),
        actualVersion: loaded.state.version,
      };
    if (loaded.state.phase !== 'FORMATTING')
      return failure('INVALID_TRANSITION', 'Formatting requires the FORMATTING phase');
    return loaded;
  }

  async function inspect() {
    return protect(async () => {
      if (!safeRoot)
        return failure(
          'SOURCE_REPOSITORY_FORBIDDEN',
          'The plugin repository cannot host product formatting',
        );
      const loaded = await store.inspect();
      if (!loaded.ok) return loaded;
      const format = loaded.state.context?.format;
      if (!object(format) || !safeRelative(format.reportPath))
        return failure('FORMAT_REQUIRED', 'No format report exists');
      const target = path.join(root, format.reportPath);
      if (!inside(root, target) || !fs.existsSync(target))
        return failure('FORMAT_EVIDENCE_MISSING', 'Format report is unavailable');
      const body = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (digest(body) !== format.hash)
        return failure('FORMAT_EVIDENCE_CHANGED', 'Format report changed');
      return { ok: true, state: loaded.state, format: body };
    });
  }

  async function run(args = {}) {
    return protect(async () => {
      const loaded = await current(args);
      if (!loaded.ok) return loaded;
      if (typeof formatter !== 'function')
        return failure('FORMATTER_UNAVAILABLE', 'A server-owned Formatter is required');
      const checked = await planService.inspect();
      if (!checked.ok) return checked;
      const development = loaded.state.context?.development;
      const integration = development?.worktrees?.integration;
      const format = development?.worktrees?.format;
      if (
        !object(integration) ||
        !object(format) ||
        !fs.existsSync(integration.path) ||
        !fs.existsSync(format.path)
      )
        return failure('FORMAT_WORKTREE_MISSING', 'Format or integration worktree is unavailable');
      const integrationCommit = git(integration.path, ['rev-parse', 'HEAD']);
      if (status(integration.path))
        return failure('INTEGRATION_WORKTREE_DIRTY', 'Integration worktree is dirty');
      if (status(format.path))
        return failure('FORMAT_WORKTREE_DIRTY', 'Format worktree is dirty before formatting');
      if (git(format.path, ['rev-parse', '--abbrev-ref', 'HEAD']) !== format.branch)
        return failure('FORMAT_WORKTREE_BROKEN', 'Format worktree is on the wrong branch');
      git(format.path, ['reset', '--hard', integrationCommit]);
      const changedByDevelopment = new Set(
        git(root, ['diff', '--name-only', development.freezeCommit, integrationCommit])
          .split('\n')
          .filter(Boolean),
      );
      let result;
      try {
        result = await formatter({
          operation: 'format',
          changeId: loaded.state.changeId,
          worktree: format.path,
          integrationCommit,
          freezeCommit: development.freezeCommit,
          files: [...changedByDevelopment],
        });
      } catch (error) {
        return failure(error.code || 'FORMATTER_FAILED', error.message);
      }
      if (!object(result) || result.ok !== true)
        return failure(result?.code || 'FORMATTER_FAILED', result?.message || 'Formatter failed');
      const changed = status(format.path)
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(3).replace(/\\/g, '/'));
      const violations = changed.filter(
        (relative) =>
          relative.startsWith('.specgate/') ||
          /(^|\/)(?:test|tests|__tests__|fixtures)\//i.test(relative) ||
          /\.(?:test|spec)\.[^/]+$/i.test(relative) ||
          !changedByDevelopment.has(relative),
      );
      if (violations.length)
        return failure(
          'FORMAT_ROLE_POLICY_VIOLATION',
          `Formatter changed files outside the development delta: ${violations.join(', ')}`,
          { violations },
        );
      let formatCommit = null;
      if (changed.length) {
        git(format.path, ['add', '-A']);
        git(format.path, ['commit', '-q', '-m', `style: format change ${loaded.state.changeId}`], {
          GIT_AUTHOR_NAME: 'SpecGate Formatter',
          GIT_AUTHOR_EMAIL: 'specgate-formatter@localhost',
          GIT_COMMITTER_NAME: 'SpecGate Formatter',
          GIT_COMMITTER_EMAIL: 'specgate-formatter@localhost',
        });
        formatCommit = git(format.path, ['rev-parse', 'HEAD']);
        git(integration.path, ['merge', '--no-ff', '-m', 'merge formatter', format.branch], {
          GIT_AUTHOR_NAME: 'SpecGate Formatter',
          GIT_AUTHOR_EMAIL: 'specgate-formatter@localhost',
          GIT_COMMITTER_NAME: 'SpecGate Formatter',
          GIT_COMMITTER_EMAIL: 'specgate-formatter@localhost',
        });
      }
      const formattedIntegration = git(integration.path, ['rev-parse', 'HEAD']);
      const body = {
        schemaVersion: 1,
        changeId: loaded.state.changeId,
        status: 'passed',
        integrationBefore: integrationCommit,
        integrationAfter: formattedIntegration,
        formatCommit,
        changedFiles: changed,
        commands: result.commands || [],
        checkedAt: new Date().toISOString(),
      };
      const hash = digest(body);
      const reportPath = `.specgate/codex/changes/${loaded.state.changeId}/format/format-${hash.slice(7)}.json`;
      writeEvidence(root, reportPath, canonicalJson(body) + '\n');
      const worktrees = {
        ...development.worktrees,
        format: { ...format, commit: formatCommit || integrationCommit },
      };
      const merged = [
        ...(development.merged || []),
        {
          role: 'format',
          branch: format.branch,
          roleCommit: formatCommit,
          integrationCommit: formattedIntegration,
          mergedAt: new Date().toISOString(),
        },
      ];
      const saved = await store.update({
        expectedVersion: loaded.state.version,
        patch: {
          context: {
            development: { ...development, worktrees, merged },
            format: { reportPath, hash, status: 'passed', ...body },
          },
        },
      });
      if (!saved.ok) return saved;
      const moved = await store.transition({
        expectedVersion: saved.state.version,
        to: 'REVIEWING',
      });
      return moved.ok ? { ...moved, format: { ...body, reportPath, hash } } : moved;
    });
  }

  return Object.freeze({ run, inspect });
}
