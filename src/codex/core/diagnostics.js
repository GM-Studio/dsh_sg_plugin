// Public diagnostics contain bounded codes and fixed guidance, never raw provider
// messages, stacks, URLs, credentials, argv, remote error data or arbitrary objects.
const read = (value, key) => {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
};
const codeOf = (value) =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : null;
const groups = {
  permission: ['EACCES', 'EPERM', 'ERR_ACCESS_DENIED'],
  storage: ['ENOSPC', 'EDQUOT', 'EIO', 'EBUSY', 'EMFILE', 'ENFILE'],
  dependency: [
    'ENOENT',
    'MODULE_NOT_FOUND',
    'ERR_MODULE_NOT_FOUND',
    'ERR_PACKAGE_PATH_NOT_EXPORTED',
  ],
  network: [
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ],
  authentication: [
    'AUTH_REQUIRED',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'ERR_MISSING_CREDENTIALS',
    'CODEX_AUTH_REQUIRED',
  ],
  timeout: ['ETIMEDOUT', 'COMMAND_TIMEOUT', 'PEER_TIMEOUT', 'APPROVAL_TIMEOUT'],
  unsupported: [
    'ELICITATION_UNSUPPORTED',
    'PEER_METHOD_UNSUPPORTED',
    'ROOTS_UNSUPPORTED',
    'APPROVAL_CHANNEL_UNSUPPORTED',
  ],
  cancelled: ['ABORT_ERR', 'PEER_CANCELLED', 'PEER_CLOSED', 'CANCELLED', 'APPROVAL_CANCELLED'],
  configuration: [
    'UNSAFE_PROJECT_PATH',
    'PROJECT_ROOT_MISSING',
    'PROJECT_SOURCE_FORBIDDEN',
    'UNSAFE_PATH',
    'HOST_CONFIG_INVALID',
    'ENOTDIR',
    'ERR_INVALID_ARG_VALUE',
    'ERR_INVALID_ARG_TYPE',
    'SYNTAX_ERROR',
  ],
  runtime: ['HOST_RUNTIME_UNSUPPORTED'],
};
const guidance = {
  permission: ['权限不足，操作未完成。', 'GRANT_PROJECT_ACCESS_AND_RETRY'],
  storage: ['存储空间、文件句柄或文件锁导致操作未完成。', 'CHECK_DISK_SPACE_AND_FILE_LOCKS'],
  dependency: ['缺少文件、命令或运行依赖，操作未完成。', 'CONFIGURE_REQUIRED_DEPENDENCY_AND_RETRY'],
  network: ['网络、代理或证书连接失败，操作未完成。', 'CHECK_NETWORK_PROXY_AND_CERTIFICATES'],
  authentication: ['缺少有效认证或授权，操作未完成。', 'AUTHENTICATE_IN_HOST_AND_RETRY'],
  timeout: ['操作超时，未记录成功。', 'CHECK_CURRENT_STATE_BEFORE_RETRY'],
  unsupported: ['宿主不支持所请求的通道，未取得批准。', 'RELOAD_HOST_OR_USE_SUPPORTED_CHANNEL'],
  cancelled: ['操作已取消或连接已关闭，未记录成功。', 'INSPECT_STATE_THEN_RESUME_OR_REISSUE'],
  configuration: ['配置、输入路径或元数据无效，操作未完成。', 'CORRECT_CONFIGURATION_AND_RESTART'],
  runtime: ['Node运行时不满足插件要求。', 'SELECT_SUPPORTED_NODE_AND_RESTART'],
  unknown: ['操作未完成；未公开不可信的原始错误内容。', 'REPORT_CODE_AND_STAGE_FOR_DIAGNOSIS'],
};
const publicCodes = new Set([
  ...Object.values(groups).flat(),
  'PEER_REJECTED',
  'PEER_INVALID_RESPONSE',
  'PEER_SEND_FAILED',
  'STORAGE_ERROR',
]);

export function diagnosticFailure(
  error,
  { stage = 'operation', code = 'TOOL_FAILED', message, preserveCode = false } = {},
) {
  stage = typeof stage === 'string' && /^[a-z][a-z0-9_.-]{0,95}$/.test(stage) ? stage : 'operation';
  const seen = new Set();
  let current = error,
    selected = { code: 'UNKNOWN', category: 'unknown' };
  for (let depth = 0; current && depth < 3 && !seen.has(current); depth++) {
    seen.add(current);
    const rpcCode = Number.isSafeInteger(read(current, 'rpcCode'))
      ? read(current, 'rpcCode')
      : Number.isSafeInteger(read(current, 'code'))
        ? read(current, 'code')
        : undefined;
    const candidate =
      codeOf(read(current, 'storageCode')) ||
      codeOf(read(current, 'code')) ||
      (read(current, 'name') === 'SyntaxError' ? 'SYNTAX_ERROR' : 'UNKNOWN');
    const rawCode = publicCodes.has(candidate) ? candidate : 'UNKNOWN';
    let category =
      Object.entries(groups).find(([, codes]) => codes.includes(rawCode))?.[0] || 'unknown';
    if (rpcCode === -32601) category = 'unsupported';
    else if ([401, 403].includes(read(current, 'status'))) category = 'authentication';
    if (stage === 'bootstrap.project-binding' && ['ENOENT', 'ENOTDIR'].includes(rawCode))
      category = 'configuration';
    if (stage === 'bootstrap.config' && category === 'unknown') category = 'configuration';
    if (depth === 0 || category !== 'unknown')
      selected = { code: rawCode, category, ...(rpcCode === undefined ? {} : { rpcCode }) };
    if (category !== 'unknown') break;
    current = read(current, 'cause');
  }
  const [detail, retryAction] = guidance[selected.category];
  return {
    ok: false,
    code:
      preserveCode && selected.code !== 'UNKNOWN' ? selected.code : codeOf(code) || 'TOOL_FAILED',
    stage,
    message: message || detail,
    cause: { ...selected, message: detail },
    retryAction,
  };
}

export function diagnosticToolResult(error, options) {
  const data = diagnosticFailure(error, options);
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}
