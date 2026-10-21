import { randomUUID } from 'node:crypto';

function peerError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Owns only the server-to-client response channel. Tool parameters never enter
// this map. Elicitation support alone does not authenticate an approving user.
export function createMcpPeer({ send, timeoutMs = 120000 } = {}) {
  if (typeof send !== 'function') throw new TypeError('A protocol sender is required');
  let elicitationSupported = false;
  let closed = false;
  const pending = new Map();
  return {
    initialize(capabilities = {}) {
      elicitationSupported =
        capabilities.elicitation !== null &&
        typeof capabilities.elicitation === 'object' &&
        !Array.isArray(capabilities.elicitation);
    },
    capabilities() {
      return { elicitationSupported, trustedUserIdentity: false };
    },
    request(method, params, { signal, timeoutMs: requestedTimeout = timeoutMs } = {}) {
      if (closed) return Promise.reject(peerError('PEER_CLOSED', 'MCP peer is disconnected'));
      if (method !== 'elicitation/create')
        return Promise.reject(
          peerError('PEER_METHOD_UNSUPPORTED', 'Only elicitation/create is supported'),
        );
      if (!elicitationSupported)
        return Promise.reject(
          peerError('ELICITATION_UNSUPPORTED', 'MCP client does not advertise elicitation'),
        );
      if (signal?.aborted)
        return Promise.reject(peerError('PEER_CANCELLED', 'User interaction cancelled'));
      if (!Number.isFinite(requestedTimeout) || requestedTimeout <= 0 || requestedTimeout > 300000)
        return Promise.reject(
          peerError('INVALID_ARGUMENT', 'Peer timeout must be between 1 and 300000 ms'),
        );
      const id = 'sg-host-' + randomUUID();
      return new Promise((resolve, reject) => {
        const finish = (error, result) => {
          if (!pending.has(id)) return;
          pending.delete(id);
          clearTimeout(timer);
          signal?.removeEventListener('abort', aborted);
          if (error) reject(error);
          else resolve(result);
        };
        const aborted = () => finish(peerError('PEER_CANCELLED', 'User interaction cancelled'));
        const timer = setTimeout(
          () => finish(peerError('PEER_TIMEOUT', 'User interaction timed out')),
          requestedTimeout,
        );
        pending.set(id, finish);
        signal?.addEventListener('abort', aborted, { once: true });
        try {
          send({ jsonrpc: '2.0', id, method, params });
        } catch {
          finish(peerError('PEER_SEND_FAILED', 'Cannot send user interaction request'));
        }
      });
    },
    receive(message) {
      if (
        !message ||
        message.jsonrpc !== '2.0' ||
        Object.hasOwn(message, 'method') ||
        !pending.has(message.id)
      )
        return false;
      const finish = pending.get(message.id);
      if (Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error')) {
        finish(peerError('PEER_INVALID_RESPONSE', 'Expected exactly one result or error'));
      } else if (Object.hasOwn(message, 'error')) {
        finish(peerError('PEER_REJECTED', 'MCP client rejected user interaction'));
      } else finish(null, message.result);
      return true;
    },
    close() {
      closed = true;
      for (const finish of [...pending.values()])
        finish(peerError('PEER_CLOSED', 'MCP peer is disconnected'));
    },
  };
}
