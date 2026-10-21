// Real, opt-in template acceptance. Not part of the offline unit test suite.
import fs from 'node:fs';
import path from 'node:path';
import { JAVA_PRESETS, templateHash } from '../src/v4/java-versions.js';
import { startJavaInit } from '../src/v4/java-init.js';
import { javaFullstackFiles } from '../src/v4/java-fullstack-template.js';
import { verifyJavaProject } from '../src/v4/java-verify.js';

const requested = process.argv[2];
const presets = requested ? JAVA_PRESETS.filter((item) => item.id === requested) : JAVA_PRESETS;
if (!presets.length) throw new Error('Unknown preset: ' + requested);
const parent = path.resolve('.specgate/template-qa/' + Date.now());
fs.mkdirSync(parent, { recursive: true });
const results = [];
for (const preset of presets) {
  const root = path.join(parent, preset.id);
  const init = await startJavaInit({
    root,
    version: preset.id,
    userQuestions: { ask: async () => ({ answers: [{ selected: ['确认'] }] }) },
  });
  if (!init.ok) throw new Error(JSON.stringify(init));
  console.log('VERIFY ' + root);
  const result = await verifyJavaProject({
    root,
    install: false,
    onProgress: (event) => console.log(event.message),
  });
  const record = {
    preset: preset.id,
    templateHash: templateHash(javaFullstackFiles({ preset })),
    root,
    ...result,
  };
  results.push(record);
  fs.writeFileSync(path.join(parent, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(result.message);
  if (!result.ok) {
    process.exitCode = 1;
    break;
  }
}
console.log('Evidence: ' + path.join(parent, 'results.json'));
