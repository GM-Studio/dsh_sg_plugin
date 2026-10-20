function lines(...rows) {
  return rows.join('\n') + '\n';
}

function apiSource() {
  return lines(
    'const MODE = (import.meta.env && import.meta.env.VITE_API_MODE) || "mock";',
    'const store = [];',
    'let sequence = 0;',
    '',
    'export function resetMock() {',
    '  store.length = 0;',
    '  sequence = 0;',
    '}',
    '',
    'async function json(response) {',
    '  if (!response.ok) throw new Error("HTTP " + response.status);',
    '  return response.status === 204 ? null : response.json();',
    '}',
    '',
    'export async function listItems() {',
    '  if (MODE === "mock") return [...store];',
    '  return json(await fetch("/api/items"));',
    '}',
    '',
    'export async function createItem(payload) {',
    '  if (MODE === "mock") {',
    '    sequence += 1;',
    '    const item = { id: sequence, name: payload.name, description: payload.description || "" };',
    '    store.push(item);',
    '    return item;',
    '  }',
    '  return json(await fetch("/api/items", {',
    '    method: "POST",',
    '    headers: { "content-type": "application/json" },',
    '    body: JSON.stringify(payload),',
    '  }));',
    '}',
    '',
    'export async function updateItem(id, payload) {',
    '  if (MODE === "mock") {',
    '    const index = store.findIndex((item) => item.id === id);',
    '    if (index < 0) throw new Error("not found");',
    '    store[index] = { ...store[index], ...payload, id };',
    '    return store[index];',
    '  }',
    '  return json(await fetch("/api/items/" + id, {',
    '    method: "PUT",',
    '    headers: { "content-type": "application/json" },',
    '    body: JSON.stringify(payload),',
    '  }));',
    '}',
    '',
    'export async function deleteItem(id) {',
    '  if (MODE === "mock") {',
    '    const index = store.findIndex((item) => item.id === id);',
    '    if (index >= 0) store.splice(index, 1);',
    '    return;',
    '  }',
    '  return json(await fetch("/api/items/" + id, { method: "DELETE" }));',
    '}',
  );
}

function reactFiles() {
  return {
    'package.json':
      JSON.stringify(
        {
          name: 'web',
          private: true,
          type: 'module',
          scripts: { dev: 'vite', build: 'vite build', test: 'vitest run' },
          dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
          devDependencies: {
            '@vitejs/plugin-react': '^4.3.4',
            vite: '^5.4.11',
            vitest: '^2.1.8',
            jsdom: '^25.0.1',
          },
        },
        null,
        2,
      ) + '\n',
    'index.html': lines(
      '<div id="root"></div>',
      '<script type="module" src="/src/main.jsx"></script>',
    ),
    'vite.config.js': lines(
      'import { defineConfig } from "vite";',
      'import react from "@vitejs/plugin-react";',
      '',
      'export default defineConfig({',
      '  plugins: [react()],',
      '  test: { environment: "jsdom" },',
      '});',
    ),
    'pnpm-workspace.yaml': lines('onlyBuiltDependencies:', '  - esbuild'),
    'src/api.js': apiSource(),
    'src/main.jsx': lines(
      'import React from "react";',
      'import { createRoot } from "react-dom/client";',
      'import App from "./App.jsx";',
      '',
      'createRoot(document.getElementById("root")).render(<App />);',
    ),
    'src/App.jsx': lines(
      'import { useEffect, useState } from "react";',
      'import { createItem, deleteItem, listItems, updateItem } from "./api.js";',
      '',
      'export default function App() {',
      '  const [items, setItems] = useState([]);',
      '  const [name, setName] = useState("");',
      '  const [editing, setEditing] = useState(null);',
      '',
      '  async function refresh() {',
      '    setItems(await listItems());',
      '  }',
      '',
      '  useEffect(() => {',
      '    refresh();',
      '  }, []);',
      '',
      '  async function submit(event) {',
      '    event.preventDefault();',
      '    if (!name.trim()) return;',
      '    if (editing) {',
      '      await updateItem(editing, { name });',
      '    } else {',
      '      await createItem({ name });',
      '    }',
      '    setName("");',
      '    setEditing(null);',
      '    await refresh();',
      '  }',
      '',
      '  return (',
      '    <main>',
      '      <h1>Items</h1>',
      '      <form onSubmit={submit}>',
      '        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="name" />',
      '        <button type="submit">{editing ? "Update" : "Create"}</button>',
      '      </form>',
      '      <ul>',
      '        {items.map((item) => (',
      '          <li key={item.id}>',
      '            <span>{item.name}</span>',
      '            <button onClick={() => setEditing(item.id)}>Edit</button>',
      '            <button onClick={async () => { await deleteItem(item.id); await refresh(); }}>Delete</button>',
      '          </li>',
      '        ))}',
      '      </ul>',
      '    </main>',
      '  );',
      '}',
    ),
    'src/api.test.js': lines(
      'import { beforeEach, describe, expect, it } from "vitest";',
      'import { createItem, deleteItem, listItems, resetMock, updateItem } from "./api.js";',
      '',
      'describe("items api (mock)", () => {',
      '  beforeEach(() => resetMock());',
      '',
      '  it("creates, lists, updates and deletes", async () => {',
      '    expect(await listItems()).toEqual([]);',
      '    const created = await createItem({ name: "demo" });',
      '    expect(created.id).toBe(1);',
      '    expect(await listItems()).toHaveLength(1);',
      '    const updated = await updateItem(1, { name: "updated" });',
      '    expect(updated.name).toBe("updated");',
      '    await deleteItem(1);',
      '    expect(await listItems()).toEqual([]);',
      '  });',
      '});',
    ),
  };
}

function vueFiles() {
  return {
    'package.json':
      JSON.stringify(
        {
          name: 'web',
          private: true,
          type: 'module',
          scripts: { dev: 'vite', build: 'vite build', test: 'vitest run' },
          dependencies: { vue: '^3.5.13' },
          devDependencies: {
            '@vitejs/plugin-vue': '^5.2.1',
            vite: '^5.4.11',
            vitest: '^2.1.8',
            jsdom: '^25.0.1',
          },
        },
        null,
        2,
      ) + '\n',
    'index.html': lines(
      '<div id="app"></div>',
      '<script type="module" src="/src/main.js"></script>',
    ),
    'vite.config.js': lines(
      'import { defineConfig } from "vite";',
      'import vue from "@vitejs/plugin-vue";',
      '',
      'export default defineConfig({',
      '  plugins: [vue()],',
      '  test: { environment: "jsdom" },',
      '});',
    ),
    'pnpm-workspace.yaml': lines('onlyBuiltDependencies:', '  - esbuild'),
    'src/api.js': apiSource(),
    'src/main.js': lines(
      'import { createApp } from "vue";',
      'import App from "./App.vue";',
      '',
      'createApp(App).mount("#app");',
    ),
    'src/App.vue': lines(
      '<template>',
      '  <main>',
      '    <h1>Items</h1>',
      '    <form @submit.prevent="submit">',
      '      <input v-model="name" placeholder="name" />',
      '      <button type="submit">{{ editing ? "Update" : "Create" }}</button>',
      '    </form>',
      '    <ul>',
      '      <li v-for="item in items" :key="item.id">',
      '        <span>{{ item.name }}</span>',
      '        <button @click="editing = item.id">Edit</button>',
      '        <button @click="remove(item.id)">Delete</button>',
      '      </li>',
      '    </ul>',
      '  </main>',
      '</template>',
      '',
      '<script setup>',
      'import { onMounted, ref } from "vue";',
      'import { createItem, deleteItem, listItems, updateItem } from "./api.js";',
      '',
      'const items = ref([]);',
      'const name = ref("");',
      'const editing = ref(null);',
      '',
      'async function refresh() {',
      '  items.value = await listItems();',
      '}',
      '',
      'async function submit() {',
      '  if (!name.value.trim()) return;',
      '  if (editing.value) await updateItem(editing.value, { name: name.value });',
      '  else await createItem({ name: name.value });',
      '  name.value = "";',
      '  editing.value = null;',
      '  await refresh();',
      '}',
      '',
      'async function remove(id) {',
      '  await deleteItem(id);',
      '  await refresh();',
      '}',
      '',
      'onMounted(refresh);',
      '</script>',
    ),
    'src/api.test.js': lines(
      'import { beforeEach, describe, expect, it } from "vitest";',
      'import { createItem, deleteItem, listItems, resetMock, updateItem } from "./api.js";',
      '',
      'describe("items api (mock)", () => {',
      '  beforeEach(() => resetMock());',
      '',
      '  it("creates, lists, updates and deletes", async () => {',
      '    expect(await listItems()).toEqual([]);',
      '    const created = await createItem({ name: "demo" });',
      '    expect(created.id).toBe(1);',
      '    const updated = await updateItem(1, { name: "updated" });',
      '    expect(updated.name).toBe("updated");',
      '    await deleteItem(1);',
      '    expect(await listItems()).toEqual([]);',
      '  });',
      '});',
    ),
  };
}

function selectedPackageMap(context) {
  const deps = context?.dependencies;
  if (!deps || !Array.isArray(deps.items)) return null;
  const selected = new Set([...(deps.required || []), ...(deps.optional || [])]);
  const dependencies = {};
  const devDependencies = {};
  for (const item of deps.items) {
    if (!selected.has(item.id) || !item.name || item.kind === 'file') continue;
    const dev =
      item.scope === 'devDependencies' ||
      item.scope === 'dev' ||
      item.category === 'test' ||
      item.category === 'quality' ||
      item.category === 'lint' ||
      item.category === 'format';
    const target = dev ? devDependencies : dependencies;
    target[item.name] = item.version;
  }
  return { dependencies, devDependencies };
}

function packageJson(context, map) {
  return (
    JSON.stringify(
      {
        name: 'web',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'vite build',
          test: 'vitest run',
          lint: 'eslint .',
          format: 'prettier --write .',
        },
        ...(map || {}),
      },
      null,
      2,
    ) + '\n'
  );
}

function eslintConfig(framework, language) {
  const ignores = '  { ignores: ["node_modules/**", "dist/**"] },';
  if (framework === 'vue') {
    const rows = ['import pluginVue from "eslint-plugin-vue";'];
    if (language !== 'javascript') rows.push('import tseslint from "typescript-eslint";');
    rows.push('', 'export default [', ignores, '  ...pluginVue.configs["flat/essential"],');
    if (language !== 'javascript') {
      rows.push(
        '  { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, rules: {} },',
      );
    }
    rows.push('];', '');
    return rows.join('\n');
  }
  const rows = [];
  if (language !== 'javascript') rows.push('import tseslint from "typescript-eslint";', '');
  rows.push('export default [', ignores);
  rows.push(
    '  { languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } }, rules: {} },',
  );
  if (language !== 'javascript') {
    rows.push(
      '  { files: ["**/*.{ts,tsx}"], languageOptions: { parser: tseslint.parser }, rules: {} },',
    );
  }
  rows.push('];', '');
  return rows.join('\n');
}

function tsconfig(framework) {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: framework === 'react' ? 'react-jsx' : undefined,
          allowJs: true,
          checkJs: false,
          strict: false,
          noEmit: true,
          skipLibCheck: true,
          esModuleInterop: true,
        },
        include: ['src/**/*.js', 'src/**/*.jsx', 'src/**/*.ts', 'src/**/*.tsx', 'src/**/*.vue'],
      },
      null,
      2,
    ) + '\n'
  );
}

export function frontendFiles(framework, context = {}) {
  const files = framework === 'vue' ? vueFiles() : reactFiles();
  const map = selectedPackageMap(context);
  if (map) {
    files['package.json'] = packageJson(context, map);
    files['eslint.config.js'] = eslintConfig(framework, context.language);
    if (context.language !== 'javascript') {
      files['tsconfig.json'] = tsconfig(framework);
    }
  }
  return files;
}
