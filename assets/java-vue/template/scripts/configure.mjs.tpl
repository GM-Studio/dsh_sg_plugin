import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 本地演示使用明确可知的账号；显式关闭演示模式时生成强密码，保留已有配置。
export function configure(root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  const file = resolve(root, '.env');
  if (existsSync(file)) return { file, created: false };
  const localDemo = process.env.APP_LOCAL_DEMO !== 'false';
  writeFileSync(file, [
    '# 本地演示：admin / admin，viewer / viewer；不要提交此文件。',
    'APP_LOCAL_DEMO=' + localDemo,
    'APP_ADMIN_PASSWORD=' + (process.env.APP_ADMIN_PASSWORD || (localDemo ? 'admin' : randomBytes(24).toString('base64url'))),
    'APP_VIEWER_PASSWORD=' + (process.env.APP_VIEWER_PASSWORD || (localDemo ? 'viewer' : randomBytes(24).toString('base64url'))),
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  return { file, created: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = configure();
  console.log(`本地配置${result.created ? '已创建' : '已存在'}：${result.file}。本地演示默认账号 admin / admin、viewer / viewer；已有自定义配置保持不变。`);
}
