import path from 'node:path';
import { exists } from './util/fsx.js';

/** Validate a test:json report against the frozen AC set and the workspace. */
export function validateReport({
  report,
  deltaAcs,
  knownAcs,
  mapping,
  worktree,
  changedFiles = [],
  requireChangedFiles = true,
}) {
  const known = knownAcs || deltaAcs;
  if (!report || typeof report !== 'object') {
    return { ok: false, errors: ['报告缺失或不是 JSON 对象'] };
  }
  const errors = [];
  if (report.schemaVersion !== 1) errors.push('schemaVersion 必须为 1');

  const list = Array.isArray(report.cases) ? report.cases : [];
  if (list.length === 0 && deltaAcs.size > 0) errors.push('报告没有用例');

  const ids = new Set();
  const passedAcs = new Set();
  const mappedAcs = new Set((mapping?.requirements || []).map((entry) => entry.ac));
  const changed = new Set(changedFiles);

  for (const item of list) {
    if (!item?.id) {
      errors.push('用例缺少 id');
      continue;
    }
    if (ids.has(item.id)) errors.push(`用例 id 重复：${item.id}`);
    ids.add(item.id);

    if (!['pass', 'fail', 'skip'].includes(item.status)) {
      errors.push(`用例 ${item.id} 的 status 非法：${String(item.status)}`);
    }
    const acs = Array.isArray(item.ac) ? item.ac : [];
    if (acs.length === 0) errors.push(`用例 ${item.id} 缺少 ac`);
    for (const ac of acs) {
      if (!known.has(ac)) errors.push(`用例 ${item.id} 引用了未冻结的 ${ac}`);
      if (deltaAcs.has(ac) && !mappedAcs.has(ac)) {
        errors.push(`用例 ${item.id} 的 ${ac} 不在 mapping 中`);
      }
      if (item.status === 'pass' && deltaAcs.has(ac)) passedAcs.add(ac);
    }

    if (!item.file) {
      errors.push(`用例 ${item.id} 缺少 file`);
    } else {
      if (worktree && !exists(path.join(worktree, item.file))) {
        errors.push(`用例 ${item.id} 的文件不存在：${item.file}`);
      }
      if (requireChangedFiles && changed.size > 0 && !changed.has(item.file)) {
        errors.push(`用例 ${item.id} 的文件不在本次 diff：${item.file}`);
      }
    }
  }

  for (const ac of deltaAcs) {
    if (!passedAcs.has(ac)) errors.push(`AC ${ac} 没有通过的用例`);
  }

  return {
    ok: errors.length === 0,
    errors,
    stats: {
      total: list.length,
      passed: list.filter((item) => item.status === 'pass').length,
      failed: list.filter((item) => item.status === 'fail').length,
      skipped: list.filter((item) => item.status === 'skip').length,
    },
  };
}
