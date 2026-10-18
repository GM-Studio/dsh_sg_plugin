import path from 'node:path';
import { normalizeLanguage } from './assets.js';
import { DEFAULT_CONFIG } from './constants.js';
import {
  isRequirementsProject,
  requirementsPath,
} from './requirements.js';
import {
  exists,
  parseSimpleYaml,
  readIfExists,
  renderConfig,
  writeFile,
} from './util.js';

export function findProjectRoot(start) {
  const initial = path.resolve(start || process.cwd());
  let current = initial;
  for (;;) {
    if (
      exists(path.join(current, '.git')) ||
      exists(path.join(current, '.specgate')) ||
      exists(path.join(current, 'requirements')) ||
      exists(path.join(current, 'openspec'))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return initial;
    current = parent;
  }
}

export function normalizeParadigm(value) {
  const text = String(value || '').trim().toUpperCase();
  return text === 'L1' || text === 'L2' || text === 'L3' ? text : null;
}

export function loadProject(start) {
  const root = findProjectRoot(start);
  const specgateDir = path.join(root, '.specgate');
  const configPath = path.join(specgateDir, 'config.yaml');
  const configText = readIfExists(configPath);
  const parsed = configText === null ? {} : parseSimpleYaml(configText);
  const config = { ...DEFAULT_CONFIG, ...parsed };
  const hasSpecgate = exists(specgateDir);
  const hasMaterializedSkills = exists(path.join(root, '.dsh', 'skills', 'specgate'));
  const explicitlyDisabled = parsed.enabled === false;
  const enabled = !explicitlyDisabled && (hasSpecgate || hasMaterializedSkills || parsed.enabled === true);
  const paradigm = normalizeParadigm(config.paradigm);
  const hasGit = exists(path.join(root, '.git'));
  const gitEnabled = parsed.git === true || (parsed.git !== false && hasGit);
  const isV2 = isRequirementsProject(root);

  return {
    root,
    config,
    configPath,
    enabled,
    hasSpecgate,
    hasMaterializedSkills,
    paradigm,
    enforcement: config.enforcement || 'hybrid',
    language: normalizeLanguage(config.language),
    maxConcurrency: Number(config.maxConcurrency) > 0 ? Number(config.maxConcurrency) : 4,
    materializeSkills: config.materializeSkills !== false,
    materializeAgents: config.materializeAgents !== false,
    gitEnabled,
    minimal: config.minimal === true,
    isV2,
    workflowVersion: isV2 ? 2 : Number(config.workflowVersion) || 1,
    requirementsDir: path.join(root, 'requirements'),
    requirementsPath: requirementsPath(root),
    testsDir: path.join(root, 'tests', 'specgate'),
    specgateDir,
    gatesDir: path.join(specgateDir, 'gates'),
    deviationsPath: path.join(specgateDir, 'deviations.log'),
    workflowStatePath: path.join(specgateDir, 'workflow-state.yaml'),
    changesDir: path.join(root, 'openspec', 'changes'),
    specsDir: path.join(root, 'openspec', 'specs'),
    archiveDir: path.join(root, 'openspec', 'changes', 'archive'),
    skillsDir: path.join(root, '.dsh', 'skills', 'specgate'),
  };
}

export function readProjectConfig(root) {
  const text = readIfExists(path.join(root, '.specgate', 'config.yaml'));
  if (text === null) return {};
  return parseSimpleYaml(text);
}

export function writeProjectConfig(root, patch) {
  const current = readProjectConfig(root);
  const merged = { ...DEFAULT_CONFIG, ...current, ...patch };
  const filePath = path.join(root, '.specgate', 'config.yaml');
  writeFile(filePath, renderConfig(merged));
  return merged;
}

export function setEnabled(root, enabled) {
  return writeProjectConfig(root, { enabled: Boolean(enabled) });
}

export function setParadigm(root, paradigm) {
  return writeProjectConfig(root, { paradigm: normalizeParadigm(paradigm) });
}
