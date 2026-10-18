import path from 'node:path';
import {
  appendFile,
  exists,
  nowIso,
  readIfExists,
  writeFile,
} from './util.js';

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

export function appendDeviation(root, entry) {
  const gate = entry.gate || 'flow';
  const reason = String(entry.reason || '').trim();
  if (!reason) throw new Error('偏离记录必须提供 reason');
  const timestamp = entry.timestamp || nowIso();
  const impact = entry.impact || 'medium';
  const block = [
    `- timestamp: ${yamlString(timestamp)}`,
    `  deviation: ${yamlString(`跳过 ${gate}`)}`,
    `  gate: ${yamlString(gate)}`,
    `  reason: ${yamlString(reason)}`,
    `  impact: ${yamlString(impact)}`,
    `  user_approval: ${entry.userApproval === false ? 'false' : 'true'}`,
    ...(entry.opId ? [`  opId: ${yamlString(entry.opId)}`] : []),
    '',
  ].join('\n');

  const filePath = path.join(root, '.specgate', 'deviations.log');
  if (!exists(filePath)) {
    writeFile(filePath, '# SpecGate deviations (append-only)\n\n');
  }
  appendFile(filePath, block);
  return { timestamp, gate, reason, impact, opId: entry.opId || null };
}

export function readDeviations(root) {
  const text = readIfExists(path.join(root, '.specgate', 'deviations.log'));
  if (!text) return [];
  const blocks = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('- timestamp:')) {
      if (current) blocks.push(current);
      current = {};
    }
    if (!current) continue;
    const match = line.match(/^\s{2}([A-Za-z_]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        // keep raw value
      }
    }
    current[key] = value;
  }
  if (current) blocks.push(current);
  return blocks;
}

export function countDeviations(root) {
  return readDeviations(root).length;
}
