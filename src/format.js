import path from 'node:path';
import { requirementChangeDir } from './requirements.js';
import { exists, readIfExists } from './util.js';

export function formatReportPath(root, change) {
  return path.join(requirementChangeDir(root, change), 'format-report.md');
}

export function reviewReportPath(root, change) {
  return path.join(requirementChangeDir(root, change), 'review-report.md');
}

export function resolveFormatCommands(root, config = {}) {
  const formatCommand = String(config.formatCommand || '').trim();
  const lintCommand = String(config.lintCommand || '').trim();
  if (formatCommand || lintCommand) {
    return {
      ok: true,
      source: 'config',
      formatCommand: formatCommand || null,
      lintCommand: lintCommand || null,
    };
  }
  const packagePath = path.join(path.resolve(root), 'package.json');
  const text = readIfExists(packagePath);
  if (!text) return { ok: false, reason: '未配置 formatCommand/lintCommand，且项目没有 package.json' };
  let scripts = {};
  try {
    scripts = JSON.parse(text).scripts || {};
  } catch {
    return { ok: false, reason: 'package.json 无法解析，无法自动探测 format/lint' };
  }
  const format = scripts.format
    ? `npm run format -- {files}`
    : scripts.prettier
      ? `npm run prettier -- --write {files}`
      : null;
  const lint = scripts.lint
    ? `npm run lint -- {files}`
    : scripts.check
      ? `npm run check -- {files}`
      : null;
  if (!format && !lint) {
    return { ok: false, reason: '未找到 format/lint/check 命令；请在 .specgate/config.yaml 配置 formatCommand/lintCommand' };
  }
  return { ok: true, source: 'package.json', formatCommand: format, lintCommand: lint };
}

function field(text, names) {
  for (const name of names) {
    const match = text.match(new RegExp(`^\\s*${name}\\s*[：:]\\s*(.*)$`, 'im'));
    if (match) return match[1].trim();
  }
  return null;
}

export function parseFormatReport(text) {
  const value = String(text || '');
  const verdict = field(value, ['verdict', '结论']);
  const lint = field(value, ['lint']);
  const skipped = field(value, ['skipped']);
  return {
    verdict: verdict ? verdict.toLowerCase() : null,
    lint: lint ? lint.toLowerCase() : null,
    skipped: skipped ? skipped.toLowerCase() : null,
    pass:
      (verdict === 'pass' || verdict === '通过') &&
      (skipped === 'true' ||
        lint === 'pass' ||
        lint === '通过'),
  };
}

export function validateFormatReport(root, change) {
  const file = formatReportPath(root, change);
  if (!exists(file)) return { ok: false, reason: '缺少 format-report.md；先执行 sg-apply 的 G7.5 阶段' };
  const report = parseFormatReport(readIfExists(file));
  if (!report.pass) {
    return {
      ok: false,
      reason: `格式化/Lint 未通过（verdict=${report.verdict || 'missing'}, lint=${report.lint || 'missing'}）`,
    };
  }
  return { ok: true, report, path: file };
}

function listItems(text, name) {
  const value = String(text || '');
  const match = value.match(new RegExp(`^\\s*(?:${name})\\s*:\\s*\\n([\\s\\S]*?)(?=\\n\\w+\\s*:|$)`, 'im'));
  if (!match) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);
}

export function parseReviewReport(text) {
  const value = String(text || '');
  const verdict = field(value, ['verdict', '结论']);
  return {
    verdict: verdict ? verdict.toLowerCase() : null,
    blocking: listItems(value, 'blocking'),
    nonBlocking: listItems(value, 'non_blocking|non-blocking'),
    pass: verdict === 'pass' || verdict === '通过',
  };
}

export function validateReviewReport(root, change) {
  const file = reviewReportPath(root, change);
  if (!exists(file)) return { ok: false, reason: '缺少 review-report.md；先执行 sg-apply 的 G9 阶段' };
  const report = parseReviewReport(readIfExists(file));
  if (!report.pass) return { ok: false, reason: '代码审查结论不是 pass/通过' };
  if (report.blocking.length > 0) {
    return { ok: false, reason: `代码审查存在 ${report.blocking.length} 个 blocking 问题` };
  }
  return { ok: true, report, path: file };
}
