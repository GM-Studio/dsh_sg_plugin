import fs from 'node:fs';
import path from 'node:path';
import { parseJacocoXml } from '../v3/coverage/jacoco.js';

/** Both sides must pass independently; missing/stale raw reports are a hard failure. */
export function reconcileCoverage(root, { since = 0, directory = null } = {}) {
  const backend = path.join(root, 'backend/target/site/jacoco/jacoco.xml');
  const frontend = path.join(root, 'frontend/coverage/coverage-summary.json');
  try {
    for (const file of [backend, frontend]) {
      if (fs.statSync(file).mtimeMs < since - 2000)
        throw new Error('Stale coverage report: ' + path.relative(root, file));
    }
    const java = parseJacocoXml(fs.readFileSync(backend, 'utf8'));
    const summary = JSON.parse(fs.readFileSync(frontend, 'utf8')).total;
    const js = Object.fromEntries(
      ['lines', 'branches'].map((key) => {
        const value = summary[key];
        if (
          !value ||
          !Number.isFinite(value.total) ||
          !Number.isFinite(value.covered) ||
          value.total < 0 ||
          value.covered < 0 ||
          value.covered > value.total
        )
          throw new Error('Invalid frontend coverage counter');
        return [
          key,
          {
            covered: value.covered,
            missed: value.total - value.covered,
            rate: value.total === 0 ? 1 : value.covered / value.total,
          },
        ];
      }),
    );
    const sides = { backend: java, frontend: js };
    for (const [side, coverage] of Object.entries(sides)) {
      if (coverage.ok === false || !(coverage.lines.covered + coverage.lines.missed))
        throw new Error(side + ' has no measured source lines');
      for (const [key, minimum] of [
        ['lines', 0.8],
        ['branches', 0.7],
      ]) {
        if (!Number.isFinite(coverage[key]?.rate) || coverage[key].rate < minimum)
          throw new Error(side + ' ' + key + ' coverage below ' + minimum * 100 + '%');
      }
    }
    if (directory) {
      fs.copyFileSync(backend, path.join(directory, 'backend-coverage.xml'));
      fs.copyFileSync(frontend, path.join(directory, 'frontend-coverage-summary.json'));
    }
    return { ok: true, ...sides };
  } catch (error) {
    return { ok: false, code: 'COVERAGE_FAILED', message: error.message };
  }
}
