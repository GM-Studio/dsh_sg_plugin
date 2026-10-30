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
          stack: {
            type: 'string',
            title: '主要技术栈',
            enum: ['node', 'python', 'go', 'java'],
          },
          javaVersion: {
            type: 'string',
            title: 'Java主版本（Java项目填写）',
            pattern: '^\\d{1,2}$',
          },
          nodeVersion: { type: 'string', title: 'Node版本约束（可选）', maxLength: 160 },
          pythonVersion: { type: 'string', title: 'Python版本约束（可选）', maxLength: 160 },
          goVersion: { type: 'string', title: 'Go版本约束（可选）', maxLength: 160 },
          packageManager: {
            type: 'string',
            title: '前端包管理器（可选）',
            enum: ['npm', 'pnpm', 'yarn'],
          },
          frontend: {
            type: 'string',
            title: '前端（纯后端选none）',
            enum: ['none', 'vue', 'react'],
          },
        },
        required: ['path', 'stack', 'frontend'],
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
    Object.keys(input).some(
      (key) =>
        ![
          'path',
          'stack',
          'preset',
          'frontend',
          'javaVersion',
          'nodeVersion',
          'pythonVersion',
          'goVersion',
          'packageManager',
        ].includes(key),
    ) ||
    !(input.stack
      ? ['node', 'python', 'go', 'java'].includes(input.stack)
      : ['jdk8-boot2.7', 'jdk17-boot3.5', 'jdk21-boot3.5'].includes(input.preset)) ||
    !['none', 'vue', 'react'].includes(input.frontend) ||
    ['javaVersion', 'nodeVersion', 'pythonVersion', 'goVersion'].some(
      (key) =>
        input[key] !== undefined && (typeof input[key] !== 'string' || input[key].length > 160),
    ) ||
    (input.javaVersion && !/^\d{1,2}$/.test(input.javaVersion)) ||
    (input.packageManager && !['npm', 'pnpm', 'yarn'].includes(input.packageManager))
  )
    return failure('PROJECT_SELECTION_INVALID', '技术栈必须由用户明确选择');
  const root = environmentProjectTarget(input.path);
  fs.mkdirSync(root, { recursive: true });
  const selection = Object.fromEntries(
    Object.entries(input).filter(([key, value]) => key !== 'path' && value && value !== 'none'),
  );
  const configuration = path.join(root, '.specgate');
  if (
    fs.existsSync(configuration) &&
    (fs.lstatSync(configuration).isSymbolicLink() || !fs.lstatSync(configuration).isDirectory())
  )
    throw Object.assign(new Error('环境配置目录不安全'), { code: 'UNSAFE_PROJECT_PATH' });
  fs.mkdirSync(configuration, { recursive: true });
  const selectionFile = path.join(configuration, 'environment-selection.json');
  if (
    fs.existsSync(selectionFile) &&
    (fs.lstatSync(selectionFile).isSymbolicLink() ||
      !fs.lstatSync(selectionFile).isFile() ||
      fs.lstatSync(selectionFile).nlink > 1)
  )
    throw Object.assign(new Error('环境选择文件不安全'), { code: 'UNSAFE_PROJECT_PATH' });
  fs.writeFileSync(selectionFile, JSON.stringify({ schemaVersion: 1, selection }, null, 2) + '\n', {
    mode: 0o600,
  });
  draft.environment = { root, selection };
  return { ok: true, root, selection };
}
