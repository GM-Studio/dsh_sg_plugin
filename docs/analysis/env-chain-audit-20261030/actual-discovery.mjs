import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createEnvironmentService } from '../../../src/codex/core/environment.js';
import { runBaselineCommand } from '../../../src/codex/baseline.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-discovery-audit-'));
try {
  const result = await createEnvironmentService({ root }).check({
    preset: 'jdk17-boot3.5',
    frontend: 'react',
  });
  const mavenByName = await runBaselineCommand({
    command: { id: 'audit-maven-by-name', argv: ['mvn', '-v'] },
    cwd: root,
    timeoutMs: 15000,
  });
  const mavenByDiscoveredPath = result.tools?.maven?.path
    ? await runBaselineCommand({
        command: { id: 'audit-maven-absolute', argv: [result.tools.maven.path, '-v'] },
        cwd: root,
        timeoutMs: 15000,
      })
    : null;
  const evidence = {
    scope:
      'Real read-only toolchain discovery on the current Windows host; manually supplied Java17+React selection for this fixture only.',
    result,
    mavenByName,
    mavenByDiscoveredPath,
  };
  fs.writeFileSync(
    '.tmp/env-chain-audit-20261030/actual-discovery.json',
    JSON.stringify(evidence, null, 2),
  );
  process.stdout.write(JSON.stringify(evidence, null, 2));
} finally {
  if (
    path.dirname(root) !== path.resolve(os.tmpdir()) ||
    !path.basename(root).startsWith('sg-discovery-audit-')
  ) {
    console.error('Unexpected fixture path; preserved without cleanup');
    process.exitCode = 1;
  } else {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
