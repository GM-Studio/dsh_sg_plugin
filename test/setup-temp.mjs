/**
 * 测试临时目录隔离 + 自动清理。
 *
 * 背景：test/ 下 70+ 个用例用 fs.mkdtempSync(path.join(os.tmpdir(), 'sg-xxx-'))
 * 建临时工作区，但从不删除。反复跑 npm test / npm run gate 时会在
 * C:\Users\<user>\AppData\Local\Temp 下堆积数万个目录、数百万文件，
 * 进而拖垮 Windows 登录（User Profile Service 遍历 %TEMP% 需数分钟）。
 *
 * 做法：把本次测试进程的 TEMP/TMP/TMPDIR 全部重定向到一个带所有权标记的
 * 专用根目录，所有 test workers 复用同一目录，owner 退出时整棵树删除；下次
 * 启动只回收 owner 已不存在的已标记目录。用例代码无需改动。
 *
 * 由 package.json 的 test 脚本以 --import 方式加载。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTemporaryDirectory, removeTemporaryDirectory } from '../src/codex/core/temp.js';

const ROOT_ENV = 'SPECGATE_TEST_TEMP_ROOT';
const OWNER_ENV = 'SPECGATE_TEST_TEMP_OWNER_PID';
const MARKER = '.specgate-test-temp.json';
const systemTemporary = os.tmpdir();
const inheritedRoot = process.env[ROOT_ENV];
const inheritedOwner = Number(process.env[OWNER_ENV]);

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function reusableInheritedRoot(directory, ownerPid) {
  if (!directory || !path.isAbsolute(directory) || !processIsAlive(ownerPid)) return false;
  if (!path.basename(directory).startsWith('run-')) return false;
  if (path.basename(path.dirname(directory)) !== 'specgate-codex-tests') return false;
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(directory, MARKER), 'utf8'));
    return marker?.schemaVersion === 1 && Number(marker.ownerPid) === ownerPid;
  } catch {
    return false;
  }
}

function scavenge(managedRoot) {
  if (!fs.existsSync(managedRoot)) return;
  for (const entry of fs.readdirSync(managedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('run-')) continue;
    const directory = path.join(managedRoot, entry.name);
    let marker;
    try {
      marker = JSON.parse(fs.readFileSync(path.join(directory, MARKER), 'utf8'));
    } catch {
      continue;
    }
    if (marker?.schemaVersion !== 1 || processIsAlive(Number(marker.ownerPid))) continue;
    try {
      removeTemporaryDirectory(directory);
    } catch (error) {
      process.stderr.write(`[specgate] stale test cleanup failed: ${error.message}\n`);
    }
  }
}

let runRoot = inheritedRoot;
let owner = false;
let temporary = null;

if (!reusableInheritedRoot(runRoot, inheritedOwner)) {
  const managedRoot = path.join(systemTemporary, 'specgate-codex-tests');
  try {
    fs.mkdirSync(managedRoot, { recursive: true });
    scavenge(managedRoot);
    temporary = createTemporaryDirectory(`run-${process.pid}-`, { parent: managedRoot });
    runRoot = temporary.path;
    owner = true;
    fs.writeFileSync(
      path.join(runRoot, MARKER),
      JSON.stringify({
        schemaVersion: 1,
        ownerPid: process.pid,
        createdAt: new Date().toISOString(),
      }),
    );
    process.env[ROOT_ENV] = runRoot;
    process.env[OWNER_ENV] = String(process.pid);
  } catch (error) {
    runRoot = systemTemporary;
    temporary = null;
    owner = false;
    process.stderr.write(`[specgate] test temp isolation unavailable: ${error.message}\n`);
  }
}

process.env.TEMP = runRoot;
process.env.TMP = runRoot;
process.env.TMPDIR = runRoot;
process.env.npm_config_cache = path.join(runRoot, 'npm-cache');
process.env.NPM_CONFIG_CACHE = process.env.npm_config_cache;

let cleaned = false;
function cleanup() {
  if (!owner || cleaned || !temporary) return;
  try {
    temporary.cleanup();
    cleaned = true;
  } catch (error) {
    process.stderr.write(`[specgate] test temp cleanup failed: ${error.message}\n`);
  }
}

if (owner) {
  process.once('exit', cleanup);
  for (const [signal, exitCode] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ]) {
    process.once(signal, () => {
      cleanup();
      process.exit(exitCode);
    });
  }
}
