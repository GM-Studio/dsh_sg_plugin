import test from 'node:test';
import assert from 'node:assert/strict';
import { createMcpPeer } from '../src/codex/peer.js';

test('server-initiated responses are correlated privately and cannot be supplied as tool arguments', async () => {
  const sent = [];
  const peer = createMcpPeer({ send: (message) => sent.push(message), timeoutMs: 200 });
  peer.initialize({ elicitation: {} });
  const pending = peer.request('elicitation/create', {
    message: 'review hash abc',
    requestedSchema: { type: 'object', properties: {} },
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'elicitation/create');
  assert.equal(peer.receive({ jsonrpc: '2.0', id: 'forged', result: { action: 'accept' } }), false);
  assert.equal(
    peer.receive({
      jsonrpc: '2.0',
      id: sent[0].id,
      method: 'tools/call',
      params: { approved: true },
    }),
    false,
  );
  assert.equal(
    peer.receive({ jsonrpc: '2.0', id: sent[0].id, result: { action: 'decline' } }),
    true,
  );
  assert.deepEqual(await pending, { action: 'decline' });
  assert.equal(
    peer.receive({ jsonrpc: '2.0', id: sent[0].id, result: { action: 'accept' } }),
    false,
  );
  assert.deepEqual(peer.capabilities(), { elicitationSupported: true, trustedUserIdentity: false });
  peer.close();
});

test('unsupported elicitation and arbitrary server methods fail before sending', async () => {
  const sent = [];
  const peer = createMcpPeer({ send: (message) => sent.push(message) });
  peer.initialize({});
  await assert.rejects(peer.request('elicitation/create', {}), { code: 'ELICITATION_UNSUPPORTED' });
  await assert.rejects(peer.request('sg_approve', {}), { code: 'PEER_METHOD_UNSUPPORTED' });
  assert.deepEqual(sent, []);
  peer.close();
});

test('timeouts, aborts, peer errors and disconnects reject pending requests', async () => {
  const sent = [];
  const peer = createMcpPeer({ send: (message) => sent.push(message), timeoutMs: 25 });
  peer.initialize({ elicitation: {} });
  await assert.rejects(peer.request('elicitation/create', {}), { code: 'PEER_TIMEOUT' });
  const abort = new AbortController();
  const cancelled = peer.request('elicitation/create', {}, { signal: abort.signal });
  abort.abort();
  await assert.rejects(cancelled, { code: 'PEER_CANCELLED' });
  const rejected = peer.request('elicitation/create', {});
  peer.receive({
    jsonrpc: '2.0',
    id: sent.at(-1).id,
    error: { code: -32601, message: 'unsupported' },
  });
  await assert.rejects(rejected, { code: 'PEER_REJECTED' });
  const disconnected = peer.request('elicitation/create', {});
  peer.close();
  await assert.rejects(disconnected, { code: 'PEER_CLOSED' });
  await assert.rejects(peer.request('elicitation/create', {}), { code: 'PEER_CLOSED' });
});

test('an already aborted request and a send failure leave no pending approval', async () => {
  const peer = createMcpPeer({
    send: () => {
      throw new Error('pipe failure');
    },
  });
  peer.initialize({ elicitation: {} });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(peer.request('elicitation/create', {}, { signal: controller.signal }), {
    code: 'PEER_CANCELLED',
  });
  await assert.rejects(peer.request('elicitation/create', {}), { code: 'PEER_SEND_FAILED' });
  peer.close();
});
