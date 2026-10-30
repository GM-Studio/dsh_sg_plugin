import fs from 'node:fs';
import path from 'node:path';
import { insideSpecGateSource } from './project-path.js';

const failure = (code, message) => ({ ok: false, code, message });

export function environmentProjectTarget(value) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.includes('\0') ||
    value.split(/[\\/]/).includes('..')
  )
    throw Object.assign(new Error('项目目录必须为无父目录跳转的绝对路径'), {
      code: 'UNSAFE_PROJECT_PATH',
    });
  const target = path.resolve(value);
  if (target === path.parse(target).root || insideSpecGateSource(target))
    throw Object.assign(new Error('不能在文件系统根或插件源码/缓存中准备业务项目'), {
      code: 'PROJECT_SOURCE_FORBIDDEN',
    });
  for (let current = target; ; current = path.dirname(current)) {
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Object.assign(new Error('项目目录不能经过链接或文件'), {
          code: 'UNSAFE_PROJECT_PATH',
        });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current === path.dirname(current)) break;
  }
  return target;
}

// This entry prepares an environment, independently of optional business templates.
export async function selectEnvironmentProject({
  requestPeer,
  trustedUserIdentity,
  projectRoot,
  initialPath,
  draft,
  reset,
  signal,
}) {
  if (reset) delete draft.environment;
  if (draft.environment && (!initialPath || path.resolve(initialPath) === draft.environment.root))
    return { ok: true, ...draft.environment };
  if (!trustedUserIdentity || typeof requestPeer !== 'function')
    return failure('PROJECT_FORM_UNAVAILABLE', '需要可信宿主表单选择新项目目录和技术栈');
  const response = await requestPeer(
    'elicitation/create',
    {
      message:
        '选择新项目环境。仅准备目录和工具链，不生成业务模板；缺项须另行批准安装，环境就绪不代表项目验收通过。',
      requestedSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            title: '项目绝对路径',
            default: initialPath || projectRoot || '',
            minLength: 1,
            maxLength: 32768,
          },
          preset: {
            type: 'string',
            title: '后端技术栈',
            enum: ['jdk8-boot2.7', 'jdk17-boot3.5', 'jdk21-boot3.5'],
          },
          frontend: { type: 'string', title: '前端技术栈', enum: ['vue', 'react'] },
        },
        required: ['path', 'preset', 'frontend'],
        additionalProperties: false,
      },
    },
    { signal, allowUnadvertised: true },
  );
  if (signal?.aborted || response?.action !== 'accept')
    return failure('PROJECT_SELECTION_CANCELLED', '未确认新项目环境，未创建目录');
  const input = response.content;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['path', 'preset', 'frontend'].includes(key)) ||
    !['jdk8-boot2.7', 'jdk17-boot3.5', 'jdk21-boot3.5'].includes(input.preset) ||
    !['vue', 'react'].includes(input.frontend)
  )
    return failure('PROJECT_SELECTION_INVALID', '技术栈必须由用户明确选择');
  const root = environmentProjectTarget(input.path);
  fs.mkdirSync(root, { recursive: true });
  const selection = { preset: input.preset, frontend: input.frontend };
  draft.environment = { root, selection };
  return { ok: true, root, selection };
}
