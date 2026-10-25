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

function parseDecision(response, { confirmation = false } = {}) {
  if (
    !isObject(response) ||
    Object.keys(response).some((key) => !['action', 'content', '_meta'].includes(key))
  )
    return null;
  if (response.action === 'cancel') {
    // Closing a native dialog does not authorize terminating the business
    // change. Some hosts include an empty or partially filled content object.
    return { decision: 'dismiss', comment: '' };
  }
  if (response.action === 'decline')
    return { decision: confirmation ? 'modify' : 'dismiss', comment: '' };
  const content = response.content;
  // Codex's native confirmation UI can submit an empty object for a schema
  // with no fields. The action itself is the human confirmation for H1.
  if (
    confirmation &&
    response.action === 'accept' &&
    (content === undefined || (isObject(content) && Object.keys(content).length === 0))
  )
    return { decision: 'approve', comment: '' };
  const decision =
    { 批准: 'approve', 要求修改: 'modify', 取消: 'cancel', 取消变更: 'cancel' }[
      content?.decision
    ] || content?.decision;
  if (
    response.action !== 'accept' ||
    !isObject(content) ||
    Object.keys(content).some((key) => !['decision', 'comment'].includes(key)) ||
    !decisions.has(decision) ||
    (content.comment !== undefined && typeof content.comment !== 'string')
  )
    return null;
  return { decision, comment: content.comment ?? '' };
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
        return request('elicitation/create', params, {
          signal: controller.signal,
          timeoutMs,
          // Probe the actual host channel even when the client omitted the
          // elicitation capability advertisement. A real native response is
          // still required before an approval can be issued.
          allowUnadvertised: true,
        });
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
  resolveGateArtifact = ({ gate, state, to }) => ({
    scope: state?.changeId,
    artifactHash:
      state?.context?.artifacts?.[
        to === 'TEST_DESIGN' ? 'testReplacement' : gate === 'H1' ? 'requirements' : 'review'
      ]?.hash,
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
      return failure('APPROVAL_AUDIT_FAILED', '审批审计无法持久化；本次审批已拒绝');
    return failure(code, message);
  }

  async function checkArtifact(readArtifactHash, artifactHash) {
    try {
      const current = hash(await readArtifactHash());
      return current === artifactHash
        ? { ok: true }
        : failure('APPROVAL_ARTIFACT_CHANGED', '已审批的文档内容发生变化；请重新请求审批');
    } catch {
      return failure('APPROVAL_ARTIFACT_UNREADABLE', '无法核对文档指纹');
    }
  }

  async function requestApproval(challenge) {
    const available = availability();
    if (!available.available)
      return reject(
        available.reason,
        available.reason === 'TRUSTED_USER_IDENTITY_UNAVAILABLE'
          ? '未启用可信人工审批身份：请确认 SpecGate 连接以 SPECGATE_INTERACTIVE_APPROVAL=1 启动，重新加载插件或新建会话后重试；普通聊天确认不能作为审批。'
          : '缺少可信人工审批通道或持久审计：请重新加载 SpecGate 插件连接或新建会话后重试；普通聊天确认不能作为审批。',
      );
    if (
      !isObject(challenge) ||
      Object.keys(challenge).some(
        (key) =>
          ![
            'gate',
            'scope',
            'artifactHash',
            'readArtifactHash',
            'summary',
            'documentPath',
            'signal',
          ].includes(key),
      ) ||
      !gates.has(challenge.gate) ||
      !text(challenge.scope) ||
      !hash(challenge.artifactHash) ||
      typeof challenge.readArtifactHash !== 'function' ||
      !text(challenge.summary) ||
      (challenge.documentPath !== undefined &&
        (typeof challenge.documentPath !== 'string' ||
          challenge.documentPath.length > 32768 ||
          !/^\.specgate\/codex\/changes\/[A-Za-z0-9][A-Za-z0-9._/-]*\.md$/.test(
            challenge.documentPath,
          ) ||
          challenge.documentPath.includes('..'))) ||
      (challenge.signal !== undefined && !(challenge.signal instanceof AbortSignal))
    )
      return reject('APPROVAL_CHALLENGE_INVALID', '审批请求缺少门禁、范围、文档指纹、读取器或摘要');
    // Snapshot the challenge before crossing any asynchronous boundary.
    const { gate, scope, summary, readArtifactHash, signal } = challenge;
    const artifactHash = hash(challenge.artifactHash);
    const started = clock();
    const context = { gate, scope, artifactHash };
    if (signal?.aborted) return reject('APPROVAL_CANCELLED', '审批请求已取消', context);
    const initial = await checkArtifact(readArtifactHash, artifactHash);
    if (!initial.ok) return reject(initial.code, initial.message, context);
    let nonce;
    try {
      nonce = nonceFactory();
    } catch {
      return reject('APPROVAL_NONCE_INVALID', '无法生成审批请求编号', context);
    }
    if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce))
      return reject('APPROVAL_NONCE_INVALID', '审批请求编号必须包含 256 位随机数', context);
    if (nonces.has(nonce)) return reject('APPROVAL_NONCE_REUSED', '审批请求编号已被使用', context);
    nonces.add(nonce);
    context.nonce = nonce;
    if (!(await append('approval.requested', { ...context, actor })))
      return failure('APPROVAL_AUDIT_FAILED', '审批请求审计无法持久化');
    let response;
    const confirmation = gate === 'H1';
    try {
      response = await requestWithDeadline(
        request,
        {
          message: `SpecGate ${gate} ${gate === 'H1' ? '需求审批' : gate === 'H3' ? '交付人工验收' : '项目基线确认'}\n${summary}\n\n${
            confirmation
              ? '点击“确认”批准本次需求；点击“拒绝”返回修改；关闭表单保留待审批。'
              : '选择决定后点击确认；关闭表单保留待审批。'
          }`,
          requestedSchema: confirmation
            ? { type: 'object', properties: {}, additionalProperties: false }
            : {
                type: 'object',
                properties: {
                  decision: {
                    type: 'string',
                    title: '请选择审批决定',
                    enum: ['批准', '要求修改', '取消'],
                  },
                  comment: { type: 'string', title: '审批意见（选填）', default: '' },
                },
                required: ['decision'],
                additionalProperties: false,
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
      const detail = {
        APPROVAL_CHANNEL_UNSUPPORTED:
          '当前宿主不支持审批表单（elicitation）：请重新加载 SpecGate 插件连接或改用支持表单的宿主；保持待审批状态，不能用聊天文字代替。',
        APPROVAL_TIMEOUT: '审批表单等待超时；请重新发起审批。',
        APPROVAL_CANCELLED: '审批请求已取消。',
      }[code];
      return reject(code, detail || '原生审批请求未成功完成', context);
    }
    if (signal?.aborted) return reject('APPROVAL_CANCELLED', '审批请求已取消', context);
    if (clock() - started >= ttlMs)
      return reject('APPROVAL_EXPIRED', '审批在用户响应前已过期；请重新发起审批', context);
    const decision = parseDecision(response, { confirmation });
    if (!decision)
      return reject('APPROVAL_RESPONSE_INVALID', '原生审批响应无效；请重新发起审批', context);
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
        return failure('APPROVAL_AUDIT_FAILED', '审批决定审计无法持久化');
      return reject(current.code, current.message, context);
    }
    if (!(await append('approval.decided', { record })))
      return failure('APPROVAL_AUDIT_FAILED', '审批决定审计无法持久化');
    if (decision.decision !== 'approve')
      return {
        ...failure(
          decision.decision === 'modify'
            ? 'APPROVAL_MODIFY_REQUESTED'
            : decision.decision === 'dismiss'
              ? 'APPROVAL_DISMISSED'
              : 'APPROVAL_CANCELLED',
          decision.decision === 'modify'
            ? '用户要求修改；请根据审批意见修订文档后重新请求审批。'
            : decision.decision === 'dismiss'
              ? '审批表单已关闭，保留原需求的待审批状态；可重新请求审批。'
              : '已确认取消变更，未批准本文档。',
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
    if (!entry) return deny('APPROVAL_UNKNOWN', '该审批句柄不存在；请重新请求人工审批');
    const { record } = entry;
    const context = { gate: record.gate, scope: record.scope, nonce: record.nonce };
    if (entry.status === 'invalidated')
      return deny('APPROVAL_INVALIDATED', '该审批已失效；请重新请求人工审批', context);
    if (entry.status !== 'active')
      return deny('APPROVAL_CONSUMED', '该审批已被消费；如需继续请重新请求人工审批', context);
    if (
      gate !== record.gate ||
      scope !== record.scope ||
      hash(artifactHash) !== record.artifactHash
    )
      return deny('APPROVAL_BINDING_MISMATCH', '审批的门禁、范围或文档指纹不匹配', context);
    // Reserve synchronously so concurrent callers cannot both consume the handle.
    entry.status = 'consuming';
    const invalidate = async (code, message) => {
      entry.status = 'invalidated';
      record.invalidatedAt = iso();
      return deny(code, message, context);
    };
    if (clock() >= Date.parse(record.expiresAt))
      return invalidate('APPROVAL_EXPIRED', '该审批已过期；请重新请求人工审批');
    const current = await checkArtifact(entry.readArtifactHash, record.artifactHash);
    if (!current.ok) return invalidate(current.code, current.message);
    if (clock() >= Date.parse(record.expiresAt))
      return invalidate('APPROVAL_EXPIRED', '该审批已过期；请重新请求人工审批');
    const consumed = { ...record, consumedAt: iso() };
    if (!(await append('approval.consumed', { record: consumed }, sink))) {
      entry.status = 'invalidated';
      record.invalidatedAt = iso();
      return failure('APPROVAL_AUDIT_FAILED', '审批消费审计失败；请重新请求人工审批');
    }
    entry.record = consumed;
    entry.status = 'consumed';
    return { ok: true, record: clone(consumed) };
  }

  const consumeApproval = (challenge) => consume(challenge);

  // The state store supplies a reserved server-owned audit closure. Each append
  // takes a short write lock; asynchronous authorization itself holds no lock.
  // This closure is never accepted from model/tool arguments.
  async function authorizeGate({ gate, state, to, approval, audit: transactionAudit } = {}) {
    if (transactionAudit !== undefined && typeof transactionAudit !== 'function')
      return reject('APPROVAL_AUDIT_FAILED', '缺少服务端事务审计回调');
    const sink = transactionAudit ?? audit;
    if (
      (gate === 'H1' && !['REQ_FROZEN', 'TEST_DESIGN'].includes(to)) ||
      (gate === 'H3' && to !== 'ARCHIVING') ||
      !gates.has(gate)
    )
      return reject('APPROVAL_BINDING_MISMATCH', '该审批不授权此门禁状态迁移', {}, sink);
    let artifact;
    try {
      artifact = await resolveGateArtifact({ gate, state, to });
    } catch {
      return reject('APPROVAL_BINDING_MISMATCH', '无法解析当前门禁对应的文档', {}, sink);
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
