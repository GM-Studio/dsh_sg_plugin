import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { initProject } from '../src/init.js';
import { confirmGate } from '../src/gates.js';
import { performGateAction } from '../src/gate-actions.js';
import { computeStatus } from '../src/status.js';
import {
  applyRequirementChange,
  createRequirementChange,
  migrateRequirements,
  parseTestReport,
  readRequirements,
  requirementsPath,
  testPaths,
  validateTestPlan,
  validateTestReport,
} from '../src/requirements.js';

function makeV2() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-requirements-'));
  initProject(root, { requirements: true, git: false });
  return root;
}

test('v2 init creates one canonical requirements doc and a v1.0.0 snapshot', () => {
  const root = makeV2();
  const req = readRequirements(root);
  assert.equal(req.version, '1.0.0');
  assert.equal(req.status, 'approved');
  assert.equal(fs.existsSync(path.join(root, 'requirements', 'history', 'v1.0.0', 'REQUIREMENTS.md')), true);
  assert.equal(fs.existsSync(path.join(root, 'requirements', 'changes')), true);
  assert.equal(fs.existsSync(path.join(root, 'tests', 'specgate')), true);
});

test('a requirement change applies a delta once and appends an immutable snapshot', () => {
  const root = makeV2();
  const created = createRequirementChange(root, 'add-login', 'add login');
  assert.equal(created.created, true);
  const changeFile = path.join(root, 'requirements', 'changes', 'add-login', 'change.json');
  const change = JSON.parse(fs.readFileSync(changeFile, 'utf8'));
  change.added = [
    {
      id: 'FR-001',
      title: 'User login',
      priority: 'P0',
      acceptance: ['AC-001'],
    },
  ];
  change.acceptance = [{ id: 'AC-001', title: 'Correct password logs in' }];
  fs.writeFileSync(changeFile, `${JSON.stringify(change, null, 2)}\n`);

  const applied = applyRequirementChange(root, 'add-login');
  assert.equal(applied.applied, true);
  assert.equal(applied.version, '1.1.0');
  const req = readRequirements(root);
  assert.equal(req.version, '1.1.0');
  assert.equal(req.requirements[0].id, 'FR-001');
  assert.equal(fs.existsSync(path.join(root, 'requirements', 'history', 'v1.1.0', 'REQUIREMENTS.md')), true);

  const second = applyRequirementChange(root, 'add-login');
  assert.equal(second.applied, false);
  assert.equal(second.version, '1.1.0');
});

test('v2 status exposes the requirement version and current change', () => {
  const root = makeV2();
  createRequirementChange(root, 'add-login');
  const status = computeStatus(root, { fresh: true });
  assert.equal(status.isV2, true);
  assert.equal(status.requirements.version, '1.0.0');
  assert.equal(status.requirementChange.name, 'add-login');
});

test('G3 confirmation applies the change delta and bumps the version', async () => {
  const root = makeV2();
  createRequirementChange(root, 'add-login');
  const changeFile = path.join(root, 'requirements', 'changes', 'add-login', 'change.json');
  const change = JSON.parse(fs.readFileSync(changeFile, 'utf8'));
  change.added = [{ id: 'FR-010', title: 'Login', priority: 'P0' }];
  fs.writeFileSync(changeFile, `${JSON.stringify(change, null, 2)}\n`);
  confirmGate(root, 'G1');
  confirmGate(root, 'G2');

  const result = await performGateAction(
    { get: () => undefined },
    null,
    null,
    root,
    { gate: 'G3', action: 'confirm', interactive: false, confirmed: true, language: 'zh' },
  );
  assert.equal(result.ok, true);
  assert.match(result.text, /1\.1\.0/);
  assert.equal(readRequirements(root).version, '1.1.0');
});

test('test plan and test report validation enforce cases, coverage and verdict', () => {
  const root = makeV2();
  createRequirementChange(root, 'add-login');
  const paths = testPaths(root, 'add-login');
  assert.equal(validateTestPlan(root, 'add-login').ok, false);
  fs.writeFileSync(paths.cases, '# Cases\n\n### TC-001\n- Priority: P0\n');
  fs.writeFileSync(paths.matrix, '| Requirement | Case |\n|---|---|\n| FR-001 | TC-001 |\n');
  assert.equal(validateTestPlan(root, 'add-login').ok, true);

  assert.equal(validateTestReport(root, 'add-login').ok, false);
  fs.writeFileSync(
    paths.report,
    'verdict: pass\nP0: 90\nP1: 100\nP2: 95\nline: 85\nbranch: 75\n',
  );
  assert.equal(validateTestReport(root, 'add-login').ok, false);
  fs.writeFileSync(
    paths.report,
    'verdict: pass\nP0: 100\nP1: 100\nP2: 95\nline: 85\nbranch: 75\n',
  );
  const report = validateTestReport(root, 'add-login');
  assert.equal(report.ok, true);
  assert.equal(report.line, 85);
  assert.equal(parseTestReport('结论：通过\n行覆盖率：90%\n分支覆盖率：80%').pass, true);
});

test('G5 rejects an unfinished test plan and G8 requires a passing report', async () => {
  const root = makeV2();
  createRequirementChange(root, 'add-login');
  for (const gate of ['G1', 'G2', 'G3', 'G4']) confirmGate(root, gate);

  const ctx = { get: () => undefined };
  const g5 = await performGateAction(ctx, null, null, root, {
    gate: 'G5', action: 'confirm', interactive: false, confirmed: true, language: 'zh',
  });
  assert.equal(g5.ok, false);
  assert.match(g5.text, /TC-/);

  const paths = testPaths(root, 'add-login');
  fs.writeFileSync(paths.cases, '# Plan\n\n### TC-001\n');
  fs.writeFileSync(paths.matrix, '| R | C |\n|---|---|\n| FR-001 | TC-001 |\n');
  const g5b = await performGateAction(ctx, null, null, root, {
    gate: 'G5', action: 'confirm', interactive: false, confirmed: true, language: 'zh',
  });
  assert.equal(g5b.ok, true);
  for (const gate of ['G6', 'G7']) confirmGate(root, gate);

  const g8 = await performGateAction(ctx, null, null, root, {
    gate: 'G8', action: 'confirm', interactive: false, confirmed: true, language: 'zh',
  });
  assert.equal(g8.ok, false);
  fs.writeFileSync(paths.report, 'verdict: pass\nline: 85\nbranch: 75\n');
  const g8b = await performGateAction(ctx, null, null, root, {
    gate: 'G8', action: 'confirm', interactive: false, confirmed: true, language: 'zh',
  });
  assert.equal(g8b.ok, true);
});

test('legacy openspec projects migrate explicitly and are never auto-converted', () => {  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-legacy-'));
  fs.mkdirSync(path.join(root, 'openspec', 'changes', 'old-change'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'openspec', 'changes', 'old-change', 'proposal.md'),
    '# Old Change\n\n## Intent\n\nlegacy\n',
  );
  assert.equal(readRequirements(root), null);
  const dry = migrateRequirements(root, { dryRun: true });
  assert.equal(dry.ok, true);
  assert.equal(fs.existsSync(requirementsPath(root)), false);
  const applied = migrateRequirements(root);
  assert.equal(applied.ok, true);
  assert.equal(readRequirements(root).version, '1.0.0');
  assert.equal(fs.existsSync(path.join(root, 'requirements', 'changes', 'old-change', 'change.md')), true);
  assert.equal(migrateRequirements(root).already, true);
});
