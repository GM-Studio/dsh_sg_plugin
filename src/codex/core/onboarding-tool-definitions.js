export const field = (title) => ({ type: 'string', title, minLength: 1, maxLength: 1024 });
export const ONBOARDING_TOOLS = [
  {
    name: 'sg_project_bind',
    description:
      '将当前 MCP 会话切换到指定业务项目；后续状态、需求与审批都使用此路径，不使用插件源码目录。',
    inputSchema: {
      type: 'object',
      properties: { path: field('业务项目绝对路径') },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'sg_project_setup',
    description:
      '自动安装业务项目所需的六个 Agent、可显式调用的中文 Skill 和项目 MCP 配置；保留已有配置及冲突文件。',
    inputSchema: {
      type: 'object',
      properties: { path: field('业务项目绝对路径') },
      additionalProperties: false,
    },
  },
  {
    name: 'sg_project_create',
    description:
      '打开中文新建项目表单选择目录、包名、技术栈和 Git 身份；先通过环境预检门禁再生成和配置 Agent/Skill。验证基线后等待需求，失败保留原选择。',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '可选项目目录；省略或留空使用当前仓库，不要擅自改为父目录。',
        },
        reset: { type: 'boolean', description: '仅用户要求重新选择时清除已填写的信息。' },
      },
      additionalProperties: false,
    },
  },
].map((entry) => ({
  ...entry,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: entry.name !== 'sg_project_create',
    openWorldHint: false,
  },
}));
