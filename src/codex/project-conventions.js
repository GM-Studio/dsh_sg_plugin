import fs from 'node:fs';
import path from 'node:path';
import { loadProjectReadiness } from './project-state.js';

const DEFAULT_LOCALES = ['zh-CN', 'en-US'];

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
  return {
    backendPackage,
    frontendDefaultLocale,
    frontendLocales: [...frontendLocales],
    templateStyle: '.specgate/template-style.json',
  };
}
