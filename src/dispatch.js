import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { runDoctor } from './doctor.js';
import { gitAddAndCommit } from './git.js';
import { changeDir } from './openspec.js';
import {
  formatReportPath,
  resolveFormatCommands,
  reviewReportPath,
  validateFormatReport,
  validateReviewReport,
} from './format.js';
import { loadProject } from './project.js';
import {
  currentRequirementChange,
  readRequirements,
  testPaths,
  validateTestPlan,
  validateTestReport,
} from './requirements.js';
import { buildWaves, parseTasks } from './task-graph.js';
import {
  createWorktree,
  currentBranch,
  diffNames,
  gitDirty,
  headHash,
  isGitRepo,
  mergeBranch,
  removeWorktree,
} from './worktree.js';
import {
  ensureDir,
  exists,
  nowIso,
  readIfExists,
  readJsonIfExists,
  writeFile,
  writeJson,
} from './util.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function resolveMaxConcurrency(root, fallback = 4) {
  const text = readIfExists(path.join(path.resolve(root), '.specgate', 'config.yaml')) || '';
  const nested = text.match(/^\s+maxConcurrency:\s*(\d+)\s*$/m);
  const top = text.match(/^maxConcurrency:\s*(\d+)\s*$/m);
  const value = Number((nested || top)?.[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function dispatchStorePath(root) {
  return path.join(path.resolve(root), '.specgate', 'state', 'dispatch.json');
}

function readDispatchStore(root) {
  return readJsonIfExists(dispatchStorePath(root)) || { version: 1, tasks: {} };
}

function writeDispatchStore(root, store) {
  const dir = path.dirname(dispatchStorePath(root));
  ensureDir(dir);
  const ignore = path.join(dir, '.gitignore');
  if (!exists(ignore)) writeFile(ignore, '*\n');
  writeJson(dispatchStorePath(root), store);
}

function taskKey(change, task) {
  return `${change}/${task.id}`;
}

function recordTask(root, change, task, data) {
  const store = readDispatchStore(root);
  store.tasks[taskKey(change, task)] = {
    taskId: task.id,
    contentHash: task.contentHash,
    at: nowIso(),
    ...data,
  };
  writeDispatchStore(root, store);
}

function markTasksDone(root, change, taskIds) {
  if (taskIds.size === 0) return null;
  const file = path.join(path.resolve(root), 'openspec', 'changes', change, 'tasks.md');
  const text = readIfExists(file);
  if (text === null) return null;
  let changed = false;
  const lines = text.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*-\s*)\[ \](\s+)([A-Za-z0-9][A-Za-z0-9._-]*)(\s|$)/);
    if (!match || !taskIds.has(match[3])) return line;
    changed = true;
    const rest = line.slice(match[0].length);
    const separator = match[4] || (rest ? ' ' : '');
    return `${match[1]}[x]${match[2]}${match[3]}${separator}${rest}`;
  });
  if (!changed) return null;
  writeFile(file, lines.join('\n'));
  try {
    const result = gitAddAndCommit(
      root,
      `chore(specgate): mark ${change} tasks done`,
      { all: false, paths: [path.relative(root, file)] },
    );
    return result.committed ? result.hash : null;
  } catch {
    return null;
  }
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length)))
    .fill(null)
    .map(async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await fn(items[index], index);
      }
    });
  await Promise.all(workers);
  return results;
}

function roleInstruction(role) {
  if (role === 'tester') {
    return 'You are the SpecGate tester role. You own test cases, automation, coverage and reports. Never modify production code; report failures instead of fixing them.';
  }
  return `You are the SpecGate ${role} role. Work only within the assigned task.`;
}

function taskPrompt({ change, task, cwd, role }) {
  return [
    `SpecGate 并行实施任务`,
    ``,
    `Change: ${change}`,
    `Task: ${task.id} — ${task.title}`,
    `Role: ${role}`,
    `Workspace: ${cwd}`,
    ``,
    `要求：`,
    `1. 只在当前 workspace（${cwd}）内修改文件，不要访问或修改其他 worktree。`,
    `2. 遵循 TDD：先写/更新测试并确认 RED，再实现到 GREEN。`,
    `3. 运行与任务相关的测试；失败时先修复，不要伪造通过。`,
    `4. 完成后在 workspace 内提交：git add -A && git commit -m "specgate(${change}): ${task.id} ${task.title}"。`,
    `5. 不要合并分支，不要删除 worktree；合并由主调度器负责。`,
    `6. 最终只回复：完成摘要、测试命令与结果、提交 hash、未解决问题（如有）。`,
  ].join('\n');
}

/**
 * Default runner: create one child Agent in the target cwd, send the prompt,
 * wait for idle, read its final assistant text, then dispose it.
 */
export function createAgentRunner(ctx) {
  let agents;
  // Resolve through ctx.get() first: a direct `ctx.agents` access on a context
  // that did not inject the service throws in Cordis instead of returning
  // undefined, which used to abort sg_doctor before its fallback ran.
  try {
    agents = ctx && typeof ctx.get === 'function' ? ctx.get('agents') : undefined;
  } catch {
    agents = undefined;
  }
  if (!agents) {
    try {
      agents = ctx?.agents;
    } catch {
      agents = undefined;
    }
  }
  if (!agents) return null;
  return async ({ prompt, cwd, role, parent }) => {
    const roleFile = path.join(cwd, '.specgate', 'agents', `sg-agent-${role}.md`);
    const roleText = readIfExists(roleFile) || roleInstruction(role);
    const parentOptions =
      parent && typeof parent.options === 'object' && parent.options !== null
        ? { ...parent.options }
        : {};
    const requestConfig =
      typeof parent?.session?.requestHeader === 'function'
        ? parent.session.requestHeader()?.config
        : undefined;
    const agentOptions = {
      ...parentOptions,
      ...(requestConfig
        ? {
            provider: requestConfig.provider,
            model: requestConfig.model,
            ...(requestConfig.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: requestConfig.reasoningEffort }),
          }
        : {}),
      subagentDepth: Number.isSafeInteger(parentOptions.subagentDepth)
        ? parentOptions.subagentDepth + 1
        : 1,
    };
    let handle;
    try {
      handle = await agents.create({
        sessionId: randomUUID(),
        parentAgent: parent,
        agentOptions,
        meta: {
          cwd,
          ...(parent?.session?.id ? { parentSession: parent.session.id } : {}),
          origin: 'subagent',
          delegationDepth: 1,
        },
        setup(agentCtx) {
          const systemPrompt = agentCtx.get('systemPrompt');
          if (systemPrompt && typeof systemPrompt.context === 'function') {
            systemPrompt.context({
              name: 'specgate-dispatch-role',
              order: 50,
              text: roleText,
            });
          }
        },
      });

      handle.agent.followup({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'specgate-dispatch' },
      });
      await handle.agent.whenIdle();

      const messages = handle.agent.session.deriveMessages();
      const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
      const text = (assistant?.content || [])
        .filter((block) => block && block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      return { ok: true, text: text || '(agent 未返回文本)', commit: null };
    } catch (error) {
      return {
        ok: false,
        text: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (handle && typeof handle.dispose === 'function') {
        try {
          await handle.dispose();
        } catch {
          // Disposal failures must not hide the task result.
        }
      }
    }
  };
}

function parseWaves(root, change, maxConcurrency) {
  const changePath = changeDir(root, change);
  const text = readIfExists(path.join(changePath, 'tasks.md'));
  if (text === null) throw new Error(`tasks.md 不存在：${change}`);
  const tasks = parseTasks(text);
  const waves = buildWaves(tasks, maxConcurrency);
  return { tasks, waves };
}

/**
 * Execute one change. Worktrees are used only when Git is available and the
 * parent working tree is clean; otherwise the dispatcher downgrades to one
 * serial writer, as agreed in v1.2.
 */
export async function dispatchChange(options) {
  const {
    root,
    change,
    parent,
    runner,
    maxConcurrency = 4,
    planOnly = false,
    roleOverrides = {},
  } = options;
  const { tasks, waves } = parseWaves(root, change, maxConcurrency);
  const open = tasks.filter((task) => !task.done);

  if (planOnly) {
    return {
      ok: true,
      planOnly: true,
      change,
      tasks,
      waves,
      results: [],
      conflicts: [],
      downgraded: false,
    };
  }

  if (open.length === 0) {
    return {
      ok: true,
      change,
      tasks,
      waves: [],
      results: [],
      conflicts: [],
      downgraded: false,
      text: '所有 tasks 已完成，无需派发。',
    };
  }

  if (typeof runner !== 'function') {
    throw new Error('当前 DSH composition 没有可用的 Agent 派发能力（agents 服务不可用）。');
  }

  const useWorktrees = isGitRepo(root) && !gitDirty(root);
  const results = [];
  const conflicts = [];
  let stopped = false;

  if (!useWorktrees) {
    const reason = !isGitRepo(root)
      ? '项目不是 Git 仓库'
      : '工作区有未提交改动，worktree 不包含这些改动';
    for (const task of open) {
      const role = roleOverrides[task.id] || task.role || 'developer';
      const before = headHash(root);
      const outcome = await runner({
        prompt: taskPrompt({ change, task, cwd: root, role }),
        cwd: root,
        role,
        parent,
        task,
      });
      const after = headHash(root);
      const commit = outcome?.commit || (after && after !== before ? after : null);
      results.push({ task, ok: Boolean(outcome?.ok), text: outcome?.text || '', commit, serial: true });
      if (!outcome?.ok) stopped = true;
      else recordTask(root, change, task, {
        commit,
        branch: null,
        status: 'serial',
      });
      if (stopped) break;
    }
    const doneIds = new Set(
      results.filter((item) => item.ok && !item.skipped).map((item) => item.task.id),
    );
    markTasksDone(root, change, doneIds);
    return {
      ok: !stopped,
      change,
      tasks,
      waves: open.map((task) => [task]),
      results,
      conflicts,
      downgraded: true,
      downgradeReason: reason,
    };
  }

  for (const wave of waves) {
    if (stopped) break;
    const runnable = wave;
    const prepared = runnable.map((task) => {
      const worktree = createWorktree(root, change, task);
      return { task, worktree };
    });

    const waveResults = await mapLimit(prepared, maxConcurrency, async ({ task, worktree }) => {
      const role = roleOverrides[task.id] || task.role || 'developer';
      const before = headHash(worktree.path);
      const outcome = await runner({
        prompt: taskPrompt({ change, task, cwd: worktree.path, role }),
        cwd: worktree.path,
        role,
        parent,
        task,
      });
      const after = headHash(worktree.path);
      return {
        task,
        worktree,
        ok: Boolean(outcome?.ok),
        text: outcome?.text || '',
        commit: outcome?.commit || (after && after !== before ? after : null),
      };
    });
    results.push(...waveResults);

    for (const item of waveResults) {
      if (!item.ok) {
        stopped = true;
        continue;
      }
      const merged = mergeBranch(root, item.worktree.branch);
      if (!merged.ok) {
        stopped = true;
        conflicts.push({
          task: item.task.id,
          branch: item.worktree.branch,
          conflicts: merged.conflicts,
          message: merged.message,
        });
        continue;
      }
      recordTask(root, change, item.task, {
        commit: item.commit,
        branch: item.worktree.branch,
        status: 'merged',
      });
      removeWorktree(root, item.worktree.path);
    }
    if (stopped) break;
  }

  const doneIds = new Set(
    results.filter((item) => item.ok && !item.skipped).map((item) => item.task.id),
  );
  markTasksDone(root, change, doneIds);

  return {
    ok: !stopped,
    change,
    tasks,
    waves,
    results,
    conflicts,
    downgraded: false,
    branch: currentBranch(root),
  };
}

/**
 * Run the dedicated tester agent in an independent test worktree.
 * `plan` writes/finalizes cases and automation, then the main agent merges
 * the test branch. `run` executes against the current integration commit and
 * copies the report back; it never merges production changes.
 */
export async function runTestAgent(options) {
  const { root, change, parent, runner, action = 'run', language = 'zh' } = options;
  if (typeof runner !== 'function') {
    throw new Error('当前 DSH composition 没有可用的 Agent 派发能力（agents 服务不可用）。');
  }
  const projectRoot = path.resolve(root);
  const requirement = readRequirements(projectRoot);
  if (!requirement) throw new Error('requirements/REQUIREMENTS.md 不存在');
  const active = currentRequirementChange(projectRoot);
  if (!active || active.change !== change) {
    throw new Error(`当前没有匹配的需求变更：${change}`);
  }
  const changeInfo = active;
  const useWorktree = isGitRepo(projectRoot) && !gitDirty(projectRoot);
  if (isGitRepo(projectRoot) && gitDirty(projectRoot)) {
    return { ok: false, text: '工作区 dirty，无法创建独立测试 worktree；请先提交当前改动。' };
  }
  const worktree = useWorktree
    ? createWorktree(projectRoot, change, { id: 'test' })
    : { path: projectRoot, branch: null, reused: true };
  const paths = testPaths(worktree.path, change);
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  const prompt = [
    en ? 'SpecGate tester task' : 'SpecGate 测试 Agent 任务',
    '',
    `Change: ${change}`,
    `Requirement version: ${changeInfo.version || requirement.version}`,
    `Workspace: ${worktree.path}`,
    `Action: ${action}`,
    '',
    en
      ? 'Read requirements/REQUIREMENTS.md and requirements/changes/<change>/{change.md,design.md,tests/cases.md,tests/matrix.md}.'
      : '阅读 requirements/REQUIREMENTS.md 与 requirements/changes/<change>/ 下的 change.md、design.md、tests/cases.md、tests/matrix.md。',
    en
      ? 'Do not modify production code. Write or run tests, update cases/matrix and write tests/test-report.md with verdict, P0/P1/P2 pass rates, failed count, line and branch coverage, failures and evidence.'
      : '不要修改生产代码。编写或执行测试，更新 cases/matrix，并写 tests/test-report.md，包含 verdict、P0/P1/P2 通过率、失败数、行/分支覆盖率、失败用例和证据。',
    en
      ? `Automation lives in tests/specgate/${change}/. Cases must cover red/green, branches and conditions.`
      : `自动化测试放在 tests/specgate/${change}/。用例必须覆盖红绿、分支和条件。`,
    en
      ? 'If action=plan, finish the test plan and automation; do not run the full implementation suite yet.'
      : 'action=plan 时完成测试计划与自动化测试，不要求跑完整实现套件。',
    en
      ? 'If action=run, execute the frozen suite and report pass only when all P0/P1 pass and coverage is adequate.'
      : 'action=run 时执行已冻结套件；只有 P0/P1 全部通过且覆盖率达标才可写 pass。',
    en
      ? 'Reply with a short summary, test command, result and blockers.'
      : '最终回复：摘要、测试命令、结果和阻塞项。',
  ].join('\n');

  let outcome;
  try {
    outcome = await runner({
      prompt,
      cwd: worktree.path,
      role: 'tester',
      parent,
      task: { id: `test-${change}` },
    });
    if (!outcome?.ok) {
      return { ok: false, action, text: outcome?.text || '测试 Agent 失败', worktree, branch: worktree.branch };
    }
    if (action === 'plan') {
      const plan = validateTestPlan(worktree.path, change);
      if (!plan.ok) return { ok: false, action, text: plan.reason, worktree, branch: worktree.branch };
      if (useWorktree) {
        const commit = gitAddAndCommit(worktree.path, `test(specgate): plan ${change}`);
        if (!commit.committed) {
          return { ok: false, action, text: '测试 Agent 没有产生可提交的测试变更', worktree, branch: worktree.branch };
        }
        const merged = mergeBranch(projectRoot, worktree.branch);
        if (!merged.ok) {
          return {
            ok: false,
            action,
            text: `测试分支合并失败：${merged.message}`,
            conflicts: merged.conflicts,
            worktree,
            branch: worktree.branch,
          };
        }
      }
      return { ok: true, action, text: '测试计划已生成并合入基线', worktree, branch: worktree.branch };
    }

    const report = readIfExists(paths.report);
    if (report === null) {
      return { ok: false, action, text: '测试 Agent 未生成 tests/test-report.md', worktree, branch: worktree.branch };
    }
    const target = testPaths(projectRoot, change).report;
    ensureDir(path.dirname(target));
    writeFile(target, report);
    const validation = validateTestReport(projectRoot, change, options);
    return {
      ok: validation.ok,
      action,
      text: validation.ok ? '测试通过' : validation.reason,
      report: target,
      verdict: validation,
      worktree,
      branch: worktree.branch,
    };
  } finally {
    if (useWorktree && worktree.path && worktree.path !== projectRoot) {
      removeWorktree(projectRoot, worktree.path);
    }
  }
}

/**
 * Formatter stage: an independent worktree runs formatter/lint on changed files,
 * commits fixes and reports pass/fail. The main agent merges only on pass.
 */
export async function runFormatAgent(options) {
  const { root, change, parent, runner, language = 'zh' } = options;
  if (typeof runner !== 'function') {
    throw new Error('当前 DSH composition 没有可用的 Agent 派发能力（agents 服务不可用）。');
  }
  const projectRoot = path.resolve(root);
  const project = loadProject(projectRoot);
  const active = currentRequirementChange(projectRoot);
  if (!active || active.change !== change) throw new Error(`当前没有匹配的需求变更：${change}`);
  const commands = resolveFormatCommands(projectRoot, project.config);
  if (!commands.ok) return { ok: false, text: commands.reason };
  const changed = diffNames(projectRoot, active.baseCommit);
  if (changed.length === 0) {
    const file = formatReportPath(projectRoot, change);
    ensureDir(path.dirname(file));
    writeFile(file, 'verdict: pass\nlint: pass\nskipped: true\nchanged_files: []\n');
    return { ok: true, skipped: true, text: '没有变更文件，格式化跳过' };
  }
  const useWorktree = isGitRepo(projectRoot) && !gitDirty(projectRoot);
  if (isGitRepo(projectRoot) && gitDirty(projectRoot)) {
    return { ok: false, text: '工作区 dirty，无法创建独立格式化 worktree；请先提交当前改动。' };
  }
  const worktree = useWorktree
    ? createWorktree(projectRoot, change, { id: 'format' })
    : { path: projectRoot, branch: null, reused: true };
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  const fileList = changed.join(' ');
  const formatCommand = commands.formatCommand
    ? commands.formatCommand.replaceAll('{files}', fileList)
    : null;
  const lintCommand = commands.lintCommand ? commands.lintCommand.replaceAll('{files}', fileList) : null;
  const prompt = [
    en ? 'SpecGate formatter task' : 'SpecGate 格式化/Lint 任务',
    '',
    `Change: ${change}`,
    `Workspace: ${worktree.path}`,
    `Changed files: ${changed.join(', ')}`,
    `Format command: ${formatCommand || '(skip)'}`,
    `Lint command: ${lintCommand || '(skip)'}`,
    '',
    en
      ? 'Modify only the changed files. Run the formatter, then lint. Do not modify production logic, tests, requirements, or other files.'
      : '只修改列出的变更文件。先运行 formatter，再运行 lint；不要修改生产逻辑、测试、需求或其他文件。',
    en
      ? 'Write requirements/changes/<change>/format-report.md with verdict: pass|fail, lint: pass|fail, changed_files and fixed_files.'
      : '写 requirements/changes/<change>/format-report.md，包含 verdict: pass|fail、lint: pass|fail、changed_files 和 fixed_files。',
    en
      ? 'If lint has unfixable errors, verdict must be fail and the reasons must be listed.'
      : '如果 lint 有无法修复的错误，verdict 必须为 fail，并列出原因。',
  ].join('\n');

  let outcome;
  let reportText = null;
  try {
    outcome = await runner({
      prompt,
      cwd: worktree.path,
      role: 'formatter',
      parent,
      task: { id: `format-${change}` },
    });
    reportText = readIfExists(formatReportPath(worktree.path, change));
    if (outcome?.ok === false) {
      return { ok: false, text: outcome.text || 'formatter Agent 失败', worktree, branch: worktree.branch };
    }
    if (!reportText) {
      return { ok: false, text: 'formatter Agent 未生成 format-report.md', worktree, branch: worktree.branch };
    }
    const validation = validateFormatReport(worktree.path, change);
    if (useWorktree) {
      const commit = gitAddAndCommit(worktree.path, `chore(specgate): format ${change}`);
      if (commit.committed) {
        const merged = mergeBranch(projectRoot, worktree.branch);
        if (!merged.ok) {
          ensureDir(path.dirname(formatReportPath(projectRoot, change)));
          writeFile(formatReportPath(projectRoot, change), reportText);
          return { ok: false, text: `格式化分支合并失败：${merged.message}`, worktree, branch: worktree.branch };
        }
      }
    } else {
      ensureDir(path.dirname(formatReportPath(projectRoot, change)));
      writeFile(formatReportPath(projectRoot, change), reportText);
    }
    return {
      ok: validation.ok,
      text: validation.ok ? '格式化/Lint 通过' : validation.reason,
      report: formatReportPath(projectRoot, change),
      worktree,
      branch: worktree.branch,
    };
  } finally {
    if (useWorktree && worktree.path && worktree.path !== projectRoot) {
      removeWorktree(projectRoot, worktree.path);
    }
  }
}

/**
 * Reviewer stage: a read-only independent worktree reviews the integrated
 * change. The report is copied back; no production branch is merged.
 */
export async function runReviewAgent(options) {
  const { root, change, parent, runner, language = 'zh' } = options;
  if (typeof runner !== 'function') {
    throw new Error('当前 DSH composition 没有可用的 Agent 派发能力（agents 服务不可用）。');
  }
  const projectRoot = path.resolve(root);
  const active = currentRequirementChange(projectRoot);
  if (!active || active.change !== change) throw new Error(`当前没有匹配的需求变更：${change}`);
  const useWorktree = isGitRepo(projectRoot) && !gitDirty(projectRoot);
  if (isGitRepo(projectRoot) && gitDirty(projectRoot)) {
    return { ok: false, text: '工作区 dirty，无法创建独立审查 worktree；请先提交当前改动。' };
  }
  const worktree = useWorktree
    ? createWorktree(projectRoot, change, { id: 'review' })
    : { path: projectRoot, branch: null, reused: true };
  const changed = diffNames(projectRoot, active.baseCommit);
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  const prompt = [
    en ? 'SpecGate reviewer task' : 'SpecGate 代码审查任务',
    '',
    `Change: ${change}`,
    `Workspace: ${worktree.path}`,
    `Changed files: ${changed.join(', ') || '(none)'}`,
    '',
    en
      ? 'Read requirements/REQUIREMENTS.md, requirements/changes/<change>/{change.md,change.json,design.md}, tests/cases.md, tests/matrix.md, test-report.md, format-report.md and the diff.'
      : '阅读 requirements/REQUIREMENTS.md、requirements/changes/<change>/{change.md,change.json,design.md}、tests/cases.md、tests/matrix.md、test-report.md、format-report.md 和 diff。',
    en
      ? 'Review requirement coverage, boundary/error paths, test quality, security and regression risk. Do not modify production code, tests, requirements or any file except the review report.'
      : '审查需求覆盖、边界/错误路径、测试质量、安全和回归风险。除审查报告外，不要修改任何文件。',
    en
      ? 'Write requirements/changes/<change>/review-report.md with verdict: pass|fail, blocking items and non_blocking items.'
      : '写 requirements/changes/<change>/review-report.md，包含 verdict: pass|fail、blocking 和 non_blocking。',
  ].join('\n');

  let outcome;
  try {
    outcome = await runner({
      prompt,
      cwd: worktree.path,
      role: 'reviewer',
      parent,
      task: { id: `review-${change}` },
    });
    if (outcome?.ok === false) {
      return { ok: false, text: outcome.text || 'reviewer Agent 失败', worktree, branch: worktree.branch };
    }
    const text = readIfExists(reviewReportPath(worktree.path, change));
    if (!text) return { ok: false, text: 'reviewer Agent 未生成 review-report.md', worktree, branch: worktree.branch };
    ensureDir(path.dirname(reviewReportPath(projectRoot, change)));
    writeFile(reviewReportPath(projectRoot, change), text);
    const validation = validateReviewReport(projectRoot, change);
    return {
      ok: validation.ok,
      text: validation.ok ? '代码审查通过' : validation.reason,
      report: reviewReportPath(projectRoot, change),
      worktree,
      branch: worktree.branch,
    };
  } finally {
    if (useWorktree && worktree.path && worktree.path !== projectRoot) {
      removeWorktree(projectRoot, worktree.path);
    }
  }
}

const DOCTOR_GROUPS = [
  {
    name: '结构 / 配置 / Git',
    nameEn: 'Structure / config / Git',
    prompt:
      '只读检查 SpecGate 项目的 .specgate/ 结构、config.yaml、openspec/ 目录与 Git 状态。不要修改任何文件。',
    promptEn:
      'Read-only check of the .specgate/ structure, config.yaml, openspec/ directories and Git state. Do not modify any file.',
  },
  {
    name: '门控 / Artifact',
    nameEn: 'Gates / artifacts',
    prompt:
      '只读检查 SpecGate 门控标记与 openspec/changes 下 proposal/design/specs/tasks 是否矛盾。不要修改任何文件。',
    promptEn:
      'Read-only check for contradictions between SpecGate gate markers and proposal/design/specs/tasks under openspec/changes. Do not modify any file.',
  },
  {
    name: '偏离 / 幂等 / 锁',
    nameEn: 'Deviations / idempotency / locks',
    prompt:
      '只读检查 .specgate/deviations.log 格式、.specgate/state/idempotency.json 与 stale lock。不要修改任何文件。',
    promptEn:
      'Read-only check of .specgate/deviations.log, .specgate/state/idempotency.json and stale locks. Do not modify any file.',
  },
  {
    name: 'Skill / Agent / 文档',
    nameEn: 'Skills / agents / docs',
    prompt:
      '只读检查 .dsh/skills/specgate 的 30 个 Skill、.specgate/agents 的 10 个 Agent 与 AGENTS.md 是否完整。不要修改任何文件。',
    promptEn:
      'Read-only check that .dsh/skills/specgate has 30 skills, .specgate/agents has 10 agents, and AGENTS.md is complete. Do not modify any file.',
  },
];

function doctorPrompt(group, language = 'zh') {
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  return [
    en ? `SpecGate health dimension: ${group.nameEn || group.name}` : `SpecGate 体检维度：${group.name}`,
    en ? group.promptEn || group.prompt : group.prompt,
    '',
    en
      ? 'Return only one JSON object, without Markdown fences:'
      : '只返回一个 JSON 对象，不要 Markdown 代码围栏：',
    '{"checks":[{"name":"...","ok":true,"detail":"..."}],"issues":[{"level":"error|warn","code":"...","message":"...","fix":"..."}]}',
  ].join('\n');
}

function parseDoctorJson(text) {
  const source = String(text || '');
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(source.slice(start, end + 1));
    return {
      checks: Array.isArray(value.checks) ? value.checks : [],
      issues: Array.isArray(value.issues) ? value.issues : [],
    };
  } catch {
    return null;
  }
}

/**
 * Multi-agent doctor: four read-only reviewer agents inspect independent
 * dimensions, then the results are merged. If the composition cannot start
 * agents, the local deterministic doctor is used instead.
 */
export async function runDoctorParallel({ root, parent, runner, maxConcurrency = 4, language = 'zh' }) {
  if (typeof runner !== 'function') return runDoctor(root);

  // Keep the deterministic local report as the baseline; agent checks augment
  // it so a malformed or partial agent answer can never hide a local issue.
  const local = runDoctor(root);
  const outcomes = await mapLimit(DOCTOR_GROUPS, maxConcurrency, async (group) => {
    const outcome = await runner({
      prompt: doctorPrompt(group, language),
      cwd: path.resolve(root),
      role: 'reviewer',
      parent,
      task: { id: `doctor-${group.name}` },
    });
    return { group, outcome };
  });

  const agentChecks = [];
  const agentIssues = [];
  for (const { group, outcome } of outcomes) {
    const parsed = outcome?.ok ? parseDoctorJson(outcome.text) : null;
    if (parsed) {
      agentChecks.push(...parsed.checks);
      agentIssues.push(...parsed.issues);
    } else {
      agentChecks.push({
        name: `doctor-agent:${group.name}`,
        ok: false,
        detail: outcome?.text || (String(language || 'zh').toLowerCase().startsWith('en') ? 'agent returned no result' : 'agent 未返回结果'),
      });
    }
  }

  const checks = [...local.checks, ...agentChecks];
  const issues = [...local.issues, ...agentIssues];
  return {
    ...local,
    ok: issues.every((item) => item.level !== 'error'),
    checks,
    issues,
    parallel: true,
  };
}

export function renderDispatch(report, language = 'zh') {
  const en = String(language || 'zh').toLowerCase().startsWith('en');
  const lines = [en ? `SpecGate parallel dispatch: ${report.change}` : `SpecGate 并行派发：${report.change}`];
  if (report.planOnly) {
    lines.push(en ? 'Mode: plan only (nothing executed)' : '模式：仅计划（未执行）');
    for (let index = 0; index < report.waves.length; index += 1) {
      lines.push(
        en
          ? `  Wave ${index + 1}: ${report.waves[index].map((task) => task.id).join(', ')}`
          : `  波次 ${index + 1}：${report.waves[index].map((task) => task.id).join('、')}`,
      );
    }
    return lines.join('\n');
  }
  if (report.downgraded) {
    lines.push(
      en
        ? `Downgraded: serial single writer (${report.downgradeReason || 'no Git or dirty worktree'})`
        : `降级：串行单写者（${report.downgradeReason || '无 Git 或工作区不干净'}）`,
    );
  }
  const done = report.results.filter((item) => item.ok && !item.skipped).length;
  const skipped = report.results.filter((item) => item.skipped).length;
  const failed = report.results.filter((item) => !item.ok).length;
  lines.push(
    en
      ? `Result: ${done} succeeded | ${skipped} skipped | ${failed} failed`
      : `结果：成功 ${done} ｜ 跳过 ${skipped} ｜ 失败 ${failed}`,
  );
  for (const item of report.results) {
    const state = item.skipped ? (en ? 'skipped' : '跳过') : item.ok ? (en ? 'ok' : '成功') : en ? 'failed' : '失败';
    lines.push(`  [${state}] ${item.task.id} ${item.task.title}`);
    if (item.commit) lines.push(`        commit: ${String(item.commit).slice(0, 12)}`);
    if (item.text) lines.push(`        ${String(item.text).split(/\r?\n/).slice(0, 3).join(' / ')}`);
  }
  if (report.conflicts.length > 0) {
    lines.push(en ? 'Merge conflicts (merge stopped; worktrees/branches preserved):' : '合并冲突（已停止合并，worktree/分支保留）：');
    for (const conflict of report.conflicts) {
      lines.push(`  ${conflict.task} ${conflict.branch}`);
      if (conflict.conflicts?.length) lines.push(`    ${conflict.conflicts.join(', ')}`);
    }
  }
  return lines.join('\n');
}

export function writeDispatchReport(root, report, language = 'zh') {
  const dir = path.join(path.resolve(root), '.specgate', 'reports');
  ensureDir(dir);
  const ignore = path.join(dir, '.gitignore');
  if (!exists(ignore)) writeFile(ignore, '*\n');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}-dispatch-${report.change}.md`);
  writeFile(file, `${renderDispatch(report, language)}\n`);
  return file;
}
