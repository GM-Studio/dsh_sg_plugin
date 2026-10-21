import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { javaFullstackFiles } from '../../src/v4/java-fullstack-template.js';
import { loadTemplateStyle, projectSourceHash } from '../../src/v3/template-style.js';
import { validateReview } from '../../src/v3/review.js';
import { runQualityStage } from '../../src/v3/quality.js';

test('project-local examples bind actual content and reject drift, traversal and missing references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-style-'));
  try {
    const files = javaFullstackFiles();
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    }
    const loaded = loadTemplateStyle(root);
    assert.equal(loaded.ok, true);
    assert.match(loaded.prompt, /class TaskService/);
    assert.match(loaded.prompt, /const taskApi/);
    for (const entry of loaded.references) {
      const file = path.join(root, entry.path);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n'));
    }
    assert.equal(
      loadTemplateStyle(root).ok,
      true,
      'Windows checkout line endings must not look like source drift',
    );
    const entry = loaded.references[0];
    const sourceHash = projectSourceHash(root);
    const checklist = Object.fromEntries(
      [
        'layering',
        'transactions',
        'errors',
        'authentication',
        'files',
        'templateStyle',
        'tests',
      ].map((name) => [
        name,
        { status: 'pass', reason: 'Checked actual reference source and test evidence' },
      ]),
    );
    const review = {
      verdict: 'pass',
      blocking: [],
      sourceHash,
      templateManifestHash: loaded.manifestHash,
      checklist,
    };
    assert.equal(validateReview(review, { files: [], text: '' }, '', root).ok, true);
    assert.equal(
      validateReview({ ...review, checklist: {} }, { files: [], text: '' }, '', root).ok,
      false,
    );
    assert.equal(
      validateReview({ ...review, sourceHash: 'stale' }, { files: [], text: '' }, '', root).ok,
      false,
    );
    fs.mkdirSync(path.join(root, 'backend/target'), { recursive: true });
    fs.writeFileSync(path.join(root, 'backend/target/build.txt'), 'runtime output');
    assert.equal(projectSourceHash(root), sourceHash);
    const beforeCode = projectSourceHash(root, { ignoreLocks: true });
    fs.appendFileSync(path.join(root, 'frontend/package-lock.json'), '\n');
    assert.notEqual(projectSourceHash(root), sourceHash);
    assert.equal(projectSourceHash(root, { ignoreLocks: true }), beforeCode);
    fs.appendFileSync(path.join(root, entry.path), 'drift');
    assert.equal(loadTemplateStyle(root).code, 'TEMPLATE_STYLE_DRIFT');
    fs.unlinkSync(path.join(root, entry.path));
    assert.equal(loadTemplateStyle(root).ok, false);
    const manifest = JSON.parse(files['.specgate/template-style.json']);
    manifest.samples = { '../outside': 'a'.repeat(64) };
    fs.writeFileSync(path.join(root, '.specgate/template-style.json'), JSON.stringify(manifest));
    assert.equal(loadTemplateStyle(root).code, 'TEMPLATE_STYLE_INVALID');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('legacy projects skip optional style but required missing/incompatible style blocks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-style-'));
  try {
    assert.equal(loadTemplateStyle(root).skipped, true);
    assert.equal(loadTemplateStyle(root, { required: true }).ok, false);
    fs.mkdirSync(path.join(root, '.specgate'));
    fs.writeFileSync(
      path.join(root, '.specgate/template-style.json'),
      JSON.stringify({ schemaVersion: 99, samples: {} }),
    );
    assert.equal(loadTemplateStyle(root).ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('quality execution evidence stays outside the tester change package', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-quality-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const worktree = path.join(root, 'worktree');
  fs.mkdirSync(worktree);
  fs.mkdirSync(path.join(root, '.specgate'));
  fs.writeFileSync(
    path.join(root, '.specgate/config.yaml'),
    'quality:\n  lint: ' + JSON.stringify([process.execPath, '-e', 'console.log(123)']) + '\n',
  );
  const result = runQualityStage({
    root,
    worktree,
    change: 'sample',
    task: { id: 'T-001' },
    stage: 'lint',
  });
  assert.equal(result.ok, true);
  assert.ok(result.report.startsWith(path.join(root, '.specgate/runs')));
  assert.equal(
    fs.existsSync(path.join(worktree, 'openspec/changes/sample/reviews/lint-report.md')),
    false,
  );
  assert.match(fs.readFileSync(result.report, 'utf8'), /123/);
});
