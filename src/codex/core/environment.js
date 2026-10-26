import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  discoverJava,
  discoverMaven,
  discoverNode,
  javaRoots,
  mavenRoots,
  mergeEnvironment,
  readPersistentEnvironment,
  probeTool,
} from './java/java-env.js';
import { componentArchive } from './environment-catalog.js';

export const environmentCacheRoot = (env = process.env) =>
  path.join(env.USERPROFILE || env.HOME || os.homedir(), '.specgate', 'toolchains');
const failed = (code, message) => ({ ok: false, environmentReady: false, code, message });

// 只读读取有限大小 JSON；状态查询不创建任何状态文件。
export function readEnvironmentJson(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function projectEnvironmentSelection(root, selection = {}) {
  const profile = readEnvironmentJson(path.join(root, '.specgate/codex/project.json'));
  const monorepo = readEnvironmentJson(path.join(root, '.specgate/monorepo.json'));
  const style = readEnvironmentJson(path.join(root, '.specgate/template-style.json'));
  let inferredPreset;
  try {
    const pomPath = path.join(root, 'backend/pom.xml');
    if (fs.statSync(pomPath).size < 1024 * 1024) {
      const pom = fs.readFileSync(pomPath, 'utf8');
      const major =
        /<(?:java.version|maven.compiler.release|maven.compiler.source)>\s*(?:1\.)?(8|17|21)\s*</.exec(
          pom,
        )?.[1];
      const boot =
        /<artifactId>spring-boot-starter-parent<\/artifactId>\s*<version>(2\.7|3\.5)\./.exec(
          pom,
        )?.[1];
      if (major && boot) inferredPreset = `jdk${major}-boot${boot}`;
    }
  } catch {
    /* 新项目尚无 pom。 */
  }
  const frontendPackage = readEnvironmentJson(path.join(root, 'frontend/package.json'));
  const dependencies = { ...frontendPackage?.dependencies, ...frontendPackage?.devDependencies };
  const inferredFrontend = dependencies.vue ? 'vue' : dependencies.react ? 'react' : undefined;
  const configured = {
    preset: profile?.javaPreset || monorepo?.preset || style?.preset || inferredPreset,
    frontend:
      profile?.frontendFramework ||
      monorepo?.frontendFramework ||
      style?.frontendFramework ||
      inferredFrontend,
  };
  if (
    (configured.preset && selection.preset && configured.preset !== selection.preset) ||
    (configured.frontend && selection.frontend && configured.frontend !== selection.frontend)
  )
    return { conflict: true };
  return {
    preset: configured.preset || selection.preset,
    frontend: configured.frontend || selection.frontend,
  };
}

export function managedEnvironment({
  env = process.env,
  platform = process.platform,
  cacheRoot = environmentCacheRoot(env),
} = {}) {
  const persistent = readPersistentEnvironment({ env, platform });
  const merged = mergeEnvironment({ ...persistent, env, platform });
  let dirs = [];
  try {
    dirs = fs
      .readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^node-/.test(entry.name))
      .slice(0, 16)
      .map((entry) => path.join(cacheRoot, entry.name, platform === 'win32' ? '' : 'bin'));
  } catch {
    /* 首次使用无缓存。 */
  }
  merged.PATH = [...dirs, merged.PATH].filter(Boolean).join(platform === 'win32' ? ';' : ':');
  return merged;
}

export function discoverEnvironment({
  root,
  selection,
  env = process.env,
  platform = process.platform,
  cacheRoot = environmentCacheRoot(env),
} = {}) {
  const merged = managedEnvironment({ env, platform, cacheRoot });
  const projectCache = path.join(root, '.specgate/toolchains');
  const java = discoverJava({
    env: merged,
    platform,
    roots: [cacheRoot, projectCache, ...javaRoots({ env: merged, platform })],
  }).homes.find(
    (entry) => entry.major === Number(/jdk(8|17|21)-/.exec(selection.preset || '')?.[1]),
  );
  const javaEnv = { ...merged, ...(java ? { JAVA_HOME: java.home, SG_JAVA_HOME: java.home } : {}) };
  const maven = discoverMaven({
    env: javaEnv,
    platform,
    roots: [cacheRoot, projectCache, ...mavenRoots({ env: javaEnv, platform })],
  });
  const node = discoverNode({ env: merged, platform });
  const gitVersion = /git version ([\w.-]+)/.exec(
    probeTool('git', ['--version'], 4000, merged),
  )?.[1];
  const gitPath = String(merged.PATH || '')
    .split(platform === 'win32' ? ';' : ':')
    .map((dir) => path.join(dir, platform === 'win32' ? 'git.exe' : 'git'))
    .find((file) => fs.existsSync(file));
  return {
    git: gitVersion ? { version: gitVersion, path: gitPath || 'git' } : null,
    node,
    java,
    maven,
  };
}

export function planEnvironment({
  selection = {},
  tools = {},
  platform = process.platform,
  arch = process.arch,
  source = 'domestic',
} = {}) {
  if (!['win32', 'linux'].includes(platform) || arch !== 'x64')
    return failed('ENV_PLATFORM_UNSUPPORTED', '当前仅支持 Windows/Linux x64');
  if (selection.conflict)
    return failed('ENV_STACK_CONFLICT', '输入技术栈与项目记录不一致，请保留项目技术栈');
  const major = /^jdk(8|17|21)-boot(?:2\.7|3\.5)$/.exec(selection.preset || '')?.[1];
  if (
    !major ||
    !['jdk8-boot2.7', 'jdk17-boot3.5', 'jdk21-boot3.5'].includes(selection.preset) ||
    !['vue', 'react'].includes(selection.frontend)
  )
    return failed(
      'ENV_STACK_REQUIRED',
      '请先选择或确认当前项目的 JDK/Spring Boot 和 Vue/React 技术栈',
    );
  const required = ['git', 'node', `jdk${major}`, 'maven'];
  const found = {
    git: tools.git || null,
    node: tools.node || null,
    [`jdk${major}`]: Number(tools.java?.major) === Number(major) ? tools.java : null,
    maven: tools.maven || null,
  };
  const missing = required.filter((id) => !found[id]);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ selection, platform, arch, found }))
    .digest('hex');
  return {
    ok: true,
    environmentReady: missing.length === 0,
    status: missing.length ? 'blocked' : 'ready',
    platform,
    arch,
    selection,
    required,
    missing,
    tools: found,
    fingerprint,
    source,
    plan: required.map((id) => ({
      id,
      action: found[id] ? 'reuse' : 'install',
      current: found[id],
      ...(!found[id] ? { archive: componentArchive(id, { platform, source }) } : {}),
    })),
    message: missing.length
      ? `缺少：${missing.join('、')}。通过环境准备入口补齐后重新验证。`
      : '当前项目所需工具链真实版本探测通过。项目基线和业务验证需分别执行。',
    workflowVerification: 'not-run',
  };
}

export function createEnvironmentService({
  root,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  discover = discoverEnvironment,
  install,
  consent,
  cacheRoot = environmentCacheRoot(env),
} = {}) {
  let latest = null;
  const check = async (input = {}) => {
    const selection = projectEnvironmentSelection(root, input);
    const source = input.source || 'domestic';
    // 参数/平台不合法时，不能先进行系统发现或创建目录。
    const initial = planEnvironment({ selection, platform, arch, source });
    if (!initial.ok)
      return (latest = {
        ...initial,
        projectRoot: path.resolve(root),
        checkedAt: new Date().toISOString(),
      });
    const tools = await discover({ root, selection, env, platform, cacheRoot });
    latest = {
      ...planEnvironment({ selection, tools, platform, arch, source }),
      projectRoot: path.resolve(root),
      checkedAt: new Date().toISOString(),
    };
    return latest;
  };
  return {
    check,
    inspect: () => latest || { status: 'not-checked', environmentReady: false },
    async prepare(input = {}, { signal } = {}) {
      const before = await check(input);
      if (!before.ok || before.environmentReady) return before;
      if (typeof consent !== 'function' || !(await consent(before, { signal })))
        return {
          ...before,
          ok: false,
          code: 'ENV_INSTALL_CONSENT_REQUIRED',
          message: '尚未取得可信安装确认；保持阻塞，未执行安装。',
        };
      const completed = [];
      try {
        for (const id of before.missing) {
          if (signal?.aborted)
            throw Object.assign(new Error('环境准备已取消'), { code: 'CANCELLED' });
          const current = await check(input);
          if (!current.missing.includes(id)) continue;
          const installer =
            install || (await import('./environment-install.js')).installEnvironmentComponent;
          const result = await installer(id, {
            cacheRoot,
            env,
            platform,
            source: before.source,
            signal,
            javaHome: current.tools[`jdk${/jdk(\d+)/.exec(before.selection.preset)[1]}`]?.home,
          });
          completed.push({ id, ...result });
          if (!result?.ok)
            return {
              ...current,
              ok: false,
              code: result?.code || 'ENV_INSTALL_FAILED',
              completed,
              message: result?.message || '安装失败，工作流仍阻塞',
            };
        }
        const after = await check(input);
        return {
          ...after,
          ok: after.environmentReady,
          ...(after.environmentReady ? {} : { code: 'ENV_VERIFICATION_FAILED' }),
          completed,
        };
      } catch (error) {
        latest = {
          ...before,
          ok: false,
          environmentReady: false,
          status: 'blocked',
          code: error.code || 'ENV_INSTALL_FAILED',
          message: signal?.aborted ? '环境准备已取消' : error.message,
          completed,
          cleanup: error.cleanupError ? 'failed' : 'completed',
        };
        return latest;
      }
    },
  };
}
