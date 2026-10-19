import { initProject, createChange } from './change.js';
import { renderStatus, statusData } from './status.js';
import { headCommit, isGitRepo } from './util/git.js';
import { checkM1, checkM2, checkFrozenH1, computeArtifactHash } from './phase.js';
import { patchState } from './state.js';
import { askApproval, issueApproval } from './approvals.js';

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
          case 'EXECUTING':
            return ok('执行阶段：任务调度尚未启用（S4）。');
          case 'INTEGRATING':
            return ok('集成阶段：全量回归尚未启用（S5）。');
          case 'H3_PENDING':
            return ok('等待人执行 /sg-approve H3。');
          case 'ARCHIVING':
            return ok('归档阶段：归档事务尚未启用（S5）。');
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
        if (!['H1', 'H2'].includes(gate)) {
          return fail(`${gate} 批准尚未启用（S5 提供 H3）。`);
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

        const saved = patchState(project.root, (draft) => {
          issueApproval(draft, gate, m2.planHash, asked.at);
          draft.plan.planHash = m2.planHash;
          draft.plan.approvedAt = asked.at;
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
