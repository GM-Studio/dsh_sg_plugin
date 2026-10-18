import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  assetsRoot,
  listAgentAssets,
  listSkillAssets,
  normalizeLanguage,
} from '../src/assets.js';
import { parseFrontmatter } from '../src/util.js';

const repoRoot = path.resolve(assetsRoot, '..');
const manifestPath = path.join(repoRoot, '.bilingual-manifest.json');

test('every bilingual manifest entry has an English base and a Chinese sibling', () => {
  assert.equal(fs.existsSync(manifestPath), true, 'bilingual manifest is required');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entries = Object.values(manifest).flat();
  assert.ok(entries.length >= 100, `expected a full asset manifest, got ${entries.length}`);
  for (const entry of entries) {
    assert.equal(fs.existsSync(path.join(repoRoot, entry.base)), true, `missing base ${entry.base}`);
    assert.equal(fs.existsSync(path.join(repoRoot, entry.zh)), true, `missing zh ${entry.zh}`);
  }
});

test('30 skills and 11 agents exist in both languages with identical identifiers', () => {
  const zhSkills = listSkillAssets('zh');
  const enSkills = listSkillAssets('en');
  assert.equal(zhSkills.length, 30);
  assert.equal(enSkills.length, 30);
  assert.deepEqual(
    zhSkills.map((skill) => skill.name),
    enSkills.map((skill) => skill.name),
  );
  for (const skill of enSkills) {
    assert.equal(skill.file.endsWith('.zh.md'), false, `${skill.name} selected a Chinese file for en`);
    const zh = zhSkills.find((item) => item.name === skill.name);
    assert.ok(zh, `missing zh variant for ${skill.name}`);
    const zhMeta = parseFrontmatter(fs.readFileSync(zh.file, 'utf8')).data;
    const enMeta = parseFrontmatter(fs.readFileSync(skill.file, 'utf8')).data;
    assert.equal(enMeta.name, zhMeta.name, `frontmatter name drift for ${skill.name}`);
  }

  const zhAgents = listAgentAssets('zh');
  const enAgents = listAgentAssets('en');
  assert.equal(zhAgents.length, 11);
  assert.equal(enAgents.length, 11);
  assert.deepEqual(
    zhAgents.map((agent) => agent.name),
    enAgents.map((agent) => agent.name),
  );
});

test('language normalization accepts DSH locales and defaults to zh', () => {
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage('en-US'), 'en');
  assert.equal(normalizeLanguage('zh-CN'), 'zh');
  assert.equal(normalizeLanguage(undefined), 'zh');
  assert.equal(normalizeLanguage('fr'), 'zh');
});
