import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveProjectRoot } from '../src/codex/server.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = path.join(root, 'src/codex/server.js');
const initialize = (id = 1, protocolVersion = '2025-06-18') => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: { protocolVersion, capabilities: {}, clientInfo: { name: 'sg-test', version: '1' } },
});
const ready = { jsonrpc: '2.0', method: 'notifications/initialized' };
const request = (id, method, params = {}) => ({ jsonrpc: '2.0', id, method, params });

test('MCP roots bind tools to the target project instead of the plugin cache', async () => {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-plugin-cache-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-project-root-'));
  const calls = [];
  const peer = {
    capabilities: () => ({ rootsSupported: true }),
    request: async (method) => {
      calls.push(method);
      return {
        roots: [
          { uri: pathToFileURL(pluginRoot).href, name: 'plugin cache' },
          { uri: pathToFileURL(project).href, name: 'project' },
        ],
      };
    },
  };
  assert.equal(
    await resolveProjectRoot(peer, pluginRoot, { env: { PLUGIN_ROOT: pluginRoot } }),
    fs.realpathSync(project),
  );
  assert.deepEqual(calls, ['roots/list']);
  assert.equal(
    await resolveProjectRoot(peer, pluginRoot, {
      env: { SPECGATE_PROJECT_ROOT: project, PLUGIN_ROOT: pluginRoot },
    }),
    fs.realpathSync(project),
  );
});

test('session cwd wins over ambient roots and environment variables', async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-session-project-'));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-other-project-'));
  let rootRequests = 0;
  const peer = {
    capabilities: () => ({ rootsSupported: true }),
    request: async () => {
      rootRequests += 1;
      return { roots: [{ uri: pathToFileURL(other).href, name: 'other workspace' }] };
    },
  };
  assert.equal(
    await resolveProjectRoot(peer, project, {
      env: {
        PWD: other,
        INIT_CWD: other,
        WORKSPACE_ROOT: other,
        PROJECT_ROOT: other,
        SPECGATE_PROJECT_ROOT: other,
      },
    }),
    fs.realpathSync(project),
  );
  assert.equal(rootRequests, 0);
});

test('plugin-cache sessions use one unambiguous business root or stay unbound', async () => {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-plugin-cache-multi-'));
  const first = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-root-first-'));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-root-second-'));
  const peer = (roots) => ({
    capabilities: () => ({ rootsSupported: true }),
    request: async () => ({ roots: roots.map((entry) => ({ uri: pathToFileURL(entry).href })) }),
  });
  assert.equal(
    await resolveProjectRoot(peer([pluginRoot, first]), pluginRoot, {
      env: { PLUGIN_ROOT: pluginRoot },
    }),
    fs.realpathSync(first),
  );
  assert.equal(
    await resolveProjectRoot(peer([first, second]), pluginRoot, {
      env: { PLUGIN_ROOT: pluginRoot },
    }),
    null,
  );
  assert.equal(
    await resolveProjectRoot(peer([first, second]), pluginRoot, {
      env: { PLUGIN_ROOT: pluginRoot, SPECGATE_PROJECT_ROOT: second },
    }),
    fs.realpathSync(second),
  );
});

function exchange(messages, { cwd, args = [], input } = {}) {
  const result = spawnSync(process.execPath, [server, ...args], {
    cwd: cwd || fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-protocol-')),
    input: input ?? messages.map((message) => JSON.stringify(message)).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  assert.ifError(result.error);
  return {
    ...result,
    messages: result.stdout.trim() ? result.stdout.trim().split('\n').map(JSON.parse) : [],
  };
}

test('stdio handshake and diagnostic tools leave a nonempty project unchanged', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-中文 space-'));
  fs.mkdirSync(path.join(cwd, '.specgate'));
  const legacy = '{"workflowVersion":3,"phase":"H1_PENDING"}\n';
  fs.writeFileSync(path.join(cwd, '.specgate/state.json'), legacy);
  fs.writeFileSync(path.join(cwd, 'business.txt'), 'preserve me');
  const result = exchange(
    [
      initialize(),
      ready,
      request(2, 'tools/list'),
      ...['health', 'version', 'status'].map((name, index) =>
        request(index + 3, 'tools/call', { name, arguments: {} }),
      ),
      request(6, 'ping'),
    ],
    { cwd },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.messages[0].result.protocolVersion, '2025-06-18');
  assert.deepEqual(result.messages[0].result.capabilities, { tools: { listChanged: false } });
  const tools = result.messages[1].result.tools;
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      'health',
      'version',
      'status',
      'sg_state',
      'sg_pause',
      'sg_resume',
      'sg_cancel',
      'sg_init_preview',
      'sg_init',
      'sg_verify',
      'sg_project_verify',
      'sg_project_status',
      'sg_adopt_preview',
      'sg_adopt_commit_dirty',
      'sg_adopt_apply',
      'sg_project_finalize_new',
      'sg_change_preflight',
      'sg_change_add',
      'sg_change',
      'sg_change_propose',
      'sg_change_questions',
      'sg_change_critique',
      'sg_request_h1',
      'sg_plan_inspect',
      'sg_plan_generate',
      'sg_plan_freeze_contracts',
      'sg_plan_freeze_tests',
      'sg_test_design_prepare',
      'sg_test_design_freeze',
      'sg_test_replace_assets',
      'sg_development_inspect',
      'sg_development_prepare',
      'sg_development_run',
      'sg_development_rework',
      'sg_development_repair',
      'sg_quality_inspect',
      'sg_quality_run',
      'sg_format_inspect',
      'sg_format_run',
      'sg_review_inspect',
      'sg_review_prepare',
      'sg_review_run',
      'sg_review_request_h3',
      'sg_release_preview',
      'sg_release_archive',
      'sg_work_item_create',
      'sg_work_item_status',
      'sg_work_item_wait',
      'sg_project_bind',
      'sg_project_setup',
      'sg_project_create',
      'sg_env_check',
      'sg_env_prepare',
      'sg_status',
    ],
  );
  for (const tool of tools) {
    assert.equal(
      tool.annotations.readOnlyHint,
      [
        'health',
        'version',
        'status',
        'sg_state',
        'sg_init_preview',
        'sg_project_status',
        'sg_adopt_preview',
        'sg_change_preflight',
        'sg_plan_inspect',
        'sg_development_inspect',
        'sg_quality_inspect',
        'sg_format_inspect',
        'sg_review_inspect',
        'sg_release_preview',
        'sg_work_item_status',
        'sg_env_check',
        'sg_status',
      ].includes(tool.name),
    );
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  for (const response of result.messages.slice(2, 5)) {
    assert.equal(response.result.isError, false);
    assert.deepEqual(
      JSON.parse(response.result.content[0].text),
      response.result.structuredContent,
    );
  }
  const status = result.messages[4].result.structuredContent;
  assert.equal(status.stage, 'P1');
  assert.equal(status.projectRoot, cwd);
  assert.equal(status.verification.status, 'not-run');
  assert.equal(status.workflow.status, 'kernel-only');
  assert.equal(status.legacyStateDetected, undefined);
  assert.deepEqual(result.messages[5].result, {});
  assert.equal(fs.readFileSync(path.join(cwd, '.specgate/state.json'), 'utf8'), legacy);
  assert.equal(fs.readFileSync(path.join(cwd, 'business.txt'), 'utf8'), 'preserve me');
  assert.deepEqual(fs.readdirSync(cwd).sort(), ['.specgate', 'business.txt']);
  assert.deepEqual(fs.readdirSync(path.join(cwd, '.specgate')), ['state.json']);
});

test('unknown versions negotiate the supported version; invalid initialize can be corrected', () => {
  const result = exchange([
    request(1, 'initialize', {}),
    initialize(2, '2099-01-01'),
    ready,
    request(3, 'tools/call', { name: 'version' }),
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.messages[0].error.code, -32602);
  assert.equal(result.messages[1].result.protocolVersion, '2025-06-18');
  const version = result.messages[2].result.structuredContent;
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.codex-plugin/plugin.json')));
  assert.equal(version.version, manifest.version);
  assert.equal(
    version.packageVersion,
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
  );
});

test('lifecycle rejects calls before handshake and repeated initialization', () => {
  const result = exchange([
    request(1, 'tools/list'),
    initialize(2),
    request(3, 'tools/list'),
    ready,
    initialize(4),
    request(5, 'tools/list'),
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.messages[0].error.code, -32002);
  assert.equal(result.messages[2].error.code, -32002);
  assert.equal(result.messages[3].error.code, -32600);
  assert.equal(result.messages[4].result.tools.length, 54);
});

test('malformed JSON, batch messages and invalid envelopes do not terminate the server', () => {
  const input =
    [
      '{broken',
      'null',
      '[]',
      JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'ping' }),
      JSON.stringify(request(false, 'ping')),
      JSON.stringify(initialize()),
      JSON.stringify(ready),
      JSON.stringify(request('ok', 'ping')),
    ].join('\n') + '\n';
  const result = exchange([], { input });
  assert.equal(result.status, 0);
  assert.deepEqual(
    result.messages.slice(0, 5).map((message) => message.error.code),
    [-32700, -32600, -32600, -32600, -32600],
  );
  assert.equal(result.messages.at(-1).id, 'ok');
  assert.deepEqual(result.messages.at(-1).result, {});
});

test('tools reject forged approvals, arguments and unknown methods; notifications get no reply', () => {
  const result = exchange([
    initialize(),
    ready,
    { jsonrpc: '2.0', method: 'tools/call', params: { name: 'health' } },
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99 } },
    request(2, 'sg_approve', { approved: true }),
    request(3, 'tools/call', { name: 'sg_approve', arguments: { approved: true } }),
    request(4, 'tools/call', { name: 'health', arguments: { approved: true } }),
    request(5, 'tools/call', { name: 'health', arguments: [] }),
    request(6, 'tools/call', { name: 'health', arguments: null }),
    request(7, 'tools/call', { name: 'health' }),
  ]);
  assert.equal(result.status, 0);
  assert.equal(result.messages.length, 7);
  assert.equal(result.messages[1].error.code, -32601);
  for (const message of result.messages.slice(2, 6)) assert.equal(message.error.code, -32602);
  assert.equal(result.messages.at(-1).result.structuredContent.ok, true);
});

test('large and truncated frames fail closed; an empty EOF exits cleanly', () => {
  for (const input of ['x'.repeat(1024 * 1024 + 1), JSON.stringify(initialize())]) {
    const result = exchange([], { input });
    assert.equal(result.status, 1);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].error.code, -32700);
  }
  assert.equal(exchange([], { input: '' }).status, 0);
});

test('project root comes from startup options; invalid options cannot start a workflow', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-project-'));
  const result = exchange([initialize(), ready, request(2, 'tools/call', { name: 'status' })], {
    args: ['--project-root', project],
  });
  assert.equal(result.messages[1].result.structuredContent.projectRoot, project);
  assert.deepEqual(fs.readdirSync(project), []);
  const invalid = exchange([], { args: ['--approve'], input: '' });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /Usage:/);
});
