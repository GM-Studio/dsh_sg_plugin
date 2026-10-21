#!/usr/bin/env node
// Explicit formatting only. Never stages files or executes commit/push.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyFile } from './quality-snapshot.mjs';
import { executeCommand } from './quality-checks.mjs';
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const files = [
  ...new Set([
    ...execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).split('\0'),
    ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'utf8',
    }).split('\0'),
  ]),
].filter((name) => name && fs.existsSync(path.join(root, name)));
const formats = files.filter((name) =>
  ['javascript', 'typescript', 'vue', 'format'].includes(classifyFile(name)),
);
if (formats.length)
  executeCommand(
    'format-explicit',
    process.execPath,
    ['node_modules/prettier/bin/prettier.cjs', '--write', '--', ...formats],
    { cwd: root },
  );
const python = files.filter((name) => classifyFile(name) === 'python');
const shell = files.filter((name) => classifyFile(name) === 'shell');
if (shell.length)
  executeCommand(
    'shell-format-explicit',
    process.execPath,
    [
      'node_modules/prettier/bin/prettier.cjs',
      '--plugin=prettier-plugin-sh',
      '--parser=sh',
      '--write',
      '--',
      ...shell,
    ],
    { cwd: root },
  );
if (python.length)
  executeCommand(
    'python-format-explicit',
    process.env.SG_RUFF || 'ruff',
    ['format', '--', ...python],
    {
      cwd: root,
    },
  );
const templates = files.filter((name) =>
  ['java-template', 'reference-template', 'java-scaffold'].includes(classifyFile(name)),
);
if (templates.length)
  console.log(
    'Template formatting uses the generated project tools; copy reviewed output back to source, then rerun acceptance:\n' +
      templates.join('\n'),
  );
console.log('Formatting complete. Review changes and stage them yourself.');
