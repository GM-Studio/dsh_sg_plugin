import fs from 'node:fs';
import path from 'node:path';
import {
  ensureDir,
  exists,
  nowIso,
  parseFrontmatter,
  readIfExists,
  writeFile,
} from './util.js';

const REQUIREMENTS = 'REQUIREMENTS.md';
const CHANGE_FILE = 'change.json';

export function requirementsRoot(root) {
  return path.join(path.resolve(root), 'requirements');
}

export function requirementsPath(root) {
  return path.join(requirementsRoot(root), REQUIREMENTS);
}

export function historyRoot(root) {
  return path.join(requirementsRoot(root), 'history');
}

export function requirementsChangesDir(root) {
  return path.join(requirementsRoot(root), 'changes');
}

export function requirementChangeDir(root, name) {
  return path.join(requirementsChangesDir(root), name);
}

export function isRequirementsProject(root) {
  return exists(requirementsPath(root));
}

export function activeChangePath(root) {
  return path.join(path.resolve(root), '.specgate', 'state', 'active-change.json');
}

function readJson(file) {
  const text = readIfExists(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeJson(file, value) {
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function section(text, start, end) {
  const from = text.search(new RegExp(start.source, start.flags.includes('m') ? start.flags : `${start.flags}m`));
  if (from < 0) return '';
  const rest = text.slice(from);
  const firstLine = rest.indexOf('\n');
  if (firstLine < 0) return '';
  const body = rest.slice(firstLine + 1);
  const to = end ? body.search(end) : -1;
  return (to < 0 ? body : body.slice(0, to)).trim();
}

function field(block, name) {
  const match = block.match(new RegExp(`^-\\s*${name}\\s*[：:]\\s*(.*)$`, 'mi'));
  return match ? match[1].trim() : '';
}

function list(value) {
  return String(value || '')
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseEntries(text, prefix) {
  const pattern = new RegExp(`^###\\s+((?:${prefix})-[A-Za-z0-9-]+)\\s+(.+)$`, 'gm');
  const matches = [...text.matchAll(pattern)];
  return matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const block = text.slice(start, end);
    return {
      id: match[1],
      title: match[2].trim(),
      priority: field(block, '优先级') || 'P2',
      status: field(block, '状态') || 'active',
      introduced: field(block, '引入版本') || '',
      change: field(block, '来源变更') || '',
      acceptance: list(field(block, '验收标准')),
      metric: field(block, '指标') || '',
      description: field(block, '说明') || '',
    };
  });
}

export function parseRequirementsText(text) {
  const { data, body } = parseFrontmatter(text);
  const functionalText = section(body, /^##\s+3\./, /^##\s+4\./m);
  const nonfunctionalText = section(body, /^##\s+4\./, /^##\s+5\./m);
  const acceptanceText = section(body, /^##\s+5\./, /^##\s+6\./m);
  const goals = section(body, /^##\s+1\./, /^##\s+2\./m);
  const terms = section(body, /^##\s+2\./, /^##\s+3\./m);
  const constraints = section(body, /^##\s+6\./, /^##\s+7\./m);
  const changeLog = section(body, /^##\s+7\./, null);
  return {
    meta: data,
    version: String(data.version || '1.0.0'),
    status: String(data.status || 'draft'),
    changeId: data.change_id ? String(data.change_id) : null,
    goals,
    terms,
    requirements: parseEntries(functionalText, 'FR'),
    nonfunctional: parseEntries(nonfunctionalText, 'NFR'),
    acceptance: parseEntries(acceptanceText, 'AC'),
    constraints,
    changeLog,
    body,
  };
}

export function readRequirements(root) {
  const file = requirementsPath(root);
  const text = readIfExists(file);
  if (text === null) return null;
  return { ...parseRequirementsText(text), path: file, raw: text };
}

function renderEntry(entry, prefix) {
  const lines = [`### ${entry.id} ${entry.title}`, ''];
  lines.push(`- 优先级：${entry.priority || 'P2'}`);
  lines.push(`- 状态：${entry.status || 'active'}`);
  if (entry.introduced) lines.push(`- 引入版本：${entry.introduced}`);
  if (entry.change) lines.push(`- 来源变更：${entry.change}`);
  if (entry.acceptance?.length) lines.push(`- 验收标准：${entry.acceptance.join(', ')}`);
  if (entry.metric) lines.push(`- 指标：${entry.metric}`);
  if (entry.description) lines.push(`- 说明：${entry.description}`);
  if (prefix === 'AC') lines.push('- 说明：可独立验证的验收条件');
  lines.push('');
  return lines.join('\n');
}

export function renderRequirementsText(data) {
  const meta = {
    document: 'REQUIREMENTS',
    version: data.version,
    status: data.status || 'draft',
    updated_at: data.updatedAt || nowIso(),
    ...(data.changeId ? { change_id: data.changeId } : {}),
    ...(data.approvedAt ? { approved_at: data.approvedAt } : {}),
    ...(data.approvedBy ? { approved_by: data.approvedBy } : {}),
  };
  const frontmatter = Object.entries(meta)
    .map(([key, value]) => `${key}: ${JSON.stringify(String(value))}`)
    .join('\n');
  const functional = data.requirements.map((entry) => renderEntry(entry, 'FR')).join('\n');
  const nonfunctional = data.nonfunctional.map((entry) => renderEntry(entry, 'NFR')).join('\n');
  const acceptance = data.acceptance.map((entry) => renderEntry(entry, 'AC')).join('\n');
  const defaults = {
    goals: '待补充：项目目标、用户价值和范围。',
    terms: '待补充：项目术语与定义。',
    constraints: '待补充：约束、假设和明确不做的事情。',
    changeLog: '| 版本 | change | 摘要 | 批准人 | 时间 |\n|---|---|---|---|---|',
  };
  return [
    '---',
    frontmatter,
    '---',
    '',
    '# 项目需求',
    '',
    '## 1. 目标与范围',
    '',
    data.goals || defaults.goals,
    '',
    '## 2. 术语',
    '',
    data.terms || defaults.terms,
    '',
    '## 3. 功能需求',
    '',
    functional || '<!-- 添加 FR-001 等需求。 -->',
    '',
    '## 4. 非功能需求',
    '',
    nonfunctional || '<!-- 添加 NFR-001 等非功能需求。 -->',
    '',
    '## 5. 验收标准',
    '',
    acceptance || '<!-- 添加 AC-001 等验收标准。 -->',
    '',
    '## 6. 约束、假设与不做范围',
    '',
    data.constraints || defaults.constraints,
    '',
    '## 7. 变更记录',
    '',
    data.changeLog || defaults.changeLog,
    '',
  ].join('\n');
}

export function ensureRequirementsSkeleton(root, options = {}) {
  const dir = requirementsRoot(root);
  const file = requirementsPath(root);
  const language = String(options.language || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
  const baseline = {
    version: '1.0.0',
    status: 'approved',
    changeId: 'baseline',
    updatedAt: nowIso(),
    approvedAt: nowIso(),
    approvedBy: 'user',
    goals:
      language === 'en'
        ? 'Define the project goal, user value and scope here.'
        : '在此定义项目目标、用户价值和范围。',
    terms: language === 'en' ? 'Define project terms here.' : '在此定义项目术语。',
    constraints:
      language === 'en'
        ? 'List constraints, assumptions and explicit non-goals here.'
        : '在此列出约束、假设和明确不做的事情。',
    requirements: [],
    nonfunctional: [],
    acceptance: [],
    changeLog: '| 版本 | change | 摘要 | 批准人 | 时间 |\n|---|---|---|---|---|\n| 1.0.0 | baseline | initial requirements | user | ' + nowIso() + ' |',
  };
  ensureDir(dir);
  ensureDir(historyRoot(root));
  ensureDir(requirementsChangesDir(root));
  ensureDir(path.join(root, 'tests', 'specgate'));
  if (!exists(file)) writeFile(file, renderRequirementsText(baseline));
  const snapshot = path.join(historyRoot(root), 'v1.0.0');
  ensureDir(snapshot);
  if (!exists(path.join(snapshot, REQUIREMENTS))) {
    writeFile(path.join(snapshot, REQUIREMENTS), readIfExists(file) || renderRequirementsText(baseline));
  }
  return { file, created: exists(file) };
}

function bumpVersion(version, kind = 'minor') {
  const match = String(version || '1.0.0').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`需求版本不是 SemVer：${version}`);
  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (kind === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === 'patch') {
    patch += 1;
  } else {
    minor += 1;
    patch = 0;
  }
  return `${major}.${minor}.${patch}`;
}

export function validateChangeName(name) {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(name);
}

export function readRequirementChange(root, name) {
  const dir = requirementChangeDir(root, name);
  const data = readJson(path.join(dir, CHANGE_FILE));
  if (!data) return null;
  return { ...data, dir, changePath: path.join(dir, 'change.md') };
}

export function currentRequirementChange(root) {
  const active = readJson(activeChangePath(root));
  if (active?.name) {
    const change = readRequirementChange(root, active.name);
    if (change) return change;
  }
  const dir = requirementsChangesDir(root);
  if (!exists(dir)) return null;
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    .map((entry) => entry.name)
    .sort();
  return entries.length > 0 ? readRequirementChange(root, entries[entries.length - 1]) : null;
}

export function createRequirementChange(root, name, description = '') {
  if (!isRequirementsProject(root)) {
    throw new Error('当前项目不是 v2 需求项目：先执行 /sg-init 或 /sg-requirements-migrate');
  }
  if (!validateChangeName(name)) {
    throw new Error('change 名称必须是 kebab-case：小写字母、数字、连字符');
  }
  const existing = readRequirementChange(root, name);
  if (existing) return { ...existing, created: false };
  const base = readRequirements(root);
  const dir = requirementChangeDir(root, name);
  ensureDir(path.join(dir, 'tests', 'automation'));
  ensureDir(path.join(dir, 'specs'));
  ensureDir(path.join(root, '.specgate', 'state'));
  const data = {
    change: name,
    baseVersion: base.version,
    status: 'draft',
    versionBump: 'minor',
    summary: description || '',
    createdAt: nowIso(),
    added: [],
    modified: [],
    deprecated: [],
    acceptance: [],
  };
  writeJson(path.join(dir, CHANGE_FILE), data);
  writeFile(
    path.join(dir, 'change.md'),
    [
      `# Change ${name}`,
      '',
      '## Intent',
      '',
      description || '待补充：为什么要做这个变更。',
      '',
      '## Scope',
      '',
      '- 包含：',
      '- 不包含：',
      '',
      '## Impact',
      '',
      '- 影响的需求 ID：',
      '- 影响的模块/接口/数据：',
      '- 风险：',
      '',
      '## Requirement delta',
      '',
      '在 `change.json` 中维护 added / modified / deprecated / acceptance；',
      '`change.md` 只描述意图、范围和影响，不复制完整需求正文。',
      '',
    ].join('\n'),
  );
  writeFile(
    path.join(dir, 'design.md'),
    '# Design\n\n## Architecture\n\n待补充。\n\n## Technical Approach\n\n待补充。\n',
  );
  writeFile(path.join(dir, 'tasks.md'), '# Tasks\n\n- [ ] T1 实现变更\n- [ ] T2 编写/执行测试 role: tester\n');
  writeFile(
    path.join(dir, 'tests', 'cases.md'),
    '# Test Plan\n\n- Requirement version: \n- Change: ' +
      name +
      '\n\n## Cases\n\n### TC-XXX\n\n- Requirement: \n- Priority: P0\n- Type: integration\n- Preconditions: \n- Steps: \n- Expected: \n- Branches: \n- Red: \n- Automation: tests/specgate/' +
      name +
      '/tc-001\n',
  );
  writeFile(
    path.join(dir, 'tests', 'matrix.md'),
    '# Coverage Matrix\n\n| Requirement / AC | Case | Branches | Automation | Priority |\n|---|---|---|---|---|\n',
  );
  writeJson(activeChangePath(root), { name, createdAt: nowIso() });
  return { ...data, dir, changePath: path.join(dir, 'change.md'), created: true };
}

export function applyRequirementChange(root, name, options = {}) {
  const base = readRequirements(root);
  if (!base) throw new Error('requirements/REQUIREMENTS.md 不存在');
  const change = readRequirementChange(root, name);
  if (!change) throw new Error(`change 不存在：${name}`);
  if (change.status === 'approved' && change.version) {
    return { applied: false, version: change.version, change };
  }
  const added = Array.isArray(change.added) ? change.added : [];
  const modified = Array.isArray(change.modified) ? change.modified : [];
  const deprecated = Array.isArray(change.deprecated) ? change.deprecated : [];
  const acceptance = Array.isArray(change.acceptance) ? change.acceptance : [];
  if (added.length + modified.length + deprecated.length + acceptance.length === 0) {
    throw new Error('change.json 没有任何需求增量；先填写 added/modified/deprecated/acceptance');
  }
  const requirements = [...base.requirements];
  const nonfunctional = [...base.nonfunctional];
  const acceptanceList = [...base.acceptance];
  const target = (id) => (String(id).startsWith('NFR-') ? nonfunctional : requirements);
  for (const entry of added) {
    if (!entry.id || !entry.title) throw new Error('added 条目需要 id 和 title');
    if ([...requirements, ...nonfunctional, ...acceptanceList].some((item) => item.id === entry.id)) {
      throw new Error(`需求 ID 已存在，不能重复新增：${entry.id}`);
    }
    target(entry.id).push({
      id: entry.id,
      title: entry.title,
      priority: entry.priority || 'P2',
      status: 'active',
      introduced: '',
      change: name,
      acceptance: entry.acceptance || [],
      metric: entry.metric || '',
      description: entry.description || '',
    });
  }
  for (const entry of modified) {
    const list = target(entry.id);
    const index = list.findIndex((item) => item.id === entry.id);
    if (index < 0) throw new Error(`modified 条目不存在：${entry.id}`);
    list[index] = {
      ...list[index],
      ...entry,
      change: name,
      acceptance: entry.acceptance || list[index].acceptance,
    };
  }
  for (const id of deprecated) {
    const list = target(id);
    const index = list.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`deprecated 条目不存在：${id}`);
    list[index] = { ...list[index], status: 'deprecated', change: name };
  }
  for (const entry of acceptance) {
    if (!entry.id || !entry.title) throw new Error('acceptance 条目需要 id 和 title');
    const index = acceptanceList.findIndex((item) => item.id === entry.id);
    const value = {
      id: entry.id,
      title: entry.title,
      priority: entry.priority || 'P1',
      status: 'active',
      change: name,
      description: entry.description || '',
    };
    if (index >= 0) acceptanceList[index] = { ...acceptanceList[index], ...value };
    else acceptanceList.push(value);
  }
  const nextVersion = bumpVersion(base.version, change.versionBump || 'minor');
  const approvedAt = nowIso();
  const changeLogLine = `| ${nextVersion} | ${name} | ${change.summary || 'requirement change'} | user | ${approvedAt} |`;
  const changeLog = `${base.changeLog || ''}\n${changeLogLine}`.trim();
  const next = {
    ...base,
    version: nextVersion,
    status: 'approved',
    changeId: name,
    updatedAt: approvedAt,
    approvedAt,
    approvedBy: 'user',
    requirements,
    nonfunctional,
    acceptance: acceptanceList,
    changeLog,
  };
  writeFile(requirementsPath(root), renderRequirementsText(next));
  const history = path.join(historyRoot(root), `v${nextVersion}`);
  ensureDir(history);
  writeFile(path.join(history, REQUIREMENTS), readIfExists(requirementsPath(root)) || '');
  const changeDir = requirementChangeDir(root, name);
  writeJson(path.join(changeDir, CHANGE_FILE), {
    ...change,
    status: 'approved',
    version: nextVersion,
    approvedAt,
  });
  writeFile(
    path.join(changeDir, 'approval.md'),
    `# Approval\n\n- change: ${name}\n- version: ${nextVersion}\n- approved_at: ${approvedAt}\n- approved_by: user\n`,
  );
  writeJson(activeChangePath(root), { name, version: nextVersion, approvedAt });
  return { applied: true, version: nextVersion, change: { ...change, version: nextVersion } };
}

export function testPaths(root, name) {
  const dir = requirementChangeDir(root, name);
  return {
    dir,
    cases: path.join(dir, 'tests', 'cases.md'),
    matrix: path.join(dir, 'tests', 'matrix.md'),
    report: path.join(dir, 'test-report.md'),
    automation: path.join(root, 'tests', 'specgate', name),
  };
}

export function validateTestPlan(root, name) {
  const paths = testPaths(root, name);
  const cases = readIfExists(paths.cases);
  const matrix = readIfExists(paths.matrix);
  if (!cases || !/^###\s+TC-\d+/im.test(cases)) return { ok: false, reason: '缺少测试用例：tests/cases.md 中没有 TC-* 用例' };
  if (!matrix || !/\|/.test(matrix)) return { ok: false, reason: '缺少覆盖矩阵：tests/matrix.md' };
  return { ok: true };
}

export function parseTestReport(text) {
  const value = String(text || '');
  const verdictMatch = value.match(/(?:^|\n)\s*(?:verdict|结论)\s*[：:]\s*([^\n]+)/i);
  const verdict = verdictMatch ? verdictMatch[1].trim().toLowerCase() : null;
  const lineMatch = value.match(/(?:line|行覆盖(?:率)?)\s*[：:]\s*(\d+(?:\.\d+)?)/i);
  const branchMatch = value.match(/(?:branch|分支覆盖(?:率)?)\s*[：:]\s*(\d+(?:\.\d+)?)/i);
  const failedMatch = value.match(/(?:failed|失败)\s*[：:]\s*(\d+)/i);
  const p0Match = value.match(/(?:p0|P0)\s*(?:通过率|pass(?:ed)?)?\s*[：:]\s*(\d+(?:\.\d+)?)/);
  const p1Match = value.match(/(?:p1|P1)\s*(?:通过率|pass(?:ed)?)?\s*[：:]\s*(\d+(?:\.\d+)?)/);
  const p2Match = value.match(/(?:p2|P2)\s*(?:通过率|pass(?:ed)?)?\s*[：:]\s*(\d+(?:\.\d+)?)/);
  const pass = verdict === 'pass' || verdict === 'passed' || verdict === '通过';
  return {
    pass,
    verdict,
    line: lineMatch ? Number(lineMatch[1]) : null,
    branch: branchMatch ? Number(branchMatch[1]) : null,
    failed: failedMatch ? Number(failedMatch[1]) : null,
    p0: p0Match ? Number(p0Match[1]) : null,
    p1: p1Match ? Number(p1Match[1]) : null,
    p2: p2Match ? Number(p2Match[1]) : null,
  };
}

export function validateTestReport(root, name, options = {}) {
  const report = readIfExists(testPaths(root, name).report);
  if (!report) return { ok: false, reason: '缺少 tests/test-report.md；先执行 /sg-test <change> run' };
  const parsed = parseTestReport(report);
  if (!parsed.pass) return { ok: false, reason: '测试报告结论不是 pass/通过' };
  if (parsed.failed !== null && parsed.failed > 0) {
    return { ok: false, reason: `测试仍有 ${parsed.failed} 个失败用例` };
  }
  const minLine = Number(options.minLineCoverage) || 80;
  const minBranch = Number(options.minBranchCoverage) || 70;
  if (parsed.p0 !== null && parsed.p0 < 100) return { ok: false, reason: 'P0 通过率必须为 100%' };
  if (parsed.p1 !== null && parsed.p1 < 100) return { ok: false, reason: 'P1 通过率必须为 100%' };
  if (parsed.p2 !== null && parsed.p2 < 90) return { ok: false, reason: 'P2 通过率必须至少 90%' };
  if (parsed.line !== null && parsed.line < minLine) {
    return { ok: false, reason: `行覆盖率 ${parsed.line}% 低于 ${minLine}%` };
  }
  if (parsed.branch !== null && parsed.branch < minBranch) {
    return { ok: false, reason: `分支覆盖率 ${parsed.branch}% 低于 ${minBranch}%` };
  }
  return { ok: true, ...parsed };
}

export function writeTestReport(root, name, report) {
  const paths = testPaths(root, name);
  ensureDir(paths.dir);
  writeFile(paths.report, report);
  return paths.report;
}

export function listRequirementChangeNames(root) {
  const dir = requirementsChangesDir(root);
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
    .map((entry) => entry.name)
    .sort();
}

export function migrateRequirements(root, options = {}) {
  const projectRoot = path.resolve(root);
  const dryRun = options.dryRun === true;
  if (isRequirementsProject(projectRoot)) {
    return { ok: true, already: true, text: '项目已经使用 requirements/REQUIREMENTS.md，无需迁移。' };
  }
  const oldRoot = path.join(projectRoot, 'openspec', 'changes');
  const names = exists(oldRoot)
    ? fs
        .readdirSync(oldRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
        .map((entry) => entry.name)
        .sort()
    : [];
  if (names.length === 0) {
    return { ok: false, text: '没有可迁移的 openspec/changes；先用 /sg-init 创建 v2 项目。' };
  }
  const plan = {
    root: projectRoot,
    changes: names,
    mode: dryRun ? 'dry-run' : 'apply',
  };
  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      plan,
      text: `将迁移 ${names.length} 个旧 change 到 requirements/REQUIREMENTS.md v1.0.0。`,
    };
  }
  ensureRequirementsSkeleton(projectRoot, { language: options.language });
  const base = readRequirements(projectRoot);
  const requirements = names.map((name, index) => {
    const proposal = readIfExists(path.join(oldRoot, name, 'proposal.md')) || '';
    const title = (proposal.match(/^#\s+(.+)$/m)?.[1] || name).trim();
    return {
      id: `FR-${String(index + 1).padStart(3, '0')}`,
      title,
      priority: 'P1',
      status: 'active',
      change: name,
      acceptance: [],
      description: `Migrated from openspec/changes/${name}/proposal.md`,
    };
  });
  const now = nowIso();
  writeFile(
    requirementsPath(projectRoot),
    renderRequirementsText({
      ...base,
      version: '1.0.0',
      status: 'approved',
      changeId: 'legacy-migration',
      updatedAt: now,
      approvedAt: now,
      approvedBy: 'user',
      requirements,
      changeLog: `${base.changeLog || ''}\n| 1.0.0 | legacy-migration | migrated ${names.length} changes | user | ${now} |`.trim(),
    }),
  );
  const history = path.join(historyRoot(projectRoot), 'v1.0.0');
  ensureDir(history);
  writeFile(path.join(history, REQUIREMENTS), readIfExists(requirementsPath(projectRoot)) || '');
  for (const name of names) {
    const dir = requirementChangeDir(projectRoot, name);
    ensureDir(dir);
    const proposal = readIfExists(path.join(oldRoot, name, 'proposal.md')) || '';
    if (!exists(path.join(dir, 'change.md'))) writeFile(path.join(dir, 'change.md'), proposal);
    if (!exists(path.join(dir, CHANGE_FILE))) {
      writeJson(path.join(dir, CHANGE_FILE), {
        change: name,
        baseVersion: '1.0.0',
        status: 'migrated',
        versionBump: 'minor',
        summary: `Migrated from openspec/changes/${name}`,
        added: [],
        modified: [],
        deprecated: [],
        acceptance: [],
      });
    }
  }
  writeJson(activeChangePath(projectRoot), { name: names[names.length - 1], migrated: true });
  return {
    ok: true,
    plan,
    version: '1.0.0',
    changes: names.length,
    text: `已迁移 ${names.length} 个旧 change 到 requirements/REQUIREMENTS.md v1.0.0（旧 openspec 文件保留）。`,
  };
}
