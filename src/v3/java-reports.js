import fs from 'node:fs';
import path from 'node:path';
import { parseJunitXml, resolveJavaTestFile } from './suites.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.specgate', 'dist', 'coverage']);

function walk(root, visit, depth = 0) {
  if (depth > 12) return;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, visit, depth + 1);
    } else if (entry.isFile()) {
      visit(full);
    }
  }
}

export function findJunitFiles(cwd) {
  const files = [];
  walk(cwd, (file) => {
    const normalized = file.replace(/\\/g, '/');
    if (!normalized.endsWith('.xml')) return;
    if (
      normalized.includes('/surefire-reports/') ||
      normalized.includes('/failsafe-reports/') ||
      normalized.includes('/build/test-results/test/')
    ) {
      files.push(file);
    }
  });
  return files.sort();
}

export function findJacocoFiles(cwd) {
  const files = [];
  walk(cwd, (file) => {
    const normalized = file.replace(/\\/g, '/');
    if (normalized.endsWith('/site/jacoco/jacoco.xml')) files.push(file);
    else if (normalized.endsWith('/reports/jacoco/test/jacocoTestReport.xml')) files.push(file);
  });
  return files.sort();
}

export function parseJavaJunitFiles(files, { suiteId, cwd, worktree, runner = 'maven' }) {
  const cases = [];
  const seen = new Set();
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const report = parseJunitXml(text, {
      suiteId,
      cwd,
      worktree,
      runner,
      fileResolver: (classname, ctx) => resolveJavaTestFile(ctx.cwd, ctx.worktree, classname),
    });
    for (const item of report.cases) {
      const key = `${item.classname || ''}::${item.name || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cases.push({
        ...item,
        id: `TC-${String(cases.length + 1).padStart(3, '0')}`,
      });
    }
  }
  return { schemaVersion: 1, runner, suite: suiteId, cases };
}

export function collectJavaReports(cwd, { suiteId, worktree, runner = 'maven' }) {
  const files = findJunitFiles(cwd);
  if (files.length === 0) {
    return {
      ok: false,
      code: 'TEST_REPORT_MISSING',
      message:
        '没有找到 JUnit XML（target/surefire-reports、target/failsafe-reports 或 build/test-results/test）',
      files: [],
    };
  }
  return {
    ok: true,
    files,
    report: parseJavaJunitFiles(files, { suiteId, cwd, worktree, runner }),
  };
}
