import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Read identity only. Never inherit repository redirects or command-level config injection.
export function resolveGitIdentity({ root, gitName, gitEmail, env = process.env } = {}) {
  let cwd = path.resolve(root || process.cwd());
  for (let depth = 0; !fs.existsSync(cwd) && depth < 128; depth++) cwd = path.dirname(cwd);
  const environment = Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
  );
  for (const key of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_NOSYSTEM'])
    if (env[key] !== undefined) environment[key] = env[key];
  const config = (key) => {
    const result = spawnSync('git', ['config', '--get', key], {
      cwd,
      env: environment,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    return result.status === 0 ? result.stdout.trim() : '';
  };
  const name = gitName ?? env.GIT_AUTHOR_NAME ?? config('user.name');
  const email = gitEmail ?? env.GIT_AUTHOR_EMAIL ?? config('user.email');
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    /[\r\n<>\0]/.test(name) ||
    typeof email !== 'string' ||
    !/^[^\s<>@]+@[^\s<>@]+$/.test(email)
  )
    return {
      ok: false,
      code: 'GIT_IDENTITY_REQUIRED',
      message:
        '请填写 Git 用户名和邮箱，或复用环境中的 git config user.name / user.email；不会使用 SpecGate 默认身份。',
    };
  return { ok: true, name: name.trim(), email: email.trim() };
}
