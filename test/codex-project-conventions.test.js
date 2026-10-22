import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  javaFullstackFiles,
  normalizeProjectNamespace,
} from '../src/codex/core/java/java-fullstack-template.js';
import {
  applyJavaPreset,
  JAVA_PRESETS,
  templateHash,
} from '../src/codex/core/java/java-versions.js';
import { executeInit, previewInit } from '../src/codex/init.js';
import {
  frontendFrameworkViolation,
  readProjectConventions,
} from '../src/codex/project-conventions.js';

const preset = JAVA_PRESETS.find((entry) => entry.id === 'jdk21-boot3.5');

const vueTemplateTree = fileURLToPath(new URL('../assets/java-vue/template/', import.meta.url));

/** Owned by the parallel React template slice; still being authored. */
const reactTemplateTree = fileURLToPath(
  new URL('../assets/java-vue/template-react/frontend/', import.meta.url),
);

/** Minimal `.tpl` reader, so the tests can cross-check the generator. */
const readTemplateTree = (directory, prefix = '') => {
  const files = {};
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, readTemplateTree(full, name + '/'));
    else if (entry.name.endsWith('.tpl'))
      files[name.slice(0, -4)] = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
  }
  return files;
};

/** The Vue tree after the preset and the React frontend splice, before projection. */
const canonicalInput = (frontend) => {
  const files = readTemplateTree(vueTemplateTree);
  if (frontend === 'react') {
    for (const name of Object.keys(files)) if (name.startsWith('frontend/')) delete files[name];
    Object.assign(files, readTemplateTree(reactTemplateTree, 'frontend/'));
  }
  return applyJavaPreset(files, preset);
};

const generate = (frontend) =>
  javaFullstackFiles({ preset, company: 'acme', business: 'orders', frontend });

const thrown = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
};

/** Every file that is neither the frontend tree nor the generated style index. */
const sharedAndBackendFiles = (files) =>
  Object.fromEntries(
    Object.entries(files).filter(
      ([name]) => !name.startsWith('frontend/') && !name.startsWith('.specgate/'),
    ),
  );

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

test('initialization preview records the selected frontend and rejects unknown ones', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-init-frontend-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vue = previewInit({ root, company: 'acme', business: 'orders', frontend: 'vue' });
  assert.equal(vue.ok, true, JSON.stringify(vue));
  assert.equal(vue.frontend, 'vue');
  const react = previewInit({ root, company: 'acme', business: 'orders', frontend: 'react' });
  assert.equal(react.ok, true, JSON.stringify(react));
  assert.equal(react.frontend, 'react');
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
  assert.match(files['frontend/src/i18n/locales/zh-CN.ts'], /角色管理/);
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

test('the vue frontend stays the default and keeps its recorded template identity', () => {
  const explicit = generate('vue');
  const implied = generate();
  assert.deepEqual(explicit, implied);
  const names = Object.keys(explicit);
  assert.equal(
    names.some((name) => name.endsWith('.vue')),
    true,
  );
  assert.equal(
    names.some((name) => name.endsWith('.tsx')),
    false,
  );
  // Unchanged: the canonical hash is still the one the Vue tree with the preset
  // applied produced before the frontend option existed.
  const recorded = templateHash(canonicalInput('vue'));
  assert.equal(templateHash(explicit), recorded);
  assert.deepEqual(Object.getOwnPropertyDescriptor(explicit, '__specgateCanonicalTemplateHash'), {
    value: recorded,
    writable: false,
    enumerable: false,
    configurable: false,
  });
  const manifest = JSON.parse(explicit['.specgate/template-style.json']);
  assert.equal(manifest.version, 'java-vue-admin-1');
  assert.equal(manifest.frontendFramework, 'vue');
  const samplePrefix = '.specgate/examples/' + manifest.version + '/';
  const samples = Object.keys(manifest.samples);
  assert.ok(samples.every((name) => name.startsWith(samplePrefix)));
});

test('an unknown frontend fails closed instead of defaulting to vue', () => {
  for (const frontend of ['svelte', 'React', 'vue2', 'tsx']) {
    const error = thrown(() => generate(frontend));
    assert.ok(error instanceof Error, frontend);
    assert.equal(error.code, 'INVALID_FRONTEND', frontend);
  }
});

test('requesting the react frontend without its template tree fails closed', (t) => {
  if (fs.existsSync(reactTemplateTree)) return t.skip('react template tree is already on disk');
  const error = thrown(() => generate('react'));
  assert.ok(error instanceof Error);
  assert.equal(error.code, 'FRONTEND_UNAVAILABLE');
});

test('the react frontend replaces the vue tree and keeps shared files identical', (t) => {
  if (!fs.existsSync(reactTemplateTree)) return t.skip('react template tree is not on disk yet');
  const vue = generate('vue');
  const react = generate('react');
  const names = Object.keys(react);

  // Every `frontend/` entry now comes from the React tree; no Vue one survives.
  const reactTreeKeys = Object.keys(readTemplateTree(reactTemplateTree, 'frontend/'));
  const frontendKeys = names.filter((name) => name.startsWith('frontend/')).sort();
  assert.deepEqual(frontendKeys, reactTreeKeys.sort());
  assert.equal(
    names.some((name) => name.endsWith('.vue')),
    false,
  );
  assert.equal(names.includes('frontend/src/App.vue'), false);
  assert.equal(names.includes('frontend/src/main.ts'), false);

  // Backend and every other shared file stay byte-identical to the Vue output.
  assert.deepEqual(sharedAndBackendFiles(react), sharedAndBackendFiles(vue));

  // The canonical hash covers the final React map, so it is separate from Vue.
  assert.equal(templateHash(react), templateHash(canonicalInput('react')));
  assert.notEqual(templateHash(react), templateHash(vue));

  // The React package name goes through the same namespace projection.
  assert.equal(JSON.parse(react['frontend/package.json']).name, 'orders-web');
  assert.equal(/"name": "task-web"/.test(vue['frontend/package.json']), false);

  // The style index is framework-scoped so its samples stay self-consistent.
  const manifest = JSON.parse(react['.specgate/template-style.json']);
  assert.equal(manifest.version, 'java-react-admin-1');
  assert.equal(manifest.frontendFramework, 'react');
  const samplePrefix = '.specgate/examples/' + manifest.version + '/';
  const samples = Object.keys(manifest.samples);
  assert.ok(samples.every((name) => name.startsWith(samplePrefix)));
  assert.ok(samples.includes(samplePrefix + 'frontend/package.json'));
});

test('the react frontend emits a .tsx entry with Chinese notes and no .vue files', (t) => {
  if (!fs.existsSync(path.join(reactTemplateTree, 'src', 'main.tsx.tpl')))
    return t.skip('the react entry frontend/src/main.tsx is still being authored');
  const react = generate('react');
  const names = Object.keys(react);
  assert.equal(names.includes('frontend/src/main.tsx'), true);
  assert.equal(
    names.some((name) => name.endsWith('.vue')),
    false,
  );
  assert.equal(
    names.some((name) => name.endsWith('.tsx')),
    true,
  );
  assert.match(react['frontend/src/main.tsx'], /^\/\/ 中文文件说明：/m);
  const samples = Object.keys(JSON.parse(react['.specgate/template-style.json']).samples);
  assert.ok(samples.includes('.specgate/examples/java-react-admin-1/frontend/src/main.tsx'));
});
