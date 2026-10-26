// 扫描预算、跳过规则与缺口报告（M2 / SNA-0203）。
//
// 目标（AC-03、NFR-01、NFR-02、NFR-03）：
// - 扫描有文件数、单文件大小与时间预算，超限停止扩展并报告未扫描范围；
// - 依赖目录与构建产物默认跳过；
// - 疑似密钥文件默认跳过，且**不**出现在 scanned 清单（跳过 ≠ 已分析）；
// - 超时返回部分结果与原因，不抛出。
//
// OI-01 尚未确认具体数值，因此这里的默认值是保守的，并在输出中标注 pending: true。

import fs from 'node:fs';
import path from 'node:path';

/** OI-01 待确认的保守默认值。 */
export const DEFAULT_BUDGET = Object.freeze({
  maxFiles: 20000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxMilliseconds: 60000,
  maxDepth: 12,
});

/** 依赖目录与构建产物：默认跳过。 */
export const DEFAULT_SKIP_DIRECTORIES = Object.freeze([
  '.git',
  'node_modules',
  'dist',
  'build',
  'target',
  'coverage',
  '.specgate',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  '.next',
  '.nuxt',
  '.cache',
  '.idea',
  '.vscode',
  'vendor',
  'Pods',
]);

/** 疑似密钥文件名模式：默认跳过，且不计入已分析范围（NFR-03）。 */
export const SECRET_NAME_PATTERNS = Object.freeze([
  /^\.env(?:\..*)?$/,
  /^.*\.(?:pem|key|p12|pfx|jks|keystore)$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/,
  /^\.npmrc$/,
  /^\.netrc$/,
  /^secrets?\.(?:json|ya?ml|toml)$/i,
  /^.*credentials.*\.(?:json|ya?ml|toml)$/i,
]);

/** 疑似密钥内容特征：命中即按敏感处理。 */
export const SECRET_CONTENT_PATTERN =
  /(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}/i;

export function isSecretName(name) {
  return SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/** 归一化预算，拒绝非法值而不是静默回退。 */
export function normalizeBudget(overrides = {}) {
  const budget = { ...DEFAULT_BUDGET, ...overrides };
  for (const key of Object.keys(DEFAULT_BUDGET)) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] <= 0)
      return { ok: false, code: 'SCAN_BUDGET_INVALID', message: '预算项必须是正整数：' + key };
  }
  return { ok: true, budget };
}

function safeLstat(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * 执行一次有界只读扫描。
 * 不读取被跳过的文件内容，不跟随符号链接，不写入任何文件。
 */
export function scanRepository({ root, budget: overrides = {}, now = () => Date.now() } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    return { ok: false, code: 'SCAN_ROOT_INVALID', message: 'root 必须是绝对路径' };
  const normalized = normalizeBudget(overrides);
  if (!normalized.ok) return normalized;
  const budget = normalized.budget;
  const startedAt = now();

  const scanned = [];
  const skipped = [];
  const unscanned = [];
  const sensitive = [];
  let files = 0;
  let bytes = 0;
  let timedOut = false;
  let truncated = false;

  const pending = [{ directory: root, relative: '', depth: 0 }];
  while (pending.length > 0) {
    if (now() - startedAt > budget.maxMilliseconds) {
      timedOut = true;
      for (const entry of pending) unscanned.push(entry.relative || '.');
      break;
    }
    const current = pending.shift();
    let entries;
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true });
    } catch {
      unscanned.push(current.relative || '.');
      continue;
    }
    // 稳定顺序，保证结果可复现。
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const relative = current.relative ? current.relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) {
        // 不跟随链接：既不扫描目标，也不把它算作已分析。
        skipped.push({ path: relative, reason: 'symlink' });
        continue;
      }
      if (entry.isDirectory()) {
        if (DEFAULT_SKIP_DIRECTORIES.includes(entry.name)) {
          skipped.push({ path: relative, reason: 'dependency-or-artifact' });
          continue;
        }
        if (current.depth + 1 > budget.maxDepth) {
          truncated = true;
          unscanned.push(relative);
          continue;
        }
        pending.push({
          directory: path.join(current.directory, entry.name),
          relative,
          depth: current.depth + 1,
        });
        continue;
      }
      if (!entry.isFile()) {
        skipped.push({ path: relative, reason: 'non-regular-file' });
        continue;
      }
      // 疑似密钥文件：按名称先跳过，绝不读取内容。
      if (isSecretName(entry.name)) {
        skipped.push({ path: relative, reason: 'suspected-secret' });
        continue;
      }
      const stat = safeLstat(path.join(current.directory, entry.name));
      if (!stat) {
        skipped.push({ path: relative, reason: 'unreadable' });
        continue;
      }
      if (stat.size > budget.maxFileBytes) {
        skipped.push({ path: relative, reason: 'exceeds-file-budget', bytes: stat.size });
        continue;
      }
      if (files + 1 > budget.maxFiles) {
        truncated = true;
        unscanned.push(relative);
        continue;
      }
      if (bytes + stat.size > budget.maxTotalBytes) {
        truncated = true;
        unscanned.push(relative);
        continue;
      }
      files += 1;
      bytes += stat.size;
      // 内容级检测用于标记「需要脱敏」，不用于把文件排除出分析范围。
      // 名称命中才跳过；内容命中仍可分析，但报告中该文件被标记为 redacted，
      // 且任何后续证据都不得引用其检出的字面量（NFR-03）。
      // 这样既能保护凭据，也不会让「包含检测正则本身」的源码无法被分析。
      let redacted = false;
      if (stat.size <= budget.maxFileBytes) {
        try {
          const text = fs.readFileSync(path.join(current.directory, entry.name), 'utf8');
          redacted = SECRET_CONTENT_PATTERN.test(text);
        } catch {
          // 二进制或不可读：不作为通过依据，也不记为敏感。
          redacted = false;
        }
      }
      scanned.push({ path: relative, bytes: stat.size, redacted });
      if (redacted) sensitive.push({ path: relative, reason: 'content-matched-secret' });
    }
  }

  const elapsedMs = now() - startedAt;
  const complete = !timedOut && !truncated && unscanned.length === 0;
  return {
    ok: true,
    complete,
    timedOut,
    truncated,
    scanned,
    skipped,
    sensitive,
    unscanned,
    stats: { files, bytes, elapsedMs },
    budget,
    // OI-01 未确认：明确标注默认值尚未批准，避免被当作既定预算。
    pendingBudgetConfirmation: true,
  };
}
