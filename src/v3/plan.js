import fs from 'node:fs';
import path from 'node:path';
import { exists, readText } from './util/fsx.js';
import { canonicalJson, digest, norm, sha256 } from './util/hash.js';
import { readSuites, validateSuites } from './change.js';

const TASK_RE = /^<!--\s*sg:task\s+(\{.*\})\s*-->\s*$/;
const CASE_RE = /^\|\s*(TC-\d{3,})\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*(.*?)\s*\|\s*$/;

export function changeDir(root, change) {
  return path.join(root, 'openspec', 'changes', change);
}

export function parseTasks(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const tasks = [];
  const errors = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = TASK_RE.exec(lines[index].trim());
    if (!match) continue;
    let meta;
    try {
      meta = JSON.parse(match[1]);
    } catch {
      errors.push(`tasks.md 第 ${index + 1} 行：sg:task 不是合法 JSON`);
      continue;
    }
    if (!meta.id || !/^T-\d{3,}$/.test(meta.id)) {
      errors.push(`tasks.md 第 ${index + 1} 行：任务 id 必须形如 T-001`);
      continue;
    }
    tasks.push({
      id: meta.id,
      title: String(meta.title || ''),
      ac: Array.isArray(meta.ac) ? meta.ac.map(String) : [],
      deps: Array.isArray(meta.deps) ? meta.deps.map(String) : [],
      parallel: meta.parallel === true,
    });
  }
  if (tasks.length === 0) errors.push('tasks.md 没有可识别的 sg:task');
  return { tasks, errors };
}

export function parseCases(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const cases = [];
  for (const line of lines) {
    const match = CASE_RE.exec(line.trim());
    if (!match) continue;
    if (match[2].trim() === 'AC') continue;
    const ac = match[2]
      .split(/[,，、\s]+/)
      .map((item) => item.trim())
      .filter((item) => /^AC-\d{3,}$/.test(item));
    cases.push({
      id: match[1],
      ac,
      layer: match[3].trim(),
      description: match[4].trim(),
    });
  }
  return { cases, errors: cases.length === 0 ? ['cases.md 没有用例行'] : [] };
}

export function readJson(filePath, label) {
  if (!exists(filePath)) return { ok: false, error: `缺少 ${label}` };
  try {
    return { ok: true, value: JSON.parse(readText(filePath)) };
  } catch {
    return { ok: false, error: `${label} 不是合法 JSON` };
  }
}

export function loadPlan(root, change) {
  const dir = changeDir(root, change);
  const tasksText = exists(path.join(dir, 'tasks.md')) ? readText(path.join(dir, 'tasks.md')) : '';
  const casesText = exists(path.join(dir, 'tests', 'cases.md'))
    ? readText(path.join(dir, 'tests', 'cases.md'))
    : '';
  const tasks = parseTasks(tasksText);
  const cases = parseCases(casesText);
  const mapping = readJson(path.join(dir, 'tests', 'mapping.json'), 'tests/mapping.json');
  const touched = readJson(path.join(dir, 'tests', 'touched.json'), 'tests/touched.json');
  return {
    dir,
    designText: exists(path.join(dir, 'design.md')) ? readText(path.join(dir, 'design.md')) : '',
    tasks: tasks.tasks,
    tasksErrors: tasks.errors,
    cases: cases.cases,
    casesErrors: cases.errors,
    mapping: mapping.ok ? mapping.value : null,
    mappingError: mapping.ok ? null : mapping.error,
    touched: touched.ok ? touched.value : null,
    touchedError: touched.ok ? null : touched.error,
  };
}

export function discoverCommand(root, config) {
  const configured = config?.testing?.command;
  if (Array.isArray(configured) && configured.length > 0 && typeof configured[0] === 'string') {
    return {
      ok: true,
      argv: configured.map(String),
      cwd: config?.testing?.cwd || '.',
      source: 'config',
    };
  }
  const pkgPath = path.join(root, 'package.json');
  if (exists(pkgPath)) {
    try {
      const pkg = JSON.parse(readText(pkgPath));
      if (typeof pkg?.scripts?.['test:json'] === 'string' && pkg.scripts['test:json'].trim()) {
        const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
        const argv = exists(npmCli)
          ? [process.execPath, npmCli, 'run', 'test:json']
          : ['npm', 'run', 'test:json'];
        return { ok: true, argv, cwd: '.', source: 'package.json' };
      }
    } catch {
      // fall through
    }
  }
  return {
    ok: false,
    code: 'TEST_COMMAND_MISSING',
    message: '找不到 test:json：请在 .specgate/config.yaml 的 testing.command 配置 argv，或添加 package.json scripts["test:json"]',
  };
}

/**
 * Resolve every configured suite to a frozen command. pytest suites keep their
 * args; the adapter adds --junitxml at run time.
 */
export function discoverSuites(root, config) {
  const suites = readSuites(config);
  const errors = [...validateSuites(root, suites).errors];
  const resolved = [];
  for (const suite of suites) {
    const cwd = suite.cwd || '.';
    if (!exists(path.resolve(root, cwd))) {
      errors.push(`suite ${suite.id} 的 cwd 不存在：${cwd}`);
    }
    let argv = suite.command.slice();
    let source = 'config';
    if (suite.kind === 'pytest') {
      source = 'pytest';
    } else if (argv.length === 0) {
      if (suite.legacy) {
        const fallback = discoverCommand(root, config);
        if (fallback.ok) {
          argv = fallback.argv;
          source = fallback.source;
        } else {
          errors.push(fallback.message);
        }
      } else {
        errors.push(`suite ${suite.id} 缺少 command`);
      }
    }
    const cmdHash =
      suite.kind === 'pytest'
        ? digest({ kind: 'pytest', args: suite.pytestArgs, python: suite.python, cwd })
        : digest({ kind: suite.kind, argv, cwd });
    resolved.push({ ...suite, argv, source, cwd, cmdHash });
  }
  return { ok: errors.length === 0, errors, suites: resolved };
}

function hasCycle(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set();
  const done = new Set();
  let cycle = null;
  const visit = (id) => {
    if (cycle) return;
    if (visiting.has(id)) {
      cycle = id;
      return;
    }
    if (done.has(id) || !byId.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id).deps) visit(dep);
    visiting.delete(id);
    done.add(id);
  };
  for (const task of tasks) visit(task.id);
  return cycle;
}

export function validatePlan({
  root,
  change,
  plan,
  deltaAcs,
  deltaReqs,
  config,
  type = 'feature',
  suites = null,
}) {
  const isRemove = type === 'remove';
  const errors = [...plan.tasksErrors];
  if (!isRemove) errors.push(...plan.casesErrors);
  if (plan.mappingError) errors.push(plan.mappingError);
  if (plan.touchedError) errors.push(plan.touchedError);

  const taskIds = new Set();
  for (const task of plan.tasks) {
    if (taskIds.has(task.id)) errors.push(`任务 id 重复：${task.id}`);
    taskIds.add(task.id);
  }
  for (const task of plan.tasks) {
    for (const dep of task.deps) {
      if (!taskIds.has(dep)) errors.push(`任务 ${task.id} 依赖不存在：${dep}`);
    }
    if (!isRemove) {
      if ((task.ac || []).length === 0) errors.push(`任务 ${task.id} 缺少 ac`);
      for (const ac of task.ac) {
        if (!deltaAcs.has(ac)) errors.push(`任务 ${task.id} 引用了 delta 中不存在的 ${ac}`);
      }
    }
  }
  const cycle = hasCycle(plan.tasks);
  if (cycle) errors.push(`任务依赖成环：${cycle}`);

  const caseIds = new Set();
  for (const item of plan.cases) {
    caseIds.add(item.id);
    for (const ac of item.ac) {
      if (!deltaAcs.has(ac)) errors.push(`用例 ${item.id} 引用了不存在的 ${ac}`);
    }
  }
  if (!isRemove) {
    for (const ac of deltaAcs) {
      if (!plan.cases.some((item) => item.ac.includes(ac))) {
        errors.push(`AC ${ac} 没有对应用例`);
      }
      if (!plan.tasks.some((task) => (task.ac || []).includes(ac))) {
        errors.push(`AC ${ac} 没有对应任务`);
      }
    }
  }

  const mapping = plan.mapping;
  if (!mapping || !Array.isArray(mapping.requirements)) {
    errors.push('mapping.json 缺少 requirements 数组');
  } else {
    const mapped = new Set();
    for (const entry of mapping.requirements) {
      if (!entry?.ac) {
        errors.push('mapping.requirements 存在缺少 ac 的条目');
        continue;
      }
      mapped.add(entry.ac);
      if (!deltaAcs.has(entry.ac)) errors.push(`mapping 引用了不存在的 ${entry.ac}`);
      for (const taskId of entry.tasks || []) {
        if (!taskIds.has(taskId)) errors.push(`mapping 引用了不存在的任务 ${taskId}`);
      }
      for (const caseId of entry.cases || []) {
        if (!caseIds.has(caseId)) errors.push(`mapping 引用了不存在的用例 ${caseId}`);
      }
      for (const reqId of entry.covers || []) {
        if (!deltaReqs.has(reqId)) errors.push(`mapping 引用了不存在的 ${reqId}`);
      }
    }
    for (const ac of deltaAcs) {
      if (!mapped.has(ac)) errors.push(`mapping 未覆盖 ${ac}`);
    }
  }

  if (Array.isArray(suites) && suites.length > 0) {
    const ids = new Set(suites.map((suite) => suite.id));
    const multi = suites.length > 1;
    const owner = new Map();
    if (plan.mapping && Array.isArray(plan.mapping.requirements)) {
      for (const entry of plan.mapping.requirements) {
        if (!entry?.ac) continue;
        const suiteId = entry.suite || (multi ? null : suites[0].id);
        if (!suiteId) {
          errors.push(`mapping ${entry.ac} 缺少 suite`);
          continue;
        }
        if (!ids.has(suiteId)) {
          errors.push(`mapping ${entry.ac} 的 suite 不存在：${suiteId}`);
          continue;
        }
        if (owner.has(entry.ac) && owner.get(entry.ac) !== suiteId) {
          errors.push(`AC ${entry.ac} 属于多个 suite`);
        }
        owner.set(entry.ac, suiteId);
      }
    }
  }

  const touched = plan.touched;
  if (touched) {
    for (const key of ['modify', 'delete', 'bootstrap']) {
      if (!Array.isArray(touched[key])) {
        errors.push(`touched.${key} 必须是数组`);
        continue;
      }
    }
    for (const key of ['modify', 'delete']) {
      for (const filePath of touched[key] || []) {
        if (!exists(path.join(root, filePath))) {
          errors.push(`touched.${key} 指向的文件不存在：${filePath}`);
        }
      }
    }
  } else {
    errors.push('缺少 tests/touched.json');
  }

  let command;
  if (Array.isArray(suites) && suites.length > 0) {
    command = { ok: true, argv: suites[0].argv, cwd: suites[0].cwd, source: suites[0].source };
  } else {
    command = discoverCommand(root, config);
    if (!command.ok) errors.push(command.message);
  }

  return { ok: errors.length === 0, errors, command, suites };
}

export function computePlanHash({ plan, command, suites = null }) {
  const payload = {
    design: sha256(norm(plan.designText)),
    cases: sha256(norm(JSON.stringify(plan.cases))),
    mappingRequirements: plan.mapping?.requirements || [],
    touched: plan.touched || {},
    tasks: [...plan.tasks]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((task) => ({
        id: task.id,
        title: task.title,
        ac: [...task.ac].sort(),
        deps: [...task.deps].sort(),
        parallel: task.parallel,
      })),
    cmd: command.ok ? { argv: command.argv, cwd: command.cwd } : null,
    suites: Array.isArray(suites)
      ? suites.map((suite) => ({
          id: suite.id,
          kind: suite.kind,
          argv: suite.kind === 'pytest' ? suite.pytestArgs : suite.argv,
          cwd: suite.cwd,
        }))
      : null,
  };
  return `sha256:${sha256(canonicalJson(payload))}`;
}

export function computeCmdHash(command) {
  return command.ok ? digest({ argv: command.argv, cwd: command.cwd }) : null;
}
