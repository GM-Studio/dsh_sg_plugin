import fs from 'node:fs';
import path from 'node:path';
import { exists, readText } from './util/fsx.js';
import { canonicalJson, digest, norm, sha256 } from './util/hash.js';
import { git } from './util/git.js';
import { parseDelta, parseSpec } from './openspec/parser.js';
import { validateDeltaFiles } from './openspec/validator.js';
import { discoverSuites, loadPlan, computePlanHash, validatePlan } from './plan.js';
import { checkApprovalHash } from './approvals.js';
import { requirementsConfig, readConfig } from './change.js';
import { loadTemplateStyle } from './template-style.js';
import { extractReqIds, isRequirementsFrozen, parseReqBaseline } from './requirements.js';

const PROPOSAL_SECTIONS = ['问题', '目标', '非目标', '影响面'];

export function changeDir(root, change) {
  return path.join(root, 'openspec', 'changes', change);
}

function walkSpecFiles(dir, baseDir = dir) {
  const out = [];
  if (!exists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSpecFiles(full, baseDir));
    else if (entry.isFile() && entry.name === 'spec.md') {
      out.push({ path: path.relative(baseDir, full).replace(/\\/g, '/'), full });
    }
  }
  return out;
}

export function collectDelta(root, change) {
  const dir = path.join(changeDir(root, change), 'specs');
  return walkSpecFiles(dir).map((entry) => ({
    capability: entry.path.split('/')[0],
    path: `openspec/changes/${change}/specs/${entry.path}`,
    text: readText(entry.full),
  }));
}

export function readSpecsAt(root, commit) {
  const specs = new Map();
  if (!commit) return specs;
  let listing;
  try {
    listing = git(root, ['ls-tree', '-r', '--name-only', commit, 'openspec/specs']);
  } catch {
    return specs;
  }
  for (const filePath of listing.split('\n').filter(Boolean)) {
    if (!filePath.endsWith('/spec.md')) continue;
    const parts = filePath.split('/');
    if (parts.length < 4) continue;
    const capability = parts[2];
    let text;
    try {
      text = git(root, ['show', `${commit}:${filePath}`]);
    } catch {
      continue;
    }
    specs.set(capability, parseSpec(text).requirements);
  }
  return specs;
}

export function checkProposal(root, change) {
  const file = path.join(changeDir(root, change), 'proposal.md');
  if (!exists(file)) return ['缺少 proposal.md'];
  const text = readText(file);
  const errors = [];
  for (const title of PROPOSAL_SECTIONS) {
    if (!new RegExp(`^##\\s*${title}\\s*$`, 'm').test(text)) {
      errors.push(`proposal 缺少「${title}」小节`);
    }
  }
  return errors;
}

/**
 * REQ-008: when the project declares a requirements baseline, the proposal must
 * reference at least one REQ-xxx and every reference must exist in REQ.md.
 */
export function checkRequirements({ root, change }) {
  const rules = requirementsConfig(root);
  if (!rules.enabled) return { ok: true, errors: [], skipped: true };
  const errors = [];
  const frozen = isRequirementsFrozen(root, rules.version);
  if (!frozen.ok) errors.push(frozen.message);
  const baseline = exists(path.join(root, 'openspec', 'REQ.md'))
    ? parseReqBaseline(readText(path.join(root, 'openspec', 'REQ.md')))
    : { reqs: [], acs: [] };
  const known = new Set(baseline.reqs.map((req) => req.id));
  const proposalFile = path.join(changeDir(root, change), 'proposal.md');
  const proposalText = exists(proposalFile) ? readText(proposalFile) : '';
  const referenced = extractReqIds(proposalText);
  if (referenced.size === 0) {
    errors.push('proposal.md 必须至少引用一个 REQ-xxx（需求基线中的需求编号）');
  }
  for (const id of referenced) {
    if (!known.has(id)) errors.push(`proposal.md 引用了不存在的需求编号：${id}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    reqs: Array.from(known),
    referenced: Array.from(referenced),
  };
}

export function checkM1({ root, state }) {
  if (!state?.change) {
    return { ok: false, errors: ['没有进行中的 change'] };
  }
  const errors = [...checkProposal(root, state.change)];
  const style = loadTemplateStyle(root, {
    required: readConfig(root)?.templateStyle?.required === true,
  });
  if (!style.ok) errors.push(style.message);
  const requirementCheck = checkRequirements({ root, change: state.change });
  errors.push(...requirementCheck.errors);
  const files = collectDelta(root, state.change);
  const specs = readSpecsAt(root, state.baseCommit);
  const validation = validateDeltaFiles({ files, specs, type: state.type });
  errors.push(...validation.errors);
  return {
    ok: errors.length === 0,
    errors,
    counts: validation.counts,
    files,
    requirements: requirementCheck,
  };
}

export function computeArtifactHash({ root, change, specsBase }) {
  const proposalFile = path.join(changeDir(root, change), 'proposal.md');
  const proposalText = exists(proposalFile) ? readText(proposalFile) : '';
  const delta = collectDelta(root, change)
    .map((file) => ({ path: file.path, hash: sha256(norm(file.text)) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const payload = {
    proposal: sha256(norm(proposalText)),
    delta,
    specsBase: specsBase ?? null,
  };
  return `sha256:${sha256(canonicalJson(payload))}`;
}

export function collectDeltaIds(root, change) {
  const acs = new Set();
  const requiredAcs = new Set();
  const reqs = new Set();
  for (const file of collectDelta(root, change)) {
    const parsed = parseDelta(file.text);
    for (const kind of ['ADDED', 'MODIFIED', 'REMOVED']) {
      for (const req of parsed.sections[kind]) {
        reqs.add(req.id);
        for (const scenario of req.scenarios) {
          acs.add(scenario.id);
          if (kind !== 'REMOVED') requiredAcs.add(scenario.id);
        }
      }
    }
  }
  return { acs, requiredAcs, reqs };
}

export function collectKnownAcs({ root, state, change }) {
  const { acs, requiredAcs } = collectDeltaIds(root, change);
  const known = new Set(acs);
  const specs = readSpecsAt(root, state?.baseCommit);
  for (const reqs of specs.values()) {
    for (const req of reqs) {
      for (const scenario of req.scenarios || []) known.add(scenario.id);
    }
  }
  return { deltaAcs: requiredAcs, knownAcs: known };
}

const DESIGN_SECTIONS = ['目标与非目标', '任务图', 'AC 到用例', '风险'];

export function checkM2({ root, state, config }) {
  if (!state?.change) return { ok: false, errors: ['没有进行中的 change'] };
  const plan = loadPlan(root, state.change);
  const errors = [];
  if (!plan.templateStyle.ok) errors.push(plan.templateStyle.message);
  if (config?.templateStyle?.required && plan.templateStyle.skipped)
    errors.push('缺少项目固定模板样例，禁止进入实现');
  for (const title of DESIGN_SECTIONS) {
    if (!new RegExp(`^##\\s*${title}\\s*$`, 'm').test(plan.designText)) {
      errors.push(`design 缺少「${title}」小节`);
    }
  }
  const suiteInfo = discoverSuites(root, config);
  errors.push(...suiteInfo.errors);
  const { acs, reqs } = collectDeltaIds(root, state.change);
  const validation = validatePlan({
    root,
    change: state.change,
    plan,
    deltaAcs: acs,
    deltaReqs: reqs,
    config,
    type: state.type,
    suites: suiteInfo.suites,
  });
  errors.push(...validation.errors);

  const command = validation.command;
  const planHash = command.ok ? computePlanHash({ plan, command, suites: suiteInfo.suites }) : null;
  const cmdHash = suiteInfo.ok ? digest(suiteInfo.suites.map((suite) => suite.cmdHash)) : null;
  return {
    ok: errors.length === 0,
    errors,
    plan,
    command,
    suites: suiteInfo.suites,
    planHash,
    cmdHash,
    hashes: {
      designHash: digest(plan.designText),
      casesHash: digest(JSON.stringify(plan.cases)),
      mappingHash: digest(plan.mapping || {}),
      touchedHash: digest(plan.touched || {}),
    },
  };
}

export function computePlanHashFor(root, change, config) {
  const plan = loadPlan(root, change);
  const suiteInfo = discoverSuites(root, config);
  if (!suiteInfo.ok) return null;
  const command = {
    ok: true,
    argv: suiteInfo.suites[0].argv,
    cwd: suiteInfo.suites[0].cwd,
  };
  return computePlanHash({ plan, command, suites: suiteInfo.suites });
}

export function checkFrozenH1({ root, state }) {
  const specsBase = state?.baseline?.specsBase || state?.baseCommit || 'no-commit';
  const hash = computeArtifactHash({ root, change: state.change, specsBase });
  const check = checkApprovalHash(state, 'H1', hash);
  return check.ok ? { ok: true } : { ok: false, gate: 'H1', message: check.message };
}

export function checkFrozenH2({ root, state, config }) {
  if (!state?.change) return { ok: false, gate: 'H2', message: '没有 change' };
  const hash = computePlanHashFor(root, state.change, config);
  if (!hash) return { ok: false, gate: 'H2', message: '测试命令不可发现' };
  const check = checkApprovalHash(state, 'H2', hash);
  return check.ok ? { ok: true } : { ok: false, gate: 'H2', message: check.message };
}
