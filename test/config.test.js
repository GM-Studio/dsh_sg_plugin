import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { adaptContent, listSkillAssets } from '../src/assets.js';
import {
  DEFAULT_GLOBAL_CONFIG,
  initOptionsFromGlobal,
  normalizeGlobalConfig,
} from '../src/config.js';
import { initProject } from '../src/init.js';
import { loadProject } from '../src/project.js';

test('global config is normalized with safe defaults', () => {
  const config = normalizeGlobalConfig({
    defaultEnabled: false,
    enforcement: 'off',
    maxConcurrency: 7,
    language: 'en-US',
    materializeSkills: false,
  });
  assert.equal(config.defaultEnabled, false);
  assert.equal(config.enforcement, 'off');
  assert.equal(config.maxConcurrency, 7);
  assert.equal(config.language, 'en');
  assert.equal(config.materializeSkills, false);
  assert.equal(config.materializeAgents, DEFAULT_GLOBAL_CONFIG.materializeAgents);

  const fallback = normalizeGlobalConfig({ enforcement: 'bogus', maxConcurrency: -1 });
  assert.equal(fallback.enforcement, 'hybrid');
  assert.equal(fallback.maxConcurrency, 4);
  assert.equal(fallback.language, 'zh');
});

test('global defaults only seed new project options; project config wins afterwards', () => {
  const merged = initOptionsFromGlobal(
    { defaultEnabled: false, language: 'en', maxConcurrency: 6, git: false },
    { force: true },
  );
  assert.equal(merged.enabled, false);
  assert.equal(merged.language, 'en');
  assert.equal(merged.maxConcurrency, 6);
  assert.equal(merged.git, false);
  assert.equal(merged.force, true);

  const explicit = initOptionsFromGlobal(
    { defaultEnabled: false, language: 'en' },
    { enabled: true, language: 'zh' },
  );
  assert.equal(explicit.enabled, true);
  assert.equal(explicit.language, 'zh');
});

test('localized adaptation headers and skill variant selection', () => {
  assert.match(adaptContent('# x', 'zh'), /^> SpecGate 适配：/);
  assert.match(adaptContent('# x', 'en'), /^> SpecGate adaptation:/);

  const zh = listSkillAssets('zh');
  const en = listSkillAssets('en');
  assert.equal(zh.length, 30);
  assert.equal(en.length, 30);
  assert.ok(zh.every((skill) => skill.file.endsWith('.zh.md')));
  assert.ok(en.every((skill) => !skill.file.endsWith('.zh.md')));
  assert.deepEqual(
    zh.map((skill) => skill.name),
    en.map((skill) => skill.name),
  );
});

test('initProject writes language, concurrency, materialization and enabled defaults', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-config-'));
  const report = initProject(root, {
    git: false,
    language: 'en',
    maxConcurrency: 6,
    materializeSkills: false,
    materializeAgents: false,
  });
  assert.equal(report.root, root);
  const project = loadProject(root);
  assert.equal(project.language, 'en');
  assert.equal(project.maxConcurrency, 6);
  assert.equal(project.materializeSkills, false);
  assert.equal(project.materializeAgents, false);
  assert.equal(project.enabled, true);
  assert.equal(fs.existsSync(path.join(root, '.dsh', 'skills', 'specgate')), false);
  assert.equal(
    fs.readdirSync(path.join(root, '.specgate', 'agents')).filter((name) => name.endsWith('.md')).length,
    0,
  );
  assert.match(
    fs.readFileSync(path.join(root, '.specgate', 'config.yaml'), 'utf8'),
    /language: "en"/,
  );
});

test('disabled global default writes enabled: false for a new project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specgate-disabled-'));
  initProject(root, { git: false, language: 'zh', enabled: false });
  const project = loadProject(root);
  assert.equal(project.enabled, false);
  assert.match(
    fs.readFileSync(path.join(root, '.specgate', 'config.yaml'), 'utf8'),
    /enabled: false/,
  );
});
