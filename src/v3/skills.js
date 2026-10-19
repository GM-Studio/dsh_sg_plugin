import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SKILLS_ROOT = path.resolve(HERE, '..', '..', 'assets', 'sp');
export const BUNDLED_SKILLS_ROOT = path.resolve(HERE, '..', '..', 'assets', 'skills');

export const ROLE_SKILLS = {
  planner: ['sg-skill-requirements-definition', 'sg-skill-vertical-slicing'],
  implementer: ['sg-skill-test-driven-development', 'sp-skill-subagent-driven-development'],
  tester: ['sg-skill-test-driven-development'],
  reviewer: ['sg-skill-code-review', 'sp-skill-requesting-and-receiving-code-review'],
  integrating: ['sp-skill-verification-before-completion'],
  archive: ['sg-skill-finishing-a-development-branch'],
};

export const PHASE_SKILLS = {
  H1_PENDING: ['sg-skill-requirements-definition', 'sg-skill-vertical-slicing'],
  PLAN: ['sg-skill-writing-plans', 'sg-skill-vertical-slicing'],
  INTEGRATING: ['sp-skill-verification-before-completion'],
  ARCHIVING: ['sg-skill-finishing-a-development-branch'],
};

export function resolveSkills({
  role,
  phase,
  parallel = false,
  retry = false,
  acCount = 0,
  multiCapability = false,
} = {}) {
  const ids = new Set([
    ...(role ? ROLE_SKILLS[role] || [] : []),
    ...(phase ? PHASE_SKILLS[phase] || [] : []),
  ]);
  if (parallel) ids.add('sp-skill-dispatching-parallel-agents');
  if (retry) ids.add('sg-skill-systematic-debugging');
  if (multiCapability) ids.add('sp-skill-brainstorming');
  if (acCount > 5) ids.add('sg-skill-triage-brief');
  return [...ids];
}

let indexCache = null;

function buildIndex(dir = SKILLS_ROOT) {
  const index = new Map();
  const walk = (current) => {
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const skillFile = path.join(full, 'SKILL.md');
        if (fs.existsSync(skillFile)) index.set(entry.name, skillFile);
        walk(full);
      }
    }
  };
  walk(SKILLS_ROOT);
  walk(BUNDLED_SKILLS_ROOT);
  return index;
}

export function findSkillFile(id) {
  if (!indexCache) indexCache = buildIndex();
  return indexCache.get(String(id)) || null;
}

export function loadSkill(id) {
  const file = findSkillFile(id);
  if (!file) return null;
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

export function loadSkillPayload(options) {
  return resolveSkills(options).map((id) => ({ id, text: loadSkill(id) || '' }));
}

export function suggestForPhase(phase) {
  return PHASE_SKILLS[phase] || [];
}
