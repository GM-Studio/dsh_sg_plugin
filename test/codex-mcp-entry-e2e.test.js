import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { smokePlugin } from '../scripts/codex-plugin-smoke.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
test('actual working-tree portable MCP entries are enabled and identical', () => {
  const workspace = read(path.join(root, '.mcp.json'));
  const portable = read(path.join(root, 'mcp.json'));
  assert.deepEqual(workspace.mcpServers, portable.mcpServers);
  const entry = workspace.mcpServers.specgate;
  assert.equal(entry.type, 'stdio');
  assert.equal(entry.command, 'node');
  assert.deepEqual(entry.args, ['${PLUGIN_ROOT}/src/codex/server.js']);
  assert.equal(entry.env.SPECGATE_INTERACTIVE_APPROVAL, '1');
  assert.equal(entry.env.SPECGATE_NATIVE_AGENTS, '1');
});
test('both actual MCP configuration files launch the declared Node command from a different cwd', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-config-launch-'));
  fs.writeFileSync(path.join(project, 'sentinel.txt'), 'preserve');
  for (const file of ['mcp.json', '.mcp.json']) {
    const evidence = await smokePlugin({ pluginRoot: root, projectRoot: project, mcpFile: file });
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.configurationFile, file);
    assert.equal(evidence.command[0], 'node');
    assert.deepEqual(evidence.configuredEnvironmentKeys.sort(), [
      'SPECGATE_INTERACTIVE_APPROVAL',
      'SPECGATE_NATIVE_AGENTS',
    ]);
    assert.equal(evidence.projectStatus.projectRoot, project);
    assert.equal(evidence.trustedApproval, 'not-run');
    assert.deepEqual(fs.readdirSync(project), ['sentinel.txt']);
  }
});
function fixture() {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-config-probe-'));
  fs.mkdirSync(path.join(pluginRoot, '.codex-plugin'));
  fs.writeFileSync(
    path.join(pluginRoot, '.codex-plugin/plugin.json'),
    JSON.stringify({ mcpServers: './mcp.json' }),
  );
  return pluginRoot;
}
test('empty, disabled, malformed and escaping MCP configurations fail before server startup', async () => {
  const pluginRoot = fixture();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-invalid-config-project-'));
  const valid = { command: 'node', type: 'stdio', args: ['${PLUGIN_ROOT}/absent.mjs'] };
  for (const value of [
    { mcpServers: {} },
    { mcpServers: { specgate: { ...valid, enabled: false } } },
    { mcpServers: { specgate: { ...valid, env: { BAD: 42 } } } },
  ]) {
    fs.writeFileSync(path.join(pluginRoot, 'mcp.json'), JSON.stringify(value));
    await assert.rejects(smokePlugin({ pluginRoot, projectRoot: project }), {
      code: 'MCP_CONFIGURATION_INVALID',
    });
  }
  await assert.rejects(
    smokePlugin({ pluginRoot, projectRoot: project, mcpFile: '../outside.json' }),
    { code: 'MCP_CONFIGURATION_INVALID' },
  );
  assert.deepEqual(fs.readdirSync(project), []);
});
test('configuration environment reaches a real MCP child without changing the parent environment', async () => {
  const pluginRoot = fixture(),
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-config-env-project-'));
  const before = process.env.SPECGATE_CONFIG_PROBE;
  const entry = {
    command: 'node',
    args: ['${PLUGIN_ROOT}/probe.mjs'],
    env: { SPECGATE_CONFIG_PROBE: 'from-configuration' },
  };
  fs.writeFileSync(
    path.join(pluginRoot, 'mcp.json'),
    JSON.stringify({ mcpServers: { specgate: entry } }),
  );
  fs.writeFileSync(
    path.join(pluginRoot, 'probe.mjs'),
    `import {serveStdio} from ${JSON.stringify(pathToFileURL(path.join(root, 'src/codex/server.js')).href)};serveStdio({projectRoot:${JSON.stringify(project)},toolRegistryFactory:()=>({definitions:['health','version','status'].map(name=>({name})),call(){const value={ok:true,probe:process.env.SPECGATE_CONFIG_PROBE};return {isError:false,content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value}}})});`,
  );
  const evidence = await smokePlugin({ pluginRoot, projectRoot: project });
  assert.equal(evidence.projectStatus.probe, 'from-configuration');
  assert.equal(process.env.SPECGATE_CONFIG_PROBE, before);
});
