// Real template acceptance, also used by read-only repository hooks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JAVA_PRESETS, templateHash } from '../src/v4/java-versions.js';
import { startJavaInit } from '../src/v4/java-init.js';
import { javaFullstackFiles } from '../src/v4/java-fullstack-template.js';
import { verifyJavaProject } from '../src/v4/java-verify.js';
import { executeCommand } from './quality-checks.mjs';
const full = process.argv.includes('--full');
const repo = fileURLToPath(new URL('../', import.meta.url));
const requested = process.argv.slice(2).find((item) => !item.startsWith('--'));
const presets = requested ? JAVA_PRESETS.filter((item) => item.id === requested) : JAVA_PRESETS;
if (!presets.length) throw new Error('Unknown preset: ' + requested);
const parent = path.resolve('.specgate/template-qa/' + Date.now());
fs.mkdirSync(parent, { recursive: true });
const results = [];
for (const preset of presets) {
  const root = path.join(parent, preset.id);
  let generatedHash;
  if (process.env.SG_QUALITY_REPOSITORY) {
    // Test the candidate template even when its Golden is intentionally stale.
    // No Git baseline or Golden promotion is part of hook verification.
    const files = javaFullstackFiles({ preset });
    generatedHash = templateHash(files);
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.specgate', 'monorepo.json'),
      JSON.stringify({ stack: 'java-vue', preset: preset.id }),
    );
  } else {
    const init = await startJavaInit({
      root,
      version: preset.id,
      userQuestions: { ask: async () => ({ answers: [{ selected: ['确认'] }] }) },
    });
    if (!init.ok) throw new Error(JSON.stringify(init));
    generatedHash = init.report.template.hash;
  }
  console.log('VERIFY ' + root);
  for (const name of ['scripts/run.mjs', 'scripts/frontend-test.mjs'])
    executeCommand(
      'template-script-' + path.basename(name),
      process.execPath,
      ['--check', path.join(root, name)],
      { cwd: root },
    );
  const launchers = [];
  const findLaunchers = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) findLaunchers(file);
      else if (/\.(mjs|js)$/.test(entry.name)) launchers.push(file);
    }
  };
  findLaunchers(path.join(root, 'scripts'));
  executeCommand(
    'template-script-lint',
    process.execPath,
    [
      path.join(repo, 'node_modules/eslint/bin/eslint.js'),
      '--config',
      path.join(repo, 'eslint.config.js'),
      '--no-ignore',
      '--max-warnings=0',
      ...launchers,
    ],
    { cwd: root },
  );
  executeCommand(
    'template-script-format',
    process.execPath,
    [
      path.join(repo, 'node_modules/prettier/bin/prettier.cjs'),
      '--config',
      path.join(repo, '.prettierrc.json'),
      '--ignore-path',
      path.join(repo, '.prettierrc.json'),
      '--check',
      ...launchers,
    ],
    { cwd: root },
  );
  const candidateRepo = process.env.SG_QUALITY_REPOSITORY;
  const result = await verifyJavaProject({
    root,
    install: false,
    full,
    scan: candidateRepo
      ? {
          javaRoots: undefined,
          extraJavaRoots: [path.join(candidateRepo, '.specgate/toolchains')],
          extraMavenRoots: [path.join(candidateRepo, '.specgate/toolchains')],
        }
      : {},
    onProgress: (event) => console.log(event.message),
  });
  const record = { preset: preset.id, templateHash: generatedHash, root, ...result };
  results.push(record);
  if (templateHash(javaFullstackFiles({ preset })) !== generatedHash) {
    record.ok = false;
    record.code = 'TEMPLATE_CHANGED_DURING_ACCEPTANCE';
    record.message = 'Template changed during acceptance; rerun the final content';
  }
  fs.writeFileSync(path.join(parent, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(record.message);
  if (!record.ok) {
    process.exitCode = 1;
    break;
  }
}
console.log('Evidence: ' + path.join(parent, 'results.json'));
