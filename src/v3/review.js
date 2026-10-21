import fs from 'node:fs';
import path from 'node:path';
import { git } from './util/git.js';
import { loadTemplateStyle, projectSourceHash } from './template-style.js';

export const MAX_DIFF_BYTES = 200 * 1024;

function safeGit(cwd, args) {
  try {
    return git(cwd, args);
  } catch {
    return '';
  }
}

export function collectDiff({ cwd, base, head }) {
  const range = `${base}..${head}`;
  const full = safeGit(cwd, ['diff', '--no-color', '--no-ext-diff', range]);
  const stats = safeGit(cwd, ['diff', '--numstat', range])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, ...rest] = line.split('\t');
      return { file: rest.join('\t'), added: Number(added) || 0, deleted: Number(deleted) || 0 };
    });
  const bytes = Buffer.byteLength(full, 'utf8');
  const truncated = bytes > MAX_DIFF_BYTES;
  const text = truncated
    ? `${full.slice(0, MAX_DIFF_BYTES)}\n…（diff 已截断，完整文件清单见下）`
    : full;
  return {
    range,
    bytes,
    truncated,
    files: stats,
    fileList: stats.map((item) => `${item.file} +${item.added} -${item.deleted}`),
    text,
  };
}

function hunkRanges(diff, file) {
  const ranges = [];
  let current = null;
  for (const line of String(diff || '').split(/\r?\n/)) {
    const header = /^\+\+\+\s+b\/(.+)$/.exec(line);
    if (header) {
      current = header[1];
      continue;
    }
    if (current !== file) continue;
    const hunk = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/.exec(line);
    if (hunk) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      ranges.push({ start, end: start + Math.max(count, 1) - 1 });
    }
  }
  return ranges;
}

function normalized(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateReview(output, diff, testOutput = '', worktree = null) {
  const errors = [];
  const warnings = [];
  if (!output || typeof output !== 'object') return { ok: false, errors: ['reviewer 未返回对象'] };
  if (worktree) {
    const style = loadTemplateStyle(worktree);
    if (!style.ok) errors.push(style.message);
    if (!style.skipped && style.ok) {
      if (
        output.sourceHash !== projectSourceHash(worktree) ||
        output.templateManifestHash !== style.manifestHash
      )
        errors.push('走查结果未绑定当前源码与固定模板摘要');
      for (const name of [
        'layering',
        'transactions',
        'errors',
        'authentication',
        'files',
        'templateStyle',
        'tests',
      ]) {
        const item = output.checklist?.[name];
        if (!item || !['pass', 'fail'].includes(item.status) || !String(item.reason || '').trim())
          errors.push('缺少有效走查项：' + name);
        else if (output.verdict === 'pass' && item.status !== 'pass')
          errors.push('走查未通过：' + name);
      }
    }
  }
  if (!['pass', 'fail'].includes(output.verdict)) errors.push('verdict 必须是 pass 或 fail');
  const blocking = Array.isArray(output.blocking) ? output.blocking : [];
  const files = new Set((diff.files || []).map((item) => item.file));
  const haystack = normalized(`${diff.text || ''}\n${testOutput || ''}`);

  for (const [index, item] of blocking.entries()) {
    const label = `blocking[${index}]`;
    if (!item || typeof item !== 'object') {
      errors.push(`${label} 不是对象`);
      continue;
    }
    if (!item.file || !files.has(item.file)) errors.push(`${label}.file 不在 diff 文件清单中`);
    const line = Number(item.line);
    if (!Number.isInteger(line) || line <= 0) {
      errors.push(`${label}.line 必须是正整数`);
    } else if (item.file && files.has(item.file)) {
      const ranges = hunkRanges(diff.text, item.file);
      if (ranges.length > 0 && !ranges.some((range) => line >= range.start && line <= range.end)) {
        errors.push(`${label}.line ${line} 不在 ${item.file} 的 diff hunk 内`);
      }
    }
    if (!normalized(item.evidence)) errors.push(`${label}.evidence 不能为空`);
    else if (haystack && !haystack.includes(normalized(item.evidence))) {
      warnings.push(`${label}.evidence 未精确匹配 diff，已按 file/line 校验`);
    }
    if (!normalized(item.reason)) errors.push(`${label}.reason 不能为空`);
  }
  if (output.verdict === 'fail' && blocking.length === 0) {
    errors.push('verdict=fail 至少需要一条 blocking');
  }
  if (output.verdict === 'pass' && blocking.length > 0) {
    errors.push('verdict=pass 时 blocking 必须为空');
  }
  return { ok: errors.length === 0, errors, warnings, blocking };
}

export function createReviewWorktree({ root, change, commit }) {
  const target = path.join(
    root,
    '.specgate',
    'worktrees',
    change,
    `review-${String(commit).slice(0, 8)}`,
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    git(root, ['worktree', 'add', '--detach', target, commit]);
  } catch (error) {
    return {
      ok: false,
      code: 'REVIEW_WORKTREE_FAILED',
      message: String(error.stderr || error.message),
    };
  }
  return { ok: true, path: target };
}

export function removeReviewWorktree({ root, path: target }) {
  try {
    git(root, ['worktree', 'remove', '--force', target]);
  } catch {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }
}
