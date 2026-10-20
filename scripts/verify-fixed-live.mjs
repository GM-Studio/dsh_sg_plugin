import fs from 'node:fs';
import path from 'node:path';
import { fixedScaffoldFiles } from '../src/v4/minimal-scaffold.js';
import { verifyFixedScaffold } from '../src/v4/minimal-verification.js';
// Developer-only template validation; not an SG initialization/approval entry point.
const required = ['SG_JAVA', 'SG_MAVEN', 'SG_NPM'];
for (const name of required)
  if (
    !process.env[name] ||
    !path.isAbsolute(process.env[name]) ||
    !fs.existsSync(process.env[name])
  )
    throw new Error(
      name + ' must name an existing absolute local tool path (no toolchains are downloaded)',
    );
const tools = {
  java: { path: process.env.SG_JAVA },
  mvn: { path: process.env.SG_MAVEN },
  node: { path: process.env.SG_NODE || process.execPath },
  npm: { path: process.env.SG_NPM },
  ...(process.env.SG_BROWSER_PATH ? { browser: { path: process.env.SG_BROWSER_PATH } } : {}),
};
const root = process.argv[2]
  ? path.resolve(process.argv[2])
  : fs.mkdtempSync(path.join(process.cwd(), '.sg-fixed-live-'));
for (const [name, content] of Object.entries(process.argv[2] ? {} : fixedScaffoldFiles())) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { flag: 'wx' });
}
console.log('LIVE_ROOT=' + root);
const result = await verifyFixedScaffold({
  root,
  tools,
  onStage: (stage) => console.log(JSON.stringify(stage)),
});
console.log(JSON.stringify({ root, result }, null, 2));
process.exitCode = result.ok ? 0 : 1;
