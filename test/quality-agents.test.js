import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initProject } from '../src/init.js';
import { createRequirementChange } from '../src/requirements.js';
import { writeProjectConfig } from '../src/project.js';
import { runFormatAgent, runReviewAgent } from '../src/dispatch.js';
import { formatReportPath, reviewReportPath, validateFormatReport, validateReviewReport } from '../src/format.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-quality-'));
  execFileSync('git', ['init'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'SpecGate Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'specgate-test@example.com'], { cwd: root });
  initProject(root, { requirements: true });
  createRequirementChange(root, 'add-login');
  writeProjectConfig(root, {
    formatCommand: 'node -e "" {files}',
    lintCommand: 'node -e "" {files}',
  });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'login.js'), 'export const login = 1;\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test: change'], { cwd: root });
  return root;
}

test('formatter runs on changed files and validates its report', async () => {
  const root = makeProject();
  let promptSeen = '';
  const result = await runFormatAgent({
    root,
    change: 'add-login',
    parent: null,
    language: 'zh',
    runner: async ({ cwd, prompt }) => {
      promptSeen = prompt;
      fs.appendFileSync(path.join(cwd, 'src', 'login.js'), '// formatted\n');
      fs.writeFileSync(
        formatReportPath(cwd, 'add-login'),
        'verdict: pass\nlint: pass\nchanged_files:\n  - src/login.js\nfixed_files:\n  - src/login.js\n',
      );
      return { ok: true, text: 'formatted' };
    },
  });

  assert.equal(result.ok, true, result.text);
  assert.match(promptSeen, /src\/login\.js/);
  assert.equal(validateFormatReport(root, 'add-login').ok, true);
});

test('formatter stops when no format/lint command exists', async () => {
  const root = makeProject();
  writeProjectConfig(root, { formatCommand: null, lintCommand: null });
  const packageFile = path.join(root, 'package.json');
  if (fs.existsSync(packageFile)) fs.rmSync(packageFile);
  const result = await runFormatAgent({
    root,
    change: 'add-login',
    parent: null,
    runner: async () => ({ ok: true, text: 'should not run' }),
  });
  assert.equal(result.ok, false);
  assert.match(result.text, /formatCommand/);
});

test('reviewer writes a read-only report and blocking items fail validation', async () => {
  const root = makeProject();
  const result = await runReviewAgent({
    root,
    change: 'add-login',
    parent: null,
    runner: async ({ cwd }) => {
      fs.writeFileSync(
        reviewReportPath(cwd, 'add-login'),
        'verdict: fail\nblocking:\n  - id: RV-001\n    file: src/login.js\n    reason: missing check\nnon_blocking: []\n',
      );
      return { ok: true, text: 'reviewed' };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(validateReviewReport(root, 'add-login').ok, false);
});
