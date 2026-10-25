import path from 'node:path';

export const validFilePattern = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 1024 &&
  !/[\\\0\r\n:[\]{}!]/.test(value) &&
  !path.posix.isAbsolute(value) &&
  !value.split('/').some((part) => !part || part === '..' || part === '.');
export const validFilePatterns = (value, nonempty = false) =>
  Array.isArray(value) &&
  value.length <= 200 &&
  (!nonempty || value.length > 0) &&
  value.every(validFilePattern) &&
  new Set(value).size === value.length;
export function matchesFile(file, pattern) {
  if (!validFilePattern(file) || /[*?]/.test(file) || !validFilePattern(pattern)) return false;
  let regex = '^';
  for (let index = 0; index < pattern.length; index++) {
    const token = pattern[index];
    if (token === '*' && pattern[index + 1] === '*') {
      index++;
      if (pattern[index + 1] === '/') {
        regex += '(?:.*/)?';
        index++;
      } else regex += '.*';
    } else if (token === '*') regex += '[^/]*';
    else if (token === '?') regex += '[^/]';
    else regex += token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(regex + '$').test(file);
}
export function validDependencyChanges(entries, acIds) {
  return (
    entries === undefined ||
    (Array.isArray(entries) &&
      entries.length <= 100 &&
      entries.every(
        (entry) =>
          entry &&
          validFilePattern(entry.file) &&
          !/[*?]/.test(entry.file) &&
          /^sha256:[a-f0-9]{64}$/.test(entry.hash) &&
          Array.isArray(entry.acIds) &&
          entry.acIds.length > 0 &&
          entry.acIds.every((ac) => acIds.includes(ac)),
      ))
  );
}
export const dependencyFile = (file) =>
  /(?:^|\/)(?:pom\.xml|package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|gradle\.properties)$/.test(
    file,
  );
export function taskFilePolicy(graph, role, file, contentHash) {
  const tasks = (graph?.tasks || []).filter((task) => task.kind === role);
  if (
    !tasks.length ||
    tasks.some(
      (task) =>
        !validFilePatterns(task.allowedFiles, true) || !validFilePatterns(task.forbiddenFiles),
    )
  )
    return {
      ok: false,
      code: 'PLAN_CONTRACT_INVALID',
      reason: 'Implementation task file boundaries are missing',
    };
  if (tasks.some((task) => task.forbiddenFiles.some((glob) => matchesFile(file, glob))))
    return {
      ok: false,
      code: 'ROLE_POLICY_VIOLATION',
      reason: 'File matches a frozen forbiddenFiles policy',
    };
  const eligible = tasks.filter((task) =>
    task.allowedFiles.some((glob) => matchesFile(file, glob)),
  );
  if (!eligible.length)
    return {
      ok: false,
      code: 'ROLE_POLICY_VIOLATION',
      reason: 'File is outside the frozen allowedFiles policy',
    };
  if (
    dependencyFile(file) &&
    !eligible.some((task) =>
      task.dependencyChanges?.some(
        (entry) =>
          entry.file === file &&
          entry.hash === contentHash &&
          entry.acIds.every((ac) => task.acIds.includes(ac)),
      ),
    )
  )
    return {
      ok: false,
      code: 'DEPENDENCY_APPROVAL_REQUIRED',
      reason: 'Dependency manifest content needs a matching H1-approved file hash and AC mapping',
    };
  return { ok: true };
}
