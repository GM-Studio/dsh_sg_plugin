import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initProject, renderInitReport } from '../src/init.js';
import { loadProject } from '../src/project.js';
import { walkFiles } from '../src/util.js';

process.env.GIT_AUTHOR_NAME = 'SpecGate Test';
process.env.GIT_AUTHOR_EMAIL = 'specgate-test@example.com';
process.env.GIT_COMMITTER_NAME = 'SpecGate Test';
process.env.GIT_COMMITTER_EMAIL = 'specgate-test@example.com';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-v11-'));
}

function skillFiles(root) {
  return walkFiles(path.join(root, '.dsh', 'skills', 'specgate')).filter((file) =>
    /[\\/]SKILL\.md$/i.test(file),
  );
}

test('--path creates a new project directory with git and an initial commit', () => {
  const base = tempDir();
  const report = initProject(base, { path: 'new-app' });

  assert.equal(report.createdTarget, true);
  assert.equal(report.git.committed, true);
  assert.ok(report.git.hash);
  assert.ok(fs.existsSync(path.join(base, 'new-app', '.git')));
  assert.ok(fs.existsSync(path.join(base, 'new-app', 'openspec', 'changes')));
  assert.ok(fs.existsSync(path.join(base, 'new-app', 'AGENTS.md')));
  assert.ok(fs.existsSync(path.join(base, 'new-app', 'docs', 'specgate', 'examples', 'example-change', 'proposal.md')));
  assert.equal(skillFiles(path.join(base, 'new-app')).length, 30);
  assert.match(
    fs.readFileSync(path.join(base, 'new-app', 'AGENTS.md'), 'utf8'),
    /## 门控/,
  );
});

test('--minimal generates skeleton, skills and a minimal AGENTS.md only', () => {
  const base = tempDir();
  const report = initProject(base, { path: 'mini', minimal: true });

  assert.equal(report.minimal, true);
  assert.equal(skillFiles(path.join(base, 'mini')).length, 30);
  assert.ok(fs.existsSync(path.join(base, 'mini', 'openspec', 'changes')));
  assert.ok(fs.existsSync(path.join(base, 'mini', '.specgate', 'experiences', 'index.md')));
  assert.equal(fs.existsSync(path.join(base, 'mini', '.specgate', 'agents')), false);
  assert.equal(fs.existsSync(path.join(base, 'mini', '.specgate', 'templates')), false);
  assert.equal(fs.existsSync(path.join(base, 'mini', 'docs')), false);

  const agents = fs.readFileSync(path.join(base, 'mini', 'AGENTS.md'), 'utf8');
  assert.match(agents, /SpecGate 工作流/);
  assert.equal(agents.includes('## 门控'), false);
  assert.match(renderInitReport(report), /精简规则/);
});

test('--no-git skips the repository and records git: false', () => {
  const base = tempDir();
  const report = initProject(base, { path: 'nogit', git: false, minimal: true });

  assert.equal(report.git.enabled, false);
  assert.equal(fs.existsSync(path.join(base, 'nogit', '.git')), false);
  assert.equal(loadProject(path.join(base, 'nogit')).gitEnabled, false);
});

test('an existing non-empty --path requires force', () => {
  const base = tempDir();
  const target = path.join(base, 'existing');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'keep.txt'), 'keep\n');

  assert.throws(
    () => initProject(base, { path: 'existing', git: false }),
    /目标目录非空/,
  );

  const report = initProject(base, { path: 'existing', git: false, minimal: true, force: true });
  assert.ok(report);
  assert.ok(fs.existsSync(path.join(target, 'keep.txt')));
  assert.ok(fs.existsSync(path.join(target, '.specgate', 'config.yaml')));
});

test('existing AGENTS.md is backed up, merged and not duplicated', () => {
  const root = tempDir();
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Project\n\nUser rules.\n');

  const first = initProject(root, { git: false });
  assert.equal(first.agentsSection.appended, true);
  const afterFirst = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(afterFirst, /User rules/);
  assert.equal((afterFirst.match(/specgate:begin/g) || []).length, 1);

  const backups = fs.readdirSync(path.join(root, '.specgate', 'backups'));
  assert.equal(backups.length, 1);

  const second = initProject(root, { git: false });
  assert.equal(second.agentsSection.unchanged, true);
  const afterSecond = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.equal((afterSecond.match(/specgate:begin/g) || []).length, 1);
  assert.equal(fs.readdirSync(path.join(root, '.specgate', 'backups')).length, 1);
});

test('--disabled initializes but keeps gating off', () => {
  const root = tempDir();
  initProject(root, { git: false, minimal: true, disabled: true });
  assert.equal(loadProject(root).enabled, false);
  assert.match(fs.readFileSync(path.join(root, '.specgate', 'config.yaml'), 'utf8'), /enabled: false/);
});
