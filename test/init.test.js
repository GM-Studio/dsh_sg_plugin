import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initProject } from '../src/init.js';
import { walkFiles } from '../src/util.js';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-init-'));
  execFileSync('git', ['init'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'SpecGate Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'specgate-test@example.com'], { cwd: root });
  return root;
}

test('initProject materializes 30 skills, 9 agents and the SpecGate skeleton', () => {
  const root = makeRoot();
  const report = initProject(root);

  assert.equal(report.skills.total, 30);
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'config.yaml')));
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'deviations.log')));
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'gates')));
  assert.ok(fs.existsSync(path.join(root, 'openspec', 'changes')));
  assert.ok(fs.existsSync(path.join(root, 'openspec', 'specs')));
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'experiences', 'index.md')));
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'experiences', 'trigger-guide.md')));
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'rules', 'cli-rules.md')));
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'briefs', 'README.md')));
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'out-of-scope', 'README.md')));
  assert.ok(report.knowledge.created > 0);
  assert.ok(fs.existsSync(path.join(root, '.git')));
  assert.equal(report.git.committed, true);
  assert.ok(report.git.hash);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'specgate', 'examples', 'example-change', 'proposal.md')));
  assert.ok(fs.existsSync(path.join(root, 'docs', 'prd', 'vision.md')));
  assert.ok(fs.existsSync(path.join(root, 'CONTEXT.md')));
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /## 门控/);

  const skillFiles = walkFiles(path.join(root, '.dsh', 'skills', 'specgate')).filter((file) =>
    /[\\/]SKILL\.md$/i.test(file),
  );
  assert.equal(skillFiles.length, 30);

  const agentFiles = fs
    .readdirSync(path.join(root, '.specgate', 'agents'))
    .filter((name) => name.endsWith('.md'));
  assert.equal(agentFiles.length, 9);

  const agentsMd = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agentsMd, /<!-- specgate:begin -->/);

  const skill = fs.readFileSync(
    path.join(root, '.dsh', 'skills', 'specgate', 'sg-skill-entry-guard', 'SKILL.md'),
    'utf8',
  );
  assert.match(skill, /SpecGate 适配/);
  assert.equal(skill.includes('.qoder/'), false);
});

test('initProject is idempotent and does not overwrite user edits', () => {
  const root = makeRoot();
  initProject(root);
  const configPath = path.join(root, '.specgate', 'config.yaml');
  fs.writeFileSync(configPath, 'version: 1\nenabled: true\nenforcement: hybrid\nparadigm: L3\n');

  const report = initProject(root);
  assert.ok(report.skipped.includes('.specgate/config.yaml'));
  const config = fs.readFileSync(configPath, 'utf8');
  assert.match(config, /paradigm:\s*"?L3"?/);
});

test('initProject appends the SpecGate section only once', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Project\n\nExisting rules.\n');
  initProject(root);
  const first = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.equal((first.match(/specgate:begin/g) || []).length, 1);
  initProject(root);
  const second = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.equal((second.match(/specgate:begin/g) || []).length, 1);
  assert.match(second, /Existing rules/);
});
