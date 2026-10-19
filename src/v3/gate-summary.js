import fs from 'node:fs';
import path from 'node:path';
import { exists, readText } from './util/fsx.js';
import { git } from './worktrees.js';

const MAX_FILES = 20;
const MAX_DIFF_LINES = 40;
const MAX_HUNKS = 3;
const MAX_HUNK_LINES = 10;
const MAX_CHARS = 6000;
const SECRET_RE = /(secret|token|password|passwd|api[_-]?key|private key)/i;

function clip(text, limit) {
  const value = String(text || '').trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trim()}\n…（已截断）`;
}

function lineCount(file) {
  if (!exists(file)) return null;
  return readText(file).split(/\r?\n/).length;
}

function section(text, title) {
  const pattern = new RegExp(`##\\s*${title}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  const match = pattern.exec(String(text || ''));
  return match ? match[1].trim() : '';
}

function listSpecFiles(root, change) {
  const base = path.join(root, 'openspec', 'changes', change, 'specs');
  const result = [];
  const walk = (dir, capability) => {
    if (!exists(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, capability || entry.name);
      else if (entry.name === 'spec.md') result.push({ file: full, capability: capability || entry.name });
    }
  };
  walk(base, null);
  return result;
}

function parseRequirements(files) {
  const requirements = [];
  for (const item of files) {
    const text = readText(item.file);
    let current = null;
    for (const line of text.split(/\r?\n/)) {
      const req = /^###\s+Requirement:\s*(.+?)\s*\((REQ-\d+)\)\s*$/.exec(line);
      if (req) {
        current = { id: req[2], title: req[1], capability: item.capability, scenarios: [] };
        requirements.push(current);
        continue;
      }
      const scenario = /^####\s+Scenario:\s*(.+?)\s*\((AC-\d+)\)\s*$/.exec(line);
      if (scenario && current) current.scenarios.push({ id: scenario[2], title: scenario[1] });
    }
  }
  return requirements;
}

function redactLine(line) {
  if (!SECRET_RE.test(line)) return { line, redacted: false };
  return { line: `${line.replace(/[^\s].*$/, '')}[REDACTED]`, redacted: true };
}

function renderH1(root, state) {
  const changeDir = path.join(root, 'openspec', 'changes', state.change);
  const proposal = exists(path.join(changeDir, 'proposal.md'))
    ? readText(path.join(changeDir, 'proposal.md'))
    : '';
  const requirements = parseRequirements(listSpecFiles(root, state.change));
  const capabilities = [...new Set(requirements.map((item) => item.capability))];

  const lines = [
    `# H1 需求审阅：${state.change}`,
    '',
    `- 类型：${state.type}`,
    `- 阶段：${state.phase}`,
    ...(state.changeKey ? [`- changeKey：${state.changeKey}`] : []),
    '',
    '## 问题',
    clip(section(proposal, '问题'), 800) || '（proposal 未填写）',
    '',
    '## 目标',
    clip(section(proposal, '目标'), 800) || '（proposal 未填写）',
    '',
    '## 需求与验收',
    ...(requirements.length === 0
      ? ['（未解析到 REQ/AC）']
      : requirements.flatMap((item) => [
          `- ${item.id} ${item.title}`,
          ...item.scenarios.map((scenario) => `  - ${scenario.id} ${scenario.title}`),
        ])),
    '',
    '## 影响 capability',
    capabilities.length ? capabilities.map((item) => `- ${item}`).join('\n') : '- （无）',
  ];
  return lines.join('\n');
}

function renderH2(root, state) {
  const tasks = Object.values(state.tasks || {});
  const touched = state.touched || { modify: [], delete: [], bootstrap: [] };
  const suites = state.plan?.suites || [];

  const fileLines = [];
  for (const file of touched.modify || []) {
    const count = lineCount(path.join(root, file));
    fileLines.push(`- M ${file}${count === null ? '（文件不存在）' : `（${count} 行）`}`);
  }
  for (const file of touched.bootstrap || []) fileLines.push(`- A ${file}（新增）`);
  for (const file of touched.delete || []) fileLines.push(`- D ${file}（删除）`);
  if (fileLines.length > MAX_FILES) {
    fileLines.splice(MAX_FILES, 0, `- …（共 ${fileLines.length} 个文件，已截断）`);
  }

  return [
    `# H2 方案审阅：${state.change}`,
    '',
    `- 类型：${state.type}`,
    '',
    '## 任务',
    '| ID | 标题 | AC | 依赖 |',
    '|---|---|---|---|',
    ...(tasks.length
      ? tasks.map(
          (task) =>
            `| ${task.id} | ${task.title} | ${(task.ac || []).join(', ')} | ${(task.deps || []).join(', ') || '-'} |`,
        )
      : ['| - | （无任务） | - | - |']),
    '',
    '## 预期改动文件',
    ...(fileLines.length ? fileLines : ['- （无）']),
    '',
    '## 测试套件',
    '| id | kind | 命令 | cwd |',
    '|---|---|---|---|',
    ...(suites.length
      ? suites.map(
          (suite) =>
            `| ${suite.id} | ${suite.kind} | ${(suite.argv || []).join(' ') || '(pytest)'} | ${suite.cwd || '.'} |`,
        )
      : ['| - | - | - | - |']),
    '',
    `计划指纹：\`${String(state.plan?.planHash || '-').replace(/^sha256:/, '').slice(0, 12)}…\``,
  ].join('\n');
}

function parseAcceptance(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = /^\|\s*(AC-\d+)\s*\|\s*(pass|fail|skip)\s*\|\s*([^|]*)\|/.exec(line);
    if (match) rows.push({ ac: match[1], result: match[2], file: match[3].trim() });
  }
  const stats = /^-\s*测试：(.+)$/m.exec(String(text || ''));
  return { rows, stats: stats ? stats[1].trim() : null };
}

function diffSummary(integrationPath, base) {
  let numstat = [];
  try {
    numstat = git(integrationPath, ['diff', '--numstat', `${base}..HEAD`])
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [added, deleted, ...rest] = line.split('\t');
        return { added, deleted, file: rest.join('\t') };
      });
  } catch {
    return { files: [], note: '无法读取 diff' };
  }
  return { files: numstat, note: null };
}

function keyHunks(integrationPath, base, files) {
  const ranked = [...files]
    .map((item) => ({
      ...item,
      score: (Number(item.added) || 0) + (Number(item.deleted) || 0),
    }))
    .filter((item) => !Number.isNaN(item.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_HUNKS);

  const lines = [];
  let redacted = 0;
  for (const item of ranked) {
    if (lines.length >= MAX_DIFF_LINES) break;
    let diff = '';
    try {
      diff = git(integrationPath, ['diff', '-U3', `${base}..HEAD`, '--', item.file]);
    } catch {
      continue;
    }
    const selected = diff
      .split('\n')
      .filter((line) => /^(@@|\+[^+]|-[^-])/.test(line))
      .slice(0, MAX_HUNK_LINES);
    if (selected.length === 0) continue;
    lines.push(`### ${item.file}`);
    lines.push('```diff');
    for (const line of selected) {
      if (lines.length >= MAX_DIFF_LINES + MAX_HUNKS * 2) break;
      const result = redactLine(line);
      if (result.redacted) redacted += 1;
      lines.push(result.line);
    }
    lines.push('```');
  }
  return { lines, redacted };
}

function renderH3(root, state, integration) {
  const acceptanceFile = path.join(
    integration.path,
    'openspec',
    'changes',
    state.change,
    'acceptance.md',
  );
  const acceptance = exists(acceptanceFile) ? readText(acceptanceFile) : '';
  const { rows, stats } = parseAcceptance(acceptance);
  const base = integration.base || state.integration?.base;
  const summary = diffSummary(integration.path, base);

  const shown = summary.files.slice(0, MAX_FILES);
  const fileLines = shown.map(
    (item) =>
      `| ${item.file} | ${item.added === '-' ? 'bin' : `+${item.added}`} | ${item.deleted === '-' ? '-' : `-${item.deleted}`} |`,
  );
  if (summary.files.length > shown.length) {
    fileLines.push(`| … | 共 ${summary.files.length} 个文件 | |`);
  }

  const hunks = keyHunks(integration.path, base, summary.files);
  const commit = (() => {
    try {
      return git(integration.path, ['rev-parse', 'HEAD']).slice(0, 12);
    } catch {
      return '-';
    }
  })();

  const lines = [
    `# H3 验收审阅：${state.change}`,
    '',
    `- 类型：${state.type}`,
    `- 结论：${rows.length && rows.every((row) => row.result === 'pass') ? '可验收' : '存在未通过 AC'}`,
    `- integration commit：${commit}`,
    '',
    '## AC 验收',
    '| AC | 结果 | 用例文件 |',
    '|---|---|---|',
    ...(rows.length ? rows.map((row) => `| ${row.ac} | ${row.result} | ${row.file} |`) : ['| - | - | - |']),
    '',
    '## 测试统计',
    stats ? `- ${stats}` : '- 见 acceptance.md',
    '',
    '## 变更文件',
    '| 文件 | + | - |',
    '|---|---|---|',
    ...(fileLines.length ? fileLines : ['| - | - | - |']),
    '',
    '## 关键 diff',
    ...(hunks.lines.length ? hunks.lines : ['（无可用 diff）']),
    '',
    ...(state.type === 'fix' ? ['## 修复证据', '- 类型为 fix：复现用例在 base 上失败、修复后通过的记录见证据链。', ''] : []),
    ...(hunks.redacted || summary.note
      ? [`> ${summary.note || ''}${hunks.redacted ? `已脱敏 ${hunks.redacted} 行。` : ''}`.trim(), '']
      : []),
    `验收指纹：\`${String(state.acceptanceHash || '-').replace(/^sha256:/, '').slice(0, 12)}…\``,
  ];
  return lines.join('\n');
}

export function renderGateSummary({ gate, root, state, integration }) {
  let text = '';
  try {
    if (gate === 'H1') text = renderH1(root, state);
    else if (gate === 'H2') text = renderH2(root, state);
    else text = renderH3(root, state, integration || { path: root, base: state.integration?.base });
  } catch (error) {
    text = `# ${gate} 审阅\n\n> 无法生成变更摘要：${error instanceof Error ? error.message : String(error)}`;
  }
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}\n…（内容超过 ${MAX_CHARS} 字符，已截断）`;
  return { text };
}
