import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_ROOT = path.join(SOURCE_ROOT, 'assets', 'codex', 'agents');
const MANAGED_START = '<!-- specgate-codex:begin -->';
const MANAGED_END = '<!-- specgate-codex:end -->';
const CONFIG_START = '# specgate-codex:config-begin';
const CONFIG_END = '# specgate-codex:config-end';
const EXCLUDE_START = '# specgate-codex:exclude-begin';
const EXCLUDE_END = '# specgate-codex:exclude-end';
const managedHistory = JSON.parse(
  fs.readFileSync(path.join(SOURCE_ROOT, 'assets/codex/managed-file-history.json'), 'utf8'),
).hashes;
const previouslyManaged = (relative, content) =>
  managedHistory[relative]?.includes(
    createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex'),
  ) === true;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function ordinaryDirectory(target, label) {
  if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    fail('UNSAFE_PROJECT_PATH', `${label} must be an ordinary directory`);
}

function ordinaryFile(target, label) {
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile())
    fail('UNSAFE_PROJECT_PATH', `${label} must be an ordinary file`);
  return fs.readFileSync(target, 'utf8');
}

function atomicWrite(target, content) {
  const temporary = `${target}.specgate-${process.pid}.tmp`;
  let promoted = false;
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    fs.renameSync(temporary, target);
    promoted = true;
  } finally {
    if (!promoted) {
      try {
        fs.rmSync(temporary, { force: true, maxRetries: 20, retryDelay: 100 });
      } catch {
        // preserve the original write or rename failure; the temp file was never published
      }
    }
  }
}

function git(target, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', target, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 10000,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
        ),
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
      },
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    fail('GIT_FAILED', `Git operation failed: ${error.message}`);
  }
}

function mergeManagedBlock(existing, block, { markerStart, markerEnd, label }) {
  const text = String(existing || '').replace(/\r\n/g, '\n');
  const start = text.indexOf(markerStart);
  const end = text.indexOf(markerEnd);
  if (start !== -1 || end !== -1) {
    if (start === -1 || end === -1 || end < start)
      fail(`${label}_MARKER_INVALID`, `${label} markers are incomplete or out of order`);
    const before = text.slice(0, start).trimEnd();
    const after = text.slice(end + markerEnd.length).trimStart();
    return [before, block, after].filter(Boolean).join('\n\n') + '\n';
  }
  return (text.trimEnd() ? text.trimEnd() + '\n\n' : '') + block + '\n';
}

function manageLocalExcludes(root, { check }) {
  if (git(root, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true }) !== 'true') {
    return {
      repository: false,
      trackedAgents: false,
      excluded: [],
      dirtyManagedPaths: [],
      warning: 'Project is not a Git worktree; local SpecGate excludes were not installed.',
    };
  }
  const trackedAgents =
    git(root, ['ls-files', '--error-unmatch', '--', 'AGENTS.md'], { allowFailure: true }) !== null;
  const excluded = [
    '.codex/',
    '.agents/skills/sg-codex/',
    '.agents/skills/sg-codex-setup/',
    '.env',
    ...(trackedAgents ? [] : ['AGENTS.md']),
  ];
  const block = [
    EXCLUDE_START,
    '/.codex/',
    '/.agents/skills/sg-codex/',
    '/.agents/skills/sg-codex-setup/',
    '/.env',
    ...(trackedAgents ? [] : ['/AGENTS.md']),
    EXCLUDE_END,
  ].join('\n');
  const relative = git(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (!relative) fail('GIT_EXCLUDE_UNAVAILABLE', 'Git did not return a local exclude path');
  const target = path.resolve(root, relative);
  const existing = ordinaryFile(target, 'Git local exclude file') || '';
  const merged = mergeManagedBlock(existing, block, {
    markerStart: EXCLUDE_START,
    markerEnd: EXCLUDE_END,
    label: 'EXCLUDE',
  });
  const changed = merged !== existing.replace(/\r\n/g, '\n');
  if (!check && changed) {
    ordinaryDirectory(path.dirname(target), 'Git info directory');
    atomicWrite(target, merged);
  }
  const dirtyManagedPaths = check
    ? []
    : git(root, ['status', '--porcelain', '--untracked-files=all', '--', '.codex', 'AGENTS.md'])
        .split('\n')
        .filter(Boolean)
        .map((line) => line.trim().split(/\s+/).at(-1));
  return {
    repository: true,
    excludePath: path.relative(root, target).replace(/\\/g, '/'),
    trackedAgents,
    excluded,
    dirtyManagedPaths,
    ...(trackedAgents
      ? {
          warning:
            'AGENTS.md is tracked; commit its SpecGate-managed change before starting Test Design. It is intentionally not hidden with .git/info/exclude.',
        }
      : {}),
  };
}

export function managedAgentsBlock() {
  return [
    MANAGED_START,
    fs.readFileSync(path.join(SOURCE_ROOT, 'assets', 'codex', 'AGENTS.specgate.md'), 'utf8').trim(),
    MANAGED_END,
  ].join('\n');
}

export function mergeAgentsDocument(existing = '', block = managedAgentsBlock()) {
  const text = String(existing).replace(/\r\n/g, '\n');
  const start = text.indexOf(MANAGED_START);
  const end = text.indexOf(MANAGED_END);
  if (start !== -1 || end !== -1) {
    if (start === -1 || end === -1 || end < start)
      fail('AGENTS_MARKER_INVALID', 'SpecGate AGENTS markers are incomplete or out of order');
    const before = text.slice(0, start).trimEnd();
    const after = text.slice(end + MANAGED_END.length).trimStart();
    return [before, block, after].filter(Boolean).join('\n\n') + '\n';
  }
  return (text.trimEnd() ? text.trimEnd() + '\n\n' : '') + block + '\n';
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

export function managedProjectConfig({
  project,
  pluginRoot = SOURCE_ROOT,
  marketplace = 'specgate-source',
} = {}) {
  const server = path.join(path.resolve(pluginRoot), 'src', 'codex', 'server.js');
  return [
    CONFIG_START,
    `[plugins.${tomlString(`specgate-codex@${marketplace}`)}.mcp_servers.specgate]`,
    'enabled = false',
    '',
    '[mcp_servers.specgate_project]',
    'command = "node"',
    `args = [${tomlString(server)}, "--project-root", ${tomlString(path.resolve(project))}]`,
    'startup_timeout_sec = 120',
    'tool_timeout_sec = 3600',
    '',
    '[mcp_servers.specgate_project.env]',
    'SPECGATE_INTERACTIVE_APPROVAL = "1"',
    'SPECGATE_NATIVE_AGENTS = "1"',
    CONFIG_END,
  ].join('\n');
}

export function mergeManagedToml(existing, block, { markerStart, markerEnd, label }) {
  const text = String(existing || '').replace(/\r\n/g, '\n');
  const start = text.indexOf(markerStart);
  const end = text.indexOf(markerEnd);
  if (start !== -1 || end !== -1) {
    if (start === -1 || end === -1 || end < start)
      fail(`${label}_MARKER_INVALID`, `${label} markers are incomplete or out of order`);
    const before = text.slice(0, start).trimEnd();
    const after = text.slice(end + markerEnd.length).trimStart();
    return [before, block, after].filter(Boolean).join('\n\n') + '\n';
  }
  if (text.includes('[mcp_servers.specgate_project]'))
    fail('MCP_CONFIG_CONFLICT', 'Unmanaged [mcp_servers.specgate_project] already exists');
  return (text.trimEnd() ? text.trimEnd() + '\n\n' : '') + block + '\n';
}

function agentTemplates() {
  return fs
    .readdirSync(AGENT_ROOT)
    .filter((name) => name.endsWith('.toml'))
    .sort()
    .map((name) => ({
      name,
      content: fs.readFileSync(path.join(AGENT_ROOT, name), 'utf8').replace(/\r\n/g, '\n'),
    }));
}

export function setupProject({
  project,
  check = false,
  pluginRoot = SOURCE_ROOT,
  marketplace = 'specgate-source',
  bindingProject = project,
} = {}) {
  if (typeof project !== 'string' || !project)
    fail('INVALID_ARGUMENT', 'An absolute project path is required');
  const root = path.resolve(project);
  ordinaryDirectory(root, 'Project root');
  const codex = path.join(root, '.codex');
  ordinaryDirectory(codex, '.codex');
  const agents = path.join(codex, 'agents');
  ordinaryDirectory(agents, '.codex/agents');

  const changes = [];
  const conflicts = [];
  for (const template of agentTemplates()) {
    const target = path.join(agents, template.name);
    const existing = ordinaryFile(target, `.codex/agents/${template.name}`);
    if (
      existing !== null &&
      existing.replace(/\r\n/g, '\n') !== template.content &&
      !previouslyManaged(`.codex/agents/${template.name}`, existing)
    ) {
      conflicts.push(`.codex/agents/${template.name}`);
      continue;
    }
    if (existing === null || existing.replace(/\r\n/g, '\n') !== template.content)
      changes.push({ target, content: template.content });
  }
  if (conflicts.length)
    fail('AGENT_CONFLICT', `Refusing to overwrite project Agent files: ${conflicts.join(', ')}`);

  const agentsFile = path.join(root, 'AGENTS.md');
  const existingAgents = ordinaryFile(agentsFile, 'AGENTS.md') || '';
  const merged = mergeAgentsDocument(existingAgents);
  if (merged !== existingAgents.replace(/\r\n/g, '\n'))
    changes.push({ target: agentsFile, content: merged });

  const configFile = path.join(codex, 'config.toml');
  const existingConfig = ordinaryFile(configFile, '.codex/config.toml') || '';
  const configBlock = managedProjectConfig({ project: bindingProject, pluginRoot, marketplace });
  const mergedConfig = mergeManagedToml(existingConfig, configBlock, {
    markerStart: CONFIG_START,
    markerEnd: CONFIG_END,
    label: 'CONFIG',
  });
  if (mergedConfig !== existingConfig.replace(/\r\n/g, '\n'))
    changes.push({ target: configFile, content: mergedConfig });

  // Project-local skills are discoverable even when a host only loads the portable manifest.
  const skillsRoot = path.join(root, '.agents', 'skills');
  ordinaryDirectory(path.join(root, '.agents'), '.agents');
  ordinaryDirectory(skillsRoot, '.agents/skills');
  for (const [folder, name] of [
    ['sg-codex', 'sg-codex'],
    ['setup', 'sg-codex-setup'],
  ]) {
    const directory = path.join(skillsRoot, name);
    ordinaryDirectory(directory, `Skill ${name}`);
    for (const relative of ['SKILL.md', 'agents/openai.yaml']) {
      const content = fs
        .readFileSync(path.join(SOURCE_ROOT, 'skills', folder, relative), 'utf8')
        .replace(/\r\n/g, '\n');
      const target = path.join(directory, relative);
      const existing = ordinaryFile(target, `Skill ${name}`);
      if (
        existing !== null &&
        existing.replace(/\r\n/g, '\n') !== content &&
        !previouslyManaged(`.agents/skills/${name}/${relative}`, existing)
      )
        fail('SKILL_CONFLICT', `保留已有 Skill，拒绝覆盖：${target}`);
      if (existing === null || existing.replace(/\r\n/g, '\n') !== content)
        changes.push({ target, content });
    }
  }

  if (!check) {
    for (const change of changes) {
      ordinaryDirectory(path.dirname(change.target), '安装目标目录');
      atomicWrite(change.target, change.content);
    }
  }
  const gitStatus = manageLocalExcludes(root, { check });
  return {
    ok: true,
    project: root,
    check,
    changed: changes.map((change) => path.relative(root, change.target).replace(/\\/g, '/')),
    agents: agentTemplates().map((entry) => entry.name.replace(/\.toml$/, '')),
    mcpServer: 'specgate_project',
    skills: ['sg-codex', 'sg-codex-setup'],
    git: gitStatus,
  };
}

function parseArgs(argv) {
  const result = { check: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--check') {
      result.check = true;
      continue;
    }
    if (
      !['--project', '--marketplace', '--plugin-root'].includes(argv[index]) ||
      index + 1 >= argv.length
    )
      throw new Error('Usage: codex-source-setup --project <path> [--check]');
    result[argv[index].slice(2)] = argv[++index];
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = setupProject({
      project: args.project,
      check: args.check,
      marketplace: args.marketplace,
      pluginRoot: args['plugin-root'],
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${error.code || 'SETUP_FAILED'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
