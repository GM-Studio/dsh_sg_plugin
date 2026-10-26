// 双平台证据汇总（M8 / SNA-0807）。
//
// 目标：汇总各平台证据并明确区分「源码保留能力 / 默认公开能力 / 实际发行能力」。
// 关键约束：任一平台缺证据即不得宣称全平台可发布。

import { summarizePlatforms, evidenceFileName } from './platform-support.js';

/** 发行三态。 */
export const CAPABILITY_TIERS = Object.freeze([
  /** 源码里保留、但默认不公开的工具能力。 */
  'source-only',
  /** 默认向用户公开的能力。 */
  'default-public',
  /** 实际进入发行包的能力。 */
  'shipped',
]);

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * 构建发行三态表。
 * 每个能力必须明确落在哪一态；三态不得静默重叠。
 */
export function capabilityTiers({ capabilities = [] } = {}) {
  if (!Array.isArray(capabilities)) return failure('TIER_INVALID', 'capabilities 必须是数组');
  const problems = [];
  const rows = [];
  for (const entry of capabilities) {
    if (!object(entry) || typeof entry.name !== 'string') {
      problems.push({ code: 'CAPABILITY_INVALID' });
      continue;
    }
    if (!CAPABILITY_TIERS.includes(entry.tier)) {
      problems.push({ code: 'TIER_UNKNOWN', name: entry.name, tier: entry.tier ?? null });
      continue;
    }
    rows.push({ name: entry.name, tier: entry.tier, reason: entry.reason ?? null });
  }
  // 同一能力不得同时出现在多态（上游应当先归一）。
  const names = rows.map((entry) => entry.name);
  const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicated.length > 0)
    problems.push({ code: 'TIER_AMBIGUOUS', names: [...new Set(duplicated)] });
  return {
    ok: problems.length === 0,
    code: problems.length === 0 ? undefined : 'TIER_INVALID',
    problems,
    rows,
    counts: {
      sourceOnly: rows.filter((entry) => entry.tier === 'source-only').length,
      defaultPublic: rows.filter((entry) => entry.tier === 'default-public').length,
      shipped: rows.filter((entry) => entry.tier === 'shipped').length,
    },
  };
}

/**
 * 汇总双平台证据。
 * 逐平台独立成表；任一平台 unverified 即不得宣称可发布。
 */
export function platformSummary({ root, platforms = ['win32', 'linux'], arch = 'x64' } = {}) {
  const summary = summarizePlatforms({ root, platforms, arch });
  if (!summary.ok) return summary;
  const rows = summary.rows.map((entry) => ({
    platform: entry.platform,
    arch: entry.arch,
    level: entry.level,
    evidenceFile: evidenceFileName(entry.platform, entry.arch),
    evidencePresent: entry.evidencePresent === true,
    recordedAt: entry.recordedAt ?? null,
    recordedBy: entry.recordedBy ?? null,
  }));
  // 受支持平台（win32/linux x64）必须全部 supported，预留平台不计入。
  const required = rows.filter((entry) => platforms.includes(entry.platform));
  const missing = required.filter((entry) => entry.level !== 'supported');
  return {
    ok: true,
    rows,
    required,
    missing,
    // 只有两个受支持平台都 supported 时才可发布。
    releaseReady: missing.length === 0,
    // 明确：预留平台不参与发布判定，但必须在报告中可见。
    reservedPlatforms: rows
      .filter((entry) => entry.level === 'reserved')
      .map((entry) => entry.platform),
  };
}

/**
 * 逐平台证据必须互不代替（AC-16）。
 */
export function assertIndependentEvidence({ rows = [] } = {}) {
  if (!Array.isArray(rows)) return failure('TIER_INVALID', 'rows 必须是数组');
  const problems = [];
  for (const row of rows) {
    if (!object(row)) continue;
    // 一个平台的文件不得被另一个平台引用。
    const expected = evidenceFileName(row.platform, row.arch);
    if (row.evidenceFile && row.evidenceFile !== expected)
      problems.push({
        code: 'EVIDENCE_FILE_MISMATCH',
        platform: row.platform,
        expected,
        got: row.evidenceFile,
      });
    // supported 必须有对应文件。
    if (row.level === 'supported' && row.evidencePresent !== true)
      problems.push({ code: 'SUPPORTED_WITHOUT_EVIDENCE', platform: row.platform });
  }
  return {
    ok: problems.length === 0,
    code: problems.length === 0 ? undefined : 'EVIDENCE_NOT_INDEPENDENT',
    problems,
  };
}
