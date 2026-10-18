import { DEFAULT_CONFIG, GATES, PARADIGM_LABELS, PARADIGM_LABELS_EN } from './constants.js';
import { normalizeLanguage } from './assets.js';

export const DEFAULT_GLOBAL_CONFIG = {
  defaultEnabled: true,
  enforcement: 'hybrid',
  maxConcurrency: 4,
  git: true,
  language: 'zh',
  materializeSkills: true,
  materializeAgents: true,
};

const ENFORCEMENTS = new Set(['hybrid', 'advisory', 'off']);

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function booleanOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

export function normalizeGlobalConfig(config = {}) {
  const source = config && typeof config === 'object' ? config : {};
  return {
    defaultEnabled: booleanOr(source.defaultEnabled, DEFAULT_GLOBAL_CONFIG.defaultEnabled),
    enforcement: ENFORCEMENTS.has(source.enforcement)
      ? source.enforcement
      : DEFAULT_GLOBAL_CONFIG.enforcement,
    maxConcurrency: positiveInteger(source.maxConcurrency, DEFAULT_GLOBAL_CONFIG.maxConcurrency),
    git: booleanOr(source.git, DEFAULT_GLOBAL_CONFIG.git),
    language: normalizeLanguage(source.language),
    materializeSkills: booleanOr(
      source.materializeSkills,
      DEFAULT_GLOBAL_CONFIG.materializeSkills,
    ),
    materializeAgents: booleanOr(
      source.materializeAgents,
      DEFAULT_GLOBAL_CONFIG.materializeAgents,
    ),
  };
}

/**
 * Global config supplies defaults for a NEW project. Once a project has its
 * own config, project values are authoritative; global defaults never rewrite
 * an existing project behind the user's back.
 */
export function initOptionsFromGlobal(globalConfig, options = {}) {
  const global = normalizeGlobalConfig(globalConfig);
  return {
    ...options,
    enabled: options.disabled === true
      ? false
      : options.enabled === undefined
        ? global.defaultEnabled
        : options.enabled === true,
    enforcement: options.enforcement || global.enforcement,
    maxConcurrency: positiveInteger(options.maxConcurrency, global.maxConcurrency),
    git: options.git === undefined ? global.git : options.git === true,
    language: normalizeLanguage(options.language || global.language),
    materializeSkills:
      options.materializeSkills === undefined
        ? global.materializeSkills
        : options.materializeSkills !== false,
    materializeAgents:
      options.materializeAgents === undefined
        ? global.materializeAgents
        : options.materializeAgents !== false,
  };
}

export function projectConfigDefaults(globalConfig, options = {}) {
  const merged = initOptionsFromGlobal(globalConfig, options);
  return {
    ...DEFAULT_CONFIG,
    enabled: merged.enabled,
    enforcement: merged.enforcement,
    language: merged.language,
    git: merged.git,
    maxConcurrency: merged.maxConcurrency,
    materializeSkills: merged.materializeSkills,
    materializeAgents: merged.materializeAgents,
  };
}

export function gateLabel(gate, language = 'zh') {
  const value = GATES[gate];
  if (!value) return gate;
  return normalizeLanguage(language) === 'en' ? value.nameEn || value.name : value.name;
}

export function gateAsk(gate, language = 'zh') {
  const value = GATES[gate];
  if (!value) return '';
  return normalizeLanguage(language) === 'en' ? value.askEn || value.ask : value.ask;
}

export function paradigmLabel(paradigm, language = 'zh') {
  if (!paradigm) return normalizeLanguage(language) === 'en' ? 'Unclassified' : '未分类';
  const labels = normalizeLanguage(language) === 'en' ? PARADIGM_LABELS_EN : PARADIGM_LABELS;
  return labels[paradigm] || paradigm;
}

export function resolveLanguage(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return normalizeLanguage(value);
    }
  }
  return 'zh';
}
