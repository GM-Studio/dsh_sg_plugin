import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mcpClient } from './environment-mcp-client.mjs';
const roots = [];
test.after(() => {
  for (const r of roots)
    fs.rmSync(r, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
});
function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-consent-native-'));
  roots.push(parent);
  const root = path.join(parent, 'project'),
    home = path.join(parent, 'home');
  const cache = path.join(home, '.specgate', 'toolchains');
  fs.mkdirSync(root);
  fs.mkdirSync(home);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'consent-native-protocol-fixture',
      private: true,
      engines: { node: '22.22.0' },
    }),
  );
  return {
    root,
    cache,
    env: {
      USERPROFILE: home,
      HOME: home,
      NVM_HOME: '',
      NVM_SYMLINK: '',
      FNM_DIR: '',
      VOLTA_HOME: '',
      SPECGATE_NODE: '',
    },
  };
}
async function missingNode(t, f, extra = {}) {
  const client = await mcpClient(t, f.root, { env: f.env, capabilities: {}, ...extra });
  const checked = (await client.call('sg_env_check', { source: 'official' })).structuredContent;
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.environmentReady, false, JSON.stringify(checked));
  assert.equal(checked.cacheRoot, f.cache);
  assert.ok(checked.missing.includes('node'));
  assert.equal(checked.plan.find((p) => p.id === 'node').archive.version, '22.22.0');
  return client;
}
for (const action of ['decline', 'cancel'])
  test(`real unadvertised installation channel receives ${action} and writes no SDK`, async (t) => {
    const f = fixture(),
      client = await missingNode(t, f);
    let forms = 0;
    client.form((params) => {
      forms++;
      assert.match(params.message, /node-v22\.22\.0/);
      assert.match(params.message, /sha256/);
      assert.ok(
        params.message.includes(f.cache),
        'confirmation must show the actual configured installation root',
      );
      assert.ok(params.message.includes(JSON.stringify(path.join(f.cache, 'node-22.22.0'))));
      return { action };
    });
    const response = (await client.call('sg_env_prepare', { source: 'official' }))
      .structuredContent;
    assert.equal(forms, 1);
    assert.equal(response.code, 'ENV_INSTALL_CONSENT_REQUIRED');
    assert.equal(response.environmentReady, false);
    assert.equal(fs.existsSync(f.cache), false);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(f.root, 'package.json'))).engines.node,
      '22.22.0',
    );
  });
test('native unadvertised accept is bound to the unchanged stack and cannot install a changed plan', async (t) => {
  const f = fixture(),
    client = await missingNode(t, f);
  let forms = 0;
  client.form(() => {
    forms++;
    fs.writeFileSync(
      path.join(f.root, 'package.json'),
      JSON.stringify({ engines: { node: '>=999' } }),
    );
    return { action: 'accept', content: {} };
  });
  const response = (await client.call('sg_env_prepare', { source: 'official' })).structuredContent;
  assert.equal(forms, 1);
  assert.equal(response.code, 'ENV_INSTALL_PLAN_CHANGED');
  assert.equal(response.environmentReady, false);
  assert.equal(fs.existsSync(f.cache), false);
});
test('an actual MCP method-not-supported reply keeps installation blocked', async (t) => {
  const f = fixture(),
    client = await missingNode(t, f);
  let forms = 0;
  client.form(() => {
    forms++;
    return {
      protocolError: { code: -32601, message: 'Protocol fixture: elicitation unsupported' },
    };
  });
  const response = await client.call('sg_env_prepare', { source: 'official' });
  assert.equal(forms, 1);
  assert.equal(response.structuredContent?.ok, false, JSON.stringify(response));
  assert.equal(response.structuredContent.cause.rpcCode, -32601);
  assert.equal(response.structuredContent.cause.category, 'unsupported');
  assert.ok(response.structuredContent.retryAction);
  assert.notEqual(response.structuredContent?.environmentReady, true);
  assert.equal(fs.existsSync(f.cache), false);
});
test('without host operator identity opt-in no installation confirmation is requested', async (t) => {
  const f = fixture(),
    client = await missingNode(t, f, { interactiveApproval: false });
  let forms = 0;
  client.form(() => {
    forms++;
    return { action: 'accept' };
  });
  const response = (await client.call('sg_env_prepare', { source: 'official' })).structuredContent;
  assert.equal(response.code, 'ENV_INSTALL_CONSENT_REQUIRED');
  assert.equal(forms, 0);
  assert.equal(fs.existsSync(f.cache), false);
});
for (const decision of ['cancel', 'approve', 'invalid', 'unsupported'])
  test(`optional native initialization probes an unadvertised channel and honors ${decision}`, async (t) => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-init-unadvertised-'));
    roots.push(parent);
    fs.writeFileSync(path.join(parent, 'README.md'), 'user-owned README\n');
    const client = await mcpClient(t, parent, { capabilities: {}, optionalModules: true });
    const input = {
      path: parent,
      preset: 'jdk17-boot3.5',
      frontend: 'react',
      company: 'acme',
      business: 'consent',
      gitName: 'Protocol Fixture',
      gitEmail: 'fixture@localhost',
    };
    const preview = (await client.call('sg_init_preview', input)).structuredContent;
    assert.equal(preview.ok, true, JSON.stringify(preview));
    let forms = 0;
    client.form((params) => {
      forms++;
      assert.match(params.message, /初始化非空目录/);
      if (decision === 'unsupported')
        return { protocolError: { code: -32601, message: 'Protocol fixture: unsupported' } };
      return { action: 'accept', content: { decision } };
    });
    const response = (await client.call('sg_init', { ...input, previewHash: preview.previewHash }))
      .structuredContent;
    assert.equal(forms, 1, JSON.stringify(response));
    assert.equal(fs.readFileSync(path.join(parent, 'README.md'), 'utf8'), 'user-owned README\n');
    if (decision !== 'approve') {
      assert.equal(response.ok, false);
      assert.equal(fs.existsSync(path.join(parent, 'backend')), false);
    } else {
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.equal(response.phase, 'GENERATED_ONLY');
      assert.equal(fs.existsSync(path.join(parent, 'frontend/src/main.tsx')), true);
      assert.equal(response.report.initializationComplete, false);
    }
  });
