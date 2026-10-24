import test from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalAuthority } from '../src/codex/approvals.js';

const HASH = `sha256:${'a'.repeat(64)}`;
const OTHER_HASH = `sha256:${'b'.repeat(64)}`;
const identity = { id: 'fixture-user-42', source: 'fixture-native-user-channel', kind: 'user' };

// These are simulated peer responses. They do not prove a real Codex user source.
function fixture(options = {}) {
  let now = Date.parse('2026-10-21T00:00:00Z');
  let hash = HASH;
  const events = [];
  const requests = [];
  const authority = createApprovalAuthority({
    request: async (method, params, options) => {
      requests.push({ method, params, options });
      return { action: 'accept', content: { decision: 'approve', comment: 'Reviewed.' } };
    },
    trustedPeerIdentity: identity,
    audit: async (event) => events.push(event),
    clock: () => now,
    ...options,
  });
  const challenge = (extra = {}) => ({
    gate: 'H1',
    scope: 'change-1',
    artifactHash: HASH,
    readArtifactHash: async () => hash,
    summary: 'Complete frozen requirements are displayed here.',
    ...extra,
  });
  return {
    authority,
    events,
    requests,
    challenge,
    setHash: (value) => (hash = value),
    advance: (ms) => (now += ms),
  };
}

test('approval fails closed without request, native user identity, or durable audit callback', async () => {
  for (const options of [
    { request: undefined },
    { trustedPeerIdentity: undefined },
    { trustedPeerIdentity: { id: 'codex', source: 'clientInfo', kind: 'client' } },
    { trustedPeerIdentity: { id: 'codex', source: 'clientInfo', kind: 'user' } },
    { audit: undefined },
  ]) {
    const f = fixture(options);
    assert.equal(f.authority.availability().available, false);
    assert.equal((await f.authority.requestApproval(f.challenge())).ok, false);
    assert.equal(f.requests.length, 0);
  }
});

test('H1 approval probes the host channel even when elicitation is unadvertised', async () => {
  const f = fixture();
  const result = await f.authority.requestApproval(f.challenge());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].method, 'elicitation/create');
  assert.equal(f.requests[0].options.allowUnadvertised, true);
  assert.equal(f.requests[0].options.timeoutMs, 300000);
});
test('only peer elicitation response issues an approval with actor, timestamps, and an opaque handle', async () => {
  const f = fixture();
  const result = await f.authority.requestApproval(f.challenge());
  assert.equal(result.ok, true);
  assert.equal(f.requests[0].method, 'elicitation/create');
  assert.deepEqual(f.requests[0].params.requestedSchema, {
    type: 'object',
    properties: {},
    additionalProperties: false,
  });
  assert.match(f.requests[0].params.message, /H1/);
  assert.doesNotMatch(f.requests[0].params.message, /sha256:|请求编号/);
  assert.equal(Object.isFrozen(result.approval), true);
  assert.equal(JSON.stringify(result.approval), '{}');
  assert.deepEqual(result.record.actor, identity);
  assert.equal(result.record.gate, 'H1');
  assert.equal(result.record.scope, 'change-1');
  assert.equal(result.record.artifactHash, HASH);
  assert.equal(result.record.decision, 'approve');
  assert.equal(result.record.comment, 'Reviewed.');
  assert.equal(result.record.consumedAt, null);
  assert.ok(Date.parse(result.record.expiresAt) > Date.parse(result.record.issuedAt));
  assert.match(result.record.nonce, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    f.events.map((event) => event.type),
    ['approval.requested', 'approval.decided'],
  );
});

test('a record, nonce, cloned handle, and forged decision cannot authorize a gate', async () => {
  const f = fixture();
  const result = await f.authority.requestApproval(f.challenge());
  for (const approval of [
    result.record,
    result.record.nonce,
    {},
    JSON.parse(JSON.stringify(result.approval)),
  ]) {
    const consumed = await f.authority.consumeApproval({
      approval,
      gate: 'H1',
      scope: 'change-1',
      artifactHash: HASH,
    });
    assert.equal(consumed.ok, false);
    assert.equal(consumed.code, 'APPROVAL_UNKNOWN');
  }
  assert.equal(
    (await f.authority.requestApproval(f.challenge({ decision: 'approve' }))).code,
    'APPROVAL_CHALLENGE_INVALID',
  );
});

test('single use survives concurrent consumption and changes to public records', async () => {
  const f = fixture();
  const issued = await f.authority.requestApproval(f.challenge());
  issued.record.artifactHash = OTHER_HASH;
  issued.record.actor.id = 'forged';
  const input = { approval: issued.approval, gate: 'H1', scope: 'change-1', artifactHash: HASH };
  const results = await Promise.all([
    f.authority.consumeApproval(input),
    f.authority.consumeApproval(input),
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.find((result) => !result.ok).code, 'APPROVAL_CONSUMED');
  const consumed = results.find((result) => result.ok).record;
  assert.equal(consumed.artifactHash, HASH);
  assert.equal(consumed.actor.id, identity.id);
  assert.ok(consumed.consumedAt);
  assert.equal((await f.authority.consumeApproval(input)).code, 'APPROVAL_CONSUMED');
});

test('modify, reject and cancel decisions are audited and never return an authorizing handle', async () => {
  for (const [response, expectedDecision] of [
    [
      { action: 'accept', content: { decision: 'modify', comment: 'Fix acceptance criterion 2.' } },
      'modify',
    ],
    [{ action: 'accept', content: { decision: 'cancel', comment: 'Stop this change.' } }, 'cancel'],
    [{ action: 'decline' }, 'modify'],
    [{ action: 'cancel' }, 'dismiss'],
    [{ action: 'decline', content: null }, 'modify'],
    [{ action: 'cancel', content: null }, 'dismiss'],
  ]) {
    const f = fixture({ request: async () => response });
    const result = await f.authority.requestApproval(f.challenge());
    assert.equal(result.ok, false);
    assert.equal(result.approval, undefined);
    assert.equal(result.record.decision, expectedDecision);
    assert.equal(f.events.at(-1).type, 'approval.decided');
  }
});

test('malformed or model-like responses cannot sign approvals', async () => {
  for (const response of [
    'approved',
    { approved: true },
    { action: 'accept', content: { decision: 'approve', comment: '', actor: identity } },
    { action: 'accept', content: { decision: 'approve', comment: 42 } },
    { action: 'accept', content: { decision: 'yes', comment: '' } },
    { action: 'unknown' },
  ]) {
    const f = fixture({ request: async () => response });
    assert.equal(
      (await f.authority.requestApproval(f.challenge())).code,
      'APPROVAL_RESPONSE_INVALID',
    );
  }
});

test('H1 confirm submits an empty native form and issues approval', async () => {
  const f = fixture();
  await f.authority.requestApproval(f.challenge());
  const schema = f.requests[0].params.requestedSchema;
  assert.deepEqual(schema.properties, {});
  assert.equal(schema.required, undefined);
  assert.equal(schema.additionalProperties, false);
  const emptyConfirm = fixture({
    request: async () => ({ action: 'accept', content: {} }),
  });
  const result = await emptyConfirm.authority.requestApproval(emptyConfirm.challenge());
  assert.equal(result.ok, true);
  assert.equal(result.record.comment, '');
});

test('H3 keeps an explicit decision field with an optional comment', async () => {
  const f = fixture();
  const result = await f.authority.requestApproval(f.challenge({ gate: 'H3' }));
  assert.equal(result.ok, true);
  const schema = f.requests[0].params.requestedSchema;
  assert.deepEqual(schema.required, ['decision']);
  assert.equal(schema.properties.decision.enum.length, 3);
  assert.equal(schema.properties.comment.default, '');
});

test('unsupported, failed, timed out and cancelled native requests fail closed', async () => {
  for (const [peerCode, expectedCode] of [
    ['ELICITATION_UNSUPPORTED', 'APPROVAL_CHANNEL_UNSUPPORTED'],
    ['PEER_CANCELLED', 'APPROVAL_CANCELLED'],
    ['PEER_TIMEOUT', 'APPROVAL_TIMEOUT'],
  ]) {
    const peer = fixture({
      request: async () => {
        throw Object.assign(new Error('peer error'), { code: peerCode });
      },
    });
    assert.equal((await peer.authority.requestApproval(peer.challenge())).code, expectedCode);
  }
  const unsupported = fixture({
    request: async () => {
      throw Object.assign(new Error('unsupported'), { code: -32601 });
    },
  });
  assert.equal(
    (await unsupported.authority.requestApproval(unsupported.challenge())).code,
    'APPROVAL_CHANNEL_UNSUPPORTED',
  );
  const failed = fixture({
    request: async () => {
      throw new Error('sensitive provider error');
    },
  });
  const failure = await failed.authority.requestApproval(failed.challenge());
  assert.equal(failure.code, 'APPROVAL_REQUEST_FAILED');
  assert.doesNotMatch(JSON.stringify(failure), /sensitive/);
  const timed = fixture({ request: async () => new Promise(() => {}), requestTimeoutMs: 10 });
  assert.equal((await timed.authority.requestApproval(timed.challenge())).code, 'APPROVAL_TIMEOUT');
  const controller = new AbortController();
  controller.abort();
  const cancelled = fixture();
  assert.equal(
    (await cancelled.authority.requestApproval(cancelled.challenge({ signal: controller.signal })))
      .code,
    'APPROVAL_CANCELLED',
  );
  assert.equal(cancelled.requests.length, 0);
});

test('approval expires and a late peer response never creates a handle', async () => {
  const f = fixture({ ttlMs: 100 });
  const result = await f.authority.requestApproval(f.challenge());
  f.advance(100);
  assert.equal(
    (
      await f.authority.consumeApproval({
        approval: result.approval,
        gate: 'H1',
        scope: 'change-1',
        artifactHash: HASH,
      })
    ).code,
    'APPROVAL_EXPIRED',
  );
  let late;
  late = fixture({
    ttlMs: 100,
    request: async () => {
      late.advance(100);
      return { action: 'accept', content: { decision: 'approve', comment: '' } };
    },
  });
  const response = await late.authority.requestApproval(late.challenge());
  assert.equal(response.code, 'APPROVAL_EXPIRED');
  assert.equal(response.approval, undefined);
});

test('content changes before request, while awaiting the user, or before consumption invalidate approval', async () => {
  const before = fixture();
  before.setHash(OTHER_HASH);
  assert.equal(
    (await before.authority.requestApproval(before.challenge())).code,
    'APPROVAL_ARTIFACT_CHANGED',
  );
  assert.equal(before.requests.length, 0);
  let during;
  during = fixture({
    request: async () => {
      during.setHash(OTHER_HASH);
      return { action: 'accept', content: { decision: 'approve', comment: '' } };
    },
  });
  assert.equal(
    (await during.authority.requestApproval(during.challenge())).code,
    'APPROVAL_ARTIFACT_CHANGED',
  );
  const after = fixture();
  const result = await after.authority.requestApproval(after.challenge());
  after.setHash(OTHER_HASH);
  const input = { approval: result.approval, gate: 'H1', scope: 'change-1', artifactHash: HASH };
  assert.equal((await after.authority.consumeApproval(input)).code, 'APPROVAL_ARTIFACT_CHANGED');
  after.setHash(HASH);
  assert.equal((await after.authority.consumeApproval(input)).code, 'APPROVAL_INVALIDATED');
});

test('wrong gate, scope, and supplied hash cannot consume a bound approval', async () => {
  for (const extra of [{ gate: 'H3' }, { scope: 'another-change' }, { artifactHash: OTHER_HASH }]) {
    const f = fixture();
    const result = await f.authority.requestApproval(f.challenge());
    const consumed = await f.authority.consumeApproval({
      approval: result.approval,
      gate: 'H1',
      scope: 'change-1',
      artifactHash: HASH,
      ...extra,
    });
    assert.equal(consumed.code, 'APPROVAL_BINDING_MISMATCH');
  }
});

test('artifact reader failures and missing reader fail closed', async () => {
  const f = fixture();
  assert.equal(
    (await f.authority.requestApproval(f.challenge({ readArtifactHash: undefined }))).code,
    'APPROVAL_CHALLENGE_INVALID',
  );
  assert.equal(
    (
      await f.authority.requestApproval(
        f.challenge({
          readArtifactHash: async () => {
            throw new Error('file changed');
          },
        }),
      )
    ).code,
    'APPROVAL_ARTIFACT_UNREADABLE',
  );
});

test('nonce reuse and cross-authority handles cannot replay an approval', async () => {
  const f = fixture({ nonceFactory: () => 'c'.repeat(64) });
  const first = await f.authority.requestApproval(f.challenge());
  assert.equal((await f.authority.requestApproval(f.challenge())).code, 'APPROVAL_NONCE_REUSED');
  const other = fixture();
  assert.equal(
    (
      await other.authority.consumeApproval({
        approval: first.approval,
        gate: 'H1',
        scope: 'change-1',
        artifactHash: HASH,
      })
    ).code,
    'APPROVAL_UNKNOWN',
  );
});

test('audit failures cannot issue or reuse approvals', async () => {
  const refused = fixture({
    audit: async () => {
      throw new Error('disk full');
    },
  });
  assert.equal(
    (await refused.authority.requestApproval(refused.challenge())).code,
    'APPROVAL_AUDIT_FAILED',
  );
  assert.equal(refused.requests.length, 0);
  let failConsumption = false;
  const f = fixture({
    audit: async () => {
      if (failConsumption) throw new Error('disk full');
    },
  });
  const result = await f.authority.requestApproval(f.challenge());
  failConsumption = true;
  const input = { approval: result.approval, gate: 'H1', scope: 'change-1', artifactHash: HASH };
  assert.equal((await f.authority.consumeApproval(input)).code, 'APPROVAL_AUDIT_FAILED');
  failConsumption = false;
  assert.equal((await f.authority.consumeApproval(input)).code, 'APPROVAL_INVALIDATED');
});

test('state gate authorization binds the active change and current artifact hash', async () => {
  for (const gate of ['H1', 'H3']) {
    const f = fixture();
    const result = await f.authority.requestApproval(f.challenge({ gate }));
    const state = {
      changeId: 'change-1',
      context: { artifacts: { [gate === 'H1' ? 'requirements' : 'review']: { hash: HASH } } },
    };
    const authorized = await f.authority.authorizeGate({
      gate,
      state,
      to: gate === 'H1' ? 'REQ_FROZEN' : 'ARCHIVING',
      approval: result.approval,
    });
    assert.equal(authorized.ok, true);
    assert.ok(authorized.record.consumedAt);
  }
  const f = fixture();
  const result = await f.authority.requestApproval(f.challenge());
  assert.equal(
    (
      await f.authority.authorizeGate({
        gate: 'H1',
        state: { changeId: 'change-1' },
        to: 'REQ_FROZEN',
        approval: result.approval,
      })
    ).code,
    'APPROVAL_BINDING_MISMATCH',
  );
});

test('server transaction audit override avoids reacquiring the state lock', async () => {
  const f = fixture();
  const result = await f.authority.requestApproval(f.challenge());
  const transactionEvents = [];
  const authorized = await f.authority.authorizeGate({
    gate: 'H1',
    state: { changeId: 'change-1', context: { artifacts: { requirements: { hash: HASH } } } },
    to: 'REQ_FROZEN',
    approval: result.approval,
    audit: async (event) => transactionEvents.push(event),
  });
  assert.equal(authorized.ok, true);
  assert.deepEqual(
    transactionEvents.map((event) => event.type),
    ['approval.consumed'],
  );
  assert.deepEqual(
    f.events.map((event) => event.type),
    ['approval.requested', 'approval.decided'],
  );
});
