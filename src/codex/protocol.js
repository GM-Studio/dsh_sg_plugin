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
      return Promise.resolve(onInitialize?.(params.capabilities, params.clientInfo)).then(() =>
        success({
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'SpecGate 统一导航使用 $sg-codex；环境自检、复用、按需安装使用 $sg-codex-env；初始化或接入项目使用 $sg-codex-project；新增/修改/修复及任务控制和验收交付使用 $sg-codex-change；只读项目信息与状态使用 $sg-codex-status。旧 $sg-codex-setup 仅转接准备能力。先识别业务项目与技术栈，sg_env_check 只读预检，缺项由 sg_env_prepare 请求可信确认并真实验证；不提供外部安装脚本。sg_status 不触发安装、初始化、恢复或审批。环境通过后才能生成或实现，项目基线就绪且用户未提供需求时等待。真实用户选择技术栈，需求澄清、反述、批判分析后请求 H1，H1/H3 未获可信审批不得推进。真实子代理串行实现，独立测试、格式化和固定提交评审；不得模拟角色或伪造证据。异步 WAITING_FOR_USER 后停止，真实 Decision 后重读状态。用户明确 push=true 才推送。全程中文，保留已有技术栈与目录选择，不重复新建。',
        }),
      );
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
