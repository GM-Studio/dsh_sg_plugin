const COUNTER_RE = /<counter\b([^>]*?)\/?>/g;
const ATTR_RE = /([A-Za-z0-9_]+)="([^"]*)"/g;

function attrsOf(text) {
  const attrs = {};
  for (const match of String(text || '').matchAll(ATTR_RE)) attrs[match[1]] = match[2];
  return attrs;
}

function counterOf(text, type) {
  let found = null;
  for (const match of String(text || '').matchAll(COUNTER_RE)) {
    const attrs = attrsOf(match[1]);
    if (attrs.type !== type) continue;
    const missed = Number(attrs.missed);
    const covered = Number(attrs.covered);
    if (!Number.isFinite(missed) || !Number.isFinite(covered)) continue;
    found = { missed, covered };
  }
  return found;
}

function rateOf(counter) {
  if (!counter) return null;
  const total = counter.covered + counter.missed;
  if (total === 0) return 1;
  return counter.covered / total;
}

/**
 * Parse the report-level LINE/BRANCH counters of a JaCoCo XML file.
 * JaCoCo writes aggregate counters last; nested class/package counters are
 * ignored by keeping the last counter of each type.
 */
export function parseJacocoXml(text) {
  const lines = counterOf(text, 'LINE');
  const branches = counterOf(text, 'BRANCH');
  if (!lines && !branches) {
    return { ok: false, code: 'COVERAGE_MISSING', message: 'JaCoCo XML 没有 LINE/BRANCH counter' };
  }
  return {
    ok: true,
    lines: lines
      ? { covered: lines.covered, missed: lines.missed, rate: rateOf(lines) }
      : { covered: 0, missed: 0, rate: null },
    branches: branches
      ? { covered: branches.covered, missed: branches.missed, rate: rateOf(branches) }
      : { covered: 0, missed: 0, rate: null },
  };
}

export function mergeCoverage(reports) {
  const total = {
    lines: { covered: 0, missed: 0, rate: null },
    branches: { covered: 0, missed: 0, rate: null },
  };
  for (const report of reports || []) {
    if (!report || report.ok === false) continue;
    for (const key of ['lines', 'branches']) {
      total[key].covered += report[key]?.covered || 0;
      total[key].missed += report[key]?.missed || 0;
    }
  }
  for (const key of ['lines', 'branches']) {
    const value = total[key];
    const sum = value.covered + value.missed;
    value.rate = sum === 0 ? 1 : value.covered / sum;
  }
  return total;
}

function percent(value) {
  return Math.round(value * 10000) / 100;
}

function required(value, threshold) {
  return value === null || value === undefined || value * 100 >= threshold;
}

/**
 * Evaluate thresholds and P0/P1/P2 AC pass rates.
 * `stats` = { P0: { total, passed }, P1: ..., P2: ... }
 */
export function evaluateCoverage({ coverage, thresholds = {}, baseline = null, stats = {} }) {
  const errors = [];
  const warnings = [];
  const blocking = thresholds.blocking !== false;
  const lineRate = coverage?.lines?.rate ?? null;
  const branchRate = coverage?.branches?.rate ?? null;
  const limits = {
    lines: Number(thresholds.lines) > 0 ? Number(thresholds.lines) : 80,
    branches: Number(thresholds.branches) > 0 ? Number(thresholds.branches) : 70,
    p0p1: Number(thresholds.p0p1) > 0 ? Number(thresholds.p0p1) : 100,
    p2: Number(thresholds.p2) > 0 ? Number(thresholds.p2) : 90,
  };

  for (const [key, value] of [
    ['lines', lineRate],
    ['branches', branchRate],
  ]) {
    if (value === null) {
      errors.push(`缺少 ${key} 覆盖率`);
      continue;
    }
    if (required(value, limits[key])) continue;
    const base = Number(baseline?.[key]);
    if (Number.isFinite(base) && value * 100 >= base) {
      warnings.push(`${key} 覆盖率 ${percent(value)}% 低于 ${limits[key]}%，但不低于 baseline ${base}%`);
    } else {
      errors.push(`${key} 覆盖率 ${percent(value)}% 低于 ${limits[key]}%`);
    }
  }

  for (const [priority, limit] of [
    ['P0', limits.p0p1],
    ['P1', limits.p0p1],
    ['P2', limits.p2],
  ]) {
    const item = stats[priority];
    if (!item || !item.total) continue;
    const rate = (item.passed / item.total) * 100;
    if (rate < limit) errors.push(`${priority} 通过率 ${rate}% 低于 ${limit}%`);
  }

  if (!blocking) {
    return { ok: true, errors: [], warnings: [...warnings, ...errors], blocking: false };
  }
  return { ok: errors.length === 0, errors, warnings, blocking: true };
}
