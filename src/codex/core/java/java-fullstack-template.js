import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { applyJavaPreset, templateHash } from './java-versions.js';

const source = fileURLToPath(new URL('../../../../assets/java-vue/template/', import.meta.url));
const JAVA_PACKAGE_SEGMENT = /^[a-z][a-z0-9]{1,62}$/;

const namespaceFailure = (code, message) => ({ ok: false, code, message });

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
  if (/\.(?:ts|js)$/.test(name))
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
      .replaceAll('"name": "task-web"', `"name": "${normalized.business}-web"`);
    if (/\.java$/.test(projectedName)) projectedContent = sortJavaImports(projectedContent);
    projected[projectedName] = projectedContent;
  }
  return { normalized, files: addChineseHeaders(projected) };
}

/** One readable source tree; generation never executes commands or connects to the network. */
export function javaFullstackFiles(options = {}) {
  const files = {};
  function read(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) read(path.join(directory, entry.name), name + '/');
      else if (entry.isFile() && name.endsWith('.tpl')) {
        files[name.slice(0, -4)] = fs
          .readFileSync(path.join(directory, entry.name), 'utf8')
          .replace(/\r\n/g, '\n');
      }
    }
  }
  read(source);
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
        version: 'java-vue-admin-1',
        preset: options.preset?.id || 'jdk8-boot2.7',
        projectNamespace: {
          company: projected.normalized.company,
          business: projected.normalized.business,
          basePackage: projected.normalized.basePackage,
        },
        samples: Object.fromEntries(
          samples.sort().map((name) => {
            const reference = '.specgate/examples/java-vue-admin-1/' + name;
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
