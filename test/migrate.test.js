import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { migrateProject } from '../src/migrate.js';

function makeLegacy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-migrate-'));
  fs.mkdirSync(path.join(root, '.ak47', 'gates'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.ak47', 'config.yaml'),
    'version: 1\nenabled: true\nenforcement: hybrid\ngit: false\n',
  );
  fs.writeFileSync(path.join(root, '.ak47', 'gates', 'G1.confirmed'), '2026-10-18T00:00:00.000Z\n');
  fs.writeFileSync(
    path.join(root, '.ak47', 'deviations.log'),
    '# AK47 deviations (append-only)\n\n- timestamp: "2026-10-18T00:00:00.000Z"\n  gate: "G3"\n  reason: "legacy"\n  impact: "low"\n',
  );
  fs.mkdirSync(path.join(root, '.dsh', 'skills', 'ak47', 'sg-skill-entry-guard'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.dsh', 'skills', 'ak47', 'sg-skill-entry-guard', 'SKILL.md'),
    '# entry guard\n\nRun /ak47-status and use .ak47/gates.\n',
  );
  fs.writeFileSync(
    path.join(root, 'AGENTS.md'),
    '# AGENTS\n\n<!-- ak47-dsh:begin -->\n- run /ak47-status\n<!-- ak47-dsh:end -->\n',
  );
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'demo'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'openspec', 'changes', 'demo', 'tasks.md'),
    '- [ ] T1 run /ak47-status\n',
  );
  return root;
}

test('migrate dry-run reports the plan and changes nothing', () => {
  const root = makeLegacy();
  const result = migrateProject(root, { dryRun: true });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.match(result.text, /\.ak47/);
  assert.equal(fs.existsSync(path.join(root, '.specgate')), false);
  assert.equal(fs.existsSync(path.join(root, '.ak47')), true);
});

test('migrate moves .ak47 to a backup and rewrites managed SpecGate assets', () => {
  const root = makeLegacy();
  const result = migrateProject(root);

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(root, '.ak47')), false);
  assert.equal(fs.existsSync(path.join(root, '.specgate')), true);
  assert.ok(result.backup.startsWith(path.join(root, '.ak47.')));
  assert.equal(fs.existsSync(result.backup), true);

  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /<!-- specgate:begin -->/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /ak47/);
  assert.equal(
    fs.existsSync(path.join(root, '.dsh', 'skills', 'specgate', 'sg-skill-entry-guard', 'SKILL.md')),
    true,
  );
  const skill = fs.readFileSync(
    path.join(root, '.dsh', 'skills', 'specgate', 'sg-skill-entry-guard', 'SKILL.md'),
    'utf8',
  );
  assert.match(skill, /\/sg-status/);
  assert.match(skill, /\.specgate\/gates/);
  assert.equal(fs.existsSync(path.join(root, '.specgate', 'gates', 'G1.confirmed')), true);
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'reports')));
});

test('migrate is idempotent once .specgate exists and refuses an existing target without force', () => {
  const root = makeLegacy();
  const first = migrateProject(root);
  assert.equal(first.ok, true);

  const second = migrateProject(root);
  assert.equal(second.ok, true);
  assert.equal(second.already, true);

  const other = makeLegacy();
  fs.mkdirSync(path.join(other, '.specgate'), { recursive: true });
  fs.writeFileSync(path.join(other, '.specgate', 'existing.txt'), 'keep');
  const refused = migrateProject(other);
  assert.equal(refused.ok, false);
  assert.match(refused.text, /--force/);

  const forced = migrateProject(other, { force: true });
  assert.equal(forced.ok, true);
  assert.ok(forced.targetBackup);
  assert.equal(fs.existsSync(path.join(other, '.specgate', 'existing.txt')), false);
  assert.equal(fs.existsSync(path.join(forced.targetBackup, 'existing.txt')), true);
});
