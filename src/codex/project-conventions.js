import fs from 'node:fs';
import path from 'node:path';
import { loadProjectReadiness } from './project-state.js';

const DEFAULT_LOCALES = ['zh-CN', 'en-US'];
const DEFAULT_FRONTEND_FRAMEWORK = 'vue';

function readJson(target) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

export function readProjectConventions({ projectRoot } = {}) {
  const readiness = loadProjectReadiness({ projectRoot });
  const profile = readiness.ok ? readiness.profile : null;
  const monorepo = readJson(path.join(projectRoot, '.specgate', 'monorepo.json'));
  const backendPackage =
    profile?.backendPackage || monorepo?.backendPackage || monorepo?.basePackage || null;
  const frontendDefaultLocale =
    profile?.frontendDefaultLocale || monorepo?.frontendDefaultLocale || 'zh-CN';
  const frontendLocales = profile?.frontendLocales || monorepo?.frontendLocales || DEFAULT_LOCALES;
  const frontendFramework =
    profile?.frontendFramework || monorepo?.frontendFramework || DEFAULT_FRONTEND_FRAMEWORK;
  const javaPreset = profile?.javaPreset || monorepo?.preset || null;
  return {
    backendPackage,
    frontendDefaultLocale,
    frontendLocales: [...frontendLocales],
    frontendFramework,
    javaPreset,
    templateStyle: '.specgate/template-style.json',
  };
}

/**
 * Returns a violation reason when a file contradicts the project's recorded
 * frontend framework, otherwise null. Only unambiguous cases are rejected: a
 * React project must not add Vue single-file components.
 */
export function frontendFrameworkViolation(frontendFramework, filePath) {
  if (frontendFramework === 'react' && /\.vue$/i.test(String(filePath || '')))
    return 'A React project must not add Vue single-file components';
  return null;
}
