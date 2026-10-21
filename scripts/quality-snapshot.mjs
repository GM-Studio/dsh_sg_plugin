import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function git(root, args, options = {}) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, ...options });
}
export function changedFiles(root, ref, base) {
  if (ref !== 'index' && !base)
    return git(root, ['ls-tree', '-r', '--name-only', '-z', ref], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  const args = ref === 'index' ? ['diff', '--cached'] : ['diff', base, ref];
  return git(root, [...args, '--name-only', '--no-renames', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}
export function exportSnapshot(root, ref, destination) {
  const entries = git(
    root,
    ref === 'index' ? ['ls-files', '--stage', '-z'] : ['ls-tree', '-r', '-z', ref],
    { encoding: 'utf8' },
  );
  const blobs = [];
  for (const record of entries.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const name = record.slice(tab + 1);
    const [mode, second, third] = record.slice(0, tab).split(' ');
    if (ref === 'index' && third !== '0') throw new Error('Unmerged index: ' + name);
    if (!['100644', '100755'].includes(mode))
      throw new Error('Unsupported Git mode: ' + mode + ' ' + name);
    const absolute = path.resolve(destination, name);
    const relative = path.relative(destination, absolute);
    if (
      !relative ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      name.split('/').includes('.git')
    )
      throw new Error('Unsafe snapshot path: ' + name);
    blobs.push({ name, absolute, oid: ref === 'index' ? second : third, mode });
  }
  const output = git(root, ['cat-file', '--batch'], {
    input: blobs.map((b) => b.oid + '\n').join(''),
  });
  let offset = 0;
  for (const blob of blobs) {
    const end = output.indexOf(10, offset);
    const [oid, type, size] = output.subarray(offset, end).toString().split(' ');
    if (oid !== blob.oid || type !== 'blob' || !/^\d+$/.test(size))
      throw new Error('Invalid blob: ' + blob.name);
    offset = end + 1;
    fs.mkdirSync(path.dirname(blob.absolute), { recursive: true });
    fs.writeFileSync(blob.absolute, output.subarray(offset, offset + Number(size)), {
      mode: blob.mode === '100755' ? 0o755 : 0o644,
    });
    offset += Number(size) + 1;
  }
  return blobs.map((blob) => blob.name);
}
const codeExtensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.vue',
  '.java',
  '.py',
  '.sh',
  '.css',
  '.scss',
  '.html',
  '.cpp',
  '.c',
  '.h',
  '.go',
  '.rs',
  '.rb',
  '.ps1',
  '.bat',
  '.cmd',
  '.kt',
  '.kts',
  '.php',
  '.sql',
  '.swift',
  '.cs',
  '.psm1',
  '.pl',
  '.lua',
  '.bash',
]);
export function classifyFile(name) {
  const effective = name.replace(/\.(tpl|template)$/, '');
  if (name.endsWith('.template') && codeExtensions.has(path.extname(effective)))
    return 'unsupported';
  if (name.startsWith('assets/java-vue/template/')) {
    const extension = path.extname(effective);
    if (/^assets\/java-vue\/template\/backend\/mvnw(?:\.cmd)?\.tpl$/.test(name))
      return 'vendor-wrapper';
    const target = effective.slice('assets/java-vue/template/'.length);
    const executableLocations = {
      '.java': /^backend\/src\/(main|test)\/java\/.+\.java$/,
      '.ts': /^frontend\/((src|test)\/.+\.ts|vite\.config\.ts)$/,
      '.vue': /^frontend\/src\/.+\.vue$/,
      '.js': /^(frontend\/eslint\.config\.js|scripts\/.+\.js)$/,
      '.mjs': /^scripts\/.+\.mjs$/,
      '.css': /^frontend\/src\/.+\.css$/,
      '.html': /^frontend\/index\.html$/,
    };
    if (executableLocations[extension] && !executableLocations[extension].test(target))
      return 'unsupported';
    if (
      ['.java', '.ts', '.vue', '.js', '.mjs', '.css', '.html'].includes(extension) &&
      !/\/(backend\/src\/|frontend\/|scripts\/)/.test(effective)
    )
      return 'unsupported';
    if (
      codeExtensions.has(extension) &&
      !['.java', '.ts', '.vue', '.js', '.mjs', '.css', '.html'].includes(extension)
    )
      return 'unsupported';
  }
  if (name.startsWith('assets/java-vue/template/') && !name.endsWith('.tpl')) return 'unsupported';
  if (
    name.startsWith('test/fixtures/reference-note/') &&
    !/^test\/fixtures\/reference-note\/(NoteApiTest\.java|NotesPanel\.vue|notes(?:\.test)?\.ts)\.tpl$/.test(
      name,
    )
  )
    return 'unsupported';
  if (
    name.startsWith('assets/scaffold/java/') &&
    !/^assets\/scaffold\/java\/ItemController(Test)?\.java$/.test(name)
  )
    return 'unsupported';
  if (name.startsWith('assets/e2e/customer/')) {
    if (
      /^assets\/e2e\/customer\/backend\/[A-Za-z0-9]+\.java$/.test(name) ||
      /^assets\/e2e\/customer\/source\/backend\/src\/main\/java\/.+\.java$/.test(name)
    )
      return 'customer-e2e';
    if (name.endsWith('.java')) return 'unsupported';
  }
  if (/\.(png|jpg|svg|xml|md|txt|log|dot)$/.test(name)) return 'data';
  if (name.endsWith('.template') && effective.endsWith('.md')) return 'data';
  if (name.startsWith('docs/verification/') && /\.json$/.test(name)) return 'data';
  if (name.startsWith('assets/java-vue/template/')) return 'java-template';
  if (name.startsWith('test/fixtures/reference-note/')) return 'reference-template';
  if (name.startsWith('assets/scaffold/java/')) return 'java-scaffold';
  if (/^scripts\/git-hooks\/pre-(commit|push)$/.test(name)) return 'shell';
  const extension = path.extname(name);
  const supported = {
    '.js': 'javascript',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.ts': 'typescript',
    '.json': 'format',
    '.yml': 'format',
    '.yaml': 'format',
    '.css': 'format',
    '.html': 'format',
    '.vue': 'vue',
    '.py': 'python',
    '.sh': 'shell',
  };
  if (supported[extension]) return supported[extension];
  if (codeExtensions.has(extension) || ['.tpl', '.template'].includes(extension))
    return 'unsupported';
  return 'data';
}
export function checksFor(files, stage) {
  const template = files.some((name) =>
    /^(assets\/java-vue\/|assets\/scaffold\/java\/|test\/fixtures\/reference-note\/|src\/v4\/|src\/v3\/(template-|archive|tools|commands|quality|executor|formatter|suites|toolchain|bootstrap-code)|scripts\/(verify-.*template|quality-|install-hooks|git-hooks)|package(-lock)?\.json|eslint\.config\.js|\.prettier|\.github\/workflows\/)/.test(
      name,
    ),
  );
  const tests = files.some((name) => classifyFile(name) !== 'data' || /^test\//.test(name));
  const allPresets = ['jdk8-boot2.7', 'jdk17-boot3.5', 'jdk21-boot3.5', 'jdk21-boot4.0'];
  return {
    tests,
    template,
    presets: template ? (stage === 'commit' ? allPresets.slice(0, 1) : allPresets) : [],
  };
}
