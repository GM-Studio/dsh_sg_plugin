import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

async function simulatedHost(
  t,
  { cancel = false, pingBeforeReply = false, duplicate = false, approvalResponse } = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-codex-peer-server-'));
  const fixture = path.join(root, 'server.mjs');
  fs.writeFileSync(
    fixture,
    `
import { serveStdio } from ${JSON.stringify(new URL('../src/codex/server.js', import.meta.url).href)};
import { createApprovalAuthority } from ${JSON.stringify(new URL('../src/codex/approvals.js', import.meta.url).href)};
serveStdio({ toolRegistryFactory: ({ requestPeer }) => ({
  definitions: [{ name: 'ask', inputSchema: {type:'object', properties:{}, additionalProperties:false} }],
  call: async (_name, _args, {signal}) => {
    if (${Boolean(approvalResponse)}) {
      const authority = createApprovalAuthority({ request: requestPeer,
        trustedPeerIdentity: {kind:'user', id:'fixture', source:'simulated-native-host'}, audit: async () => {} });
      const hash = 'sha256:' + 'a'.repeat(64);
      const response = await authority.requestApproval({gate:'H1', scope:'fixture-only',
        artifactHash:hash, readArtifactHash:async () => hash, summary:'变更内容：新增客房查询。变更方式：扩展现有后台。', signal});
      return {isError:!response.ok, content:[{type:'text', text:JSON.stringify(response)}], structuredContent:response};
    }
    const response = await requestPeer('elicitation/create', {
      message: 'Simulated transport fixture only; this does not authorize an SG gate.',
      requestedSchema: {type:'object', properties:{decision:{type:'string', enum:['decline']}}}
    }, {signal, timeoutMs:1000});
    return {isError:false, content:[{type:'text', text:JSON.stringify(response)}], structuredContent:response};
  }
})});
`,
  );
  const child = spawn(process.execPath, [fixture], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  t.after(() => {
    child.kill();
  });
  const output = [];
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const waiting = new Map();
  const lines = createInterface({ input: child.stdout });
  const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
  let reverseRequests = 0;
  lines.on('line', (line) => {
    const message = JSON.parse(line);
    output.push(message);
    if (message.method === 'elicitation/create') {
      reverseRequests++;
      if (approvalResponse) send({ jsonrpc: '2.0', id: message.id, result: approvalResponse });
      else if (duplicate)
        send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'ask', arguments: {} },
        });
      else if (pingBeforeReply) {
        waiting.set(3, () =>
          send({ jsonrpc: '2.0', id: message.id, result: { action: 'decline', content: null } }),
        );
        send({ jsonrpc: '2.0', id: 3, method: 'ping' });
      } else if (cancel)
        send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } });
      else send({ jsonrpc: '2.0', id: message.id, result: { action: 'decline', content: null } });
    } else {
      if (duplicate && message.id === 2 && message.error) {
        assert.equal(message.error.code, -32600);
        send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } });
        return;
      }
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
  });
  const request = (id, method, params) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stdio peer deadlocked')), 4000);
      waiting.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      send({ jsonrpc: '2.0', id, method, params });
    });
  const initialized = await request(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: { elicitation: {} },
    clientInfo: { name: 'simulated-host', version: '1' },
  });
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const result = await request(2, 'tools/call', { name: 'ask', arguments: {} });
  const exited = new Promise((resolve) => child.once('close', (code) => resolve(code)));
  child.stdin.end();
  assert.equal(await exited, 0, stderr);
  assert.equal(stderr, '');
  assert.equal(reverseRequests, 1);
  return { result, output };
}

test('real stdio can receive a simulated peer response while a tool waits for elicitation', async (t) => {
  const { result } = await simulatedHost(t);
  assert.equal(result.result.isError, false);
  assert.deepEqual(result.result.structuredContent, { action: 'decline', content: null });
});

test('stdio cancellation bypasses the tool queue and aborts an outstanding peer request', async (t) => {
  const { result } = await simulatedHost(t, { cancel: true });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /TOOL_FAILED/);
});

test('ping remains responsive while an interactive tool waits', async (t) => {
  const { result, output } = await simulatedHost(t, { pingBeforeReply: true });
  assert.equal(result.result.isError, false);
  assert.ok(
    output.findIndex((message) => message.id === 3) <
      output.findIndex((message) => message.id === 2),
  );
});

test('duplicate in-flight tool ids cannot replace the original cancellation controller', async (t) => {
  const { result, output } = await simulatedHost(t, { duplicate: true });
  assert.equal(result.result.isError, true);
  assert.equal(
    output.filter((message) => message.id === 2 && message.error?.code === -32600).length,
    1,
  );
});

test('empty native H1 confirm and dialog cancel both complete over real stdio', async (t) => {
  for (const response of [
    { action: 'accept', content: {} },
    { action: 'cancel', content: {} },
  ]) {
    const { result, output } = await simulatedHost(t, { approvalResponse: response });
    const data = result.result.structuredContent;
    assert.equal(data.ok, response.action === 'accept');
    if (response.action === 'cancel') assert.equal(data.code, 'APPROVAL_DISMISSED');
    const form = output.find((message) => message.method === 'elicitation/create').params;
    assert.deepEqual(form.requestedSchema.properties, {});
    assert.equal(form.requestedSchema.additionalProperties, false);
  }
});
