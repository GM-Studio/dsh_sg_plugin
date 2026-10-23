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
            'SpecGate 中文交付流程：使用 sg-codex Skill。先调用 sg_project_status 核对 projectRoot；错误时用 sg_project_bind 指定业务项目。新建项目调用 sg_project_create 弹出配置表单，用户亲自选择技术栈；sg_init 自动安装项目 Agent 与 Skill。真实验证并建立 ProjectProfile 和 ProjectBaseline 后停在就绪，等待用户提供业务需求，禁止编造示例需求或直接开发。需求必须澄清、反述、批判分析，调用 sg_request_h1 请求人工审批。H1/H3 未获可信用户确认不得推进；表单不可用时保持待审批并说明原因。前后端由真实代理串行实现，随后独立测试、格式化并对固定提交评审。异步模式先读取工作项状态，返回 WAITING_FOR_USER 后立即停止。交付批准后生成交付记录和证据包；仅用户明确要求 push=true 时推送。不得模拟子代理或伪造人工批准。所有用户可见内容与选项使用中文。统一推荐 sg-codex 使用向导，项目准备为辅助步骤。新建填写确认一次，路径留空使用当前仓库；失败保留已有技术栈选择，不重复弹出整张表单。',
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
