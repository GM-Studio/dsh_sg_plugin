/**
 * 测试临时目录隔离 + 自动清理。
 *
 * 背景：test/ 下 70+ 个用例用 fs.mkdtempSync(path.join(os.tmpdir(), 'sg-xxx-'))
 * 建临时工作区，但从不删除。反复跑 npm test / npm run gate 时会在
 * C:\Users\<user>\AppData\Local\Temp 下堆积数万个目录、数百万文件，
 * 进而拖垮 Windows 登录（User Profile Service 遍历 %TEMP% 需数分钟）。
 *
 * 做法：把本次测试进程的 TEMP/TMP/TMPDIR 全部重定向到一个专用根目录，
 * 进程结束时整棵树删除。用例代码无需改动（os.tmpdir() 每次都读环境变量）。
 *
 * 由 package.json 的 test 脚本以 --import 方式加载。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const baseTmp = os.tmpdir();
const runRoot = path.join(baseTmp, `sg-testrun-${process.pid}-${Date.now()}`);

try {
  fs.mkdirSync(runRoot, { recursive: true });
  process.env.TEMP = runRoot;
  process.env.TMP = runRoot;
  process.env.TMPDIR = runRoot;
} catch {
  // 无法建立隔离目录时退回系统默认，不要因此让测试失败
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch {
    // 被占用时留给下一次运行或人工清理
  }
}

process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    cleanup();
    process.exit(1);
  });
}
