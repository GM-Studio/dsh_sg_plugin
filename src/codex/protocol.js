import { SERVER_INFO } from './tools.js';
import { createToolRegistry } from './workflow-tools.js';

// Workflow mutations are registered explicitly. No generic state writer,
// transition method, approval issuer or model-supplied approval is exposed.
export const PROTOCOL_VERSION = '2025-06-18';
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

export function createProtocol({
  projectRoot,
  registry = createToolRegistry({ projectRoot }),
  onInitialize,
} = {}) {
  let lifecycle = 'new';
  return (message, context = {}) => {
    const validId = typeof message?.id === 'string' || Number.isSafeInteger(message?.id);
    const hasId = isObject(message) && Object.hasOwn(message, 'id');
    if (
      !isObject(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string' ||
      (hasId && !validId) ||
      (message.params !== undefined && !isObject(message.params))
    ) {
      return rpcError(validId ? message.id : null, -32600, 'Invalid JSON-RPC request');
    }
    if (!hasId) {
      if (message.method === 'notifications/initialized' && lifecycle === 'initializing')
        lifecycle = 'ready';
      return null;
    }
    const { id, method, params = {} } = message;
    const success = (result) => ({ jsonrpc: '2.0', id, result });
    if (method === 'ping') return success({});
    if (method === 'initialize') {
      if (lifecycle !== 'new') return rpcError(id, -32600, 'Already initialized');
      if (
        typeof params.protocolVersion !== 'string' ||
        !params.protocolVersion ||
        !isObject(params.capabilities) ||
        !isObject(params.clientInfo) ||
        typeof params.clientInfo.name !== 'string' ||
        typeof params.clientInfo.version !== 'string'
      ) {
        return rpcError(id, -32602, 'protocolVersion, capabilities and clientInfo are required');
      }
      lifecycle = 'initializing';
      onInitialize?.(params.capabilities);
      return success({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Codex state kernel and generation adapter. Read sg_state for CAS versions and sg_init_preview before sg_init. Trusted native user identity is not configured: approval gates and nonempty initialization fail closed. Change orchestration is not yet enabled.',
      });
    }
    if (lifecycle !== 'ready')
      return rpcError(id, -32002, 'Complete the MCP initialize handshake first');
    if (method === 'tools/list') {
      if (params.cursor !== undefined)
        return rpcError(id, -32602, 'This tool list is not paginated');
      return success({ tools: registry.definitions });
    }
    if (method === 'tools/call') {
      if (!registry.definitions.some((tool) => tool.name === params.name))
        return rpcError(id, -32602, 'Unknown tool');
      const args = params.arguments === undefined ? {} : params.arguments;
      if (!isObject(args)) {
        return rpcError(id, -32602, 'Tool arguments must be an object');
      }
      if (registry.validate && !registry.validate(params.name, args))
        return rpcError(id, -32602, 'Tool arguments do not match the declared schema');
      try {
        return Promise.resolve(registry.call(params.name, args, context))
          .then(success)
          .catch(() =>
            success({
              isError: true,
              content: [{ type: 'text', text: 'TOOL_FAILED: operation did not complete' }],
            }),
          );
      } catch {
        return success({
          isError: true,
          content: [{ type: 'text', text: 'DIAGNOSTIC_FAILED: cannot inspect the bound project' }],
        });
      }
    }
    return rpcError(id, -32601, 'Method not found');
  };
}
