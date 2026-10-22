import path from 'node:path';
import { verifyProject } from '../src/codex/verify.js';

const root = process.argv[2];
if (!root || !path.isAbsolute(root)) {
  process.stderr.write('Usage: node scripts/verify-project-pilot.mjs <absolute-project-root>\n');
  process.exitCode = 1;
} else {
  const result = await verifyProject({ root, timeoutMs: 10 * 60 * 1000 });
  process.stdout.write(
    JSON.stringify(
      {
        ok: result.ok,
        code: result.code || null,
        runId: result.runId || result.report?.runId || null,
        sourceHash: result.sourceHash || result.report?.sourceHash || null,
        status: result.report?.status || null,
      },
      null,
      2,
    ) + '\n',
  );
  if (!result.ok) process.exitCode = 1;
}
