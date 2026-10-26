#!/usr/bin/env node
// 平台验收证据生成器（M4 / SNA-0402）。
//
// 语义与 scripts/verify-codex-matrix.mjs 一致：
// 一次调用只为**当前平台**背书，绝不替其他平台写入通过记录。
//
// 产物：docs/verification/stack-neutral-adoption/platform-<platform>-<arch>.json
// 该文件被 src/codex/core/platform-support.js 读取，用于判定 supported / unverified。
//
// 用法：node scripts/record-platform-evidence.mjs [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIRECTORY = 'docs/verification/stack-neutral-adoption';

const CHECKS = [
  { name: 'core-tests', command: ['npm', 'test'] },
  { name: 'lint', command: ['npm', 'run', 'lint'] },
  { name: 'format-check', command: ['npm', 'run', 'format:check'] },
  { name: 'pack-check', command: ['npm', 'run', 'pack:check'] },
  { name: 'mcp-smoke', command: ['npm', 'run', 'codex:smoke'] },
];

function executable(command, platform) {
  if (platform === 'win32') return command === 'npm' ? 'npm.cmd' : command;
  return command;
}

function runCheck(check) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(executable(check.command[0], process.platform), check.command.slice(1), {
    cwd: root,
    encoding: 'utf8',
    timeout: 30 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  const finishedAt = new Date().toISOString();
  return {
    name: check.name,
    command: check.command.join(' '),
    exitCode: typeof result.status === 'number' ? result.status : null,
    startedAt,
    finishedAt,
    // 只保留尾部，避免证据文件过大；失败时保留 stderr 尾部用于定位。
    stdoutTail: String(result.stdout || '')
      .split('\n')
      .slice(-8)
      .join('\n'),
    stderrTail: String(result.stderr || '')
      .split('\n')
      .slice(-8)
      .join('\n'),
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const platform = process.platform;
  const arch = process.arch;
  const fileName = 'platform-' + platform + '-' + arch + '.json';
  const target = path.join(root, OUTPUT_DIRECTORY, fileName);

  console.error('记录平台证据：' + platform + '/' + arch);
  console.error('目标文件：' + path.relative(root, target));

  const checks = [];
  for (const check of CHECKS) {
    console.error('  → ' + check.name);
    const result = runCheck(check);
    checks.push(result);
    if (result.exitCode !== 0) {
      console.error('    失败：exit=' + result.exitCode + (result.timedOut ? ' (timeout)' : ''));
      // 失败也写证据：status 如实为 failed，绝不写成 passed。
      write({ platform, arch, checks, status: 'failed', dryRun, target });
      process.exit(1);
    }
    console.error('    通过');
  }

  write({ platform, arch, checks, status: 'passed', dryRun, target });
}

function write({ platform, arch, checks, status, dryRun, target }) {
  const evidence = {
    $schema: 'https://specgate.dev/schemas/platform-evidence-v1.json',
    platform,
    arch,
    // passed 只在全部命令真实退出 0 时成立。
    status,
    recordedAt: new Date().toISOString(),
    recordedBy: 'scripts/record-platform-evidence.mjs',
    node: process.version,
    release: process.release?.name ?? null,
    checks,
    // 诚实标记：本记录只覆盖它自己的平台。
    coversOnlyOwnPlatform: true,
  };
  if (dryRun) {
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(evidence, null, 2) + '\n');
  console.error('已写入：' + path.relative(process.cwd().startsWith(root) ? root : root, target));
  console.error('结果：' + status);
}

main();
