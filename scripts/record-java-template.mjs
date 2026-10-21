// Promote only complete, real acceptance runs whose template hashes still match.
import fs from 'node:fs';
import path from 'node:path';
import { JAVA_PRESETS, templateHash } from '../src/v4/java-versions.js';
import { javaFullstackFiles } from '../src/v4/java-fullstack-template.js';
import { VERIFY_STAGES } from '../src/v4/verify-evidence.js';

const file = process.argv[2];
const evidenceBase = process.argv[3] || 'docs/verification/2026-10-21-java-vue';
if (!file) throw new Error('Usage: node scripts/record-java-template.mjs <results.json>');
const results = JSON.parse(fs.readFileSync(file, 'utf8'));
const records = [];
for (const preset of JAVA_PRESETS) {
  const item = results.find((item) => item.preset === preset.id);
  if (
    !item?.ok ||
    item.code !== 'SMOKE_PASSED' ||
    item.templateHash !== templateHash(javaFullstackFiles({ preset }))
  )
    throw new Error('Missing, failed or stale template acceptance: ' + preset.id);
  const report = item.report;
  if (
    report.reconciliation?.passed !== 7 ||
    report.reconciliation?.notRun !== 0 ||
    VERIFY_STAGES.some(
      (name) => !report.stages.some((stage) => stage.name === name && stage.status === 0),
    )
  )
    throw new Error('Incomplete reconciliation: ' + preset.id);
  for (const name of ['backend-verify', 'frontend-test']) {
    const tests = report.stages.find((stage) => stage.name === name).tests;
    if (!tests?.total || tests.total !== tests.passed)
      throw new Error('Missing executed test cases: ' + preset.id);
  }
  const origin = path.join(item.root, '.specgate', 'verify-runs', report.runId);
  for (const stage of report.stages)
    if (!stage.log || !fs.existsSync(path.join(item.root, stage.log)))
      throw new Error('Missing stage log: ' + preset.id + ' ' + stage.name);
  records.push({ preset, item, report, origin });
}
const manifest = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString().slice(0, 10),
  presets: {},
};
for (const { preset, item, report, origin } of records) {
  const destination = evidenceBase + '/' + preset.id;
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(origin, destination, { recursive: true });
  const logArchive = {};
  for (const stage of report.stages) {
    const name = stage.name + '.txt';
    fs.copyFileSync(path.join(item.root, stage.log), path.join(destination, name));
    logArchive[stage.log] = name;
  }
  fs.writeFileSync(
    path.join(destination, 'log-index.json'),
    JSON.stringify(logArchive, null, 2) + '\n',
  );
  const java = report.environment.java.find((java) => java.home === report.toolchain.javaHome);
  manifest.presets[preset.id] = {
    templateHash: item.templateHash,
    verifiedAt: report.finishedAt,
    verifiedBy: 'local:' + report.environment.platform + ' ' + report.environment.arch,
    toolchain:
      'JDK ' +
      java.version +
      ' + Maven ' +
      report.environment.maven.version +
      ' + Node ' +
      report.environment.node.version,
    commands: report.stages
      .filter((stage) => stage.command)
      .map((stage) => [stage.command, ...stage.args].join(' ')),
    result: 'passed',
    evidence: destination + '/report.json',
    ...(preset.preview ? { preview: true } : {}),
  };
}
const source = 'src/v4/java-versions.js';
const original = fs.readFileSync(source, 'utf8');
const start = original.indexOf('export const GOLDEN_MANIFEST = ');
const end = original.indexOf('export function normalizeJavaPreset', start);
if (start < 0 || end < 0) throw new Error('Golden manifest source boundaries not found');
fs.writeFileSync(
  source,
  original.slice(0, start) +
    'export const GOLDEN_MANIFEST = ' +
    JSON.stringify(manifest, null, 2) +
    ';\n\n' +
    original.slice(end),
);
console.log(
  'Recorded ' + records.length + ' verified templates; evidence copied to ' + evidenceBase + '/.',
);
