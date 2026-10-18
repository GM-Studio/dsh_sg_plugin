import path from 'node:path';
import { GATES } from './constants.js';
import { initOptionsFromGlobal } from './config.js';
import { classifyRequest } from './classify.js';
import { appendDeviation } from './deviations.js';
import { runDoctor, renderDoctor } from './doctor.js';
import {
  createAgentRunner,
  resolveMaxConcurrency,
  runDoctorParallel,
} from './dispatch.js';
import { performGateAction } from './gate-actions.js';
import {
  gateRequiredForParadigm,
  missingGates,
  readGate,
  requiredGatesFor,
} from './gates.js';
import {
  disableProject,
  enableProject,
  initProject,
  renderInitReport,
} from './init.js';
import { archiveChange, createChange } from './openspec.js';
import { gitAddAndCommit } from './git.js';
import { loadProject, setParadigm } from './project.js';
import { migrateProject } from './migrate.js';
import {
  DAY_MS,
  archivedPath,
  changeExists,
  projectComplete,
  runMutation,
} from './mutations.js';
import {
  computeStatus,
  invalidateStatusCache,
  renderNext,
  renderStatus,
  statusSummary,
} from './status.js';
import { readIfExists } from './util.js';

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

async function mutateTool(root, meta, execute) {
  const result = await runMutation(root, meta, execute);
  if (result.kind === 'error') return fail(result.text, result.data);
  return ok(result.text, result.data);
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
      name: 'sg_status',
      description:
        'Show the SpecGate project status: active OpenSpec changes, artifact completion, gate states and the next step. Read-only.',
      parameters: EMPTY_PARAMS,
      output: textOutput(),
      async execute(args, exec) {
        const project = runtime.project(exec.agent);
        const status = computeStatus(project.root, { fresh: true });
        return ok(renderStatus(status, runtime.language(exec.agent)), statusSummary(status));
      },
    },
    {
      name: 'sg_next',
      description:
        'Return the next SpecGate action: the next gate to confirm, the next artifact to create, or the next implementation step. Read-only.',
      parameters: EMPTY_PARAMS,
      output: textOutput(),
      async execute(args, exec) {
        const project = runtime.project(exec.agent);
        const status = computeStatus(project.root, { fresh: true });
        return ok(renderNext(status, runtime.language(exec.agent)), statusSummary(status));
      },
    },
    {
      name: 'sg_gate',
      description:
        'Inspect, confirm, or waive an SpecGate gate (G1-G11). confirm/waive ask the user through a structured question; waive requires a reason and writes .specgate/deviations.log. Repeated calls are idempotent.',
      parameters: {
        type: 'object',
        properties: {
          gate: { type: 'string', enum: Object.keys(GATES) },
          action: { type: 'string', enum: ['status', 'confirm', 'waive'] },
          reason: { type: 'string' },
          impact: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['gate'],
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const project = runtime.project(exec.agent);
        const gate = String(args?.gate || '').trim();
        if (!GATES[gate]) return fail(`未知门控：${gate}`);
        const action = args?.action || 'status';
        if (action === 'status') {
          const result = await performGateAction(ctx, exec.agent, exec.signal, project.root, {
            gate,
            action,
            interactive: false,
            language: runtime.language(exec.agent),
          });
          return ok(result.text, result);
        }

        return mutateTool(
          project.root,
          {
            command: 'sg_gate',
            args: { gate, action, reason: args?.reason, impact: args?.impact },
            target: gate,
            ttlMs: 0,
          },
          async () => {
            const state = readGate(project.root, gate);
            if (action === 'confirm' && state.confirmed) {
              return {
                result: { kind: 'success', text: `${gate} 已确认，幂等跳过。`, data: state },
                record: false,
              };
            }
            if (action === 'waive' && state.waived) {
              return {
                result: {
                  kind: 'success',
                  text: `${gate} 已跳过（${state.reason || '未记录原因'}），幂等跳过。`,
                  data: state,
                },
                record: false,
              };
            }
            const result = await performGateAction(
              ctx,
              exec.agent,
              exec.signal,
              project.root,
              { ...(args || {}), interactive: true, callId: exec.callId, language: runtime.language(exec.agent) },
            );
            return {
              result: {
                kind: result.ok ? 'success' : 'error',
                text: result.text,
                data: result,
              },
              record: false,
            };
          },
        );
      },
    },
    {
      name: 'sg_deviation',
      description:
        'Append a deviation entry to .specgate/deviations.log. Use when a gate or workflow rule is intentionally skipped. Repeated identical entries are deduplicated for 24h; use force to append again.',
      parameters: {
        type: 'object',
        properties: {
          gate: { type: 'string' },
          reason: { type: 'string' },
          impact: { type: 'string', enum: ['low', 'medium', 'high'] },
          force: { type: 'boolean' },
        },
        required: ['reason'],
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const project = runtime.project(exec.agent);
        const gate = args?.gate || 'flow';
        const reason = args?.reason;
        return mutateTool(
          project.root,
          {
            command: 'sg_deviation',
            args: { gate, reason, impact: args?.impact || 'medium' },
            target: 'deviations',
            ttlMs: DAY_MS,
            force: args?.force === true,
          },
          async ({ key }) => {
            const entry = appendDeviation(project.root, {
              gate,
              reason,
              impact: args?.impact || 'medium',
              opId: key,
            });
            invalidateStatusCache(project.root);
            return {
              result: { kind: 'success', text: `已记录偏离：${entry.gate} / ${entry.reason}`, data: entry },
              summary: `偏离 ${entry.gate} / ${entry.reason}`,
              record: true,
            };
          },
        );
      },
    },
    {
      name: 'sg_classify',
      description:
        'Recommend L1/L2/L3 for a change description. L1 = requirement-driven, L2 = technical implementation, L3 = defect fix. Optionally record the paradigm (without confirming G2).',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          apply: { type: 'boolean' },
        },
        required: ['description'],
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const project = runtime.project(exec.agent);
        const result = classifyRequest(args?.description || '', runtime.language(exec.agent));
        let suffix = '下一步：/sg-gate G2 confirm --yes 确认范式。';
        if (!args?.apply) {
          return ok(
            [
              `建议范式：${result.paradigm}（${result.label}）`,
              `理由：${result.reason}`,
              `流程：${result.nextAction}`,
              suffix,
            ].join('\n'),
            result,
          );
        }

        const requiresG1 = gateRequiredForParadigm('G1', result.paradigm);
        const g1 = readGate(project.root, 'G1');
        if (requiresG1 && !g1.satisfied) {
          return fail('G1 需求确认尚未通过，不能记录范式。请先完成 /sg-gate G1 confirm --yes。');
        }

        return mutateTool(
          project.root,
          {
            command: 'sg_classify',
            args: { description: args?.description || '', paradigm: result.paradigm },
            target: 'config',
            ttlMs: 0,
          },
          async () => {
            const current = loadProject(project.root);
            if (current.paradigm === result.paradigm) {
              return {
                result: {
                  kind: 'success',
                  text: `范式已是 ${result.paradigm}，幂等跳过。`,
                  data: result,
                },
                record: false,
              };
            }
            setParadigm(project.root, result.paradigm);
            invalidateStatusCache(project.root);
            suffix = '已写入 .specgate/config.yaml；下一步：/sg-gate G2 confirm --yes 确认范式。';
            return {
              result: {
                kind: 'success',
                text: [
                  `建议范式：${result.paradigm}（${result.label}）`,
                  `理由：${result.reason}`,
                  `流程：${result.nextAction}`,
                  suffix,
                ].join('\n'),
                data: result,
              },
              summary: `范式 ${result.paradigm}`,
              record: false,
            };
          },
        );
      },
    },
    {
      name: 'sg_doctor',
      description:
        'Run an SpecGate project health check in parallel: missing directories/artifacts, gate/artifact contradictions, deviation format, materialized skills.',
      parameters: EMPTY_PARAMS,
      output: textOutput(),
      async execute(args, exec) {
        const project = runtime.project(exec.agent);
        let result;
        try {
          // The agents service is optional: build the runner inside the guard so a
          // composition without it falls back to the local deterministic doctor.
          const runner = createAgentRunner(ctx);
          result = runner
            ? await runDoctorParallel({
                root: project.root,
                parent: exec.agent,
                runner,
                maxConcurrency: resolveMaxConcurrency(project.root, runtime.global.maxConcurrency),
                language: runtime.language(exec.agent),
              })
            : runDoctor(project.root);
        } catch {
          result = runDoctor(project.root);
        }
        return ok(renderDoctor(result, runtime.language(exec.agent)), result);
      },
    },
    {
      name: 'sg_propose',
      description:
        'Create a new OpenSpec change skeleton (proposal.md) after G1 and G2 are confirmed. Does not generate design/tasks automatically. Repeated creation is idempotent.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const project = loadProject(runtime.getCwd(exec.agent));
        const name = args?.name;
        const description = args?.description || '';
        const proposalPath = path.join(project.root, 'openspec', 'changes', name, 'proposal.md');
        const existing = readIfExists(proposalPath);

        return mutateTool(
          project.root,
          {
            command: 'sg_propose',
            args: { name, description },
            target: name,
            ttlMs: 0,
          },
          async () => {
            if (changeExists(project.root, name)) {
              if (existing !== null && description && !existing.includes(description)) {
                return {
                  result: {
                    kind: 'error',
                    text: `Change 已存在且描述不同：${name}。请换一个名称，或手工合并到现有 proposal。`,
                  },
                  record: false,
                };
              }
              return {
                result: { kind: 'success', text: `Change 已存在：${name}，幂等跳过。` },
                record: false,
              };
            }
            const required = requiredGatesFor('proposal', project.paradigm);
            const missing = missingGates(project.root, required);
            if (missing.length > 0) {
              return {
                result: {
                  kind: 'error',
                  text: `无法创建 proposal：缺少门控 ${missing.join('、')}。请先完成 /sg-gate 确认。`,
                },
                record: false,
              };
            }
            const created = createChange(project.root, name, description);
            invalidateStatusCache(project.root);
            return {
              result: {
                kind: 'success',
                text: `已创建 ${created.name}：${created.path}\n下一步：补齐 proposal 的 Intent/Scope，然后 /sg-gate G3 confirm --yes。`,
                data: created,
              },
              summary: `创建 Change ${name}`,
              record: false,
            };
          },
        );
      },
    },
    {
      name: 'sg_archive',
      description:
        'Archive a completed OpenSpec change after G9 (review passed). Moves openspec/changes/<name> to openspec/changes/archive/<date>-<name>. Repeated calls are idempotent.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const project = loadProject(runtime.getCwd(exec.agent));
        const name = args?.name;
        const archived = archivedPath(project.root, name);
        if (archived) {
          return ok(`已归档在 ${archived}，幂等跳过。`, { name, path: archived });
        }
        if (!changeExists(project.root, name)) {
          return fail(`Change 不存在：${name}`);
        }
        const g9 = readGate(project.root, 'G9');
        if (!g9.satisfied) {
          return fail('无法归档：G9（审查通过/提交）尚未确认。');
        }
        return mutateTool(
          project.root,
          { command: 'sg_archive', args: { name }, target: name, ttlMs: 0 },
          async () => {
            const archivedAgain = archivedPath(project.root, name);
            if (archivedAgain) {
              return {
                result: {
                  kind: 'success',
                  text: `已归档在 ${archivedAgain}，幂等跳过。`,
                  data: { name, path: archivedAgain },
                },
                record: false,
              };
            }
            if (!changeExists(project.root, name)) {
              return {
                result: { kind: 'error', text: `Change 不存在：${name}` },
                record: false,
              };
            }
            const result = archiveChange(project.root, name);
            invalidateStatusCache(project.root);
            return {
              result: {
                kind: 'success',
                text: `已归档到 ${result.path}`,
                data: result,
              },
              summary: `归档 ${name}`,
              record: false,
            };
          },
        );
      },
    },
    {
      name: 'sg_init',
      description:
        'Initialize an SpecGate workflow project. Generates .specgate, openspec/, AGENTS.md, 30 skills, agents/templates/docs and an initial Git commit by default. Use path to create a new project directory; minimal for a lightweight scaffold; no-git via git:false. Repeated calls are idempotent.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          minimal: { type: 'boolean' },
          force: { type: 'boolean' },
          git: { type: 'boolean' },
          example: { type: 'boolean' },
          docs: { type: 'boolean' },
          disabled: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const cwd = runtime.getCwd(exec.agent);
        const options = initOptionsFromGlobal(runtime.global, {
          path: args?.path,
          minimal: Boolean(args?.minimal),
          force: Boolean(args?.force),
          git: args?.git !== false,
          example: args?.example !== false,
          docs: args?.docs !== false,
          disabled: args?.disabled === true,
        });
        const targetRoot = options.path ? path.resolve(cwd, options.path) : path.resolve(cwd);
        return mutateTool(
          targetRoot,
          { command: 'sg_init', args: options, target: 'project', ttlMs: 0 },
          async () => {
            if (!options.force && projectComplete(targetRoot, options)) {
              return {
                result: {
                  kind: 'success',
                  text: 'SpecGate 项目已初始化且完整，幂等跳过。',
                  data: { root: targetRoot },
                },
                record: false,
              };
            }
            const report = initProject(cwd, options);
            invalidateStatusCache(report.root);
            return {
              result: {
                kind: 'success',
                text: renderInitReport(report, options.language),
                data: { root: report.root, git: report.git },
              },
              summary: 'SpecGate 初始化完成',
              record: false,
            };
          },
        );
      },
    },
    {
      name: 'sg_enable',
      description:
        'Enable SpecGate in the current project. Initializes the project first when .specgate does not exist. Repeated calls are idempotent.',
      parameters: EMPTY_PARAMS,
      output: textOutput(),
      async execute(args, exec) {
        const cwd = runtime.getCwd(exec.agent);
        const project = loadProject(cwd);
        return mutateTool(
          project.root,
          { command: 'sg_enable', args: {}, target: 'config', ttlMs: 0 },
          async () => {
            if (project.enabled) {
              return {
                result: { kind: 'success', text: 'SpecGate 已在当前项目启用，幂等跳过。', data: { root: project.root } },
                record: false,
              };
            }
            const result = enableProject(cwd, initOptionsFromGlobal(runtime.global, {}));
            invalidateStatusCache(project.root);
            if (result.initialized) {
              return {
                result: { kind: 'success', text: renderInitReport(result.report, runtime.language(exec.agent)), data: { root: project.root } },
                record: false,
              };
            }
            return {
              result: { kind: 'success', text: 'SpecGate 已在当前项目启用。', data: { root: project.root } },
              record: false,
            };
          },
        );
      },
    },
    {
      name: 'sg_disable',
      description:
        'Disable SpecGate gating in the current project while keeping .specgate and openspec files intact. Repeated calls are idempotent.',
      parameters: EMPTY_PARAMS,
      output: textOutput(),
      async execute(args, exec) {
        const cwd = runtime.getCwd(exec.agent);
        const project = loadProject(cwd);
        if (!project.hasSpecgate) return fail('项目尚未初始化，无法停用。');
        return mutateTool(
          project.root,
          { command: 'sg_disable', args: {}, target: 'config', ttlMs: 0 },
          async () => {
            if (!project.enabled) {
              return {
                result: { kind: 'success', text: 'SpecGate 已停用，幂等跳过。', data: { root: project.root } },
                record: false,
              };
            }
            const result = disableProject(cwd);
            invalidateStatusCache(project.root);
            return {
              result: result.changed
                ? { kind: 'success', text: 'SpecGate 已在当前项目停用。', data: { root: project.root } }
                : { kind: 'error', text: result.reason },
              record: false,
            };
          },
        );
      },
    },
    {
      name: 'sg_migrate',
      description:
        'Migrate an existing .ak47/ project to .specgate/: backs up the old directory, copies state/config/gates/deviations, and rewrites managed SpecGate references. Use dryRun to preview.',
      parameters: {
        type: 'object',
        properties: {
          dryRun: { type: 'boolean' },
          force: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const cwd = runtime.getCwd(exec.agent);
        if (args?.dryRun === true) {
          const result = migrateProject(cwd, { dryRun: true, force: args?.force === true });
          return result.ok ? ok(result.text, result) : fail(result.text, result);
        }
        return mutateTool(
          cwd,
          { command: 'sg_migrate', args: { force: args?.force === true }, target: 'migration', ttlMs: 0 },
          async () => {
            const result = migrateProject(cwd, { force: args?.force === true });
            invalidateStatusCache(cwd);
            return {
              result: result.ok
                ? { kind: 'success', text: result.text, data: result }
                : { kind: 'error', text: result.text, data: result },
              summary: 'SpecGate migration',
              record: false,
            };
          },
        );
      },
    },
    {
      name: 'sg_commit',
      description:
        'Commit current changes with a message. Gate confirmations require a clean working tree, so use this before advancing a gate. Repeated calls without changes are idempotent.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          all: { type: 'boolean' },
          paths: { type: 'array', items: { type: 'string' } },
        },
        required: ['message'],
        additionalProperties: false,
      },
      output: textOutput(),
      async execute(args, exec) {
        const project = loadProject(runtime.getCwd(exec.agent));
        return mutateTool(
          project.root,
          { command: 'sg_commit', args: { message: args?.message }, target: 'git', ttlMs: 0 },
          async () => {
            try {
              const result = gitAddAndCommit(project.root, args?.message, {
                all: args?.all !== false,
                paths: args?.paths || [],
              });
              if (!result.committed) {
                return {
                  result: { kind: 'success', text: '没有可提交的变更，幂等跳过。', data: result },
                  record: false,
                };
              }
              invalidateStatusCache(project.root);
              return {
                result: {
                  kind: 'success',
                  text: `已提交 ${result.hash}：${result.subject}（${result.files} 个文件）`,
                  data: result,
                },
                summary: `已提交 ${result.hash}`,
                record: false,
              };
            } catch (error) {
              return {
                result: {
                  kind: 'error',
                  text: `提交失败：${error instanceof Error ? error.message : String(error)}`,
                },
                record: false,
              };
            }
          },
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
