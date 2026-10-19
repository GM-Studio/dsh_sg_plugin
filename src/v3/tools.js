import { initProject, createChange } from './change.js';
import { renderStatus, statusData } from './status.js';
import { headCommit, isGitRepo } from './util/git.js';

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
        if (!result.ok) {
          return fail(`初始化失败：${result.message}`, result);
        }
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
