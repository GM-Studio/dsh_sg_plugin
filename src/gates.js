import fs from 'node:fs';
import path from 'node:path';
import {
  ARTIFACT_REQUIREMENTS,
  GATE_ORDER,
  GATES,
  PARADIGM_GATE_EXEMPTIONS,
} from './constants.js';
import {
  ensureDir,
  exists,
  readIfExists,
  unique,
  writeFile,
} from './util.js';

export function gateFile(root, gate, suffix) {
  return path.join(root, '.specgate', 'gates', `${gate}.${suffix}`);
}

export function readGate(root, gate) {
  const confirmedPath = gateFile(root, gate, 'confirmed');
  const waivedPath = gateFile(root, gate, 'waived');
  const confirmedText = readIfExists(confirmedPath);
  const waivedText = readIfExists(waivedPath);
  let waived = null;
  if (waivedText !== null) {
    try {
      waived = JSON.parse(waivedText);
    } catch {
      waived = { at: null, reason: waivedText.trim() };
    }
  }
  return {
    id: gate,
    name: GATES[gate]?.name || gate,
    nameEn: GATES[gate]?.nameEn || GATES[gate]?.name || gate,
    confirmed: confirmedText !== null,
    confirmedAt: confirmedText ? confirmedText.trim() : null,
    waived: waived !== null,
    waivedAt: waived?.at || null,
    reason: waived?.reason || null,
    satisfied: confirmedText !== null || waived !== null,
  };
}

export function allGateStatuses(root) {
  return GATE_ORDER.map((gate) => readGate(root, gate));
}

export function confirmGate(root, gate, meta = {}) {
  ensureDir(path.join(root, '.specgate', 'gates'));
  const at = meta.at || new Date().toISOString();
  writeFile(gateFile(root, gate, 'confirmed'), `${at}\n`);
  const waived = gateFile(root, gate, 'waived');
  if (exists(waived)) fs.rmSync(waived, { force: true });
  return readGate(root, gate);
}

export function waiveGate(root, gate, reason) {
  if (!reason || !String(reason).trim()) {
    throw new Error('waiveGate requires a non-empty reason');
  }
  ensureDir(path.join(root, '.specgate', 'gates'));
  const payload = {
    at: new Date().toISOString(),
    reason: String(reason).trim(),
  };
  writeFile(gateFile(root, gate, 'waived'), `${JSON.stringify(payload, null, 2)}\n`);
  const confirmed = gateFile(root, gate, 'confirmed');
  if (exists(confirmed)) fs.rmSync(confirmed, { force: true });
  return readGate(root, gate);
}

export function gateRequiredForParadigm(gate, paradigm) {
  // G6.5 is conditional (only for large changes) and is opted into manually.
  if (gate === 'G6.5') return false;
  const normalized = paradigm || 'L1';
  const exempt = PARADIGM_GATE_EXEMPTIONS[normalized] || [];
  return !exempt.includes(gate);
}

export function requiredGatesFor(kind, paradigm) {
  const base = ARTIFACT_REQUIREMENTS[kind] || [];
  return base.filter((gate) => gateRequiredForParadigm(gate, paradigm));
}

export function missingGates(root, required) {
  const seen = [];
  for (const gate of unique(required)) {
    if (!readGate(root, gate).satisfied) seen.push(gate);
  }
  return seen;
}

export function invalidateFrom(root, gate) {
  const index = GATE_ORDER.indexOf(gate);
  if (index < 0) return [];
  const removed = [];
  for (const current of GATE_ORDER.slice(index)) {
    for (const suffix of ['confirmed', 'waived']) {
      const filePath = gateFile(root, current, suffix);
      if (exists(filePath)) {
        fs.rmSync(filePath, { force: true });
        removed.push(`${current}.${suffix}`);
      }
    }
  }
  return removed;
}

export function clearAllGates(root) {
  const removed = [];
  for (const gate of GATE_ORDER) {
    for (const suffix of ['confirmed', 'waived']) {
      const filePath = gateFile(root, gate, suffix);
      if (exists(filePath)) {
        fs.rmSync(filePath, { force: true });
        removed.push(`${gate}.${suffix}`);
      }
    }
  }
  return removed;
}

export function formatGateStatus(status, language = 'zh') {
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  const name = en ? status.nameEn || status.name : status.name;
  if (status.confirmed) return en ? `${status.id} ${name}: confirmed` : `${status.id} ${name}：已确认`;
  if (status.waived) {
    return en
      ? `${status.id} ${name}: waived (${status.reason || 'no reason recorded'})`
      : `${status.id} ${name}：已跳过（${status.reason || '未记录原因'}）`;
  }
  return en ? `${status.id} ${name}: pending` : `${status.id} ${name}：待确认`;
}

export function gateSummary(root) {
  const gates = allGateStatuses(root);
  const confirmed = gates.filter((g) => g.confirmed).map((g) => g.id);
  const waived = gates.filter((g) => g.waived).map((g) => g.id);
  const pending = gates.filter((g) => !g.satisfied).map((g) => g.id);
  return { gates, confirmed, waived, pending };
}
