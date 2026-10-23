import path from 'node:path';
import fs from 'node:fs';
import { executeInit, previewInit } from './init.js';
import { createNativeInitConsent } from './init-consent.js';
import { checkedProjectRoot } from './project-state.js';
import { setupProject } from '../../scripts/codex-source-setup.mjs';
import { resolveGitIdentity } from './core/git-identity.js';
import { insideSpecGateSource } from './core/project-path.js';

const field = (title) => ({ type: 'string', title, minLength: 1, maxLength: 1024 });
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
      '打开中文新建项目表单，让用户选择目录、包名、JDK/Spring Boot、Vue/React 和 Git 身份，确认预览后自动生成并安装 Agent 与 Skill。完成验证后停在就绪，等待用户业务需求。',
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

export function bindProject(value) {
  if (!path.isAbsolute(value || ''))
    throw Object.assign(new Error('请提供业务项目的绝对路径。'), { code: 'UNSAFE_PROJECT_PATH' });
  if (path.resolve(value) === path.parse(path.resolve(value)).root)
    throw Object.assign(new Error('不能把文件系统根目录绑定为业务项目。'), {
      code: 'UNSAFE_PROJECT_PATH',
    });
  return checkedProjectRoot(value);
}

export function installProject(root) {
  return setupProject({ project: bindProject(root) });
}

export const NONEMPTY_KEEP = '保留已有文件，只补齐缺失文件';
export const NONEMPTY_CHILD = '在业务同名子目录中新建';
export const STACK_CHOICES = {
  'JDK 8 + Spring Boot 2.7（兼容旧项目）': 'jdk8-boot2.7',
  'JDK 17 + Spring Boot 3.5（通用项目）': 'jdk17-boot3.5',
  'JDK 21 + Spring Boot 3.5（较新项目）': 'jdk21-boot3.5',
};
const FRONTEND_CHOICES = { 'Vue 3（管理后台）': 'vue', 'React 18（管理后台）': 'react' };

function existingProject(root) {
  if (!fs.existsSync(root)) return null;
  if (fs.existsSync(path.join(root, '.specgate/init-report.json')))
    return {
      ok: true,
      root,
      projectRoot: root,
      alreadyInitialized: true,
      generated: false,
      nextAction: 'VERIFY_PROJECT_THEN_WAIT_FOR_USER_REQUIREMENTS',
      message:
        '该目录已生成项目，无需重新填写或创建。继续验证并建立基线；基线就绪后等待你的业务需求。',
    };
  if (
    fs.existsSync(path.join(root, 'backend/pom.xml')) &&
    fs.existsSync(path.join(root, 'frontend/package.json'))
  )
    return {
      ok: true,
      root,
      projectRoot: root,
      generated: false,
      nextAction: 'ADOPT_EXISTING_PROJECT',
      message:
        '检测到已有业务工程，保留原文件并转入项目接入，不混入新模板，不重新选择技术栈。下一步执行只读接入预览。',
    };
  return null;
}

export async function createProjectInteractively({
  requestPeer,
  peerCapabilities,
  trustedUserIdentity,
  projectRoot,
  signal,
  draft = {},
  initialPath,
  reset = false,
}) {
  if (reset) {
    delete draft.input;
    delete draft.policy;
    delete draft.approvalProvider;
  }
  const selectedRoot =
    typeof initialPath === 'string' && initialPath.trim()
      ? initialPath.trim()
      : draft.input?.root || projectRoot;
  if (!path.isAbsolute(selectedRoot))
    return {
      ok: false,
      code: 'UNSAFE_INIT_PATH',
      message: '项目目录必须是绝对路径；留空时使用当前仓库。',
    };
  // 插件源码或缓存目录不是业务项目：此时路径必须显式填写，不能默认留空。
  const pluginDirectory = insideSpecGateSource(selectedRoot);
  const existing = existingProject(selectedRoot);
  if (existing) return existing;
  if (
    peerCapabilities?.().elicitationSupported !== true ||
    !trustedUserIdentity ||
    typeof requestPeer !== 'function'
  )
    return {
      ok: false,
      code: 'PROJECT_FORM_UNAVAILABLE',
      status: 'WAITING_FOR_USER',
      message:
        '当前宿主未提供可信表单。请使用支持表单的宿主，或按用户明确给出的目录和技术栈继续；不能代替用户确认。',
    };
  if (!draft.input) {
    const identity = resolveGitIdentity({ root: pluginDirectory ? undefined : selectedRoot });
    const properties = {
      path: pluginDirectory
        ? {
            type: 'string',
            title: '业务项目绝对路径（必填：当前目录是 SpecGate 插件目录，不能作为业务项目）',
            description: '请填写目标业务项目的绝对路径，例如 D:\\projects\\my-app。',
            minLength: 1,
            maxLength: 32768,
          }
        : {
            type: 'string',
            title: '项目绝对路径（可留空，使用当前仓库）',
            description: '留空使用：' + selectedRoot,
            default: selectedRoot,
            maxLength: 32768,
          },
      company: { ...field('公司包名（小写字母与数字）'), pattern: '^[a-z][a-z0-9]{1,62}$' },
      business: { ...field('业务包名（小写字母与数字）'), pattern: '^[a-z][a-z0-9]{1,62}$' },
      preset: {
        type: 'string',
        title: '后端技术栈（请亲自选择）',
        enum: Object.keys(STACK_CHOICES),
      },
      frontend: {
        type: 'string',
        title: '前端框架（请亲自选择）',
        enum: Object.keys(FRONTEND_CHOICES),
      },
      nonempty: {
        type: 'string',
        title: '目录非空时如何处理',
        enum: [NONEMPTY_KEEP, NONEMPTY_CHILD, '取消创建'],
        default: NONEMPTY_KEEP,
      },
      ...(!identity.ok ? { gitName: field('提交用户名'), gitEmail: field('提交邮箱') } : {}),
      confirm: {
        type: 'boolean',
        title: '确认以上选择：保留原文件，补齐项目并建立仅包含生成文件的本地提交',
        default: false,
      },
    };
    const response = await requestPeer(
      'elicitation/create',
      {
        message:
          'SpecGate 项目准备：只需填写并确认这一次。' +
          (pluginDirectory
            ? '当前会话目录是 SpecGate 插件目录，必须填写业务项目绝对路径。'
            : '路径留空使用当前仓库：' + selectedRoot + '。') +
          '确认后生成所选脚手架并安装项目环境；非空目录按你的保留策略处理。默认本地管理员账号：admin，密码：admin；验证就绪后等待你提出业务需求。' +
          (identity.ok ? '\n复用提交身份：' + identity.name + ' <' + identity.email + '>' : ''),
        requestedSchema: {
          type: 'object',
          properties,
          required: Object.keys(properties).filter(
            (key) => !['nonempty', ...(pluginDirectory ? [] : ['path'])].includes(key),
          ),
          additionalProperties: false,
        },
      },
      { signal },
    );
    if (response?.action !== 'accept' || response.content?.confirm !== true)
      return { ok: false, code: 'INIT_CANCELLED', message: '尚未确认，未创建项目。' };
    const args = response.content;
    if (
      !args ||
      typeof args !== 'object' ||
      Array.isArray(args) ||
      Object.keys(args).some((key) => !Object.hasOwn(properties, key)) ||
      [
        'company',
        'business',
        'preset',
        'frontend',
        ...(!identity.ok ? ['gitName', 'gitEmail'] : []),
      ].some((key) => typeof args[key] !== 'string' || !args[key].trim())
    )
      return {
        ok: false,
        code: 'INVALID_ARGUMENT',
        message: '请完整填写包名与技术栈。目录可以留空。',
      };
    const policy = args.nonempty || NONEMPTY_KEEP;
    if (policy === '取消创建')
      return { ok: false, code: 'INIT_CANCELLED', message: '已取消，未创建项目。' };
    const preset = STACK_CHOICES[args.preset];
    const frontend = FRONTEND_CHOICES[args.frontend];
    if (!preset || !frontend || ![NONEMPTY_KEEP, NONEMPTY_CHILD].includes(policy))
      return {
        ok: false,
        code: 'INVALID_ARGUMENT',
        message: '请选择表单提供的中文技术栈与目录处理选项。',
      };
    const rawPath =
      typeof args.path === 'string' && args.path.trim() ? args.path.trim() : selectedRoot;
    if (pluginDirectory && rawPath === selectedRoot)
      return {
        ok: false,
        code: 'INIT_SOURCE_TARGET_FORBIDDEN',
        message: 'SpecGate 插件目录不能作为业务项目；请填写业务项目的绝对路径后重试。',
      };
    if (!path.isAbsolute(rawPath))
      return {
        ok: false,
        code: 'UNSAFE_INIT_PATH',
        message: '请填写绝对路径，或留空使用当前仓库。',
      };
    let root = path.resolve(rawPath);
    if (policy === NONEMPTY_CHILD && fs.existsSync(root) && fs.readdirSync(root).length) {
      if (!/^[a-z][a-z0-9]{1,62}$/.test(args.business))
        return {
          ok: false,
          code: 'PROJECT_NAMESPACE_INVALID',
          message: '业务包名必须是合法的小写包片段。',
        };
      root = path.join(root, args.business);
    }
    draft.input = {
      root,
      company: args.company,
      business: args.business,
      preset,
      frontend,
      gitName: identity.ok ? identity.name : args.gitName,
      gitEmail: identity.ok ? identity.email : args.gitEmail,
    };
    draft.policy = policy;
    draft.approvalProvider = createNativeInitConsent({
      response,
      identity: trustedUserIdentity,
      root,
      preset,
      policy,
    });
  } else if (path.resolve(selectedRoot) !== draft.input.root) {
    if (pluginDirectory)
      return {
        ok: false,
        code: 'INIT_SOURCE_TARGET_FORBIDDEN',
        message:
          'SpecGate 插件目录不能作为业务项目；请提供业务项目绝对路径，已保留原包名与技术栈选择。',
      };
    // A changed directory needs fresh consent, but never asks for stack fields again.
    const response = await requestPeer(
      'elicitation/create',
      {
        message: '仅修正项目目录，保留已选择的包名和技术栈。新目录：' + selectedRoot,
        requestedSchema: {
          type: 'object',
          properties: {
            confirm: { type: 'boolean', title: '确认改用此目录，继续保留已有文件', default: false },
          },
          required: ['confirm'],
        },
      },
      { signal },
    );
    if (response?.action !== 'accept' || response.content?.confirm !== true)
      return { ok: false, code: 'INIT_CANCELLED', message: '未确认目录变更，原选择已保留。' };
    draft.input.root = path.resolve(selectedRoot);
    draft.approvalProvider = createNativeInitConsent({
      response,
      identity: trustedUserIdentity,
      root: draft.input.root,
      preset: draft.input.preset,
      policy: draft.policy,
    });
  }
  const continuation = existingProject(draft.input.root);
  if (continuation) return continuation;
  const preview = previewInit(draft.input);
  if (!preview.ok)
    return {
      ...preview,
      selectionRetained: true,
      message:
        preview.message +
        ' 已保留本次包名与技术栈，修正目录后重试即可，不要重新填写或擅自更换目录。',
    };
  const created = await executeInit(
    { ...draft.input, previewHash: preview.previewHash },
    { approvalProvider: draft.approvalProvider, signal, allowExistingGit: true },
  );
  return {
    ...created,
    selectionRetained: true,
    ...(!created.ok
      ? {
          message:
            created.message + ' 已保留技术栈选择，修正目录或权限后重试，不会再次弹出整张表单。',
        }
      : {}),
  };
}
