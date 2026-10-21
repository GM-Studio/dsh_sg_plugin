// Real, opt-in template acceptance. Not part of the offline unit test suite.
import fs from 'node:fs';
import path from 'node:path';
import { JAVA_PRESETS, templateHash } from '../src/v4/java-versions.js';
import { startJavaInit } from '../src/v4/java-init.js';
import { javaFullstackFiles } from '../src/v4/java-fullstack-template.js';
import { verifyJavaProject } from '../src/v4/java-verify.js';

const full = process.argv.includes('--full');
const requested = process.argv.slice(2).find((item) => !item.startsWith('--'));
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
  const generatedHash = init.report.template.hash;
  console.log('VERIFY ' + root);
  const result = await verifyJavaProject({
    root,
    install: false,
    full,
    onProgress: (event) => console.log(event.message),
  });
  const record = {
    preset: preset.id,
    templateHash: generatedHash,
    root,
    ...result,
  };
  results.push(record);
  if (templateHash(javaFullstackFiles({ preset })) !== generatedHash) {
    record.ok = false;
    record.code = 'TEMPLATE_CHANGED_DURING_ACCEPTANCE';
    record.message = 'Template source changed during acceptance; rerun the final content';
  }
  fs.writeFileSync(path.join(parent, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(record.message);
  if (!record.ok) {
    process.exitCode = 1;
    break;
  }
}
console.log('Evidence: ' + path.join(parent, 'results.json'));
