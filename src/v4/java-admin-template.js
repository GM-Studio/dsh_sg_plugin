import fs from 'node:fs';

const source = new URL('../../assets/java-vue/admin/', import.meta.url);
const files = Object.fromEntries(
  ['App.vue', 'main.ts', 'style.css'].map((name) => [
    'frontend/src/' + name,
    fs.readFileSync(new URL(name, source), 'utf8').replace(/\r\n/g, '\n'),
  ]),
);

/** Minimal Element Plus administration UI, shared by all Java presets. */
export function javaAdminFiles(base) {
  const pkg = JSON.parse(base['frontend/package.json']);
  pkg.dependencies['element-plus'] = '2.11.8';
  pkg.scripts.lint = 'eslint . --max-warnings=0';
  return {
    ...files,
    '.gitignore':
      base['.gitignore'] + '.specgate/toolchains/\n.specgate/verify-runs/\n.specgate/verify.lock\n',
    'frontend/package.json': JSON.stringify(pkg, null, 2) + '\n',
    'frontend/.prettierrc.json':
      JSON.stringify(
        { singleQuote: true, semi: true, htmlWhitespaceSensitivity: 'ignore' },
        null,
        2,
      ) + '\n',
  };
}
