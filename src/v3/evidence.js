import fs from 'node:fs';
import path from 'node:path';
import { appendFileSync } from 'node:fs';
import { atomicWrite, ensureDir, exists, readText } from './util/fsx.js';
import { canonicalJson, sha256 } from './util/hash.js';
import { nowIso } from './state.js';

export function evidenceDir(root, change) {
  return path.join(root, '.specgate', 'evidence', change);
}

function readRecords(dir) {
  if (!exists(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^\d{4,}\.json$/.test(name))
    .sort()
    .map((name) => {
      try {
        return JSON.parse(readText(path.join(dir, name)));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function recordHash(record) {
  const { hash: _hash, ...rest } = record;
  return `sha256:${sha256(canonicalJson(rest))}`;
}

export function appendEvidence(root, change, input) {
  const dir = evidenceDir(root, change);
  ensureDir(dir);
  const records = readRecords(dir);
  const last = records[records.length - 1] || null;
  const seq = (last?.seq || 0) + 1;
  const record = {
    seq,
    at: nowIso(),
    change,
    task: input.task ?? null,
    event: input.event,
    decision: input.decision ?? null,
    refs: input.refs || {},
    skills: input.skills || { suggested: [], injected: [] },
    actor: input.actor || 'orchestrator',
    prevHash: last?.hash || null,
  };
  record.hash = recordHash(record);
  const file = path.join(dir, `${String(seq).padStart(4, '0')}.json`);
  atomicWrite(file, `${JSON.stringify(record, null, 2)}\n`);
  try {
    appendFileSync(path.join(dir, 'audit.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // audit index is best effort; numbered records are the source of truth
  }
  return { ok: true, seq, hash: record.hash, record };
}

export function verifyEvidence(root, change) {
  const dir = evidenceDir(root, change);
  const records = readRecords(dir);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const expected = recordHash(record);
    if (record.hash !== expected) {
      return { ok: false, brokenAt: record.seq, message: `记录 ${record.seq} 的 hash 不匹配` };
    }
    const prev = index === 0 ? null : records[index - 1].hash;
    if ((record.prevHash || null) !== (prev || null)) {
      return { ok: false, brokenAt: record.seq, message: `记录 ${record.seq} 的 prevHash 不连续` };
    }
  }
  return {
    ok: true,
    count: records.length,
    headSeq: records.length ? records[records.length - 1].seq : 0,
    headHash: records.length ? records[records.length - 1].hash : null,
  };
}
