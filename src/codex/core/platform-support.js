// 预留平台标注机制（M4 / SNA-0403）。
//
// 目标（AC-17）：macOS/ARM64 在未完成真实支持与验收前明确标为预留或未验证。
//
// 关键约束：supported 必须由**真实证据文件**驱动，不能靠手写常量宣称。
// 这意味着「有代码分支」不等于「已支持」，与 AC-17 的口径一致。

import fs from 'node:fs';
import path from 'node:path';
import {
  SUPPORT_LEVELS,
  SUPPORTED_PLATFORMS,
  RESERVED_PLATFORMS,
  platformSupport,
} from './platform.js';

/** 平台验收证据目录（相对仓库根）。 */
export const PLATFORM_EVIDENCE_DIRECTORY = 'docs/verification/stack-neutral-adoption';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/** 证据文件名约定：platform-<platform>-<arch>.json。 */
export function evidenceFileName(platform, arch = 'x64') {
  return 'platform-' + platform + '-' + arch + '.json';
}

/**
 * 读取某平台的验收证据。
 * 证据必须同时满足：声明 passed、含真实命令与退出码、含时间戳与执行者。
 * 任何一项缺失都视为无证据。
 */
export function readPlatformEvidence({ root, platform, arch = 'x64' } = {}) {
  if (typeof root !== 'string' || root.length === 0)
    return failure('PLATFORM_EVIDENCE_INVALID', 'root 必须是仓库根路径');
  const target = path.join(root, PLATFORM_EVIDENCE_DIRECTORY, evidenceFileName(platform, arch));
  let parsed;
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.size > 1024 * 1024)
      return { ok: true, present: false, reason: 'evidence-not-a-file' };
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return { ok: true, present: false, reason: 'evidence-missing' };
  }
  if (!object(parsed)) return { ok: true, present: false, reason: 'evidence-not-an-object' };
  if (parsed.platform !== platform || parsed.arch !== arch)
    return { ok: true, present: false, reason: 'evidence-platform-mismatch' };
  if (parsed.status !== 'passed')
    return {
      ok: true,
      present: false,
      reason: 'evidence-not-passed',
      status: parsed.status ?? null,
    };
  // 真实证据必须可核对：命令、退出码、时间、执行者。
  if (!Array.isArray(parsed.checks) || parsed.checks.length === 0)
    return { ok: true, present: false, reason: 'evidence-has-no-checks' };
  for (const check of parsed.checks) {
    if (!object(check) || typeof check.command !== 'string' || check.command.length === 0)
      return { ok: true, present: false, reason: 'evidence-check-without-command' };
    if (check.exitCode !== 0)
      return { ok: true, present: false, reason: 'evidence-check-failed', command: check.command };
  }
  if (typeof parsed.recordedAt !== 'string' || !Number.isFinite(Date.parse(parsed.recordedAt)))
    return { ok: true, present: false, reason: 'evidence-without-timestamp' };
  if (typeof parsed.recordedBy !== 'string' || parsed.recordedBy.length === 0)
    return { ok: true, present: false, reason: 'evidence-without-recorder' };
  return { ok: true, present: true, evidence: parsed, path: target };
}

/**
 * 判定某平台的对外声明等级。
 * 规则：
 * - 预留平台（darwin / arm64）即使有证据也需人工升级，默认 reserved；
 * - 受支持平台必须有真实证据才可 supported，否则 unverified；
 * - 未知平台 unverified。
 */
export function declareSupportLevel({
  root,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const base = platformSupport(platform, arch);
  const evidence = readPlatformEvidence({ root, platform, arch });
  if (!evidence.ok) return evidence;

  if (!SUPPORT_LEVELS.includes(base.level))
    return failure('PLATFORM_SUPPORT_INVALID', '未知的支持等级', { level: base.level });

  // 预留平台：永远不因证据而自动升级。
  if (base.level === 'reserved')
    return {
      ok: true,
      platform,
      arch,
      level: 'reserved',
      claimed: base.level,
      evidencePresent: evidence.present,
      // 明确区分「预留」与「已验证」：即使有证据也保持 reserved，直到人工升级。
      note: '预留平台不会因证据自动升级为 supported（AC-17）',
    };

  // 受支持平台：必须有真实证据。
  if (base.level === 'supported') {
    if (!evidence.present)
      return {
        ok: true,
        platform,
        arch,
        level: 'unverified',
        claimed: base.level,
        evidencePresent: false,
        reason: evidence.reason,
        note: '缺少真实平台证据，不得宣称 supported',
      };
    return {
      ok: true,
      platform,
      arch,
      level: 'supported',
      claimed: base.level,
      evidencePresent: true,
      evidencePath: evidence.path,
      recordedAt: evidence.evidence.recordedAt,
      recordedBy: evidence.evidence.recordedBy,
    };
  }

  return {
    ok: true,
    platform,
    arch,
    level: 'unverified',
    claimed: base.level,
    evidencePresent: evidence.present,
  };
}

/** 汇总所有平台的声明等级，供报告使用。 */
export function summarizePlatforms({ root, platforms = SUPPORTED_PLATFORMS, arch = 'x64' } = {}) {
  if (!Array.isArray(platforms)) return failure('PLATFORM_SUPPORT_INVALID', 'platforms 必须是数组');
  const rows = [];
  for (const platform of platforms) {
    const declared = declareSupportLevel({ root, platform, arch });
    if (!declared.ok) return declared;
    rows.push(declared);
  }
  // 预留平台也一并列出，避免报告中「看不见 macOS」。
  for (const platform of RESERVED_PLATFORMS) {
    const declared = declareSupportLevel({ root, platform, arch: 'arm64' });
    if (declared.ok) rows.push(declared);
  }
  return {
    ok: true,
    rows,
    // 只有全部为 supported 才能被称为「全平台已验证」。
    allSupported: rows.every((entry) => entry.level === 'supported'),
    supportedCount: rows.filter((entry) => entry.level === 'supported').length,
    reservedCount: rows.filter((entry) => entry.level === 'reserved').length,
    unverifiedCount: rows.filter((entry) => entry.level === 'unverified').length,
  };
}
