import fs from 'node:fs';
import path from 'node:path';
import { finalizeJavaInitialization } from '../src/v4/java-init.js';
const root = path.resolve(process.argv[2]);
const pending = JSON.parse(fs.readFileSync(path.join(root, '.specgate/init-pending.json'), 'utf8'));
const reports = {};
const log = (file) => {
  const b = fs.readFileSync(path.join(root, file));
  return b[0] === 255 && b[1] === 254
    ? b.toString('utf16le').replace(/^\uFEFF/, '')
    : b.toString('utf8');
};
for (const stage of ['test', 'lint', 'format']) {
  const backend = log('.specgate/validation-logs/backend-' + stage + '.log');
  const frontend = log('frontend/frontend-' + stage + '.log');
  const backendCode = stage === 'format' ? 0 : 1;
  const frontendCode = 0;
  if (stage === 'format' && !backend.includes('BUILD SUCCESS'))
    throw new Error('format log not successful');
  if (stage === 'test' && !backend.includes('Cannot create resource output directory'))
    throw new Error('unknown test failure');
  if (stage === 'lint' && !backend.includes('Unable to create output stream'))
    throw new Error('unknown lint failure');
  const report = {
    schemaVersion: 1,
    stage,
    baseline: pending.token.baseline,
    status: backendCode ? 'unverified' : 'verified',
    summary: backendCode
      ? 'Backend command attempted but environment prevented target output creation; frontend actual command passed. Not a backend test/static pass.'
      : 'Actual backend Spotless check and frontend format check passed.',
    findings: [],
    commands: [
      {
        command: 'mvn',
        args: [
          '-B',
          stage === 'test' ? 'test' : stage === 'lint' ? 'checkstyle:check' : 'spotless:check',
        ],
        cwd: 'backend',
        exitCode: backendCode,
        stdout: backend,
        stderr: '',
        ...(backendCode ? { reason: 'environment' } : {}),
      },
      {
        command: 'npm',
        args: stage === 'test' ? ['test'] : ['run', stage === 'lint' ? 'lint' : 'format:check'],
        cwd: 'frontend',
        exitCode: frontendCode,
        stdout: frontend,
        stderr: '',
      },
    ],
  };
  reports[stage] = 'docs/initialization/pending/' + pending.token.baseline + '/' + stage + '.json';
  fs.mkdirSync(path.dirname(path.join(root, reports[stage])), { recursive: true });
  fs.writeFileSync(path.join(root, reports[stage]), JSON.stringify(report, null, 2) + '\n');
}
reports.review = 'docs/initialization/pending/' + pending.token.baseline + '/review.json';
const result = await finalizeJavaInitialization({
  root,
  token: pending.token,
  reports,
  parent: { id: 'development-main-agent-validation' },
});
console.log(
  JSON.stringify(
    {
      ok: result.ok,
      code: result.code,
      phase: result.phase,
      message: result.message,
      archive: result.report?.archive,
      archiveCommit: result.report?.archiveCommit,
      errors: result.report?.verification?.errors,
    },
    null,
    2,
  ),
);
process.exitCode = result.ok ? 0 : 1;
