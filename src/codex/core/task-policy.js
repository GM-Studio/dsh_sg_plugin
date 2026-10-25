import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PROTECTED_TEST_RULES = Object.freeze([
  '.specgate/**',
  '**/tests/**',
  '**/test/**',
  '**/__tests__/**',
  '**/acceptance/**',
  'specgate-tests/**',
  '**/*.test.*',
  '**/*.spec.*',
]);

export function validFileRule(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    ![...value].some((character) => character.charCodeAt(0) < 32) &&
    !/[\\:?[\]{}<>|"!]/u.test(value) &&
    !value.startsWith('/') &&
    value
      .split('/')
      .every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          part === part.trim() &&
          !part.endsWith('.') &&
          (!part.includes('**') || part === '**') &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  );
}

export function matchesFileRule(file, rule) {
  if (!validFileRule(rule) || !validFileRule(file) || file.includes('*')) return false;
  const parts = rule.split('/');
  let pattern = '^';
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === '**') pattern += index === parts.length - 1 ? '.*' : '(?:[^/]+/)*';
    else {
      pattern += part
        .split('*')
        .map((value) => value.replace(/[.+^$()]/g, '\\$&'))
        .join('[^/]*');
      if (index < parts.length - 1) pattern += '/';
    }
  }
  return new RegExp(pattern + '$', process.platform === 'win32' ? 'i' : '').test(file);
}

export const isProtectedTestFile = (file) =>
  PROTECTED_TEST_RULES.some((rule) => matchesFileRule(file, rule));
export const isDependencyFile = (file) =>
  /(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradle\.lockfile|requirements(?:-[^/]+)?\.txt|pyproject\.toml|poetry\.lock|Cargo\.(?:toml|lock)|go\.(?:mod|sum))$/i.test(
    file,
  );
const unique = (values) => Array.isArray(values) && new Set(values).size === values.length;

export function validDependencyChanges(changes, acIds) {
  return (
    Array.isArray(changes) &&
    changes.length <= 100 &&
    new Set(changes.map((change) => change?.path)).size === changes.length &&
    changes.every(
      (change) =>
        change &&
        typeof change === 'object' &&
        Object.keys(change).every((key) => ['path', 'sha256', 'acIds', 'reason'].includes(key)) &&
        validFileRule(change.path) &&
        !change.path.includes('*') &&
        isDependencyFile(change.path) &&
        /^[a-f0-9]{64}$/.test(change.sha256) &&
        unique(change.acIds) &&
        change.acIds.length > 0 &&
        change.acIds.every((id) => acIds.includes(id)) &&
        typeof change.reason === 'string' &&
        change.reason.trim().length > 0 &&
        change.reason.length <= 2048,
    )
  );
}

export function validTaskBoundary(task, acs) {
  const reqIds = [...new Set(task.acIds.map((id) => acs.get(id)?.requirementId))];
  return (
    unique(task.requirementIds) &&
    task.requirementIds.length === reqIds.length &&
    task.requirementIds.every((id) => reqIds.includes(id)) &&
    unique(task.allowedFiles) &&
    task.allowedFiles.length > 0 &&
    task.allowedFiles.length <= 200 &&
    task.allowedFiles.every(validFileRule) &&
    unique(task.forbiddenFiles) &&
    task.forbiddenFiles.length > 0 &&
    task.forbiddenFiles.length <= 200 &&
    task.forbiddenFiles.every(validFileRule) &&
    unique(task.dependencies) &&
    JSON.stringify(task.dependencies) === JSON.stringify(task.deps) &&
    unique(task.verification) &&
    task.verification.length > 0 &&
    task.verification.every((id) => id === 'frozen-tests')
  );
}

export function commitPolicyViolations({ graph, role, entries, readContent, worktree }) {
  const tasks =
    graph?.tasks?.filter((task) =>
      role ? task.kind === role : ['frontend', 'backend'].includes(task.kind),
    ) || [];
  const violations = [];
  for (const entry of entries) {
    const file = entry.path;
    if (entry.mode === '120000' || entry.mode === '160000') {
      violations.push({
        path: file,
        code: 'UNSAFE_ROLE_PATH',
        reason: 'Symbolic links and gitlinks are not permitted implementation assets',
      });
      continue;
    }
    if (worktree && entry.status !== 'D') {
      let target = worktree;
      let unsafe = fs.lstatSync(target).isSymbolicLink();
      for (const part of file.split('/')) {
        target = path.join(target, part);
        const stat = fs.lstatSync(target);
        if (
          stat.isSymbolicLink() ||
          (stat.isFile() && stat.nlink !== 1) ||
          (!stat.isFile() && !stat.isDirectory())
        )
          unsafe = true;
      }
      if (unsafe) {
        violations.push({
          path: file,
          code: 'UNSAFE_ROLE_PATH',
          reason: 'Implementation paths cannot contain symbolic links, hardlinks or special files',
        });
        continue;
      }
    }
    const matching = tasks.filter((task) =>
      task.allowedFiles?.some((rule) => matchesFileRule(file, rule)),
    );
    if (
      isProtectedTestFile(file) ||
      tasks.some((task) => task.forbiddenFiles?.some((rule) => matchesFileRule(file, rule))) ||
      !matching.length
    ) {
      violations.push({
        path: file,
        code: 'FILE_OUTSIDE_TASK_POLICY',
        reason: 'File is forbidden or outside the frozen task whitelist',
      });
      continue;
    }
    if (isDependencyFile(file)) {
      const approval = graph.dependencyChanges?.find(
        (change) =>
          change.path === file &&
          change.acIds.every((id) => matching.some((task) => task.acIds.includes(id))),
      );
      const hash =
        entry.status === 'D' ? null : createHash('sha256').update(readContent(file)).digest('hex');
      if (!approval || hash !== approval.sha256)
        violations.push({
          path: file,
          code: 'DEPENDENCY_APPROVAL_REQUIRED',
          reason: 'Dependency file content does not match an H1-approved file/hash/AC binding',
        });
    }
  }
  return violations;
}
