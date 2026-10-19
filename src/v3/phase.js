import fs from 'node:fs';
import path from 'node:path';
import { exists, readText } from './util/fsx.js';
import { canonicalJson, norm, sha256 } from './util/hash.js';
import { git } from './util/git.js';
import { parseSpec } from './openspec/parser.js';
import { validateDeltaFiles } from './openspec/validator.js';

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

export function checkM1({ root, state }) {
  if (!state?.change) {
    return { ok: false, errors: ['没有进行中的 change'] };
  }
  const errors = [...checkProposal(root, state.change)];
  const files = collectDelta(root, state.change);
  const specs = readSpecsAt(root, state.baseCommit);
  const validation = validateDeltaFiles({ files, specs, type: state.type });
  errors.push(...validation.errors);
  return { ok: errors.length === 0, errors, counts: validation.counts, files };
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
