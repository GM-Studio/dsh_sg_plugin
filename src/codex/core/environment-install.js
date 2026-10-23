import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { withTemporaryDirectory, removeTemporaryDirectory } from './temp.js';
import { componentArchive } from './environment-catalog.js';
import { runEnvironmentCommand } from './environment-process.js';
import { probeTool } from './java/java-env.js';

export function verifyArchive(file, { algorithm, checksum }) {
  const hash = createHash(algorithm);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)))
      hash.update(buffer.subarray(0, count));
  } finally {
    fs.closeSync(fd);
  }
  if (hash.digest('hex') !== checksum)
    throw Object.assign(new Error('下载文件校验失败'), { code: 'ENV_CHECKSUM_FAILED' });
  return { ok: true, algorithm, checksum };
}

export function recoverEnvironmentStages(cacheRoot) {
  let entries;
  try {
    entries = fs.readdirSync(cacheRoot, { withFileTypes: true }).slice(0, 128);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^sg-env-[A-Za-z0-9]+$/.test(entry.name)) continue;
    const directory = path.join(cacheRoot, entry.name);
    let owner;
    try {
      const marker = path.join(directory, 'owner.json');
      if (fs.lstatSync(marker).isSymbolicLink() || fs.statSync(marker).size > 1024) continue;
      owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
    } catch {
      continue;
    }
    if (owner.kind !== 'specgate-environment' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
      continue;
    try {
      process.kill(owner.pid, 0);
      continue;
    } catch (error) {
      if (error.code !== 'ESRCH') continue;
    }
    removeTemporaryDirectory(directory);
  }
}

function toolHome(root, id, platform) {
  const marker =
    id === 'node'
      ? platform === 'win32'
        ? 'node.exe'
        : 'bin/node'
      : id === 'maven'
        ? platform === 'win32'
          ? 'bin/mvn.cmd'
          : 'bin/mvn'
        : platform === 'win32'
          ? 'bin/javac.exe'
          : 'bin/javac';
  if (fs.existsSync(path.join(root, marker))) return root;
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).slice(0, 64))
    if (entry.isDirectory() && fs.existsSync(path.join(root, entry.name, marker)))
      return path.join(root, entry.name);
  throw Object.assign(new Error('归档中缺少工具入口'), { code: 'ENV_ARCHIVE_INVALID' });
}

export async function installEnvironmentComponent(
  id,
  {
    cacheRoot,
    platform = process.platform,
    source = 'domestic',
    env = process.env,
    signal,
    fetchImpl = fetch,
    run = runEnvironmentCommand,
    javaHome,
  } = {},
) {
  const archive = componentArchive(id, { platform, source, env });
  if (!archive)
    return {
      ok: false,
      code: 'ENV_HOST_INSTALL_REQUIRED',
      message: `${id} 需要由 Codex 在当前会话内请求宿主执行原生安装，再重新预检。`,
    };
  for (let ancestor = path.resolve(cacheRoot); ; ancestor = path.dirname(ancestor)) {
    try {
      const stat = fs.lstatSync(ancestor);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error('工具链缓存路径不能经过符号链接或文件');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (path.dirname(ancestor) === ancestor) break;
  }
  fs.mkdirSync(cacheRoot, { recursive: true });
  if (fs.lstatSync(cacheRoot).isSymbolicLink()) throw new Error('工具链缓存不能是符号链接');
  recoverEnvironmentStages(cacheRoot);
  return withTemporaryDirectory(
    'sg-env-',
    async (stage) => {
      fs.writeFileSync(
        path.join(stage, 'owner.json'),
        JSON.stringify({ kind: 'specgate-environment', pid: process.pid }),
      );
      const timeoutSignal = AbortSignal.timeout(15 * 60 * 1000);
      const activeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const response = await fetchImpl(archive.url, { signal: activeSignal });
      if (!response.ok || !response.body)
        throw Object.assign(new Error(`下载失败 HTTP ${response.status}；可显式选择官方源后重试`), {
          code: 'ENV_DOWNLOAD_FAILED',
        });
      const file = path.join(stage, archive.name);
      let bytes = 0;
      const limit = new Transform({
        transform(chunk, encoding, done) {
          bytes += chunk.length;
          done(bytes > 512 * 1024 * 1024 ? new Error('下载超过大小限制') : null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body),
        limit,
        fs.createWriteStream(file, { flags: 'wx' }),
        { signal: activeSignal },
      );
      verifyArchive(file, archive);
      const listing = await run('tar', ['-tf', file], {
        env,
        signal: activeSignal,
        timeout: 30000,
      });
      if (
        !listing.ok ||
        listing.output
          .split(/\r?\n/)
          .some((entry) => /(^[/\\]|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$))/.test(entry))
      )
        throw Object.assign(new Error('归档路径校验失败或缺少 tar'), {
          code: 'ENV_ARCHIVE_INVALID',
        });
      const extracted = path.join(stage, 'extracted');
      fs.mkdirSync(extracted);
      const extraction = await run('tar', ['-xf', file, '-C', extracted], {
        env,
        signal: activeSignal,
        timeout: 600000,
      });
      if (!extraction.ok)
        throw Object.assign(new Error('工具链解压失败'), { code: 'ENV_EXTRACT_FAILED' });
      const home = toolHome(extracted, id, platform);
      const probeEnv = { ...env, ...(javaHome ? { JAVA_HOME: javaHome } : {}) };
      const bin =
        id === 'node'
          ? path.join(home, platform === 'win32' ? 'node.exe' : 'bin/node')
          : path.join(
              home,
              'bin',
              id === 'maven'
                ? platform === 'win32'
                  ? 'mvn.cmd'
                  : 'mvn'
                : platform === 'win32'
                  ? 'javac.exe'
                  : 'javac',
            );
      const output = probeTool(
        bin,
        [id === 'maven' || id === 'node' ? '-v' : '-version'],
        15000,
        probeEnv,
      );
      const valid =
        id === 'node'
          ? /v22\.22\.0/.test(output)
          : id === 'maven'
            ? /Apache Maven 3\.9\.11/.test(output)
            : new RegExp(`javac (?:1\\.)?${id.slice(3)}[._]`).test(output);
      if (!valid)
        throw Object.assign(new Error('解压后的真实版本探测失败'), {
          code: 'ENV_VERIFICATION_FAILED',
        });
      const target = path.join(cacheRoot, `${id}-${archive.version}`);
      if (fs.existsSync(target))
        throw Object.assign(new Error('目标目录已存在但未通过发现；请保留并诊断该目录'), {
          code: 'ENV_TARGET_CONFLICT',
        });
      fs.renameSync(home, target);
      return {
        ok: true,
        id,
        version: archive.version,
        location: target,
        source,
        url: archive.url,
        resolvedUrl: response.url || archive.url,
        integrity: {
          algorithm: archive.algorithm,
          checksum: archive.checksum,
          metadata: archive.metadata,
        },
        cleanup: 'completed',
      };
    },
    { parent: cacheRoot },
  );
}
