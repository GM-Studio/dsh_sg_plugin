const selection = {
  preset: { type: 'string', enum: ['jdk8-boot2.7', 'jdk17-boot3.5', 'jdk21-boot3.5'] },
  frontend: { type: 'string', enum: ['vue', 'react'] },
  source: { type: 'string', enum: ['domestic', 'official', 'custom'] },
};
export const ENVIRONMENT_TOOLS = [
  {
    name: 'sg_env_check',
    description:
      '只读预检当前项目所选技术栈，报告可复用工具、缺项、固定安装版本与环境门禁；不下载、不写入。',
    inputSchema: { type: 'object', properties: selection, additionalProperties: false },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'sg_env_prepare',
    description:
      '根据当前项目预检计划请求可信安装确认，按需补齐工具并真实复测。默认国内镜像，不修改全局配置；失败保持工作流阻塞。',
    inputSchema: { type: 'object', properties: selection, additionalProperties: false },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'sg_status',
    description:
      '只读汇总当前业务项目、环境检查、项目基线、Change/WorkItem、待审批和交付证据；不安装、不绑定、不恢复任务。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

export function environmentConsent({ requestPeer, peerCapabilities, trustedUserIdentity } = {}) {
  return async (plan, { signal } = {}) => {
    if (
      !trustedUserIdentity ||
      typeof requestPeer !== 'function' ||
      peerCapabilities?.().elicitationSupported !== true
    )
      return false;
    const response = await requestPeer(
      'elicitation/create',
      {
        message: `当前项目：${plan.projectRoot}\n技术栈：${plan.selection.preset} + ${plan.selection.frontend}\n可复用：${plan.plan
          .filter((entry) => entry.action === 'reuse')
          .map((entry) => entry.id)
          .join(
            '、',
          )}\n缺项安装计划：${JSON.stringify(plan.plan.filter((entry) => entry.action === 'install'))}\n安装到当前用户 .specgate/toolchains，不修改全局环境。确认后安装并重新验证；系统或宿主权限仍需正常授权。`,
        requestedSchema: {
          type: 'object',
          properties: {
            selection: {
              type: 'string',
              title: '确认此项目的缺项安装计划（提交即确认）',
              const: 'install',
            },
          },
          required: [],
          additionalProperties: false,
        },
      },
      { signal, allowUnadvertised: true },
    );
    // Submitting the form is the confirmation. A separate unchecked boolean was
    // the reason completed forms were still treated as cancelled.
    return response?.action === 'accept';
  };
}
