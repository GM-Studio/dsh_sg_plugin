import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { applyJavaPreset, templateHash } from './java-versions.js';

const source = fileURLToPath(new URL('../../../../assets/java-vue/template/', import.meta.url));
const JAVA_PACKAGE_SEGMENT = /^[a-z][a-z0-9]{1,62}$/;

/**
 * One frontend choice maps to exactly one template tree and one frozen style
 * manifest version, so a React project can never be handed the Vue tree.
 * `dir: null` means the frontend already lives in the base tree; otherwise the
 * directory tree is spliced in under `prefix`, replacing the base `frontend/`.
 */
const FRONTENDS = {
  vue: { dir: null, version: 'java-vue-admin-1', label: 'Vue 3' },
  react: {
    dir: fileURLToPath(
      new URL('../../../../assets/java-vue/template-react/frontend/', import.meta.url),
    ),
    relative: 'assets/java-vue/template-react/frontend',
    prefix: 'frontend/',
    version: 'java-react-admin-1',
    label: 'React 18',
  },
};
const FRONTEND_NAMES = Object.keys(FRONTENDS);

const namespaceFailure = (code, message) => ({ ok: false, code, message });
const templateError = (code, message) => Object.assign(new Error(message), { code });

export function normalizeProjectNamespace({ company = 'company', business = 'tasks' } = {}) {
  const normalizedCompany = String(company || '').trim();
  const normalizedBusiness = String(business || '').trim();
  if (
    !JAVA_PACKAGE_SEGMENT.test(normalizedCompany) ||
    !JAVA_PACKAGE_SEGMENT.test(normalizedBusiness)
  )
    return namespaceFailure(
      'PROJECT_NAMESPACE_INVALID',
      'company and business must be lowercase Java package segments containing letters, digits, or both',
    );
  return {
    ok: true,
    company: normalizedCompany,
    business: normalizedBusiness,
    basePackage: `com.${normalizedCompany}.${normalizedBusiness}`,
    groupId: `com.${normalizedCompany}`,
    packagePath: `com/${normalizedCompany}/${normalizedBusiness}`,
  };
}

function chineseHeader(name) {
  if (/\.java$/.test(name))
    return '// 中文文件说明：本文件由 SpecGate 初始化模板生成，用于承载项目约定和业务实现。\n';
  if (/\.(?:ts|tsx|js|jsx)$/.test(name))
    return '// 中文文件说明：本文件由 SpecGate 初始化模板生成，用于前端类型、接口或交互实现。\n';
  if (/\.vue$/.test(name))
    return '<!-- 中文文件说明：本文件由 SpecGate 初始化模板生成，用于前端页面与交互展示。 -->\n';
  if (/\.css$/.test(name))
    return '/* 中文文件说明：本文件由 SpecGate 初始化模板生成，用于前端界面样式。 */\n';
  return '';
}

function addChineseHeaders(files) {
  return Object.fromEntries(
    Object.entries(files).map(([name, content]) => [name, chineseHeader(name) + content]),
  );
}

function sortJavaImports(content) {
  const lines = content.split('\n');
  const output = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index].startsWith('import ')) {
      output.push(lines[index]);
      index += 1;
      continue;
    }
    const block = [];
    while (index < lines.length && lines[index].startsWith('import ')) {
      block.push(lines[index]);
      index += 1;
    }
    block.sort((left, right) => {
      const leftStatic = left.startsWith('import static ');
      const rightStatic = right.startsWith('import static ');
      if (leftStatic !== rightStatic) return leftStatic ? -1 : 1;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    output.push(...block);
  }
  return output.join('\n');
}

function projectNamespace(files, options) {
  const normalized = normalizeProjectNamespace(options);
  if (!normalized.ok)
    throw Object.assign(new Error(normalized.message), {
      code: normalized.code,
    });
  const projected = {};
  for (const [name, content] of Object.entries(files)) {
    const projectedName = name
      .replaceAll('com/example/tasks', normalized.packagePath)
      .replaceAll('task-api', `${normalized.business}-api`);
    let projectedContent = String(content)
      .replaceAll('com.example.tasks', normalized.basePackage)
      .replaceAll('com.example', normalized.groupId)
      .replaceAll(
        '<artifactId>task-api</artifactId>',
        `<artifactId>${normalized.business}-api</artifactId>`,
      )
      .replaceAll('"name": "task-web"', `"name": "${normalized.business}-web"`)
      // The React tree names its package `admin-web`; that literal never occurs
      // in the Vue tree, so the Vue projection stays byte-identical.
      .replaceAll('"name": "admin-web"', `"name": "${normalized.business}-web"`);
    if (/\.java$/.test(projectedName)) projectedContent = sortJavaImports(projectedContent);
    projected[projectedName] = projectedContent;
  }
  return { normalized, files: addChineseHeaders(projected) };
}

/**
 * Read one `.tpl` tree into a flat file map, stripping `.tpl` and normalizing
 * line endings. `prefix` becomes the leading path segment for every key.
 */
function readTemplateTree(directory, prefix = '') {
  const files = {};
  function read(current, currentPrefix) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const name = currentPrefix + entry.name;
      if (entry.isDirectory()) read(path.join(current, entry.name), name + '/');
      else if (entry.isFile() && name.endsWith('.tpl')) {
        files[name.slice(0, -4)] = fs
          .readFileSync(path.join(current, entry.name), 'utf8')
          .replace(/\r\n/g, '\n');
      }
    }
  }
  read(directory, prefix);
  return files;
}

/** Resolve the requested frontend, failing closed on an unknown value. */
function resolveFrontend(value) {
  // An omitted or blank choice means Vue, exactly like the init preview's
  // `String(frontend || 'vue').trim()`.
  const name = String(value === undefined || value === null ? '' : value).trim() || 'vue';
  const frontend = FRONTENDS[name];
  if (!frontend)
    throw templateError(
      'INVALID_FRONTEND',
      '前端只能是 ' + FRONTEND_NAMES.join(' 或 ') + '；收到：' + name,
    );
  return { name, ...frontend };
}

/**
 * The React tree has to exist on disk with real content before a React project
 * can be generated; otherwise the request fails closed instead of silently
 * emitting Vue files under a React name.
 */
function readFrontendTree(frontend) {
  const dir = frontend.dir;
  const missing = !dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory();
  if (missing)
    throw templateError(
      'FRONTEND_UNAVAILABLE',
      frontend.label + ' 前端模板尚未提供：缺少 ' + frontend.relative + '/',
    );
  const files = readTemplateTree(dir, frontend.prefix);
  if (!Object.keys(files).length)
    throw templateError(
      'FRONTEND_UNAVAILABLE',
      frontend.label + ' 前端模板为空：' + frontend.relative + '/',
    );
  return files;
}

/** One readable source tree; generation never executes commands or connects to the network. */
export function javaFullstackFiles(options = {}) {
  const frontend = resolveFrontend(options.frontend);
  const files = readTemplateTree(source);
  if (frontend.dir) {
    // Read (and fail closed on) the React tree before touching the base map.
    const frontendFiles = readFrontendTree(frontend);
    for (const name of Object.keys(files)) if (name.startsWith('frontend/')) delete files[name];
    Object.assign(files, frontendFiles);
  }
  const presetFiles = options.preset ? applyJavaPreset(files, options.preset) : files;
  const canonicalHash = templateHash(presetFiles);
  const projected = projectNamespace(presetFiles, {
    company: options.company,
    business: options.business,
  });
  const out = projected.files;
  const samples = Object.keys(out).filter((name) =>
    /^(backend\/src\/|frontend\/(src|test)\/|docs\/(api|style)\.md|backend\/(pom|checkstyle)\.xml|frontend\/(package\.json|vite\.config\.ts))/.test(
      name,
    ),
  );
  out['.specgate/template-style.json'] =
    JSON.stringify(
      {
        schemaVersion: 1,
        version: frontend.version,
        frontendFramework: frontend.name,
        preset: options.preset?.id || 'jdk8-boot2.7',
        projectNamespace: {
          company: projected.normalized.company,
          business: projected.normalized.business,
          basePackage: projected.normalized.basePackage,
        },
        samples: Object.fromEntries(
          samples.sort().map((name) => {
            const reference = '.specgate/examples/' + frontend.version + '/' + name;
            out[reference] = out[name];
            return [reference, createHash('sha256').update(out[name]).digest('hex')];
          }),
        ),
        coverage: { lines: 80, branches: 70 },
      },
      null,
      2,
    ) + '\n';
  Object.defineProperty(out, '__specgateCanonicalTemplateHash', {
    value: canonicalHash,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return out;
}
