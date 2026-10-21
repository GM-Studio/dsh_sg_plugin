import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(resolve(tmpdir(), 'task-vitest-'));
const output = resolve(temporary, 'vitest.json');
try {
  const child = spawnSync(process.execPath, [resolve(root, 'frontend/node_modules/vitest/vitest.mjs'), 'run', '--coverage', '--reporter=json', '--outputFile=' + output], { cwd: resolve(root, 'frontend'), stdio: ['ignore', 'inherit', 'inherit'] });
  if (child.error) throw child.error;
  const raw = JSON.parse(readFileSync(output, 'utf8'));
  const cases = (raw.testResults || []).flatMap(suite => (suite.assertionResults || []).map(assertion => ({
    id: assertion.fullName,
    status: assertion.status === 'passed' ? 'pass' : assertion.status === 'pending' || assertion.status === 'skipped' || assertion.status === 'todo' ? 'skip' : 'fail',
    ac: [...new Set(assertion.fullName.match(/AC-\d{3,}/g) || [])],
    file: relative(root, suite.name).split('\\').join('/'),
  })));
  let coverage = null;
  try {
    const summary = JSON.parse(readFileSync(resolve(root, 'frontend/coverage/coverage-summary.json'), 'utf8')).total;
    coverage = Object.fromEntries(['lines', 'branches'].map(key => [key, {
      covered: summary[key].covered, missed: summary[key].total-summary[key].covered,
      rate: summary[key].total === 0 ? 1 : summary[key].covered/summary[key].total,
    }]));
  } catch { console.error('Coverage report missing or invalid'); }
  const report = { schemaVersion: 1, cases, coverage };
  if (process.env.SG_REPORT) writeFileSync(process.env.SG_REPORT, JSON.stringify(report, null, 2) + '\n');
  else console.log(JSON.stringify(report));
  process.exitCode = child.status === 0 && raw.success === true && cases.length > 0
    && cases.every(item => item.status === 'pass') && coverage?.lines.rate >= 0.8 && coverage?.branches.rate >= 0.7 ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { rmSync(temporary, { recursive: true, force: true }); }
