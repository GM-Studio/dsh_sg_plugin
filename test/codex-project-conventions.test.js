import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  javaFullstackFiles,
  normalizeProjectNamespace,
} from '../src/codex/core/java/java-fullstack-template.js';
import { JAVA_PRESETS, templateHash } from '../src/codex/core/java/java-versions.js';
import { executeInit, previewInit } from '../src/codex/init.js';
import {
  frontendFrameworkViolation,
  readProjectConventions,
} from '../src/codex/project-conventions.js';

const preset = JAVA_PRESETS.find((entry) => entry.id === 'jdk21-boot3.5');

test('custom company and business names produce the required Java namespace', () => {
  const files = javaFullstackFiles({
    preset,
    company: 'acme',
    business: 'orders',
  });
  const keys = Object.keys(files);
  assert.ok(keys.some((key) => key.startsWith('backend/src/main/java/com/acme/orders/')));
  assert.ok(keys.every((key) => !key.includes('/com/example/')));
  assert.ok(Object.values(files).every((content) => !String(content).includes('com.example')));
  assert.match(files['backend/pom.xml'], /<groupId>com\.acme<\/groupId>/);
  assert.match(files['backend/pom.xml'], /<artifactId>orders-api<\/artifactId>/);
  assert.match(
    files['backend/src/main/java/com/acme/orders/TaskApplication.java'],
    /^\/\/ 中文文件说明：/m,
  );
  assert.match(
    files['backend/src/main/java/com/acme/orders/TaskApplication.java'],
    /package com\.acme\.orders;/,
  );
});

test('project conventions expose the selected frontend framework and Java preset', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-conventions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.specgate'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.specgate', 'monorepo.json'),
    JSON.stringify({ stack: 'java-vue', preset: 'jdk21-boot3.5', frontendFramework: 'react' }),
  );
  const conventions = readProjectConventions({ projectRoot: root });
  assert.equal(conventions.frontendFramework, 'react');
  assert.equal(conventions.javaPreset, 'jdk21-boot3.5');
});

test('a React project rejects Vue single-file components but a Vue project accepts them', () => {
  assert.match(
    frontendFrameworkViolation('react', 'frontend/src/views/Dashboard.vue'),
    /React project/,
  );
  assert.equal(frontendFrameworkViolation('react', 'frontend/src/views/Dashboard.tsx'), null);
  assert.equal(frontendFrameworkViolation('vue', 'frontend/src/App.vue'), null);
  assert.equal(frontendFrameworkViolation('vue', 'frontend/src/util.ts'), null);
});

test('initialization preview records a Vue frontend and refuses an unavailable one', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-init-frontend-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vue = previewInit({ root, company: 'acme', business: 'orders', frontend: 'vue' });
  assert.equal(vue.ok, true, JSON.stringify(vue));
  assert.equal(vue.frontend, 'vue');
  assert.equal(
    previewInit({ root, company: 'acme', business: 'orders', frontend: 'react' }).code,
    'FRONTEND_UNAVAILABLE',
  );
  assert.equal(
    previewInit({ root, company: 'acme', business: 'orders', frontend: 'svelte' }).code,
    'INVALID_FRONTEND',
  );
});

test('all generated source files contain Chinese comments and i18n defaults to Chinese', () => {
  const files = javaFullstackFiles({
    preset,
    company: 'acme',
    business: 'orders',
  });
  const sourceFiles = Object.entries(files).filter(([name]) => /\.(?:java|ts|vue|css)$/.test(name));
  assert.ok(sourceFiles.length > 20);
  for (const [name, content] of sourceFiles) {
    assert.match(content, /[\u4e00-\u9fff]/, name);
    assert.match(content, /文件说明|模块说明|样式说明/, name);
  }
  assert.match(files['frontend/package.json'], /"vue-i18n"/);
  assert.match(files['frontend/src/main.ts'], /i18n/);
  assert.match(files['frontend/src/i18n/index.ts'], /zh-CN/);
  assert.match(files['frontend/src/i18n/index.ts'], /fallbackLocale:\s*'zh-CN'/);
  assert.match(files['frontend/src/i18n/locales/zh-CN.ts'], /任务管理/);
});

test('template identity is stable across namespaces and invalid package names fail closed', () => {
  const first = javaFullstackFiles({ preset, company: 'acme', business: 'orders' });
  const second = javaFullstackFiles({ preset, company: 'globex', business: 'billing' });
  assert.equal(templateHash(first), templateHash(second));
  assert.deepEqual(normalizeProjectNamespace({ company: 'acme', business: 'orders' }), {
    ok: true,
    company: 'acme',
    business: 'orders',
    basePackage: 'com.acme.orders',
    groupId: 'com.acme',
    packagePath: 'com/acme/orders',
  });
  for (const input of [
    { company: 'com.acme', business: 'orders' },
    { company: 'Acme Corp', business: 'orders' },
    { company: 'acme', business: '../orders' },
    { company: '', business: 'orders' },
  ]) {
    assert.equal(normalizeProjectNamespace(input).ok, false);
  }
});

test('initialization writes the configured namespace and no old example source tree', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-project-namespace-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'orders');
  const preview = previewInit({
    root,
    preset: preset.id,
    company: 'acme',
    business: 'orders',
  });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.projectNamespace.basePackage, 'com.acme.orders');
  assert.equal(
    preview.files.new.some((name) => name.includes('backend/src/main/java/com/example/')),
    false,
  );
  const result = await executeInit({
    root,
    preset: preset.id,
    company: 'acme',
    business: 'orders',
    previewHash: preview.previewHash,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(
    fs.existsSync(path.join(root, 'backend/src/main/java/com/acme/orders/TaskApplication.java')),
    true,
  );
  assert.equal(fs.existsSync(path.join(root, 'backend/src/main/java/com/example')), false);
  const monorepo = JSON.parse(fs.readFileSync(path.join(root, '.specgate/monorepo.json'), 'utf8'));
  assert.equal(monorepo.backendPackage, 'com.acme.orders');
  assert.equal(monorepo.frontendDefaultLocale, 'zh-CN');
  assert.deepEqual(monorepo.frontendLocales, ['zh-CN', 'en-US']);
});
