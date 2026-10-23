import fs from 'node:fs';
import path from 'node:path';
import { withTemporaryDirectory } from './temp.js';

export function dependencyMirrors({ source = 'domestic', env = process.env } = {}) {
  const npm =
    source === 'official'
      ? 'https://registry.npmjs.org'
      : env.SG_NPM_REGISTRY || 'https://registry.npmmirror.com';
  const maven =
    source === 'official'
      ? 'https://repo.maven.apache.org/maven2'
      : env.SG_MAVEN_MIRROR || 'https://maven.aliyun.com/repository/public';
  for (const url of [npm, maven]) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      /[<>&"']/.test(url)
    )
      throw new Error('依赖镜像必须使用无凭据的 HTTPS 地址');
  }
  return { source, npm, maven };
}

export function withEnvironmentMirrors(
  { env = process.env, source = env.SPECGATE_ENV_SOURCE || 'domestic' } = {},
  callback,
) {
  const mirrors = dependencyMirrors({ env, source });
  return withTemporaryDirectory('sg-env-mirrors-', async (directory) => {
    const npmrc = path.join(directory, 'npmrc');
    const mavenSettings = path.join(directory, 'settings.xml');
    fs.writeFileSync(npmrc, `registry=${mirrors.npm}\n`);
    fs.writeFileSync(
      mavenSettings,
      `<?xml version="1.0" encoding="UTF-8"?>\n<settings><mirrors><mirror><id>specgate-session</id><mirrorOf>central</mirrorOf><url>${mirrors.maven}</url></mirror></mirrors></settings>\n`,
    );
    return callback({
      mirrors,
      mavenSettings,
      env: {
        ...env,
        NPM_CONFIG_USERCONFIG: npmrc,
        npm_config_registry: mirrors.npm,
        NPM_CONFIG_REGISTRY: mirrors.npm,
      },
    });
  });
}
