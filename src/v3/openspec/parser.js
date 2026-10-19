const SECTION_RE = /^##\s+(ADDED|MODIFIED|REMOVED)\s+Requirements\s*$/i;
const REQ_RE = /^###\s+Requirement:\s*(.+?)\s*$/;
const AC_RE = /^####\s+Scenario:\s*(.+?)\s*$/;
const REQ_ID_RE = /^(.*?)\s*\((REQ-\d{3,})\)\s*$/;
const AC_ID_RE = /^(.*?)\s*\((AC-\d{3,})\)\s*$/;

function idOf(text, pattern) {
  const match = pattern.exec(text);
  if (!match) return null;
  return { title: match[1].trim(), id: match[2] };
}

/**
 * Parse an OpenSpec delta. Returns sections plus parse errors.
 * Requirements may only appear inside ADDED/MODIFIED/REMOVED sections.
 */
export function parseDelta(text) {
  const lines = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const sections = { ADDED: [], MODIFIED: [], REMOVED: [] };
  const errors = [];
  let section = null;
  let requirement = null;
  let scenario = null;

  const flush = () => {
    if (!requirement) return;
    if (section) sections[section].push(requirement);
    requirement = null;
    scenario = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      flush();
      section = sectionMatch[1].toUpperCase();
      continue;
    }
    if (/^##\s+/.test(line)) {
      flush();
      section = null;
      continue;
    }

    const reqMatch = REQ_RE.exec(line);
    if (reqMatch) {
      flush();
      const parsed = idOf(reqMatch[1], REQ_ID_RE);
      if (!section) {
        errors.push(`第 ${lineNumber} 行：Requirement 必须位于 ADDED/MODIFIED/REMOVED 段内`);
        continue;
      }
      if (!parsed) {
        errors.push(`第 ${lineNumber} 行：Requirement 缺少 (REQ-xxx) 编号`);
        continue;
      }
      requirement = { id: parsed.id, title: parsed.title, body: [], scenarios: [] };
      continue;
    }

    const acMatch = AC_RE.exec(line);
    if (acMatch) {
      if (!requirement) {
        errors.push(`第 ${lineNumber} 行：Scenario 必须位于 Requirement 内`);
        continue;
      }
      const parsed = idOf(acMatch[1], AC_ID_RE);
      if (!parsed) {
        errors.push(`第 ${lineNumber} 行：Scenario 缺少 (AC-xxx) 编号`);
        continue;
      }
      scenario = { id: parsed.id, title: parsed.title, body: [] };
      requirement.scenarios.push(scenario);
      continue;
    }

    if (scenario) scenario.body.push(line);
    else if (requirement) requirement.body.push(line);
  }
  flush();

  for (const kind of Object.keys(sections)) {
    for (const req of sections[kind]) {
      req.body = req.body.join('\n').trim();
      for (const ac of req.scenarios) ac.body = ac.body.join('\n').trim();
    }
  }

  return { sections, errors };
}

/** Parse a capability spec (requirements without delta sections). */
export function parseSpec(text) {
  const lines = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const requirements = [];
  const errors = [];
  let requirement = null;
  let scenario = null;

  const flush = () => {
    if (requirement) requirements.push(requirement);
    requirement = null;
    scenario = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (/^##\s+/.test(line)) {
      flush();
      continue;
    }

    const reqMatch = REQ_RE.exec(line);
    if (reqMatch) {
      flush();
      const parsed = idOf(reqMatch[1], REQ_ID_RE);
      if (!parsed) {
        errors.push(`第 ${lineNumber} 行：Requirement 缺少 (REQ-xxx) 编号`);
        continue;
      }
      requirement = { id: parsed.id, title: parsed.title, body: [], scenarios: [] };
      continue;
    }

    const acMatch = AC_RE.exec(line);
    if (acMatch) {
      if (!requirement) {
        errors.push(`第 ${lineNumber} 行：Scenario 必须位于 Requirement 内`);
        continue;
      }
      const parsed = idOf(acMatch[1], AC_ID_RE);
      if (!parsed) {
        errors.push(`第 ${lineNumber} 行：Scenario 缺少 (AC-xxx) 编号`);
        continue;
      }
      scenario = { id: parsed.id, title: parsed.title, body: [] };
      requirement.scenarios.push(scenario);
      continue;
    }

    if (scenario) scenario.body.push(line);
    else if (requirement) requirement.body.push(line);
  }
  flush();

  for (const req of requirements) {
    req.body = req.body.join('\n').trim();
    for (const ac of req.scenarios) ac.body = ac.body.join('\n').trim();
  }

  return { requirements, errors };
}
