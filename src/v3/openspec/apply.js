import { parseDelta } from './parser.js';

export function serializeRequirement(req) {
  const lines = [`### Requirement: ${req.title} (${req.id})`, ''];
  if (req.body) lines.push(req.body, '');
  for (const scenario of req.scenarios || []) {
    lines.push(`#### Scenario: ${scenario.title} (${scenario.id})`, '');
    if (scenario.body) lines.push(scenario.body, '');
  }
  return lines.join('\n').trimEnd();
}

export function splitSpec(text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  const header = [];
  const blocks = [];
  let current = null;
  for (const line of normalized.split('\n')) {
    const match = /^###\s+Requirement:\s*.*\((REQ-\d{3,})\)\s*$/.exec(line);
    if (match) {
      if (current) blocks.push(current);
      current = { id: match[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      header.push(line);
    }
  }
  if (current) blocks.push(current);
  return {
    header: header.join('\n').trimEnd(),
    blocks: blocks.map((block) => ({ id: block.id, text: block.lines.join('\n').trimEnd() })),
  };
}

export function applyDeltaToText(specText, deltaText) {
  const delta = parseDelta(deltaText);
  const errors = [...delta.errors];
  const spec = splitSpec(specText || '');
  const blocks = spec.blocks.slice();
  const indexOf = (id) => blocks.findIndex((block) => block.id === id);

  for (const req of delta.sections.ADDED) {
    if (indexOf(req.id) >= 0) {
      errors.push(`${req.id} 已存在，不能 ADDED`);
      continue;
    }
    blocks.push({ id: req.id, text: serializeRequirement(req) });
  }
  for (const req of delta.sections.MODIFIED) {
    const index = indexOf(req.id);
    if (index < 0) {
      errors.push(`${req.id} 不存在，不能 MODIFIED`);
      continue;
    }
    blocks[index] = { id: req.id, text: serializeRequirement(req) };
  }
  for (const req of delta.sections.REMOVED) {
    const index = indexOf(req.id);
    if (index < 0) {
      errors.push(`${req.id} 不存在，不能 REMOVED`);
      continue;
    }
    blocks.splice(index, 1);
  }

  const parts = [];
  if (spec.header) parts.push(spec.header);
  parts.push(...blocks.map((block) => block.text));
  return { ok: errors.length === 0, errors, text: `${parts.join('\n\n').trimEnd()}\n` };
}
