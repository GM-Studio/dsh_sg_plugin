import path from 'node:path';
import { checkedProjectRoot } from '../project-state.js';

export function bindProject(value) {
  if (!path.isAbsolute(value || ''))
    throw Object.assign(new Error('请提供业务项目的绝对路径。'), { code: 'UNSAFE_PROJECT_PATH' });
  if (path.resolve(value) === path.parse(path.resolve(value)).root)
    throw Object.assign(new Error('不能把文件系统根目录绑定为业务项目。'), {
      code: 'UNSAFE_PROJECT_PATH',
    });
  return checkedProjectRoot(value);
}
