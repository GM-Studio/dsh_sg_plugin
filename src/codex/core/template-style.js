import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hash = (text) => createHash('sha256').update(text).digest('hex');
const marker = '.specgate/template-style.json';
const fail = (code, message) => ({ ok: false, code, message });

/** Read pinned examples from this project, never substitute the plugin's current template. */
export function loadTemplateStyle(root, { required = false } = {}) {
  const file = path.join(root, marker);
  if (!fs.existsSync(file))
    return required
      ? fail(
          'TEMPLATE_STYLE_MISSING',
          '缺少项目模板样例索引；请恢复原版本或审批迁移，禁止猜测或覆盖',
        )
      : { ok: true, skipped: true, references: [], prompt: '' };
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const manifest = JSON.parse(raw);
    const versions = ['java-vue-admin-1', 'java-react-admin-1'];
    if (
      manifest.schemaVersion !== 1 ||
      !versions.includes(manifest.version) ||
      !manifest.samples ||
      typeof manifest.samples !== 'object' ||
      Array.isArray(manifest.samples)
    ) {
      return fail('TEMPLATE_STYLE_INVALID', '不兼容或非法的项目模板样例索引');
    }
    const entries = Object.entries(manifest.samples);
    if (!entries.length || entries.length > 100)
      return fail('TEMPLATE_STYLE_INVALID', '模板样例数量不合法');
    const references = [];
    const examples = [];
    let bytes = 0;
    const realRoot = fs.realpathSync(root);
    for (const [name, expected] of entries) {
      if (
        !name.startsWith('.specgate/examples/' + manifest.version + '/') ||
        name.includes('..') ||
        name.includes('\\') ||
        !/^[a-f0-9]{64}$/.test(expected)
      ) {
        return fail('TEMPLATE_STYLE_INVALID', '模板样例路径或摘要不合法');
      }
      const resolved = path.join(root, name);
      const relative = path.relative(realRoot, fs.realpathSync(resolved));
      if (
        relative.startsWith('..') ||
        path.isAbsolute(relative) ||
        !fs.statSync(resolved).isFile()
      ) {
        return fail('TEMPLATE_STYLE_INVALID', '模板样例越过项目边界');
      }
      const stat = fs.statSync(resolved);
      bytes += stat.size;
      if (stat.size > 256 * 1024 || bytes > 512 * 1024)
        return fail('TEMPLATE_STYLE_INVALID', '模板样例超过读取上限');
      const content = fs.readFileSync(resolved, 'utf8').replace(/\r\n/g, '\n');
      if (hash(content) !== expected)
        return fail(
          'TEMPLATE_STYLE_DRIFT',
          '模板样例已变化：' + name + '；恢复原版本或明确审批迁移',
        );
      references.push({ path: name, sha256: expected });
      examples.push(`\n--- ${name} (sha256:${expected}) ---\n${content}`);
    }
    return {
      ok: true,
      skipped: false,
      version: manifest.version,
      manifestHash: hash(raw),
      references,
      prompt: [
        '项目已固定下列规范与实际样例。按它们实现并走查新增资源的分层、API、页面、测试及文档。',
        '质量检查必须实际执行；缺证据、失败、关键跳过、覆盖率不足或未整改阻断问题不得报告完成。',
        ...examples,
      ].join('\n'),
    };
  } catch (error) {
    return fail('TEMPLATE_STYLE_INVALID', '无法读取项目模板样例：' + error.message);
  }
}

/** Only source/configuration inputs; build outputs, persisted data and reports are excluded. */
export function projectSourceHash(root, { ignoreLocks = false } = {}) {
  const digest = createHash('sha256');
  const ignored = new Set([
    '.git',
    '.specgate',
    'node_modules',
    'target',
    'dist',
    'coverage',
    'data',
    'openspec',
  ]);
  function visit(directory, prefix = '') {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name)) continue;
      if (ignoreLocks && ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].includes(entry.name))
        continue;
      const name = prefix + entry.name;
      if (entry.isDirectory()) visit(path.join(directory, entry.name), name + '/');
      else if (entry.isFile() && !/\.(log|mv\.db|trace\.db)$/.test(name)) {
        const buffer = fs.readFileSync(path.join(directory, entry.name));
        const content =
          /\.(java|[cm]?js|tsx?|vue|css|html|json|xml|ya?ml|md|properties)$/.test(name) ||
          entry.name.startsWith('.')
            ? buffer.toString('utf8').replace(/\r\n/g, '\n')
            : buffer;
        digest.update(name).update('\0').update(content).update('\0');
      }
    }
  }
  visit(root);
  return digest.digest('hex');
}
