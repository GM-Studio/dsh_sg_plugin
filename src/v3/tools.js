import { createChange } from './change.js';
import { renderStatusAt, statusJsonAt, resolveRepoPath, loadProjectAt } from './status-query.js';
import { renderStatus } from './status.js';
import { exists } from './util/fsx.js';
import { scanEnv, writeEnvReport } from './env-scan.js';
import { ensureToolchain } from './toolchain.js';
import { headCommit, isGitRepo } from './util/git.js';
import { checkM1, checkM2, checkFrozenH1, computeArtifactHash, collectKnownAcs } from './phase.js';
import { load, patchState } from './state.js';
import { askApproval, issueApproval, checkApprovalHash } from './approvals.js';
import { renderGatePages } from './gate-card.js';
import {
  commitChangePackage,
  ensureIntegration,
  git,
  headOf,
  integrationBranch,
} from './worktrees.js';
import { createDispatcher } from './dispatch.js';
import { maybeBuildBootstrap } from './bootstrap.js';
import { startJavaInit, resolveJavaInitRoot, summarizeJavaInit } from '../v4/java-init.js';
import { JAVA_PRESETS } from '../v4/java-versions.js';
import { verifyJavaProject } from '../v4/java-verify.js';
import { resolveInitRoot, shouldUseV4Default, startV4Init, summarizeV4Result } from '../v4/init.js';
import { adoptWorkspace, summarizeAdopt } from '../v4/adopt.js';
import { readWorkspace } from '../v4/workspace.js';
import { driveWorkspace, summarizeDrive } from '../v4/drive.js';
import {
  finalizeWorkspaceChange,
  prepareWorkspaceChange,
  startWorkspaceChange,
  summarizeFinalize,
  summarizeWorkspaceChange,
} from '../v4/workspace-change.js';
import { appendRun } from './runs.js';
import {
  collectDiff,
  validateReview,
  createReviewWorktree,
  removeReviewWorktree,
} from './review.js';
import { executeTask, revertWave } from './executor.js';
import { readyBatch } from './scheduler.js';
import { discoverCommand, loadPlan } from './plan.js';
import { runAllSuites, persistRuntime } from './suites.js';
import {
  finishInitProject,
  gitInitCommit,
  inspectInit,
  startRequirementsInit,
  summarizeInitResult,
} from './init.js';
import { poolDisposeChange } from './pool.js';
import { generateAcceptance } from './acceptance.js';
import { verifyEvidence, appendEvidence } from './evidence.js';
import { digest } from './util/hash.js';
import { archiveChange, nextTag } from './archive.js';
import { loadSkill, loadSkillPayload, suggestForPhase } from './skills.js';
import { acquire, release } from './lock.js';
import fs from 'node:fs';
import path from 'node:path';

function textOutput() {
  return {
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        data: { type: 'object', additionalProperties: true },
      },
      required: ['text'],
      additionalProperties: false,
    },
    render(args, value) {
      return [{ type: 'text', text: String(value?.text ?? '') }];
    },
  };
}

function ok(text, data) {
  return data === undefined ? { text } : { text, data };
}

function fail(text, data) {
  return data === undefined ? { text } : { text, data };
}

export function ensureV3(project) {
  if (!project.config) {
    return {
      ok: false,
      code: 'NOT_INITIALIZED',
      message: '项目未初始化',
      fix: '先执行 /sg-init',
    };
  }
  const version = Number(project.config.workflowVersion);
  if (!Number.isFinite(version) || version < 3) {
    return {
      ok: false,
      code: 'WORKFLOW_VERSION_MISMATCH',
      message: `项目 workflowVersion=${project.config.workflowVersion}，v3 拒绝写入`,
      fix: 'v3 不能接管旧项目；请先迁移或换一个干净目录',
    };
  }
  return { ok: true };
}

function formatErrors(errors) {
  return errors.map((item) => `- ${item}`).join('\n');
}

/** 老项目接入时由 SpecGate 自己生成、因而可以安全提交的路径（REQ-010）。 */
const LEGACY_GENERATED_PATHS = [
  'openspec/REQ.md',
  'openspec/history',
  'openspec/specs/.gitkeep',
  'openspec/changes/.gitkeep',
  '.specgate/config.yaml',
  '.gitignore',
  'docs/requirements-scan.md',
];

export function registerTools(ctx, runtime) {
  const disposers = [];
  const definitions = [
    {
      name: 'sg_init',
      description:
        '初始化 Java/Vue 全栈：sg_init({ path?, version? }) 仅接受完全空目录；只生成代码、req v1.0 与 Git 基线，不安装、不编译、不启动 agent；可选版本档 jdk8-boot2.7 / jdk17-boot3.5 / jdk21-boot3.5 / jdk21-boot4.0；' +
        '省略 path 时使用当前目录，支持相对/绝对路径（Windows/Linux/macOS）。' +
        'v3 兼容：sg_init({ req, description, draft }) 走需求先行流程；--v3 可强制。',
      parameters: {
        type: 'object',
        properties: {
          req: {
            type: 'string',
            description: '本地需求文档路径（Markdown/文本，相对项目根或绝对路径）',
          },
          description: { type: 'string', description: '自由描述；缺少的维度由 Agent 逐维追问' },
          draft: {
            type: 'object',
            additionalProperties: true,
            description:
              '结构化需求草稿：functional/nonFunctional/constraints/acceptance/context 等',
          },
          path: {
            type: 'string',
            description: '目标仓库/工作区路径；相对路径按当前目录解析，支持绝对路径与 ~',
          },
          v4: { type: 'boolean', description: '兼容参数，默认生成 Java/Vue monorepo' },
          adopt: { type: 'boolean', description: '原地接入存量仓库' },
          v3: { type: 'boolean', description: '强制走 v3 单仓流程' },
          backend: { type: 'string', description: 'v4 后端：node/python/java/none' },
          frontend: { type: 'string', description: 'v4 前端：vue/react/none' },
          preset: { type: 'string', description: 'v4 预设：node-fullstack 等' },
          version: {
            type: 'string',
            enum: JAVA_PRESETS.map((item) => item.id),
            description:
              'Java 版本档：jdk8-boot2.7 / jdk17-boot3.5 / jdk21-boot3.5 / jdk21-boot4.0',
          },
        },
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const cwd = runtime.getCwd(exec?.agent);
        const userQuestions = runtime.service('userQuestions');
        const input = args && typeof args === 'object' ? args : {};
        if (input.v3 && input.adopt)
          return fail('初始化失败（E_ARGS_CONFLICT）：v3 与 adopt 不能同时使用', {
            code: 'E_ARGS_CONFLICT',
          });
        if (!input.v3 && !input.adopt) {
          const result = await startJavaInit({
            ...input,
            root: resolveJavaInitRoot(cwd, input.path),
            userQuestions,
            agent: exec?.agent,
            signal: exec?.signal,
          });
          return result.ok
            ? ok(summarizeJavaInit(result), result)
            : fail(summarizeJavaInit(result), result);
        }
        const resolved = resolveInitRoot(cwd, input.path, { create: input.adopt !== true });
        if (!resolved.ok)
          return fail('初始化失败（' + resolved.code + '）：' + resolved.message, resolved);
        const root = resolved.root;
        if (input.req && (input.description || input.draft)) {
          return fail(
            '初始化失败（E_ARGS_CONFLICT）：-req 与自由描述/草稿不能同时使用；未写入任何文件。',
            {
              code: 'E_ARGS_CONFLICT',
            },
          );
        }
        if (input.description && input.draft) {
          return fail(
            '初始化失败（E_ARGS_CONFLICT）：description 与 draft 不能同时使用；未写入任何文件。',
            {
              code: 'E_ARGS_CONFLICT',
            },
          );
        }
        if (
          input.draft !== undefined &&
          (input.draft === null || typeof input.draft !== 'object')
        ) {
          return fail('初始化失败（E_DRAFT_INCOMPLETE）：draft 必须是对象；未写入任何文件。', {
            code: 'E_DRAFT_INCOMPLETE',
          });
        }

        if (input.adopt === true) {
          const adopted = adoptWorkspace({ root });
          if (!adopted.ok) return fail(summarizeAdopt(adopted), adopted);
          return ok(summarizeAdopt(adopted), adopted);
        }

        if (
          !input.v3 &&
          (input.v4 === true || shouldUseV4Default(root, { v3: input.v3 === true }))
        ) {
          const v4 = await startV4Init({
            root,
            userQuestions,
            agent: exec?.agent,
            signal: exec?.signal,
            backend: input.backend || null,
            frontend: input.frontend || null,
            preset: input.preset || null,
          });
          if (!v4.ok) return fail(summarizeV4Result(v4), v4);
          return ok(summarizeV4Result(v4), v4);
        }

        const guard = inspectInit(root);
        if (guard.skip) {
          const skipped = { ...guard, ok: true, skipped: true };
          return ok(summarizeInitResult(skipped), skipped);
        }

        let result = await startRequirementsInit({
          root,
          userQuestions,
          agent: exec?.agent,
          signal: exec?.signal,
          req: input.req || null,
          description: input.description || '',
          draft: input.draft || null,
        });
        if (!result.ok) return fail(summarizeInitResult(result), result);
        const built = await maybeBuildBootstrap({
          root,
          result,
          runtime,
          agent: exec?.agent,
        });
        if (!built.ok) return fail(summarizeInitResult(built), built);
        if (built.result) result = built.result;
        if (built.skipped && built.reason) result = { ...result, autoBuildSkipped: built.reason };
        return ok(summarizeInitResult(result), result);
      },
    },
    {
      name: 'sg_verify',
      description:
        '本地验证 Java/Vue 初始化项目：先跨平台扫描并预检 JDK/Maven/Node（环境变量、PATH、常见安装目录），缺失时按需下载到项目 .specgate/toolchains，再执行后端 mvn verify 与前端 npm install/build/test/lint/format:check，随后启动后端、HTTP CRUD、重启持久化；通过后状态为 SMOKE_PASSED，可创建 change。只读源码，不自动修复。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '项目根目录，默认当前目录' },
          javaHome: { type: 'string', description: '自定义 JDK 安装根目录' },
          mavenHome: { type: 'string', description: '自定义 Maven 安装根目录' },
          install: {
            type: 'boolean',
            description:
              '缺少 JDK 8/17/21 或 Maven 时先询问自定义路径，再自动下载到项目内（默认 true）；false 时禁止下载安装',
          },
        },
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const root = resolveJavaInitRoot(runtime.getCwd(exec?.agent), args?.path);
        const result = await verifyJavaProject({
          root,
          install: args?.install !== false,
          signal: exec?.signal,
          userQuestions: runtime.service('userQuestions'),
          agent: exec?.agent,
          javaHome: args?.javaHome,
          mavenHome: args?.mavenHome,
        });
        return result.ok ? ok(result.message, result) : fail(result.message, result);
      },
    },
    {
      name: 'sg_change',
      description:
        '创建 v3 change 包并进入 H1_PENDING。参数：name（kebab-case），type（feature|modify|fix|remove）。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['feature', 'modify', 'fix', 'remove'] },
          link: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const project = runtime.project(exec?.agent);
        const workspace = readWorkspace(project.root);
        if (workspace) {
          const prepared = await prepareWorkspaceChange({
            root: project.root,
            name: String(args?.name || ''),
            type: String(args?.type || 'feature'),
            userQuestions: runtime.service('userQuestions'),
            agent: exec?.agent,
            signal: exec?.signal,
          });
          if (!prepared.ok) return fail(prepared.message || prepared.code, prepared);
          const result = startWorkspaceChange({
            root: project.root,
            name: String(args?.name || ''),
            type: String(args?.type || 'feature'),
            requirements: prepared.requirements,
          });
          if (!result.ok) return fail(summarizeWorkspaceChange(result), result);
          return ok(summarizeWorkspaceChange(result), result);
        }
        const guard = ensureV3(project);
        if (!guard.ok) return fail(guard.message, guard);

        const baseCommit = isGitRepo(project.root) ? headCommit(project.root) : null;
        const result = createChange(project.root, {
          name: args?.name,
          type: args?.type || 'feature',
          baseCommit,
          changeKey: args?.link || null,
        });
        if (!result.ok) return fail(result.message, result);
        return ok(
          `已创建 change ${result.name}（${result.type}），阶段 H1_PENDING。下一步：写 proposal 与 specs delta，然后 /sg-run`,
          { change: result.name, type: result.type, phase: 'H1_PENDING', baseCommit },
        );
      },
    },
    {
      name: 'sg_status',
      description:
        '查看 SpecGate v3 状态。可选参数：path 指定仓库根（支持 Windows/POSIX 路径），json 输出 JSON，verbose 显示运行时间线。只读。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          json: { type: 'boolean' },
          verbose: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const cwd = runtime.getCwd(exec?.agent);
        if (!args?.path && !exists(cwd + '/.specgate/state.json')) {
          const project = { root: cwd, state: null, config: {} };
          const data = statusJsonAt(project, { verbose: false });
          return ok(args?.json ? JSON.stringify(data, null, 2) : renderStatus(project), data);
        }
        const resolved = resolveRepoPath(cwd, args?.path);
        if (!resolved.ok) return fail(`${resolved.code}：${resolved.message}`);
        const loaded = loadProjectAt(resolved.root);
        if (!loaded.ok) return fail(`${loaded.code || 'STATE_INVALID'}：${loaded.message}`);
        const data = statusJsonAt(loaded.project, { verbose: Boolean(args?.verbose) });
        const text = args?.json
          ? JSON.stringify(data, null, 2)
          : renderStatusAt(loaded.project, { verbose: Boolean(args?.verbose) });
        return ok(text, data);
      },
    },
    {
      name: 'sg_skill',
      description: '加载一个技能的正文，并把使用记录写入证据。参数：name（技能 id）。',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const id = String(args?.name || '').trim();
        const text = loadSkill(id);
        if (!text) {
          return fail(`未知技能：${id}`, {
            ok: false,
            code: 'SKILL_NOT_FOUND',
            fix: '用技能目录中的 id，例如 sp-skill-brainstorming',
          });
        }
        const project = runtime.project(exec?.agent);
        if (project.state) {
          appendEvidence(project.root, project.state.change || 'project', {
            event: 'skill',
            decision: 'loaded',
            refs: { skill: id },
          });
        }
        return ok(text, { skill: id });
      },
    },
    {
      name: 'sg_run',
      description:
        '推进 SpecGate v3 一个阶段：校验 M1/M2、执行任务或做集成回归。不接收命令、分支等覆盖参数。',
      parameters: {
        type: 'object',
        properties: {
          retry: { type: 'boolean' },
          force: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const project = runtime.project(exec?.agent);
        const workspace = readWorkspace(project.root);
        if (workspace) {
          const driven = await driveWorkspace({ root: project.root });
          if (!driven.ok) return fail(summarizeDrive(driven), driven);
          if (driven.results.some((item) => item.gate)) {
            return ok(
              summarizeDrive(driven) + '\n人工批准后再次执行 /sg-run；两侧归档后根自动收尾。',
              driven,
            );
          }
          const result = finalizeWorkspaceChange({ root: project.root });
          if (!result.ok) return fail(summarizeFinalize(result), result);
          return ok(summarizeFinalize(result), result);
        }
        const guard = ensureV3(project);
        if (!guard.ok) return fail(guard.message, guard);
        const state = project.state;
        if (!state) return fail('未找到状态文件，先执行 /sg-init', project.stateError);

        const acquired = acquire(project.root, { force: args?.force === true });
        if (!acquired.ok) return fail(`${acquired.message}。${acquired.fix || ''}`, acquired);

        try {
          switch (state.phase) {
            case 'IDLE':
              return ok('当前没有进行中的 change。先执行 /sg-change <name> --type <type>。');
            case 'H0_PENDING': {
              if (!state.h0?.hash) return fail('缺少 H0 上下文哈希');
              const frozen = checkApprovalHash(state, 'H0', state.h0.hash);
              if (!frozen.ok)
                return fail(
                  'H0 尚未批准或上下文已变化，请先调用 sg_approve 工具（gate="H0"）',
                  frozen,
                );
              const finished = await finishInitProject({ root: project.root, state });
              if (!finished.ok) return fail(`初始化失败：${finished.message}`, finished);
              return ok(
                'H0 已批准，已生成脚手架与首个 change，进入 H1_PENDING。下一步 /sg-run 校验 M1。',
                finished,
              );
            }
            case 'H1_PENDING': {
              const m1 = checkM1({ root: project.root, state });
              if (!m1.ok) return fail(`M1 未通过：\n${formatErrors(m1.errors)}`, m1);
              const suggested = suggestForPhase('H1_PENDING');
              patchState(project.root, (draft) => {
                draft.skills.suggested = suggested;
              });
              return ok(
                `M1 通过。请审阅 delta 后执行 /sg-approve H1。\n建议加载技能：${suggested.join('、')}`,
                { m1, suggested },
              );
            }
            case 'PLAN': {
              const m2 = checkM2({ root: project.root, state, config: project.config });
              if (!m2.ok) return fail(`M2 未通过：\n${formatErrors(m2.errors)}`, m2);
              writeEnvReport(project.root, scanEnv(project.root));
              try {
                const dirty = git(project.root, [
                  'status',
                  '--porcelain',
                  '--',
                  '.specgate/env.json',
                  '.specgate/env-report.md',
                ]).trim();
                if (dirty) {
                  git(project.root, ['add', '.specgate/env.json', '.specgate/env-report.md']);
                  git(project.root, ['commit', '-q', '-m', `env(${state.change}): 环境扫描`]);
                }
              } catch {
                // env report is best-effort; keep the plan flow unblocked
              }
              const saved = patchState(project.root, (draft) => {
                draft.plan = {
                  designHash: m2.hashes.designHash,
                  casesHash: m2.hashes.casesHash,
                  mappingHash: m2.hashes.mappingHash,
                  touchedHash: m2.hashes.touchedHash,
                  planHash: m2.planHash,
                  cmdHash: m2.cmdHash,
                  argv: m2.command.argv,
                  cwd: m2.command.cwd,
                  suites: m2.suites.map((suite) => ({
                    id: suite.id,
                    kind: suite.kind,
                    argv: suite.argv,
                    cwd: suite.cwd,
                    pytestArgs: suite.pytestArgs,
                    python: suite.python,
                    node: suite.node,
                    jdk: suite.jdk,
                    buildTool: suite.buildTool,
                    goals: suite.goals,
                    reportGlob: suite.reportGlob,
                    jacocoGlob: suite.jacocoGlob,
                    install: suite.install,
                    cmdHash: suite.cmdHash,
                  })),
                  approvedAt: null,
                };
                draft.tasks = Object.fromEntries(
                  m2.plan.tasks.map((task) => [
                    task.id,
                    {
                      id: task.id,
                      title: task.title,
                      ac: task.ac,
                      deps: task.deps,
                      parallel: task.parallel,
                      status: 'pending',
                      attempts: 0,
                      commit: null,
                      review: null,
                      evidence: [],
                    },
                  ]),
                );
                draft.touched = {
                  modify: m2.plan.touched?.modify || [],
                  delete: m2.plan.touched?.delete || [],
                  bootstrap: m2.plan.touched?.bootstrap || [],
                };
                draft.phase = 'H2_PENDING';
              });
              if (!saved.ok) return fail(`冻结计划失败：${saved.message}`, saved);
              const suggested = suggestForPhase('PLAN');
              return ok(
                `M2 通过，已冻结 planHash ${String(m2.planHash).slice(0, 19)}…。请审阅方案后执行 /sg-approve H2。\n建议加载技能：${suggested.join('、')}`,
                { m2, suggested },
              );
            }
            case 'H2_PENDING':
              return ok('等待人执行 /sg-approve H2。');
            case 'EXECUTING': {
              const maxParallel = Math.max(
                1,
                Math.min(4, Number(project.config?.maxParallel) || 2),
              );
              const info = readyBatch(state, maxParallel);
              if (info.done) {
                const moved = patchState(project.root, (draft) => {
                  draft.phase = 'INTEGRATING';
                });
                if (!moved.ok) return fail(moved.message, moved);
                return ok('所有任务已合并，进入 INTEGRATING。请再次 /sg-run 执行全量回归。');
              }
              if (info.batch.length === 0) {
                return fail('没有可执行任务：依赖未满足或任务已阻塞');
              }

              const dispatcher = createDispatcher(runtime);
              const results = await Promise.all(
                info.batch.map(async (taskId) => {
                  const task = state.tasks[taskId];
                  const result = await executeTask({
                    root: project.root,
                    state,
                    task,
                    dispatcher,
                    config: project.config,
                    parent: exec?.agent,
                  });
                  return { taskId, result, attempts: (task.attempts || 0) + 1 };
                }),
              );

              let lastError = null;
              const saved = patchState(project.root, (draft) => {
                for (const { taskId, result, attempts } of results) {
                  const item = draft.tasks[taskId];
                  if (result.ok) {
                    item.status = 'merged';
                    item.attempts = attempts;
                    item.commit = result.commit;
                    draft.evidence = {
                      headSeq: result.evidence.seq,
                      headHash: result.evidence.hash,
                    };
                  } else {
                    const isBlocked = attempts >= 3;
                    item.status = isBlocked ? 'blocked' : 'failed';
                    item.attempts = attempts;
                    lastError = `任务 ${taskId} 第 ${attempts} 次失败：${result.message}`;
                    if (isBlocked) {
                      draft.phase = 'BLOCKED';
                      draft.resumePhase = 'EXECUTING';
                      draft.blockedReason = lastError;
                    }
                  }
                }
              });
              if (!saved.ok) return fail(saved.message, saved);
              if (lastError) return fail(lastError, { results });

              const mergedIds = results.map(
                (item) => `${item.taskId}@${String(item.result.commit).slice(0, 8)}`,
              );
              return ok(`已合并：${mergedIds.join('、')}。继续 /sg-run 推进。`, {
                results: results.map((item) => ({
                  taskId: item.taskId,
                  commit: item.result.commit,
                })),
              });
            }
            case 'INTEGRATING': {
              const change = state.change;
              const integration = ensureIntegration(project.root, change, state.integration?.base);
              if (!integration.ok) return fail(integration.message, integration);

              const command = discoverCommand(project.root, project.config);
              const plan = loadPlan(project.root, change);
              const { deltaAcs, knownAcs } = collectKnownAcs({ root: project.root, state, change });
              const base = state.integration?.base;
              const changedFiles = base
                ? git(integration.path, ['diff', '--name-only', `${base}..HEAD`])
                    .split('\n')
                    .filter(Boolean)
                : [];
              const commit = headOf(integration.path, 'HEAD');

              const integrationToolchain = ensureToolchain({
                root: project.root,
                worktree: integration.path,
                change,
                task: { id: 'INTEGRATION' },
                stack: state.context?.stack || null,
              });
              if (!integrationToolchain.ok) {
                return fail(
                  `集成环境安装失败：${integrationToolchain.message}`,
                  integrationToolchain,
                );
              }
              const suitesResult = runAllSuites({
                root: project.root,
                state,
                worktree: integration.path,
                plan,
                knownAcs,
                changedFiles,
                fallbackCommand: command.ok ? command : null,
              });
              persistRuntime(project.root, suitesResult.results);
              if (!suitesResult.ok) {
                const reverted = revertWave({
                  root: project.root,
                  state,
                  waveStart: state.integration?.base,
                });
                patchState(project.root, (draft) => {
                  for (const id of reverted.reverted || []) {
                    draft.tasks[id].status = 'reverted';
                    draft.tasks[id].attempts = (draft.tasks[id].attempts || 0) + 1;
                  }
                  draft.phase = 'EXECUTING';
                  draft.blockedReason = `集成回归失败：suite ${suitesResult.failedSuite} ${suitesResult.message}`;
                });
                return fail(
                  `集成回归失败（suite ${suitesResult.failedSuite}）：${suitesResult.message}，已回退到波前：${(reverted.reverted || []).join('、')}`,
                  { suitesResult, reverted },
                );
              }

              const reviewDiff = collectDiff({ cwd: integration.path, base, head: commit });
              const reviewWt = createReviewWorktree({
                root: project.root,
                change,
                commit,
              });
              const reviewPath = reviewWt.ok ? reviewWt.path : integration.path;
              const reviewDispatcher = createDispatcher(runtime);
              let integrationReview;
              try {
                integrationReview = await reviewDispatcher({
                  role: 'reviewer',
                  task: { id: 'INTEGRATION', title: '集成审查', ac: [...deltaAcs] },
                  worktree: reviewPath,
                  root: project.root,
                  change,
                  prompt: [
                    `审查 change ${change} 的集成结果。`,
                    `AC: ${[...deltaAcs].join(', ')}`,
                    `diff ${reviewDiff.range}（${reviewDiff.bytes} bytes${reviewDiff.truncated ? '，已截断但文件清单完整' : ''}）`,
                    '文件清单：',
                    ...reviewDiff.fileList,
                    '完整 diff：',
                    reviewDiff.text,
                    'blocking 必须包含 file/line/evidence/reason，evidence 必须能在 diff 或测试输出中找到。',
                    '只输出 JSON：{"verdict":"pass|fail","blocking":[{"file":"","line":0,"evidence":"","reason":""}],"nonBlocking":[]}',
                  ].join('\n'),
                  skills: loadSkillPayload({ role: 'reviewer' }),
                  parent: exec?.agent,
                });
              } finally {
                if (reviewWt.ok) removeReviewWorktree({ root: project.root, path: reviewWt.path });
              }
              appendRun(project.root, {
                change,
                task: 'INTEGRATION',
                role: 'reviewer',
                worktree: reviewPath,
                commit,
                durationMs: 0,
                result: integrationReview?.ok ? 'pass' : 'fail',
              });
              const reviewDir = path.join(
                integration.path,
                'openspec',
                'changes',
                change,
                'reviews',
              );
              fs.mkdirSync(reviewDir, { recursive: true });
              let integrationVerdict = null;
              let reviewErrors = [];
              if (integrationReview?.ok) {
                try {
                  const raw = String(integrationReview.text || '');
                  const start = raw.indexOf('{');
                  const end = raw.lastIndexOf('}');
                  integrationVerdict = start >= 0 ? JSON.parse(raw.slice(start, end + 1)) : null;
                } catch {
                  integrationVerdict = null;
                }
                if (!integrationVerdict) {
                  reviewErrors = ['reviewer 未返回合法 JSON'];
                } else {
                  const checked = validateReview(
                    integrationVerdict,
                    reviewDiff,
                    suitesResult.message || '',
                  );
                  reviewErrors = checked.errors;
                  if (
                    checked.ok &&
                    (integrationVerdict.verdict !== 'pass' || checked.blocking.length > 0)
                  ) {
                    reviewErrors = [
                      `reviewer 判定 ${integrationVerdict.verdict}，blocking ${checked.blocking.length} 项`,
                    ];
                  }
                }
              } else {
                reviewErrors = [integrationReview?.message || 'reviewer 调用失败'];
              }
              fs.writeFileSync(
                path.join(reviewDir, 'integration.json'),
                `${JSON.stringify(
                  {
                    verdict: integrationVerdict,
                    errors: reviewErrors,
                    at: new Date().toISOString(),
                  },
                  null,
                  2,
                )}\n`,
                'utf8',
              );
              git(integration.path, ['add', 'openspec/changes']);
              git(integration.path, ['commit', '-q', '-m', `review(${change}): 集成审查`]);
              if (reviewErrors.length > 0) {
                patchState(project.root, (draft) => {
                  draft.blockedReason = `集成审查未通过：${reviewErrors.join('; ')}`;
                });
                return fail(`集成审查未通过：${reviewErrors.join('; ')}`, {
                  verdict: integrationVerdict,
                  errors: reviewErrors,
                });
              }

              const combinedReport = {
                schemaVersion: 1,
                cases: suitesResult.results.flatMap((item) => item.report?.cases || []),
              };

              const headEvidence = verifyEvidence(project.root, change);
              const acceptance = generateAcceptance({
                change,
                type: state.type,
                changeKey: state.changeKey || null,
                acs: deltaAcs,
                report: combinedReport,
                exitCode: 0,
                evidence: headEvidence,
                commit,
                validator: 'builtin',
              });
              const acceptanceFile = path.join(
                integration.path,
                'openspec',
                'changes',
                change,
                'acceptance.md',
              );
              fs.mkdirSync(path.dirname(acceptanceFile), { recursive: true });
              fs.writeFileSync(acceptanceFile, acceptance.text, 'utf8');
              git(integration.path, ['add', 'openspec/changes']);
              git(integration.path, ['commit', '-q', '-m', `acceptance(${change}): 生成验收报告`]);
              const finalCommit = headOf(integration.path, 'HEAD');

              const evidence = appendEvidence(project.root, change, {
                event: 'acceptance',
                decision: 'pass',
                refs: { commit: finalCommit, validator: 'builtin' },
              });
              const saved = patchState(project.root, (draft) => {
                draft.phase = 'H3_PENDING';
                draft.blockedReason = null;
                draft.integration = { ...draft.integration, lastGreen: finalCommit };
                draft.acceptanceHash = digest(acceptance.text);
                draft.evidence = { headSeq: evidence.seq, headHash: evidence.hash };
              });
              if (!saved.ok) return fail(saved.message, saved);
              return ok(
                `集成回归通过，验收报告已生成（${deltaAcs.size} 个 AC），integration commit ${String(finalCommit).slice(0, 8)}。请审阅后执行 /sg-approve H3。`,
                { acceptance: acceptance.rows, commit: finalCommit },
              );
            }
            case 'H3_PENDING':
              return ok('等待人执行 /sg-approve H3。');
            case 'ARCHIVING': {
              const tag = nextTag(project.root);
              const result = archiveChange({
                root: project.root,
                change: state.change,
                integrationBranch: state.integration?.branch,
                tag,
                evidenceHead: state.evidence?.headHash,
              });
              if (!result.ok) {
                patchState(project.root, (draft) => {
                  draft.phase = 'BLOCKED';
                  draft.resumePhase = 'ARCHIVING';
                  draft.blockedReason = `归档失败：${result.message}`;
                });
                return fail(`归档失败：${result.message}`, result);
              }
              await poolDisposeChange(project.root, state.change);
              const evidence = appendEvidence(project.root, state.change, {
                event: 'archive',
                decision: 'done',
                refs: { tag: result.tag, commit: headOf(project.root, 'HEAD') },
              });
              const saved = patchState(project.root, (draft) => {
                draft.phase = 'DONE';
                draft.blockedReason = null;
                draft.evidence = { headSeq: evidence.seq, headHash: evidence.hash };
              });
              if (!saved.ok) return fail(saved.message, saved);
              return ok(
                `归档完成：tag ${result.tag}，specs 已更新，change 已移动到 openspec/changes/archive/。`,
                result,
              );
            }
            case 'BLOCKED': {
              if (!args?.retry) {
                return ok(
                  `已阻塞：${state.blockedReason || '未知原因'}。处理后可执行 /sg-run --retry。`,
                );
              }
              const resumePhase = state.resumePhase || 'EXECUTING';
              const saved = patchState(project.root, (draft) => {
                draft.phase = resumePhase;
                draft.blockedReason = null;
                if (resumePhase === 'EXECUTING') {
                  for (const item of Object.values(draft.tasks || {})) {
                    if (item.status === 'blocked' || item.status === 'failed') {
                      item.status = 'pending';
                      item.attempts = 0;
                    }
                  }
                }
              });
              if (!saved.ok) return fail(saved.message, saved);
              return ok(`已从 BLOCKED 恢复到 ${resumePhase}，继续 /sg-run。`);
            }
            case 'DONE':
              return ok('change 已完成。');
            case 'ABORTED':
              return ok('change 已中止。');
            default:
              return fail(`未知阶段：${state.phase}`);
          }
        } finally {
          release(project.root);
        }
      },
    },
    {
      name: 'sg_approve',
      description:
        '人类批准 H0/H1/H2/H3。工具内部通过宿主问答询问用户；无用户应答则拒绝，模型无法自签。',
      parameters: {
        type: 'object',
        properties: {
          gate: { type: 'string', enum: ['H0', 'H1', 'H2', 'H3'] },
        },
        required: ['gate'],
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const project = runtime.project(exec?.agent);
        const guard = ensureV3(project);
        if (!guard.ok) return fail(guard.message, guard);
        const state = project.state;
        if (!state) return fail('未找到状态文件，先执行 /sg-init', project.stateError);

        const gate = String(args?.gate || '').toUpperCase();
        if (!['H0', 'H1', 'H2', 'H3'].includes(gate)) {
          return fail(`未知批准点：${gate}`);
        }
        // H0 发生在新项目脚手架生成之前：此时 state.change 仍为 null。
        if (gate !== 'H0' && !state.change) return fail('没有进行中的 change');

        if (gate === 'H0') {
          if (state.phase !== 'H0_PENDING') {
            if (state.phase === 'H1_PENDING' && state.h0?.approvedAt) {
              return ok('H0 已在初始化确认页批准（确认页即 H0），无需重复批准。', {
                gate: 'H0',
                phase: state.phase,
                approvedAt: state.h0.approvedAt,
              });
            }
            return fail(`当前阶段 ${state.phase} 不能批准 H0`);
          }
          if (!state.h0?.hash) return fail('缺少 H0 上下文哈希');
          const asked = await askApproval(runtime, {
            gate: 'H0',
            change: state.change || 'new-project',
            artifactHash: state.h0.hash,
            agent: exec?.agent,
            signal: exec?.signal,
            pages: renderGatePages({ gate: 'H0', root: project.root, state }).pages,
          });
          if (!asked.ok) return fail(asked.message, asked);
          const saved = patchState(project.root, (draft) => {
            issueApproval(draft, 'H0', state.h0.hash, asked.at);
          });
          if (!saved.ok) return fail(saved.message, saved);
          const legacy = state.mode === 'existing' || !state.context?.stack;
          if (legacy) {
            const current = load(project.root).state;
            const finished = await finishInitProject({
              root: project.root,
              state: current,
              gitOnly: true,
            });
            if (!finished.ok) return fail(finished.message, finished);
            // 老项目只提交本次生成的需求资产，绝不提交既有工作树（REQ-010）。
            const committed = gitInitCommit(project.root, 'chore: 接入 SpecGate 需求基线', {
              gitOnly: true,
              commitPaths: LEGACY_GENERATED_PATHS,
            });
            if (!committed.ok) return fail(`git 提交失败：${committed.stderr}`, committed);
            return ok(
              'H0 已批准。已写入需求基线 openspec/REQ.md，会进入 H1_PENDING；' +
                '老项目未生成脚手架。下一步：/sg-change <name> --type feature 并在 proposal 中引用 REQ-xxx。',
              { gate: 'H0', phase: 'H1_PENDING', mode: 'existing', baseline: finished.baseline },
            );
          }
          return ok('H0 已批准，执行 /sg-run 生成脚手架与首个 change。', {
            gate: 'H0',
            phase: 'H0_PENDING',
          });
        }

        if (gate === 'H3') {
          if (state.phase !== 'H3_PENDING') {
            return fail(`当前阶段 ${state.phase} 不能批准 H3`);
          }
          const integration = ensureIntegration(
            project.root,
            state.change,
            state.integration?.base,
          );
          if (!integration.ok) return fail(integration.message, integration);
          const acceptanceFile = path.join(
            integration.path,
            'openspec',
            'changes',
            state.change,
            'acceptance.md',
          );
          if (!fs.existsSync(acceptanceFile)) {
            return fail('找不到 acceptance.md，请先执行 /sg-run 生成验收报告');
          }
          const text = fs.readFileSync(acceptanceFile, 'utf8');
          const hash = digest(text);
          if (state.acceptanceHash && state.acceptanceHash !== hash) {
            return fail('验收报告在生成后发生变化，请重新执行 /sg-run');
          }
          const evidence = verifyEvidence(project.root, state.change);
          if (!evidence.ok) {
            return fail(`证据链断裂：${evidence.message}`, evidence);
          }

          const asked = await askApproval(runtime, {
            gate,
            change: state.change,
            artifactHash: hash,
            agent: exec?.agent,
            signal: exec?.signal,
            pages: renderGatePages({ gate, root: project.root, state, integration }).pages,
          });
          if (!asked.ok) return fail(asked.message, asked);

          const saved = patchState(project.root, (draft) => {
            issueApproval(draft, gate, hash, asked.at);
            draft.phase = 'ARCHIVING';
          });
          if (!saved.ok) return fail(saved.message, saved);
          return ok(`H3 已批准，验收指纹 ${hash.slice(0, 19)}…。执行 /sg-run 完成归档。`, {
            gate,
            acceptanceHash: hash,
            phase: 'ARCHIVING',
          });
        }

        if (gate === 'H1') {
          if (state.phase !== 'H1_PENDING') {
            return fail(`当前阶段 ${state.phase} 不能批准 H1`);
          }

          const m1 = checkM1({ root: project.root, state });
          if (!m1.ok) return fail(`M1 未通过，不能批准：\n${formatErrors(m1.errors)}`, m1);

          const specsBase = state.baseCommit || 'no-commit';
          const artifactHash = computeArtifactHash({
            root: project.root,
            change: state.change,
            specsBase,
          });
          const asked = await askApproval(runtime, {
            gate,
            change: state.change,
            artifactHash,
            agent: exec?.agent,
            signal: exec?.signal,
            pages: renderGatePages({ gate, root: project.root, state }).pages,
          });
          if (!asked.ok) return fail(asked.message, asked);

          const saved = patchState(project.root, (draft) => {
            issueApproval(draft, gate, artifactHash, asked.at);
            draft.baseline = {
              specsBase,
              artifactHash,
              approvedAt: asked.at,
            };
            draft.phase = 'PLAN';
          });
          if (!saved.ok) return fail(`记录批准失败：${saved.message}`, saved);

          return ok(
            `H1 已批准，产物指纹 ${artifactHash.slice(0, 19)}…，进入 PLAN。下一步：写 design/tasks/cases/mapping，然后 /sg-run`,
            { gate, artifactHash, phase: 'PLAN' },
          );
        }

        if (state.phase !== 'H2_PENDING') {
          return fail(`当前阶段 ${state.phase} 不能批准 H2`);
        }
        const m2 = checkM2({ root: project.root, state, config: project.config });
        if (!m2.ok) return fail(`M2 未通过，不能批准：\n${formatErrors(m2.errors)}`, m2);
        const h1 = checkFrozenH1({ root: project.root, state });
        if (!h1.ok) return fail(`${h1.message}；请重新走 H1`, h1);
        if (state.plan?.planHash && state.plan.planHash !== m2.planHash) {
          return fail('计划在冻结后发生变化，请重新执行 /sg-run 再批准', {
            frozen: state.plan.planHash,
            now: m2.planHash,
          });
        }

        const asked = await askApproval(runtime, {
          gate,
          change: state.change,
          artifactHash: m2.planHash,
          agent: exec?.agent,
          signal: exec?.signal,
          pages: renderGatePages({ gate, root: project.root, state }).pages,
        });
        if (!asked.ok) return fail(asked.message, asked);

        const committed = isGitRepo(project.root)
          ? commitChangePackage(project.root, state.change, `docs(${state.change}): 冻结 H2 方案`)
          : { ok: true, skipped: true };
        if (!committed.ok) return fail(`提交 change 包失败：${committed.message}`, committed);
        const integrationBase = isGitRepo(project.root) ? headCommit(project.root) : null;

        const saved = patchState(project.root, (draft) => {
          issueApproval(draft, gate, m2.planHash, asked.at);
          draft.plan.planHash = m2.planHash;
          draft.plan.approvedAt = asked.at;
          draft.integration = {
            branch: integrationBranch(state.change),
            base: integrationBase,
            lastGreen: null,
          };
          draft.phase = 'EXECUTING';
        });
        if (!saved.ok) return fail(`记录批准失败：${saved.message}`, saved);

        return ok(
          `H2 已批准，计划指纹 ${String(m2.planHash).slice(0, 19)}…，进入 EXECUTING。下一步：/sg-run 执行任务`,
          { gate, planHash: m2.planHash, phase: 'EXECUTING' },
        );
      },
    },
  ];

  for (const definition of definitions) {
    try {
      disposers.push(ctx.tools.register(definition));
    } catch (error) {
      console.warn(`[specgate] failed to register tool ${definition.name}:`, error);
    }
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // ignore teardown errors
      }
    }
  };
}
