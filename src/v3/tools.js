import { initProject, createChange } from './change.js';
import { renderStatus, statusData } from './status.js';
import { headCommit, isGitRepo } from './util/git.js';
import { checkM1, checkM2, checkFrozenH1, computeArtifactHash, collectKnownAcs } from './phase.js';
import { patchState } from './state.js';
import { askApproval, issueApproval } from './approvals.js';
import { commitChangePackage, ensureIntegration, git, headOf, integrationBranch } from './worktrees.js';
import { createDispatcher } from './dispatch.js';
import { executeTask, pickNextTask, revertWave } from './executor.js';
import { readyBatch } from './scheduler.js';
import { discoverCommand, loadPlan } from './plan.js';
import { runTestCommand } from './testrunner.js';
import { validateReport } from './report.js';
import { generateAcceptance } from './acceptance.js';
import { verifyEvidence, appendEvidence } from './evidence.js';
import { digest } from './util/hash.js';
import { archiveChange, nextTag } from './archive.js';
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

const EMPTY_PARAMS = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

export function registerTools(ctx, runtime) {
  const disposers = [];
  const definitions = [
    {
      name: 'sg_init',
      description:
        '初始化 SpecGate v3 项目：创建 .specgate 配置、openspec 目录、.gitignore 与状态文件。幂等。',
      parameters: EMPTY_PARAMS,
      output: textOutput(),
      async execute(args, exec) {
        const root = runtime.getCwd(exec?.agent);
        const result = initProject(root);
        if (!result.ok) return fail(`初始化失败：${result.message}`, result);
        const changed = result.created.length > 0 ? `新建 ${result.created.length} 项` : '已完整，幂等跳过';
        return ok(`SpecGate v3 已初始化（${changed}）。下一步：/sg-change <name> --type feature`, {
          root: result.root,
          created: result.created,
          ignored: result.ignored,
        });
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
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const project = runtime.project(exec?.agent);
        const guard = ensureV3(project);
        if (!guard.ok) return fail(guard.message, guard);

        const baseCommit = isGitRepo(project.root) ? headCommit(project.root) : null;
        const result = createChange(project.root, {
          name: args?.name,
          type: args?.type || 'feature',
          baseCommit,
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
      description: '查看 SpecGate v3 项目状态：阶段、下一步、任务、证据与阻塞原因。只读。',
      parameters: EMPTY_PARAMS,
      output: textOutput(),
      async execute(args, exec) {
        const project = runtime.project(exec?.agent);
        return ok(renderStatus(project), statusData(project));
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
        const guard = ensureV3(project);
        if (!guard.ok) return fail(guard.message, guard);
        const state = project.state;
        if (!state) return fail('未找到状态文件，先执行 /sg-init', project.stateError);

        switch (state.phase) {
          case 'IDLE':
            return ok('当前没有进行中的 change。先执行 /sg-change <name> --type <type>。');
          case 'H1_PENDING': {
            const m1 = checkM1({ root: project.root, state });
            if (!m1.ok) return fail(`M1 未通过：\n${formatErrors(m1.errors)}`, m1);
            return ok('M1 通过。请审阅 delta 后执行 /sg-approve H1。', { m1 });
          }
          case 'PLAN': {
            const m2 = checkM2({ root: project.root, state, config: project.config });
            if (!m2.ok) return fail(`M2 未通过：\n${formatErrors(m2.errors)}`, m2);
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
            return ok(
              `M2 通过，已冻结 planHash ${String(m2.planHash).slice(0, 19)}…。请审阅方案后执行 /sg-approve H2。`,
              { m2 },
            );
          }
          case 'H2_PENDING':
            return ok('等待人执行 /sg-approve H2。');
          case 'EXECUTING': {
            const maxParallel = Math.max(1, Math.min(4, Number(project.config?.maxParallel) || 2));
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
                    draft.blockedReason = lastError;
                  }
                }
              }
            });
            if (!saved.ok) return fail(saved.message, saved);
            if (lastError) return fail(lastError, { results });

            const mergedIds = results.map((item) => `${item.taskId}@${String(item.result.commit).slice(0, 8)}`);
            return ok(`已合并：${mergedIds.join('、')}。继续 /sg-run 推进。`, {
              results: results.map((item) => ({ taskId: item.taskId, commit: item.result.commit })),
            });
          }
          case 'INTEGRATING': {
            const change = state.change;
            const integration = ensureIntegration(project.root, change, state.integration?.base);
            if (!integration.ok) return fail(integration.message, integration);

            const command = discoverCommand(project.root, project.config);
            if (!command.ok) return fail(command.message, command);

            const run = runTestCommand({
              argv: command.argv,
              cwd: path.join(integration.path, command.cwd || '.'),
            });
            if (run.exitCode !== 0) {
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
                draft.blockedReason = `集成回归失败：exit ${run.exitCode}`;
              });
              return fail(
                `集成回归失败（exit ${run.exitCode}），已回退到波前：${(reverted.reverted || []).join('、')}`,
                { run, reverted },
              );
            }

            const plan = loadPlan(project.root, change);
            const { deltaAcs, knownAcs } = collectKnownAcs({ root: project.root, state, change });
            const base = state.integration?.base;
            const changedFiles = base
              ? git(integration.path, ['diff', '--name-only', `${base}..HEAD`])
                  .split('\n')
                  .filter(Boolean)
              : [];
            const commit = headOf(integration.path, 'HEAD');
            const validation = validateReport({
              report: run.report,
              deltaAcs,
              knownAcs,
              mapping: plan.mapping,
              worktree: integration.path,
              changedFiles,
            });
            if (!validation.ok) {
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
                draft.blockedReason = `验收证据不足：${validation.errors.join('; ')}`;
              });
              return fail(`验收证据不足，已回退到波前：\n${formatErrors(validation.errors)}`, {
                validation,
                run,
              });
            }

            const headEvidence = verifyEvidence(project.root, change);
            const acceptance = generateAcceptance({
              change,
              type: state.type,
              acs: deltaAcs,
              report: run.report,
              exitCode: run.exitCode,
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
            });
            if (!result.ok) {
              patchState(project.root, (draft) => {
                draft.phase = 'BLOCKED';
                draft.blockedReason = `归档失败：${result.message}`;
              });
              return fail(`归档失败：${result.message}`, result);
            }
            const evidence = appendEvidence(project.root, state.change, {
              event: 'archive',
              decision: 'done',
              refs: { tag: result.tag, commit: headOf(project.root, 'HEAD') },
            });
            const saved = patchState(project.root, (draft) => {
              draft.phase = 'DONE';
              draft.evidence = { headSeq: evidence.seq, headHash: evidence.hash };
            });
            if (!saved.ok) return fail(saved.message, saved);
            return ok(
              `归档完成：tag ${result.tag}，specs 已更新，change 已移动到 openspec/changes/archive/。`,
              result,
            );
          }
          case 'BLOCKED':
            return ok(
              `已阻塞：${state.blockedReason || '未知原因'}。处理后可执行 /sg-run --retry。`,
            );
          case 'DONE':
            return ok('change 已完成。');
          case 'ABORTED':
            return ok('change 已中止。');
          default:
            return fail(`未知阶段：${state.phase}`);
        }
      },
    },
    {
      name: 'sg_approve',
      description:
        '人类批准 H1/H2/H3。工具内部通过宿主问答询问用户；无用户应答则拒绝，模型无法自签。',
      parameters: {
        type: 'object',
        properties: {
          gate: { type: 'string', enum: ['H1', 'H2', 'H3'] },
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
        if (!state?.change) return fail('没有进行中的 change');

        const gate = String(args?.gate || '').toUpperCase();
        if (!['H1', 'H2', 'H3'].includes(gate)) {
          return fail(`未知批准点：${gate}`);
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
