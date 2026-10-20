import fs from 'node:fs';
import path from 'node:path';
import { executeJavaInit } from '../src/v4/java-init-execution.js';
const root = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Provide existing pending DEVELOPMENT fixture');
const pending = JSON.parse(fs.readFileSync(path.join(root, '.specgate/init-pending.json'), 'utf8'));
const result = await executeJavaInit({
  root,
  env: process.env,
  formatCheck: true,
  execution: { test: true, lint: true, format: true },
});
for (const stage of ['test', 'lint', 'format']) {
  const item = result.stages.find((x) => x.name === stage);
  console.log(
    JSON.stringify({
      stage,
      item,
      logs: result.logs.filter((x) => x.stage === stage),
      errors: result.errors,
      limitations: result.limitations,
    }),
  );
}
console.log(JSON.stringify({ token: pending.token, ok: result.ok, reportPath: result.reportPath }));
