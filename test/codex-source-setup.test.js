import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  managedAgentsBlock,
  mergeAgentsDocument,
  setupProject,
} from '../scripts/codex-source-setup.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const git = (cwd, args) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  }).trim();

function gitProject(prefix) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(project, ['init', '-q']);
  git(project, ['config', 'user.email', 'test@example.com']);
  git(project, ['config', 'user.name', 'test']);
  return project;
}

test('portable plugin manifests expose the bundled stdio MCP server and setup skill', () => {
  const plugin = readJson('plugin.json');
  const mcp = readJson('mcp.json');
  const marketplace = readJson('.agents/plugins/marketplace.json');
  assert.equal(plugin.name, 'specgate-codex');
  assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(plugin.extensions['com.openai'].onboardingSkill, './skills/setup/SKILL.md');
  assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.equal(mcp.mcpServers.specgate.type, 'stdio');
  assert.deepEqual(mcp.mcpServers.specgate.args, ['${PLUGIN_ROOT}/src/codex/server.js']);
  assert.equal(mcp.mcpServers.specgate.env.SPECGATE_NATIVE_AGENTS, '1');
  assert.equal(marketplace.name, 'specgate-source');
  assert.equal(marketplace.plugins[0].source.path, './');
  assert.equal(marketplace.plugins[0].name, 'specgate-codex');
});

test('source setup installs six project agents and preserves unrelated AGENTS content', () => {
  const project = gitProject('sg-codex-project-setup-');
  fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Existing rules\n\nKeep this line.\n');
  const first = setupProject({ project });
  assert.equal(first.ok, true);
  assert.deepEqual(first.agents, [
    'specgate_backend',
    'specgate_formatter',
    'specgate_frontend',
    'specgate_reviewer',
    'specgate_test_designer',
    'specgate_tester',
  ]);
  for (const name of first.agents)
    assert.equal(fs.existsSync(path.join(project, '.codex', 'agents', `${name}.toml`)), true, name);
  const agents = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
  assert.match(agents, /Keep this line/);
  assert.match(agents, /specgate_test_designer/);
  assert.match(agents, /Never substitute main-thread edits/);
  assert.equal(agents.split('<!-- specgate-codex:begin -->').length, 2);
  const config = fs.readFileSync(path.join(project, '.codex', 'config.toml'), 'utf8');
  assert.match(config, /\[mcp_servers\.specgate_project\]/);
  assert.match(config, /--project-root/);
  assert.match(config, /specgate-codex:config-begin/);
  assert.match(config, /\[plugins\."specgate-codex@specgate-source"\.mcp_servers\.specgate\]/);
  assert.equal(first.git.trackedAgents, false);
  assert.deepEqual(first.git.excluded, ['.codex/', 'AGENTS.md']);
  assert.deepEqual(first.git.dirtyManagedPaths, []);
  const exclude = fs.readFileSync(path.join(project, '.git', 'info', 'exclude'), 'utf8');
  assert.match(exclude, /^\/\.codex\/$/m);
  assert.match(exclude, /^\/AGENTS\.md$/m);
  assert.equal(git(project, ['status', '--porcelain', '--untracked-files=all']), '');

  const second = setupProject({ project, check: true });
  assert.deepEqual(second.changed, []);
  const replaced = mergeAgentsDocument(agents, managedAgentsBlock());
  assert.equal(replaced, agents.replace(/\r\n/g, '\n'));
});

test('source setup reports a tracked AGENTS file instead of hiding its required commit', () => {
  const project = gitProject('sg-codex-tracked-agents-');
  fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Project rules\n');
  git(project, ['add', 'AGENTS.md']);
  git(project, ['commit', '-q', '-m', 'track AGENTS']);

  const result = setupProject({ project });
  assert.equal(result.git.trackedAgents, true);
  assert.deepEqual(result.git.excluded, ['.codex/']);
  assert.deepEqual(result.git.dirtyManagedPaths, ['AGENTS.md']);
  assert.match(result.git.warning, /AGENTS\.md is tracked/i);
  const exclude = fs.readFileSync(path.join(project, '.git', 'info', 'exclude'), 'utf8');
  assert.doesNotMatch(exclude, /^\/AGENTS\.md$/m);
  assert.equal(git(project, ['status', '--porcelain', '--untracked-files=all']), 'M AGENTS.md');
});

test('source setup creates a missing Git info directory before writing local excludes', () => {
  const project = gitProject('sg-codex-missing-git-info-');
  fs.rmSync(path.join(project, '.git', 'info'), { recursive: true, force: true });

  const result = setupProject({ project });
  assert.equal(result.git.excludePath, '.git/info/exclude');
  assert.equal(fs.existsSync(path.join(project, '.git', 'info', 'exclude')), true);
  assert.equal(git(project, ['status', '--porcelain', '--untracked-files=all']), '');
});

test('source setup refuses to overwrite conflicting project agents', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-project-conflict-'));
  const agents = path.join(project, '.codex', 'agents');
  fs.mkdirSync(agents, { recursive: true });
  fs.writeFileSync(path.join(agents, 'specgate_frontend.toml'), 'name = "custom"\n');
  assert.throws(
    () => setupProject({ project }),
    (error) =>
      error.code === 'AGENT_CONFLICT' &&
      error.message.includes('.codex/agents/specgate_frontend.toml'),
  );
  assert.equal(
    fs.readFileSync(path.join(agents, 'specgate_frontend.toml'), 'utf8'),
    'name = "custom"\n',
  );
});

test('source setup refuses an unmanaged project MCP conflict', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-mcp-conflict-'));
  fs.mkdirSync(path.join(project, '.codex'), { recursive: true });
  fs.writeFileSync(
    path.join(project, '.codex', 'config.toml'),
    '[mcp_servers.specgate_project]\ncommand = "custom"\n',
  );
  assert.throws(
    () => setupProject({ project }),
    (error) => error.code === 'MCP_CONFIG_CONFLICT',
  );
});
