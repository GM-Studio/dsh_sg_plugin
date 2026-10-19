import path from 'node:path';
import fs from 'node:fs';
import { ensureDir, exists, writeText } from './util/fsx.js';
import { digest } from './util/hash.js';

export const DOC_RELATIVE = 'docs/requirements/REQ.md';
export const DOC_VERSION = 'v1.0';
export const MAX_DOC_BYTES = 1024 * 1024;

export const TEMPLATE_SECTIONS = [
  '目标与范围',
  '术语',
  '功能需求',
  '非功能需求',
  '验收标准',
  '约束、假设与不做范围',
  '变更记录',
];

export const DIMENSION_PROMPTS = [
  {
    key: 'functional',
    label: '功能需求（MVP）',
    question: '第一版必须提供哪些功能？一条一行，只列 MVP 必需能力。',
  },
  {
    key: 'nonFunctional',
    label: '非功能需求（性能 / 安全 / 可用性 / 兼容性）',
    question: '对性能、安全、可用性、兼容性有什么要求？没有就明确说“留空”。',
  },
  {
    key: 'constraints',
    label: '约束与依赖',
    question: '有哪些硬约束或外部依赖？例如合规、既有系统、部署环境、期限。没有就明确说“留空”。',
  },
  {
    key: 'acceptance',
    label: '验收标准',
    question: '每条功能需求如何验收？不回答时按“实现并通过自动化测试”自动生成。',
  },
];

export const CLARIFY_LIMITS = { maxRoundsPerDimension: 6, maxTotalRounds: 12 };

export const CONFIRM_OPTIONS = ['确认', '修改需求', '修改技术栈', '修改其他确认点', '取消'];

function fail(code, message, fix) {
  return { ok: false, code, message, ...(fix ? { fix } : {}) };
}

function pad(value) {
  return String(value).padStart(3, '0');
}

function normalizeEol(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function cleanInline(text) {
  return String(text ?? '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\x60([^\x60]+)\x60/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFrontmatter(text) {
  const lines = normalizeEol(stripBom(text)).split('\n');
  if (lines[0]?.trim() !== '---') return { data: {}, body: lines.join('\n'), lines };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return { data: {}, body: lines.join('\n'), lines };
  const data = {};
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[match[1]] = value;
  }
  return { data, body: lines.slice(end + 1).join('\n'), lines: lines.slice(end + 1) };
}

function classifySection(title) {
  const text = cleanInline(String(title).replace(/^\d+(?:\.\d+)*[.、)\s]+/, ''));
  if (/非功能|non[-_\s]?functional/i.test(text)) return 'nonFunctional';
  if (/验收|acceptance/i.test(text)) return 'acceptance';
  if (/约束|假设|不做|范围外|constraint|assumption|out[-_\s]?of[-_\s]?scope/i.test(text)) {
    return 'constraints';
  }
  if (/功能|functional|feature/i.test(text)) return 'functional';
  return null;
}

function looksLikeSubSection(title) {
  return /^\d+(?:\.\d+)+[.、)\s]/.test(title) || /[：:]$/.test(title);
}

function attributeKind(body) {
  const match =
    /^(优先级|状态|验收标准|指标|度量|covers?|priority|status|metric)\s*[:：]\s*(.*)$/i.exec(
      String(body).trim(),
    );
  if (!match) return null;
  const key = match[1].toLowerCase();
  if (key === '优先级' || key === 'priority') return { key: 'priority', value: match[2] };
  if (key === '状态' || key === 'status') return { key: 'status', value: match[2] };
  if (key === '验收标准') return { key: 'acceptanceText', value: match[2] };
  if (key === '指标' || key === '度量' || key === 'metric')
    return { key: 'metric', value: match[2] };
  return { key: 'covers', value: match[2] };
}

function normalizeId(raw) {
  const match = /^(NFR|FR|AC|CON|C)[-_\s](\d{1,4})\b/i.exec(String(raw ?? '').trim());
  if (!match) return null;
  const prefix = match[1].toUpperCase() === 'CON' ? 'C' : match[1].toUpperCase();
  return { prefix, id: prefix + '-' + pad(Number(match[2])) };
}

function splitId(text) {
  const match = /^(NFR|FR|AC|CON|C)[-_\s](\d{1,4})\b[\s:：-]*(.*)$/i.exec(
    String(text ?? '').trim(),
  );
  if (!match) return { id: null, title: cleanInline(text) };
  const prefix = match[1].toUpperCase() === 'CON' ? 'C' : match[1].toUpperCase();
  return {
    id: prefix + '-' + pad(Number(match[2])),
    prefix,
    title: cleanInline(match[3]) || prefix + '-' + pad(Number(match[2])),
  };
}

function parseCovers(value) {
  return String(value ?? '')
    .split(/[,，;；\s]+/)
    .map((item) => normalizeId(item)?.id)
    .filter(Boolean);
}

function newEntry(key, title, line) {
  return {
    id: null,
    title: cleanInline(title),
    line,
    priority: key === 'nonFunctional' ? 'P1' : 'P0',
    status: 'active',
    metric: '',
    acceptanceText: '',
    covers: [],
  };
}

function closeBucket(current, buckets) {
  if (!current) return;
  if (current.entries.length) buckets[current.key].push(...current.entries);
}

/**
 * Lenient Markdown requirements parser. It never mutates the source document.
 * Returns a normalized document model with stable FR/NFR/C/AC identifiers.
 */
export function parseRequirementsText(rawText) {
  const { data: frontmatter, body } = parseFrontmatter(rawText);
  const lines = body.split('\n');
  const buckets = { functional: [], nonFunctional: [], constraints: [], acceptance: [] };
  const warnings = [];
  const seen = { functional: false, nonFunctional: false, constraints: false, acceptance: false };
  let current = null;
  let fence = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(\x60\x60\x60|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;

    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = cleanInline(heading[2]);
      const key = classifySection(title);
      if (key) {
        closeBucket(current, buckets);
        current = { key, level, entries: [], sawSub: false };
        seen[key] = true;
        continue;
      }
      if (current && level > current.level) {
        if (looksLikeSubSection(title)) continue;
        const parsed = splitId(title);
        const entry = newEntry(current.key, parsed.title, index + 1);
        entry.id = parsed.id;
        current.entries.push(entry);
        current.sawSub = true;
        continue;
      }
      closeBucket(current, buckets);
      current = null;
      continue;
    }

    if (!current) continue;
    const bullet = /^(\s*)[-*+]\s+(.+?)\s*$/.exec(line);
    if (!bullet) continue;
    const indent = bullet[1].replace(/\t/g, '  ').length;
    const content = bullet[2].trim();
    if (current.sawSub || indent >= 2) {
      const last = current.entries[current.entries.length - 1];
      if (!last) continue;
      const attribute = attributeKind(content);
      if (attribute) {
        if (attribute.key === 'covers') last.covers.push(...parseCovers(attribute.value));
        else last[attribute.key] = cleanInline(attribute.value);
      }
      continue;
    }
    if (attributeKind(content)) continue;
    const parsed = splitId(content);
    const entry = newEntry(current.key, parsed.title, index + 1);
    entry.id = parsed.id;
    current.entries.push(entry);
  }
  closeBucket(current, buckets);

  // Fallback: a plain list without section headings is treated as functional candidates.
  if (
    !seen.functional &&
    !seen.nonFunctional &&
    !seen.constraints &&
    !seen.acceptance &&
    buckets.functional.length === 0
  ) {
    fence = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (/^\s*(\x60\x60\x60|~~~)/.test(line)) {
        fence = !fence;
        continue;
      }
      if (fence) continue;
      const bullet = /^(\s*)[-*+]\s+(.+?)\s*$/.exec(line);
      if (!bullet) continue;
      if (bullet[1].length >= 2 || attributeKind(bullet[2])) continue;
      const parsed = splitId(bullet[2]);
      const entry = newEntry('functional', parsed.title, index + 1);
      entry.id = parsed.id;
      buckets.functional.push(entry);
    }
    if (buckets.functional.length) {
      warnings.push('未识别到“功能需求”章节，已将顶层列表项归类为功能候选，请在确认页核对。');
    }
  }

  const doc = {
    functional: buckets.functional,
    nonFunctional: buckets.nonFunctional,
    constraints: buckets.constraints,
    acceptance: buckets.acceptance,
    warnings,
    meta: { frontmatter },
  };
  assignIds(doc, warnings);
  resolveAcceptance(doc, warnings);
  return doc;
}

function assignIds(doc, warnings) {
  for (const [key, prefix] of [
    ['functional', 'FR'],
    ['nonFunctional', 'NFR'],
    ['constraints', 'C'],
    ['acceptance', 'AC'],
  ]) {
    const used = new Set();
    let next = 1;
    for (const entry of doc[key]) {
      if (entry.id && entry.id.startsWith(prefix + '-') && !used.has(entry.id)) {
        used.add(entry.id);
        continue;
      }
      while (used.has(prefix + '-' + pad(next))) next += 1;
      if (entry.id)
        warnings.push(
          '编号 ' + entry.id + ' 重复或与章节不符，已重编为 ' + prefix + '-' + pad(next),
        );
      entry.id = prefix + '-' + pad(next);
      used.add(entry.id);
      next += 1;
    }
  }
}

function resolveAcceptance(doc, warnings) {
  const frById = new Map(doc.functional.map((entry) => [entry.id, entry]));
  const assigned = new Map();
  const pending = [];
  for (const ac of doc.acceptance) {
    const matched = ac.covers.filter((id) => frById.has(id));
    if (matched.length) {
      for (const id of matched) {
        if (!assigned.has(id)) assigned.set(id, []);
        assigned.get(id).push(ac.title);
      }
    } else if (ac.covers.length) {
      warnings.push(ac.id + ' 引用的功能需求不存在，已按顺序归入功能验收。');
      pending.push(ac);
    } else {
      pending.push(ac);
    }
  }
  let cursor = 0;
  for (const ac of pending) {
    while (cursor < doc.functional.length && assigned.has(doc.functional[cursor].id)) cursor += 1;
    if (cursor < doc.functional.length) {
      const id = doc.functional[cursor].id;
      if (!assigned.has(id)) assigned.set(id, []);
      assigned.get(id).push(ac.title);
      cursor += 1;
    } else if (doc.functional.length) {
      const id = doc.functional[doc.functional.length - 1].id;
      if (!assigned.has(id)) assigned.set(id, []);
      assigned.get(id).push(ac.title);
      warnings.push(ac.id + ' 没有可对应的功能需求，已归入最后一条功能验收。');
    }
  }
  for (const entry of doc.functional) {
    const titles = [...(assigned.get(entry.id) || [])];
    if (!titles.length && entry.acceptanceText && !/^AC-\d+/i.test(entry.acceptanceText)) {
      titles.push(entry.acceptanceText);
    }
    if (!titles.length) titles.push('实现并通过自动化测试：' + entry.title);
    entry.acceptanceText = titles.join('；');
  }
}

function toEntry(value, key) {
  if (value && typeof value === 'object') {
    const title = cleanInline(value.title ?? value.name ?? value.text ?? '');
    if (!title) return null;
    return {
      id: value.id ? normalizeId(value.id)?.id || null : null,
      title,
      line: null,
      priority: cleanInline(value.priority || (key === 'nonFunctional' ? 'P1' : 'P0')),
      status: cleanInline(value.status || 'active'),
      metric: cleanInline(value.metric || ''),
      acceptanceText: cleanInline(value.acceptance || value.acceptanceText || ''),
      covers: Array.isArray(value.covers)
        ? value.covers
            .map((item) => (typeof item === 'number' ? 'FR-' + pad(item) : normalizeId(item)?.id))
            .filter(Boolean)
        : [],
    };
  }
  const text = cleanInline(value);
  if (!text) return null;
  const parsed = splitId(text);
  const entry = newEntry(key, parsed.title, null);
  entry.id = parsed.id;
  return entry;
}

/**
 * Normalize the draft payload accepted by sg_init({ draft }).
 */
export function normalizeDraftInput(draft) {
  const source = draft && typeof draft === 'object' ? draft : {};
  const doc = {
    functional: (Array.isArray(source.functional) ? source.functional : [])
      .map((item) => toEntry(item, 'functional'))
      .filter(Boolean),
    nonFunctional: (Array.isArray(source.nonFunctional) ? source.nonFunctional : [])
      .map((item) => toEntry(item, 'nonFunctional'))
      .filter(Boolean),
    constraints: (Array.isArray(source.constraints) ? source.constraints : [])
      .map((item) => toEntry(item, 'constraints'))
      .filter(Boolean),
    acceptance: [],
    warnings: [],
    meta: { frontmatter: {} },
  };
  const rawAcceptance = Array.isArray(source.acceptance) ? source.acceptance : [];
  for (const [index, value] of rawAcceptance.entries()) {
    const entry = toEntry(value, 'acceptance');
    if (!entry) continue;
    if (!entry.covers.length && doc.functional[index])
      entry.covers = [doc.functional[index].id || 'FR-' + pad(index + 1)];
    doc.acceptance.push(entry);
  }
  assignIds(doc, doc.warnings);
  // Draft acceptance entries may reference functional indices before ids existed.
  for (const [index, value] of rawAcceptance.entries()) {
    const entry = doc.acceptance[index];
    if (!entry) continue;
    const raw = value && typeof value === 'object' ? value.covers : null;
    if (Array.isArray(raw) && raw.some((item) => typeof item === 'number')) {
      entry.covers = raw
        .map((item) =>
          typeof item === 'number' ? doc.functional[item - 1]?.id : normalizeId(item)?.id,
        )
        .filter(Boolean);
    }
  }
  resolveAcceptance(doc, doc.warnings);
  return {
    doc,
    background: cleanInline(source.background || ''),
    team: cleanInline(source.team || ''),
    steps: cleanInline(source.steps || ''),
    context: source.context && typeof source.context === 'object' ? { ...source.context } : {},
    confirmedEmpty: Array.isArray(source.confirmedEmpty) ? source.confirmedEmpty.map(String) : [],
    source: source.source && typeof source.source === 'object' ? { ...source.source } : null,
    warnings: doc.warnings,
  };
}

export function missingDimensions(doc, confirmedEmpty = []) {
  const empty = new Set(confirmedEmpty);
  const missing = [];
  if (!doc.functional.length) missing.push('functional');
  if (!doc.nonFunctional.length && !empty.has('nonFunctional')) missing.push('nonFunctional');
  if (!doc.constraints.length && !empty.has('constraints')) missing.push('constraints');
  return missing;
}

export function toLegacyRequirements(doc) {
  return {
    functional: doc.functional.map((entry) => entry.title),
    nonFunctional: doc.nonFunctional.map((entry) =>
      entry.metric ? entry.title + '（指标：' + entry.metric + '）' : entry.title,
    ),
    constraints: doc.constraints.map((entry) => entry.title),
    acceptance: doc.functional.map((entry) => entry.acceptanceText),
  };
}

export function summarizeDoc(doc) {
  return toLegacyRequirements(doc);
}

function buildAcceptanceList(doc) {
  const acs = [];
  const frAc = new Map();
  for (const entry of doc.functional) {
    const ac = { id: 'AC-' + pad(acs.length + 1), title: entry.acceptanceText, covers: [entry.id] };
    acs.push(ac);
    frAc.set(entry.id, ac.id);
  }
  for (const entry of doc.nonFunctional) {
    acs.push({
      id: 'AC-' + pad(acs.length + 1),
      title: '验证：' + entry.title,
      covers: [entry.id],
    });
  }
  for (const entry of doc.constraints) {
    acs.push({
      id: 'AC-' + pad(acs.length + 1),
      title: '验证：' + entry.title,
      covers: [entry.id],
    });
  }
  return { acs, frAc };
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

/**
 * Render the human-readable requirements document (template format).
 * IDs are deterministic: FR/NFR/C/AC follow document order.
 */
export function renderRequirementsDocument(doc, options = {}) {
  const { acs, frAc } = buildAcceptanceList(doc);
  const version = options.version || DOC_VERSION;
  const updatedAt = options.updatedAt || new Date().toISOString();
  const source = options.source || 'dialog';
  const sourceHash = options.sourceHash || digest(JSON.stringify({ doc }));
  const background = options.background || '（待补充）';

  const lines = [];
  lines.push('---');
  lines.push('document: REQUIREMENTS');
  lines.push('version: ' + version);
  lines.push('status: approved');
  lines.push('updated_at: ' + updatedAt);
  lines.push('source: ' + yamlString(source));
  lines.push('source_sha256: ' + yamlString(sourceHash));
  lines.push('---');
  lines.push('');
  lines.push('# 项目需求');
  lines.push('');
  lines.push('## 1. 目标与范围');
  lines.push('');
  lines.push(background);
  lines.push('');
  lines.push('## 2. 术语');
  lines.push('');
  lines.push('（暂无）');
  lines.push('');
  lines.push('## 3. 功能需求');
  lines.push('');
  for (const entry of doc.functional) {
    lines.push('### ' + entry.id + ' ' + entry.title);
    lines.push('');
    lines.push('- 优先级：' + (entry.priority || 'P0'));
    lines.push('- 状态：' + (entry.status || 'active'));
    lines.push('- 验收标准：' + (frAc.get(entry.id) || '（见验收标准）'));
    lines.push('');
  }
  if (!doc.functional.length) lines.push('（无）', '');
  lines.push('## 4. 非功能需求');
  lines.push('');
  for (const entry of doc.nonFunctional) {
    lines.push('### ' + entry.id + ' ' + entry.title);
    lines.push('');
    lines.push('- 优先级：' + (entry.priority || 'P1'));
    lines.push('- 指标：' + (entry.metric || '（待补充）'));
    lines.push('');
  }
  if (!doc.nonFunctional.length) lines.push('（无）', '');
  lines.push('## 5. 验收标准');
  lines.push('');
  for (const ac of acs) {
    lines.push('### ' + ac.id + ' ' + ac.title);
    lines.push('');
    lines.push('- covers: ' + ac.covers.join(', '));
    lines.push('');
  }
  lines.push('## 6. 约束、假设与不做范围');
  lines.push('');
  for (const entry of doc.constraints) {
    lines.push('### ' + entry.id + ' ' + entry.title);
    lines.push('');
    lines.push('- 状态：' + (entry.status || 'active'));
    lines.push('');
  }
  if (!doc.constraints.length) lines.push('（无）', '');
  lines.push('## 7. 变更记录');
  lines.push('');
  lines.push('| 版本 | change | 摘要 | 批准人 | 时间 |');
  lines.push('|---|---|---|---|---|');
  lines.push('| ' + version + ' | — | 初始化需求文档 | 用户 | ' + updatedAt.slice(0, 10) + ' |');
  lines.push('');
  return lines.join('\n');
}

/** Render a draft page used in CLARIFY (not written to disk). */
export function renderDraftPreview(doc, options = {}) {
  return renderRequirementsDocument(doc, options);
}

/**
 * Read and minimally validate a -req document. Read-only; never writes.
 */
export function readRequirementsFile(root, input) {
  const raw = String(input || '').trim();
  if (!raw) return fail('E_REQ_NOT_FOUND', '未指定需求文档路径');
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(root, raw);
  let stat;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return fail('E_REQ_NOT_FOUND', '需求文档不存在：' + raw, '检查 -req 路径');
  }
  if (!stat.isFile()) return fail('E_REQ_NOT_FILE', '需求文档不是普通文件：' + raw);
  if (stat.size > MAX_DOC_BYTES) {
    return fail('E_REQ_TOO_LARGE', '需求文档超过 1 MiB：' + raw, '拆分或精简文档');
  }
  let buffer;
  try {
    buffer = fs.readFileSync(absolute);
  } catch (error) {
    return fail('E_REQ_UNREADABLE', '需求文档不可读：' + (error?.message || raw));
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return fail('E_REQ_ENCODING', '需求文档不是合法的 UTF-8：' + raw, '另存为 UTF-8 后重试');
  }
  text = stripBom(normalizeEol(text));
  if (!text.trim()) return fail('E_REQ_EMPTY', '需求文档为空：' + raw);
  const relative = path.relative(root, absolute);
  const displayPath =
    relative && !relative.startsWith('..') && !path.isAbsolute(relative)
      ? relative.split(path.sep).join('/')
      : absolute;
  return {
    ok: true,
    absolutePath: absolute,
    displayPath,
    text,
    bytes: buffer.length,
    hash: digest(text),
  };
}

export function validateParsedDoc(doc, { sourceKind = 'req', confirmedEmpty = [] } = {}) {
  const errors = [];
  const missing = missingDimensions(doc, confirmedEmpty);
  if (!doc.functional.length) {
    errors.push({
      code: sourceKind === 'draft' ? 'E_DRAFT_INCOMPLETE' : 'E_REQ_NO_FUNCTIONAL',
      message:
        sourceKind === 'draft'
          ? '草稿至少需要一条功能需求（functional[].title）'
          : '需求文档中抽不出任何功能需求',
    });
  }
  for (const entry of doc.functional) {
    if (!entry.title) {
      errors.push({ code: 'E_DRAFT_INCOMPLETE', message: '功能需求标题为空：' + entry.id });
    }
  }
  return { ok: errors.length === 0, errors, missing };
}

export function buildClarifyPayload({
  source = 'dialog',
  seed = '',
  doc = null,
  background = '',
  team = '',
  steps = '',
  context = {},
  confirmedEmpty = [],
  warnings = [],
  missing = null,
  action = null,
  sourceInfo = null,
} = {}) {
  const model = doc || {
    functional: [],
    nonFunctional: [],
    constraints: [],
    acceptance: [],
    warnings: [],
    meta: { frontmatter: {} },
  };
  const gaps = Array.isArray(missing) ? missing : missingDimensions(model, confirmedEmpty);
  const nextQuestions = [];
  for (const dimension of DIMENSION_PROMPTS) {
    if (gaps.includes(dimension.key)) nextQuestions.push(dimension.question);
  }
  if (gaps.includes('functional') || !model.functional.length) {
    nextQuestions.unshift(DIMENSION_PROMPTS[0].question);
  }
  if (!nextQuestions.length) nextQuestions.push('还有需要补充的约束、依赖或验收标准吗？');
  const draft = {
    background,
    functional: model.functional.map((entry) => ({
      title: entry.title,
      ...(entry.priority ? { priority: entry.priority } : {}),
      ...(entry.acceptanceText ? { acceptance: entry.acceptanceText } : {}),
    })),
    nonFunctional: model.nonFunctional.map((entry) => ({
      title: entry.title,
      ...(entry.metric ? { metric: entry.metric } : {}),
    })),
    constraints: model.constraints.map((entry) => entry.title),
    acceptance: model.functional.map((entry) => ({
      title: entry.acceptanceText,
      covers: [entry.id],
    })),
    confirmedEmpty,
    ...(sourceInfo ? { source: sourceInfo } : {}),
    ...(Object.keys(context || {}).length ? { context } : {}),
    ...(team ? { team } : {}),
    ...(steps ? { steps } : {}),
  };
  return {
    ok: true,
    phase: 'CLARIFY',
    source,
    ...(action ? { action } : {}),
    seed,
    template: { sections: TEMPLATE_SECTIONS, prompts: DIMENSION_PROMPTS },
    draft,
    missing: gaps,
    nextQuestions: [...new Set(nextQuestions)],
    limits: CLARIFY_LIMITS,
    warnings: [...new Set([...(warnings || []), ...(model.warnings || [])])],
    protocol:
      'Agent 在聊天中逐维追问（功能→非功能→约束→验收，每维 1-2 问，最多 6 轮/维）。' +
      '收集完成后调用 sg_init({ draft })。缺失维度未补齐前不会写入任何文件；' +
      '如果用户明确表示某维度留空，请在 draft.confirmedEmpty 中列出该维度。',
    writes: [],
  };
}

export function nextRequirementsDocPath(root, version = DOC_VERSION) {
  const candidates = [
    DOC_RELATIVE,
    'docs/requirements/REQ.' + version + '.md',
    ...Array.from(
      { length: 8 },
      (_, index) => 'docs/requirements/REQ.' + version + '-' + (index + 2) + '.md',
    ),
  ];
  for (const relative of candidates) {
    if (!exists(path.join(root, relative))) return relative;
  }
  return null;
}

export function writeRequirementsDocument(root, text, { version = DOC_VERSION } = {}) {
  const relative = nextRequirementsDocPath(root, version);
  if (!relative) return fail('E_WRITE_FAILED', '需求文档目标路径已全部被占用，未覆盖任何文件');
  const file = path.join(root, relative);
  ensureDir(path.dirname(file));
  writeText(file, text);
  return { ok: true, relative, fallback: relative !== DOC_RELATIVE };
}

export function renderConfirmationPage({
  docText,
  contextText,
  warnings = [],
  willWrite = [],
  version = DOC_VERSION,
}) {
  const lines = [];
  lines.push('# SpecGate v3 初始化确认（= H0）');
  lines.push('');
  lines.push('## 需求文档（确认后写入 docs/requirements/REQ.md）');
  lines.push('');
  lines.push(docText.trim());
  lines.push('');
  lines.push('## 技术栈与项目上下文');
  lines.push('');
  lines.push(contextText.trim());
  lines.push('');
  if (warnings.length) {
    lines.push('## 自动补全与告警');
    lines.push('');
    for (const warning of [...new Set(warnings)]) lines.push('- ' + warning);
    lines.push('');
  }
  lines.push('## 将写入的文件');
  lines.push('');
  for (const file of willWrite) lines.push('- ' + file);
  lines.push('');
  lines.push('确认后写入上述文件并进入 H1_PENDING；选择“取消”不会写入任何文件。');
  return lines.join('\n');
}

export { fail as docFail, pad as docPad };
