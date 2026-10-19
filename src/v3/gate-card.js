import fs from 'node:fs';
import path from 'node:path';
import { exists, readText } from './util/fsx.js';
import { git } from './worktrees.js';

const MAX_CARD = 1200;
const SECRET_RE = /(secret|token|password|passwd|api[_-]?key|private key)/i;

function clip(text, limit) {
  const value = String(text || '').trim();
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trim()}…`;
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
    let current = null;
    for (const line of readText(item.file).split(/\r?\n/)) {
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

function redact(line) {
  if (!SECRET_RE.test(String(line))) return { line, redacted: false };
  return { line: '[REDACTED]', redacted: true };
}

function h1(root, state, detail) {
  const dir = path.join(root, 'openspec', 'changes', state.change);
  const proposal = exists(path.join(dir, 'proposal.md')) ? readText(path.join(dir, 'proposal.md')) : '';
  const requirements = parseRequirements(listSpecFiles(root, state.change));
  const acs = requirements.flatMap((item) => item.scenarios.map((scenario) => ({ ...scenario, req: item.id })));
  const capabilities = [...new Set(requirements.map((item) => item.capability))];
  const head = [
    `SpecGate H1 审批`,
    '================',
    `变更：${state.change}（${state.type}）`,
    `背景：${clip(section(proposal, '问题'), 160) || '未填写'}`,
    `目标：${clip(section(proposal, '目标'), 160) || '未填写'}`,
    `需求：${requirements.length} 条  AC：${acs.length} 个`,
    `影响：${capabilities.join(', ') || '无'}`,
    '前 3 个 AC：',
    ...acs.slice(0, 3).map((item) => `- ${item.id} ${item.title}`),
  ];
  if (detail) {
    head.push('', '完整需求：');
    for (const req of requirements) {
      head.push(`- ${req.id} ${req.title}`);
      for (const scenario of req.scenarios) head.push(`  - ${scenario.id} ${scenario.title}`);
    }
  }
  return { card: head, detail: head };
}

function h2(root, state, detail) {
  const tasks = Object.values(state.tasks || {});
  const touched = state.touched || { modify: [], delete: [], bootstrap: [] };
  const suites = state.plan?.suites || [];
  let lines = 0;
  for (const file of touched.modify || []) lines += lineCount(path.join(root, file)) || 0;
  const card = [
    'SpecGate H2 审批',
    '================',
    `变更：${state.change}（${state.type}）`,
    `任务：${tasks.length} 个（并行 ${tasks.filter((item) => item.parallel).length}）`,
    `文件：M ${(touched.modify || []).length}  A ${(touched.bootstrap || []).length}  D ${(touched.delete || []).length}（合计 ${lines} 行）`,
    `套件：${suites.length} 个`,
    '前 5 个任务：',
    ...tasks.slice(0, 5).map((task) => `- ${task.id} ${task.title} [${(task.ac || []).join(',')}]`),
    `计划：${String(state.plan?.planHash || '-').replace(/^sha256:/, '').slice(0, 12)}…`,
  ];
  if (detail) {
    card.push('', '完整任务：');
    for (const task of tasks) {
      card.push(`- ${task.id} ${task.title} ac=${(task.ac || []).join(',')} deps=${(task.deps || []).join(',') || '-'}`);
    }
    card.push('', '完整文件：');
    for (const file of touched.modify || []) card.push(`M ${file}（${lineCount(path.join(root, file)) ?? '?'} 行）`);
    for (const file of touched.bootstrap || []) card.push(`A ${file}`);
    for (const file of touched.delete || []) card.push(`D ${file}`);
    card.push('', '套件：');
    for (const suite of suites) card.push(`${suite.id} ${suite.kind} ${(suite.argv || []).join(' ')} @${suite.cwd || '.'}`);
  }
  return { card, detail: card };
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

function numstat(integrationPath, base) {
  try {
    return git(integrationPath, ['diff', '--numstat', `${base}..HEAD`])
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [added, deleted, ...rest] = line.split('\t');
        return { added, deleted, file: rest.join('\t') };
      });
  } catch {
    return [];
  }
}

function h3(root, state, integration, detail) {
  const acceptanceFile = path.join(integration.path, 'openspec', 'changes', state.change, 'acceptance.md');
  const acceptance = exists(acceptanceFile) ? readText(acceptanceFile) : '';
  const { rows, stats } = parseAcceptance(acceptance);
  const pass = rows.filter((row) => row.result === 'pass').length;
  const fail = rows.filter((row) => row.result !== 'pass').map((row) => row.ac);
  const base = integration.base || state.integration?.base;
  const files = numstat(integration.path, base);
  const added = files.reduce((sum, item) => sum + (Number(item.added) || 0), 0);
  const deleted = files.reduce((sum, item) => sum + (Number(item.deleted) || 0), 0);

  const card = [
    'SpecGate H3 审批',
    '================',
    `变更：${state.change}（${state.type}）`,
    `验收：${pass}/${rows.length} pass`,
    `失败：${fail.slice(0, 3).join(', ') || '无'}`,
    `测试：${stats || '见 acceptance'}`,
    `变更：${files.length} 文件  +${added}  -${deleted}`,
  ];
  const top = [...files].sort(
    (a, b) => (Number(b.added) || 0) + (Number(b.deleted) || 0) - (Number(a.added) || 0) - (Number(a.deleted) || 0),
  )[0];
  if (top) {
    try {
      const diff = git(integration.path, ['diff', '-U0', `${base}..HEAD`, '--', top.file])
        .split('\n')
        .filter((line) => /^(@@|\+[^+]|-[^-])/.test(line))
        .slice(0, 5);
      card.push(`关键 diff：${top.file}`);
      for (const line of diff) card.push(redact(line).line);
    } catch {
      // no hunk
    }
  }
  if (detail) {
    card.push('', '完整验收：');
    for (const row of rows) card.push(`${row.ac} ${row.result} ${row.file}`);
    card.push('', '完整文件：');
    for (const item of files) card.push(`${item.file} +${item.added} -${item.deleted}`);
  }
  return { card, detail: card };
}

function h0(state, detail) {
  const context = state.context || {};
  const card = [
    'SpecGate H0 审批',
    '================',
    `变更：${state.change || 'new-project'}`,
    `背景：${clip(context.background, 160) || '未填写'}`,
    `技术栈：${clip(context.stack, 80) || '未选择'}`,
    `验收：${clip(context.acceptance, 160) || '未填写'}`,
    `团队：${clip(context.team, 120) || '未填写'}`,
    `步骤：${clip(context.steps, 160) || '未填写'}`,
    `哈希：${String(state.h0?.hash || '-').replace(/^sha256:/, '').slice(0, 12)}…`,
  ];
  if (detail) {
    card.push('', '完整上下文：');
    for (const [key, value] of Object.entries(context)) card.push(`${key}: ${value}`);
  }
  return { card, detail: card };
}

function writeDetail(root, gate, text) {
  const dir = path.join(root, '.specgate', 'gates');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${gate}.txt`), `${text.join('\n')}\n`, 'utf8');
}

export function renderGateCard({ gate, root, state, integration }) {
  let result;
  try {
    if (gate === 'H0') result = h0(state, false);
    else if (gate === 'H1') result = h1(root, state, false);
    else if (gate === 'H2') result = h2(root, state, false);
    else result = h3(root, state, integration || { path: root, base: state.integration?.base }, false);
  } catch (error) {
    result = { card: [`SpecGate ${gate} 审批`, '================', `摘要生成失败：${error.message}`], detail: [] };
  }
  const footer = [`详情：.specgate/gates/${gate}.txt`, '----------------', `批准后继续 ${gate === 'H0' ? '初始化' : gate === 'H1' ? 'PLAN' : gate === 'H2' ? 'EXECUTING' : '归档'}`];
  let text = [...result.card, ...footer].join('\n');
  if (text.length > MAX_CARD) {
    text = `${text.slice(0, MAX_CARD - 30)}\n…（已压缩，详情见文件）`;
  }
  let detailText;
  try {
    if (gate === 'H0') detailText = h0(state, true).detail;
    else if (gate === 'H1') detailText = h1(root, state, true).detail;
    else if (gate === 'H2') detailText = h2(root, state, true).detail;
    else detailText = h3(root, state, integration || { path: root, base: state.integration?.base }, true).detail;
    writeDetail(root, gate, detailText);
  } catch {
    // detail is best-effort
  }
  return { text, detail: detailText };
}
