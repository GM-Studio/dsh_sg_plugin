import { parseDelta } from './parser.js';

/**
 * Validate delta files against the requirement set at specsBase.
 * files: [{ capability, path, text }]
 * specs: Map<capability, Requirement[]>
 */
export function validateDeltaFiles({ files, specs, type }) {
  const errors = [];
  const reqIds = new Set();
  const acIds = new Set();
  const counts = { ADDED: 0, MODIFIED: 0, REMOVED: 0 };
  const baselineAcs = new Set();
  for (const reqs of specs.values()) {
    for (const req of reqs) {
      for (const scenario of req.scenarios || []) baselineAcs.add(scenario.id);
    }
  }

  for (const file of files) {
    const parsed = parseDelta(file.text);
    for (const error of parsed.errors) errors.push(`${file.path}: ${error}`);

    for (const kind of ['ADDED', 'MODIFIED', 'REMOVED']) {
      for (const req of parsed.sections[kind]) {
        counts[kind] += 1;
        if (reqIds.has(req.id)) errors.push(`${file.path}: REQ 编号重复 ${req.id}`);
        reqIds.add(req.id);

        const existing = (specs.get(file.capability) || []).find((item) => item.id === req.id);
        if (kind === 'ADDED' && existing) {
          errors.push(`${file.path}: ${req.id} 已存在于 specs，应使用 MODIFIED`);
        }
        if (kind !== 'ADDED' && !existing) {
          errors.push(`${file.path}: ${kind} 目标 ${req.id} 不存在，首次覆盖请用 ADDED`);
        }
        if (kind !== 'REMOVED' && req.scenarios.length === 0) {
          errors.push(`${file.path}: ${kind} ${req.id} 至少需要一个 Scenario`);
        }

        for (const scenario of req.scenarios) {
          if (acIds.has(scenario.id)) errors.push(`${file.path}: AC 编号重复 ${scenario.id}`);
          acIds.add(scenario.id);
          if (kind === 'ADDED' && baselineAcs.has(scenario.id)) {
            errors.push(
              `${file.path}: AC ${scenario.id} 已被 specs 使用，请换新编号（建议带 change 前缀）`,
            );
          }
          if (kind === 'MODIFIED' && baselineAcs.has(scenario.id)) {
            const owned = new Set((existing?.scenarios || []).map((item) => item.id));
            if (!owned.has(scenario.id)) {
              errors.push(`${file.path}: AC ${scenario.id} 属于其他需求，不能挪用到 ${req.id}`);
            }
          }
        }
      }
    }
  }

  if (files.length === 0) {
    errors.push('delta 为空：change 缺少 specs/<capability>/spec.md');
  }
  if (counts.ADDED + counts.MODIFIED + counts.REMOVED === 0) {
    errors.push('delta 不含 ADDED/MODIFIED/REMOVED 内容');
  }

  if (type === 'feature' && counts.ADDED === 0) {
    errors.push('feature 类型至少需要一条 ADDED');
  }
  if (type === 'modify' && counts.MODIFIED === 0) {
    errors.push('modify 类型至少需要一条 MODIFIED');
  }
  if (type === 'fix' && counts.MODIFIED === 0 && counts.ADDED === 0) {
    errors.push('fix 类型至少需要一条 MODIFIED 或 ADDED');
  }
  if (type === 'remove' && counts.REMOVED === 0) {
    errors.push('remove 类型至少需要一条 REMOVED');
  }

  return { ok: errors.length === 0, errors, counts };
}
