// 启动依赖与宿主引导反馈（M4 / SNA-0404）。
//
// 目标（AC-18）：MCP 无法启动、宿主权限不足或认证缺失时给出可区分的原因，
// 不声称环境已就绪。
//
// 边界（需求 §5 FR-05 第 2 段）：MCP 本身由 Node 启动，因此它不能修复自己的
// 前置条件。缺少启动依赖时，诊断必须以宿主可读的形式表达，而不是要求尚未
// 启动的 MCP 自修复。

/** 可区分的启动诊断原因。 */
export const BOOTSTRAP_REASONS = Object.freeze([
  'host-runtime-unsupported',
  'host-permission-denied',
  'host-auth-missing',
  'host-config-invalid',
  'host-not-bound',
  'ready',
]);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** 解析 engines 的最低 Node 版本要求。 */
export function requiredNodeMajor(engines = {}) {
  const raw = String(engines?.node || '').trim();
  if (!raw) return null;
  const match = />=\s*v?(\d+)/.exec(raw);
  return match ? Number(match[1]) : null;
}

/** 解析当前 Node 主版本。 */
export function nodeMajor(version = process.versions?.node) {
  const match = /^v?(\d+)/.exec(String(version || '').trim());
  return match ? Number(match[1]) : null;
}

/**
 * 启动期诊断。
 * 只读：不写文件、不尝试自我修复、不声称就绪除非全部前置条件成立。
 */
export function diagnoseBootstrap({
  engines = {},
  nodeVersion = process.versions?.node,
  canWriteRuntime = true,
  hasCredentials = true,
  configValid = true,
  projectBound = true,
  hostSupportsMcp = true,
} = {}) {
  // 检查顺序即优先级：运行时 → 平台 → 配置 → 权限 → 认证 → 绑定。
  if (hostSupportsMcp !== true)
    return {
      ok: true,
      reason: 'host-runtime-unsupported',
      detail: '当前宿主未提供 MCP 运行支持',
      ready: false,
      // 该原因必须由宿主侧引导解决，MCP 无法自修复。
      requiresHostGuidance: true,
      selfRepairable: false,
    };

  const required = requiredNodeMajor(engines);
  const current = nodeMajor(nodeVersion);
  if (required !== null && (current === null || current < required))
    return {
      ok: true,
      reason: 'host-runtime-unsupported',
      detail: '需要 Node >= ' + required + '，当前为 ' + (nodeVersion || 'unknown'),
      ready: false,
      requiresHostGuidance: true,
      selfRepairable: false,
    };

  if (configValid !== true)
    return {
      ok: true,
      reason: 'host-config-invalid',
      detail: '宿主配置无法解析，需要人工修正',
      ready: false,
      requiresHostGuidance: true,
      selfRepairable: false,
    };

  if (canWriteRuntime !== true)
    return {
      ok: true,
      reason: 'host-permission-denied',
      detail: '宿主权限不足：无法写入运行时目录',
      ready: false,
      requiresHostGuidance: true,
      selfRepairable: false,
    };

  if (hasCredentials !== true)
    return {
      ok: true,
      reason: 'host-auth-missing',
      detail: '缺少认证凭据，需先在宿主侧完成认证',
      ready: false,
      requiresHostGuidance: true,
      selfRepairable: false,
    };

  if (projectBound !== true)
    return {
      ok: true,
      reason: 'host-not-bound',
      detail: '尚未绑定业务项目，只读分析仍可用但交付流程不可推进',
      ready: false,
      requiresHostGuidance: false,
      selfRepairable: true,
    };

  return {
    ok: true,
    reason: 'ready',
    detail: null,
    ready: true,
    requiresHostGuidance: false,
    selfRepairable: false,
  };
}

/**
 * 生成宿主侧引导文本。
 * 用途：当 MCP 无法启动时，由宿主把它展示给用户。
 */
export function hostGuidance(diagnosis) {
  if (!object(diagnosis) || typeof diagnosis.reason !== 'string')
    return { ok: false, code: 'BOOTSTRAP_DIAGNOSIS_INVALID', message: '需要一份启动诊断' };
  const lines = {
    'host-runtime-unsupported': [
      'SpecGate 的 MCP 服务无法启动：运行时不满足要求。',
      '处理方式：在宿主侧安装或切换到满足 engines.node 的 Node 版本后重启宿主。',
      '注意：该问题必须在 MCP 之外解决，服务自身无法修复。',
    ],
    'host-permission-denied': [
      'SpecGate 的 MCP 服务无法写入运行时目录：宿主权限不足。',
      '处理方式：在宿主中授予工作区写入权限，或把运行时目录改到有权限的位置。',
    ],
    'host-auth-missing': [
      'SpecGate 缺少认证凭据。',
      '处理方式：先在宿主侧完成认证，再重试需要认证的操作。',
    ],
    'host-config-invalid': [
      'SpecGate 的宿主配置无法解析。',
      '处理方式：修正 MCP 配置（plugin.json / mcp.json）后重启宿主。',
    ],
    'host-not-bound': [
      '尚未绑定业务项目。',
      '处理方式：在工作区打开业务项目，或显式绑定项目路径。',
    ],
    ready: ['SpecGate 已就绪。'],
  };
  return {
    ok: true,
    reason: diagnosis.reason,
    lines: lines[diagnosis.reason] ?? ['未知启动状态：' + diagnosis.reason],
    // 引导文本不得声称服务已就绪（除非该原因确实是 ready）。
    claimsReady: diagnosis.reason === 'ready' && diagnosis.ready === true,
  };
}

/** 给用户可见的状态标签：绝不把「未就绪」渲染成「就绪」。 */
export function userFacingStatus(diagnosis) {
  if (!object(diagnosis)) return 'unknown';
  if (diagnosis.reason === 'ready' && diagnosis.ready === true) return 'ready';
  if (diagnosis.reason === 'host-not-bound') return 'not-bound';
  return 'blocked: ' + String(diagnosis.reason);
}
