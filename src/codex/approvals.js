import { randomBytes } from 'node:crypto';

export const APPROVAL_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const gates = new Set(['H1', 'H3', 'BASELINE']);
const decisions = new Set(['approve', 'modify', 'cancel']);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = (value) => structuredClone(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const failure = (code, message) => ({ ok: false, code, message });
const hash = (value) =>
  typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/.test(value)
    ? `sha256:${value.replace(/^sha256:/, '')}`
    : null;

function trustedIdentity(value) {
  return (
    isObject(value) &&
    value.kind === 'user' &&
    text(value.id) &&
    text(value.source) &&
    !/(?:client[-_ ]?info|capabilit)|^(?:client|mcp-client)$/i.test(value.source)
  );
}

function parseDecision(response) {
  if (
    !isObject(response) ||
    Object.keys(response).some((key) => !['action', 'content', '_meta'].includes(key))
  )
    return null;
  if (response.action === 'cancel' || response.action === 'decline') {
    return response.content === undefined || response.content === null
      ? { decision: 'cancel', comment: '' }
      : null;
  }
  const content = response.content;
  if (
    response.action !== 'accept' ||
    !isObject(content) ||
    Object.keys(content).some((key) => !['decision', 'comment'].includes(key)) ||
    !decisions.has(content.decision) ||
    typeof content.comment !== 'string'
  )
    return null;
  return { decision: content.decision, comment: content.comment };
}

async function requestWithDeadline(request, params, { signal, timeoutMs }) {
  const controller = new AbortController();
  let timer;
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(Object.assign(new Error('Approval cancelled'), { code: 'APPROVAL_CANCELLED' }));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error('Approval timed out'), { code: 'APPROVAL_TIMEOUT' }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        if (controller.signal.aborted)
          throw Object.assign(new Error('Approval cancelled'), { code: 'APPROVAL_CANCELLED' });
        return request('elicitation/create', params, { signal: controller.signal, timeoutMs });
      }),
      cancelled,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Construct only inside the server, never from tool arguments. `request` must be
 * the server's correlated MCP peer request function; `trustedPeerIdentity` must
 * come from a proven native user source. MCP capabilities and clientInfo do not
 * establish that source. This module deliberately cannot discover or assert it.
 *
 * Handles are process-local opaque capabilities. Records and nonces are audit
 * evidence, never credentials. A restart requires a new native approval. `audit`
 * must durably append events before resolving. A failed consumption audit burns
 * the handle; a later failed state transaction likewise requires new approval.
 */
export function createApprovalAuthority({
  request,
  trustedPeerIdentity,
  audit,
  clock = Date.now,
  ttlMs = APPROVAL_TTL_MS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
  nonceFactory = () => randomBytes(32).toString('hex'),
  resolveGateArtifact = ({ gate, state }) => ({
    scope: state?.changeId,
    artifactHash: state?.context?.artifacts?.[gate === 'H1' ? 'requirements' : 'review']?.hash,
  }),
} = {}) {
  for (const [name, value] of Object.entries({ ttlMs, requestTimeoutMs })) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new TypeError(`${name} must be a positive safe integer`);
  }
  for (const [name, value] of Object.entries({ clock, nonceFactory, resolveGateArtifact })) {
    if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
  }
  const actor = trustedIdentity(trustedPeerIdentity)
    ? { id: trustedPeerIdentity.id, source: trustedPeerIdentity.source, kind: 'user' }
    : null;
  const handles = new WeakMap();
  const nonces = new Set();
  const iso = () => new Date(clock()).toISOString();

  function availability() {
    if (typeof request !== 'function')
      return { available: false, reason: 'APPROVAL_CHANNEL_UNAVAILABLE' };
    if (!actor) return { available: false, reason: 'TRUSTED_USER_IDENTITY_UNAVAILABLE' };
    if (typeof audit !== 'function')
      return { available: false, reason: 'APPROVAL_AUDIT_UNAVAILABLE' };
    return { available: true, actor: clone(actor) };
  }

  async function append(type, payload, sink = audit) {
    try {
      await sink({ type, at: iso(), ...clone(payload) });
      return true;
    } catch {
      return false;
    }
  }

  async function reject(code, message, payload = {}, sink = audit) {
    if (
      typeof sink === 'function' &&
      !(await append('approval.failed', { code, ...payload }, sink))
    )
      return failure(
        'APPROVAL_AUDIT_FAILED',
        'Approval audit could not be persisted; approval denied',
      );
    return failure(code, message);
  }

  async function checkArtifact(readArtifactHash, artifactHash) {
    try {
      const current = hash(await readArtifactHash());
      return current === artifactHash
        ? { ok: true }
        : failure(
            'APPROVAL_ARTIFACT_CHANGED',
            'The approved artifact changed; request new approval',
          );
    } catch {
      return failure('APPROVAL_ARTIFACT_UNREADABLE', 'The artifact hash could not be checked');
    }
  }

  async function requestApproval(challenge) {
    const available = availability();
    if (!available.available)
      return reject(
        available.reason,
        'A trusted native user approval source and durable audit are required',
      );
    if (
      !isObject(challenge) ||
      Object.keys(challenge).some(
        (key) =>
          !['gate', 'scope', 'artifactHash', 'readArtifactHash', 'summary', 'signal'].includes(key),
      ) ||
      !gates.has(challenge.gate) ||
      !text(challenge.scope) ||
      !hash(challenge.artifactHash) ||
      typeof challenge.readArtifactHash !== 'function' ||
      !text(challenge.summary) ||
      (challenge.signal !== undefined && !(challenge.signal instanceof AbortSignal))
    )
      return reject(
        'APPROVAL_CHALLENGE_INVALID',
        'A gate, scope, artifact hash, reader and summary are required',
      );
    // Snapshot the challenge before crossing any asynchronous boundary.
    const { gate, scope, summary, readArtifactHash, signal } = challenge;
    const artifactHash = hash(challenge.artifactHash);
    const started = clock();
    const context = { gate, scope, artifactHash };
    if (signal?.aborted)
      return reject('APPROVAL_CANCELLED', 'Approval request was cancelled', context);
    const initial = await checkArtifact(readArtifactHash, artifactHash);
    if (!initial.ok) return reject(initial.code, initial.message, context);
    let nonce;
    try {
      nonce = nonceFactory();
    } catch {
      return reject('APPROVAL_NONCE_INVALID', 'Cannot create an approval nonce', context);
    }
    if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce))
      return reject('APPROVAL_NONCE_INVALID', 'Approval nonce must contain 256 bits', context);
    if (nonces.has(nonce))
      return reject('APPROVAL_NONCE_REUSED', 'Approval nonce was already used', context);
    nonces.add(nonce);
    context.nonce = nonce;
    if (!(await append('approval.requested', { ...context, actor })))
      return failure('APPROVAL_AUDIT_FAILED', 'Approval request audit could not be persisted');
    let response;
    try {
      response = await requestWithDeadline(
        request,
        {
          message: `SpecGate ${gate}\nScope: ${scope}\nArtifact: ${artifactHash}\nNonce: ${nonce}\n\n${summary}`,
          requestedSchema: {
            type: 'object',
            properties: {
              decision: {
                type: 'string',
                title: 'Decision',
                enum: ['approve', 'modify', 'cancel'],
              },
              comment: { type: 'string', title: 'Approval comments' },
            },
            required: ['decision', 'comment'],
          },
        },
        { signal, timeoutMs: Math.min(requestTimeoutMs, ttlMs) },
      );
    } catch (error) {
      const aliases = new Map([
        [-32601, 'APPROVAL_CHANNEL_UNSUPPORTED'],
        ['ELICITATION_UNSUPPORTED', 'APPROVAL_CHANNEL_UNSUPPORTED'],
        ['APPROVAL_CHANNEL_UNSUPPORTED', 'APPROVAL_CHANNEL_UNSUPPORTED'],
        ['PEER_TIMEOUT', 'APPROVAL_TIMEOUT'],
        ['APPROVAL_TIMEOUT', 'APPROVAL_TIMEOUT'],
        ['PEER_CANCELLED', 'APPROVAL_CANCELLED'],
        ['APPROVAL_CANCELLED', 'APPROVAL_CANCELLED'],
      ]);
      const code = aliases.get(error?.code) ?? 'APPROVAL_REQUEST_FAILED';
      return reject(code, 'Native approval request did not complete successfully', context);
    }
    if (signal?.aborted)
      return reject('APPROVAL_CANCELLED', 'Approval request was cancelled', context);
    if (clock() - started >= ttlMs)
      return reject(
        'APPROVAL_EXPIRED',
        'Approval request expired before the user response',
        context,
      );
    const decision = parseDecision(response);
    if (!decision)
      return reject('APPROVAL_RESPONSE_INVALID', 'Native approval response is invalid', context);
    const issued = clock();
    const record = {
      ...context,
      actor: clone(actor),
      issuedAt: new Date(issued).toISOString(),
      expiresAt: new Date(issued + ttlMs).toISOString(),
      ...decision,
      consumedAt: null,
    };
    const current = await checkArtifact(readArtifactHash, artifactHash);
    if (!current.ok) {
      record.invalidatedAt = iso();
      if (!(await append('approval.decided', { record })))
        return failure('APPROVAL_AUDIT_FAILED', 'Approval decision audit could not be persisted');
      return reject(current.code, current.message, context);
    }
    if (!(await append('approval.decided', { record })))
      return failure('APPROVAL_AUDIT_FAILED', 'Approval decision audit could not be persisted');
    if (decision.decision !== 'approve')
      return {
        ...failure(
          decision.decision === 'modify' ? 'APPROVAL_MODIFY_REQUESTED' : 'APPROVAL_CANCELLED',
          'The user did not approve this artifact',
        ),
        record: clone(record),
      };
    const approval = Object.freeze(Object.create(null));
    handles.set(approval, { record, readArtifactHash, status: 'active' });
    return { ok: true, approval, record: clone(record) };
  }

  async function consume({ approval, gate, scope, artifactHash } = {}, sink = audit) {
    const deny = (code, message, payload) => reject(code, message, payload, sink);
    const entry = isObject(approval) ? handles.get(approval) : null;
    if (!entry) return deny('APPROVAL_UNKNOWN', 'No approval was issued for this opaque handle');
    const { record } = entry;
    const context = { gate: record.gate, scope: record.scope, nonce: record.nonce };
    if (entry.status === 'invalidated')
      return deny(
        'APPROVAL_INVALIDATED',
        'This approval was invalidated; request new approval',
        context,
      );
    if (entry.status !== 'active')
      return deny('APPROVAL_CONSUMED', 'This approval has already been consumed', context);
    if (
      gate !== record.gate ||
      scope !== record.scope ||
      hash(artifactHash) !== record.artifactHash
    )
      return deny(
        'APPROVAL_BINDING_MISMATCH',
        'Approval gate, scope or artifact hash does not match',
        context,
      );
    // Reserve synchronously so concurrent callers cannot both consume the handle.
    entry.status = 'consuming';
    const invalidate = async (code, message) => {
      entry.status = 'invalidated';
      record.invalidatedAt = iso();
      return deny(code, message, context);
    };
    if (clock() >= Date.parse(record.expiresAt))
      return invalidate('APPROVAL_EXPIRED', 'This approval has expired; request new approval');
    const current = await checkArtifact(entry.readArtifactHash, record.artifactHash);
    if (!current.ok) return invalidate(current.code, current.message);
    if (clock() >= Date.parse(record.expiresAt))
      return invalidate('APPROVAL_EXPIRED', 'This approval has expired; request new approval');
    const consumed = { ...record, consumedAt: iso() };
    if (!(await append('approval.consumed', { record: consumed }, sink))) {
      entry.status = 'invalidated';
      record.invalidatedAt = iso();
      return failure('APPROVAL_AUDIT_FAILED', 'Consumption audit failed; request new approval');
    }
    entry.record = consumed;
    entry.status = 'consumed';
    return { ok: true, record: clone(consumed) };
  }

  const consumeApproval = (challenge) => consume(challenge);

  // The state store supplies a durable append callback while it holds its write
  // lock. It is a server-owned closure, never a model/tool argument, and avoids
  // recursively acquiring that same lock through the constructor audit callback.
  async function authorizeGate({ gate, state, to, approval, audit: transactionAudit } = {}) {
    if (transactionAudit !== undefined && typeof transactionAudit !== 'function')
      return reject('APPROVAL_AUDIT_FAILED', 'A server transaction audit callback is required');
    const sink = transactionAudit ?? audit;
    if (
      (gate === 'H1' && to !== 'REQ_FROZEN') ||
      (gate === 'H3' && to !== 'ARCHIVING') ||
      !gates.has(gate)
    )
      return reject(
        'APPROVAL_BINDING_MISMATCH',
        'Approval does not authorize this gate transition',
        {},
        sink,
      );
    let artifact;
    try {
      artifact = await resolveGateArtifact({ gate, state, to });
    } catch {
      return reject(
        'APPROVAL_BINDING_MISMATCH',
        'Cannot resolve the current gate artifact',
        {},
        sink,
      );
    }
    return consume(
      {
        approval,
        gate,
        scope: artifact?.scope,
        artifactHash: artifact?.artifactHash,
      },
      sink,
    );
  }

  return Object.freeze({ availability, requestApproval, consumeApproval, authorizeGate });
}
