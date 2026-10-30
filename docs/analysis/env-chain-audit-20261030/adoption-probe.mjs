import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { previewAdoption } from '../../../src/codex/project-adopt.js';
import { startBaselineJob, getBaselineJob } from '../../../src/codex/baseline-job.js';
import { loadProjectReadiness } from '../../../src/codex/project-state.js';
import { runBaselineCommand } from '../../../src/codex/baseline.js';
import { createToolRegistry } from '../../../src/codex/workflow-tools.js';
import { detectProject } from '../../../src/codex/project-detect.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-adoption-audit-'));
const git = (args) => {
  const r = spawnSync(
    'git',
    [
      '-c',
      'user.name=Audit Fixture',
      '-c',
      'user.email=audit@localhost',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 },
  );
  if (r.status !== 0) throw new Error(r.stderr || r.error?.message);
  return r.stdout.trim();
};
try {
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'audit-only',
      version: '1.0.0',
      scripts: { test: 'node -e "require(\'audit-local-dependency\')"' },
    }),
  );
  fs.mkdirSync(path.join(root, 'node_modules/audit-local-dependency'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'node_modules/audit-local-dependency/index.js'),
    'module.exports = 1;\n',
  );
  git(['init', '-q', '-b', 'main']);
  git(['add', '.']);
  git(['commit', '-qm', 'Temporary audit fixture']);
  const detection = detectProject({ root });
  const preview = previewAdoption({ projectRoot: root });
  if (!preview.ok) throw new Error(JSON.stringify(preview));
  const original = await runBaselineCommand({
    command: preview.profile.commands.test[0],
    cwd: root,
    timeoutMs: 10000,
  });
  const start = startBaselineJob({ projectRoot: root, preview });
  let readiness = null,
    status = null;
  for (let i = 0; i < 300; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    status = getBaselineJob(root);
    readiness = loadProjectReadiness({ projectRoot: root });
    if ((readiness.ok && status?.status !== 'running') || status?.status === 'failed') break;
  }
  const summaryPath = path.join(root, '.specgate/codex/baseline-runs', start.runId, 'summary.json');
  const summary = fs.existsSync(summaryPath)
    ? JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
    : null;
  const registry = createToolRegistry({ projectRoot: root });
  const afterEnvironment = (await registry.call('sg_env_check')).structuredContent;
  const afterPrepare = (await registry.call('sg_development_prepare', { expectedVersion: 0 }))
    .structuredContent;
  const result = {
    note: 'Real temporary Git fixture and real Node command, with a local ignored dependency; no network installation or real human approval.',
    detection,
    preview,
    original,
    start,
    readiness,
    status,
    summary,
    afterEnvironment,
    afterPrepare,
  };
  fs.writeFileSync(
    '.tmp/env-chain-audit-20261030/adoption-probe.json',
    JSON.stringify(result, null, 2),
  );
  process.stdout.write(
    JSON.stringify(
      {
        detected: detection.stack,
        adopted: preview.stack,
        commands: preview.profile.commands,
        original: original.status,
        baseline: readiness.baseline?.status,
        ready: readiness.ok,
        missingDependencyRecordedAsKnown: readiness.baseline?.knownFailures,
        afterEnvironment,
        afterPrepare,
      },
      null,
      2,
    ),
  );
} finally {
  if (
    path.dirname(root) !== path.resolve(os.tmpdir()) ||
    !path.basename(root).startsWith('sg-adoption-audit-')
  ) {
    console.error('Unexpected fixture path; preserved without cleanup');
    process.exitCode = 1;
  } else {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
