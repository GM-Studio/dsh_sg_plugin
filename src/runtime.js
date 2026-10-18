import path from 'node:path';
import {
  normalizeGlobalConfig,
  resolveLanguage,
} from './config.js';
import {
  ARTIFACT_PATTERNS,
  GATES,
  SOURCE_EXTENSIONS,
  TEST_PATH_PATTERNS,
} from './constants.js';
import { invalidateFrom, missingGates, requiredGatesFor } from './gates.js';
import { listChangeNames } from './openspec.js';
import { findProjectRoot, loadProject } from './project.js';
import { computeStatus, invalidateStatusCache, promptTextFor } from './status.js';
import { isSubPath, readIfExists, toPosix } from './util.js';

function taskLabels(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s*\[[ xX]\]\s*(.*)$/))
    .filter(Boolean)
    .map((match) => match[1].trim());
}

export function tasksStructureChanged(before, after) {
  const oldLabels = taskLabels(before);
  const newLabels = taskLabels(after);
  if (oldLabels.length !== newLabels.length) return true;
  return oldLabels.some((label, index) => label !== newLabels[index]);
}

export function createRuntime(ctx, config = {}) {
  return new Runtime(ctx, config);
}

class Runtime {
  constructor(ctx, config) {
    this.ctx = ctx;
    this.global = normalizeGlobalConfig(config);
    this.config = this.global;
    this.lastCwd = process.cwd();
    this.beforeWrite = new Map();
  }

  remember(cwd) {
    if (cwd) this.lastCwd = path.resolve(cwd);
    return this.lastCwd;
  }

  getCwd(agent) {
    try {
      const sessions = this.ctx.get('sessions');
      const workingDirectory = this.ctx.get('workingDirectory');
      if (agent && sessions && workingDirectory) {
        const session = sessions.get(agent.id);
        if (session) {
          const value = workingDirectory.get(session);
          if (value) return this.remember(value);
        }
      }
    } catch {
      // Fall through to the last known cwd.
    }
    return this.lastCwd;
  }

  project(agent) {
    return loadProject(this.getCwd(agent));
  }

  language(agent) {
    try {
      return resolveLanguage(this.project(agent).language, this.global.language);
    } catch {
      return this.global.language;
    }
  }

  maxConcurrency(agent) {
    try {
      return this.project(agent).maxConcurrency || this.global.maxConcurrency;
    } catch {
      return this.global.maxConcurrency;
    }
  }

  status(agent, fresh = false) {
    const project = this.project(agent);
    return { project, status: computeStatus(project.root, { fresh }) };
  }

  /**
   * Classify a project-relative path for gate enforcement.
   * Returns { kind, relative } where kind is null for ungated files.
   */
  classifyWrite(relativePath) {
    const relative = toPosix(relativePath).replace(/^\.\//, '');
    if (!relative) return { kind: null, relative };
    if (
      relative.startsWith('.specgate/') ||
      relative.startsWith('.dsh/') ||
      relative.startsWith('.git/') ||
      relative.startsWith('node_modules/') ||
      relative.startsWith('docs/') ||
      relative === 'AGENTS.md' ||
      relative === 'README.md'
    ) {
      return { kind: null, relative };
    }
    for (const pattern of ARTIFACT_PATTERNS) {
      if (pattern.re.test(relative)) return { kind: pattern.kind, relative };
    }
    const extension = path.extname(relative).toLowerCase();
    if (
      SOURCE_EXTENSIONS.has(extension) &&
      TEST_PATH_PATTERNS.some((re) => re.test(relative))
    ) {
      return { kind: 'test', relative };
    }
    if (SOURCE_EXTENSIONS.has(extension)) {
      return { kind: 'source', relative };
    }
    return { kind: null, relative };
  }

  checkWrite(exec) {
    if (!exec || (exec.name !== 'write' && exec.name !== 'edit')) return undefined;
    const args = exec.arguments || {};
    const filePath = args.file_path || args.path;
    if (!filePath || typeof filePath !== 'string') return undefined;

    const cwd = this.getCwd(exec.agent);
    const project = loadProject(cwd);
    if (!project.enabled) return undefined;
    if (project.enforcement === 'advisory' || project.enforcement === 'off') return undefined;

    const absolute = path.resolve(cwd, filePath);
    if (!isSubPath(project.root, absolute)) return undefined;
    const relative = toPosix(path.relative(project.root, absolute));
    const { kind } = this.classifyWrite(relative);
    if (!kind) return undefined;

    if (kind === 'source' && listChangeNames(project.root).length === 0) {
      return undefined;
    }

    const required = requiredGatesFor(kind, project.paradigm);
    const missing = missingGates(project.root, required);
    if (missing.length === 0) {
      if (kind === 'tasks') this.beforeWrite.set(absolute, readIfExists(absolute));
      return undefined;
    }

    const labels = missing
      .map((gate) => `${gate} ${GATES[gate]?.name || ''}`.trim())
      .join('、');
    return [
      `SpecGate 门控未通过：写入 ${relative} 需要先确认 ${labels}。`,
      '请调用 sg_gate 完成确认；如用户明确要求跳过，使用 sg_gate 的 waive 动作并记录偏离。',
    ].join('\n');
  }

  afterWrite(exec) {
    if (!exec || (exec.name !== 'write' && exec.name !== 'edit')) return;
    const args = exec.arguments || {};
    const filePath = args.file_path || args.path;
    if (!filePath || typeof filePath !== 'string') return;
    const cwd = this.getCwd(exec.agent);
    const project = loadProject(cwd);
    if (!project.enabled) return;
    const absolute = path.resolve(cwd, filePath);
    if (!isSubPath(project.root, absolute)) return;
    const relative = toPosix(path.relative(project.root, absolute));
    const { kind } = this.classifyWrite(relative);
    if (!kind) return;

    const before = this.beforeWrite.get(absolute);
    this.beforeWrite.delete(absolute);
    if (kind === 'tasks' && before !== undefined && !tasksStructureChanged(before, readIfExists(absolute) || '')) {
      return;
    }

    const invalidateAt = {
      proposal: 'G3',
      design: 'G4',
      specs: 'G5',
      tasks: 'G6',
      source: 'G8',
      test: 'G8',
    }[kind];
    if (invalidateAt) {
      invalidateFrom(project.root, invalidateAt);
      invalidateStatusCache(project.root);
    }
  }

  promptText(agent) {
    const cwd = agent && agent.id ? this.getCwd(agent) : this.lastCwd;
    const root = findProjectRoot(cwd);
    return promptTextFor(root, this.language(agent));
  }
}
