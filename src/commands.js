import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { GATES } from './constants.js';
import { initOptionsFromGlobal } from './config.js';
import { classifyRequest } from './classify.js';
import { appendDeviation } from './deviations.js';
import { runDoctor, renderDoctor } from './doctor.js';
import {
  createAgentRunner,
  dispatchChange,
  renderDispatch,
  resolveMaxConcurrency,
  runDoctorParallel,
  writeDispatchReport,
} from './dispatch.js';
import { performGateAction } from './gate-actions.js';
import { missingGates, readGate, requiredGatesFor } from './gates.js';
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
} from './status.js';
import { disableProject, enableProject, initProject, renderInitReport } from './init.js';
import { readIfExists } from './util.js';

const NOTICE_SUMMARY_MAX_CHARS = 120;

function parts(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function success(text) {
  return { kind: 'success', text };
}

function failure(text) {
  return { kind: 'error', text };
}

function firstLine(text) {
  return (
    String(text || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) || 'SpecGate 命令已完成'
  );
}

function noticeSummary(text) {
  const line = firstLine(text);
  if (line.length <= NOTICE_SUMMARY_MAX_CHARS) return line;
  return `${line.slice(0, NOTICE_SUMMARY_MAX_CHARS - 3)}...`;
}

/**
 * A command result is rendered by DSH as a persistent command card. That card is
 * enough once a conversation is active, but DSH keeps a session that contains
 * only command events on its welcome screen, so the card would be invisible in
 * a fresh session. Append one DSH `notice` context message in that case.
 *
 * The append only happens while the agent is idle. Appending a message between
 * an assistant tool call and its tool result corrupts provider history.
 */
export function appendCommandNotice(invocation, result) {
  const agent = invocation?.agent;
  const session = agent?.session;
  if (!agent || !session || typeof session.append !== 'function') return false;
  if (agent.status === 'running') return false;
  if (typeof result?.text !== 'string' || result.text.trim().length === 0) return false;

  try {
    if (
      typeof session.deriveMessages === 'function' &&
      session.deriveMessages().length > 0
    ) {
      return false;
    }
  } catch {
    return false;
  }

  const text = result.text.trim();
  try {
    session.append(
      'user/message',
      {
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: `[SpecGate] ${text}` }],
        source: {
          kind: 'specgate',
          form: 'notice',
          summary: noticeSummary(text),
        },
      },
      { surfaceOp: 'append' },
    );
    return true;
  } catch {
    return false;
  }
}

function withNotice(handler) {
  return async (invocation) => {
    let result;
    try {
      result = await handler(invocation);
    } catch (error) {
      result = failure(error instanceof Error ? error.message : String(error));
    }
    try {
      appendCommandNotice(invocation, result);
    } catch {
      // Reporting is best-effort; it must never replace the command outcome.
    }
    return result;
  };
}

function parseInitOptions(rawInput) {
  const list = parts(rawInput);
  const options = {};
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (token === '--path') {
      const value = list[index + 1];
      if (!value) return { error: '用法：/sg-init --path <dir>' };
      options.path = value;
      index += 1;
    } else if (token.startsWith('--path=')) options.path = token.slice('--path='.length);
    else if (token === '--minimal') options.minimal = true;
    else if (token === '--force') options.force = true;
    else if (token === '--no-git') options.git = false;
    else if (token === '--no-example') options.example = false;
    else if (token === '--no-docs') options.docs = false;
    else if (token === '--disabled') options.disabled = true;
  }
  return { options };
}

export function registerCommands(ctx, runtime) {
  const commands =
    ctx.commands ||
    (typeof ctx.get === 'function' ? ctx.get('commands') : undefined);
  if (!commands) return () => {};

  const language = runtime.global?.language || 'zh';
  const d = (zh, en) => (language === 'en' ? en : zh);
  const disposers = [];
  const register = (definition) => {
    try {
      const dispose = commands.register({
        ...definition,
        handler: withNotice(definition.handler),
      });
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (error) {
      console.warn(`[specgate] failed to register command ${definition.name}:`, error);
    }
  };

  register({
    name: 'sg-init',
    description:
      d('初始化 SpecGate 项目：/sg-init [--path <dir>] [--minimal] [--force] [--no-git] [--no-example] [--no-docs] [--disabled]', 'Initialize a SpecGate project: /sg-init [--path <dir>] [--minimal] [--force] [--no-git] [--no-example] [--no-docs] [--disabled]'),
    input: {
      hint: '[--path <dir>] [--minimal] [--force] [--no-git] [--no-example] [--no-docs] [--disabled]',
    },
    async handler(inv) {
      const cwd = runtime.getCwd(inv.agent);
      const parsed = parseInitOptions(inv.rawInput);
      if (parsed.error) return failure(parsed.error);
      const options = initOptionsFromGlobal(runtime.global, parsed.options);
      const targetRoot = options.path ? path.resolve(cwd, options.path) : path.resolve(cwd);
      return runMutation(
        targetRoot,
        { command: 'sg-init', args: options, target: 'project', ttlMs: 0 },
        async () => {
          if (!options.force && projectComplete(targetRoot, options)) {
            return {
              result: success('SpecGate 项目已初始化且完整，幂等跳过。'),
              summary: 'SpecGate 已初始化',
              record: false,
            };
          }
          const report = initProject(cwd, options);
          invalidateStatusCache(report.root);
          return {
            result: success(renderInitReport(report, options.language)),
            summary: 'SpecGate 初始化完成',
            record: false,
          };
        },
      );
    },
  });

  register({
    name: 'sg-status',
    description: d('查看 SpecGate 项目、Change、Artifact 与门控状态', 'Show SpecGate project, change, artifact and gate status'),
    async handler(inv) {
      const project = loadProject(runtime.getCwd(inv.agent));
      const status = computeStatus(project.root, { fresh: true });
      return success(renderStatus(status, runtime.language(inv.agent)));
    },
  });

  register({
    name: 'sg-next',
    description: d('查看 SpecGate 下一步建议', 'Show the next SpecGate action'),
    async handler(inv) {
      const project = loadProject(runtime.getCwd(inv.agent));
      const status = computeStatus(project.root, { fresh: true });
      return success(renderNext(status, runtime.language(inv.agent)));
    },
  });

  register({
    name: 'sg-commit',
    description: d('提交当前变更：/sg-commit <message>', 'Commit current changes: /sg-commit <message>'),
    input: { hint: '<message>' },
    async handler(inv) {
      const message = String(inv.rawInput || '').trim();
      if (!message) return failure('用法：/sg-commit <message>');
      const project = loadProject(runtime.getCwd(inv.agent));
      return runMutation(
        project.root,
        { command: 'sg-commit', args: { message }, target: 'git', ttlMs: 0 },
        async () => {
          try {
            const result = gitAddAndCommit(project.root, message);
            if (!result.committed) {
              return { result: success('没有可提交的变更，幂等跳过。'), record: false };
            }
            invalidateStatusCache(project.root);
            return {
              result: success(`已提交 ${result.hash}：${result.subject}（${result.files} 个文件）`),
              summary: `已提交 ${result.hash}`,
              record: false,
            };
          } catch (error) {
            return {
              result: failure(`提交失败：${error instanceof Error ? error.message : String(error)}`),
              record: false,
            };
          }
        },
      );
    },
  });

  register({
    name: 'sg-gate',
    description:
      d('查看/确认/跳过门控：/sg-gate G3 status | confirm --yes | waive --yes [原因]', 'Inspect, confirm or waive a gate: /sg-gate G3 status | confirm --yes | waive --yes [reason]'),
    input: { hint: '<G1-G11> [status|confirm --yes|waive --yes] [原因]' },
    async handler(inv) {
      const list = parts(inv.rawInput);
      const gate = list[0];
      if (!gate) {
        return failure('用法：/sg-gate <G1-G11> [status|confirm --yes|waive --yes] [原因]');
      }
      if (!GATES[gate]) return failure(`未知门控：${gate}。可用：${Object.keys(GATES).join('、')}`);
      const project = loadProject(runtime.getCwd(inv.agent));
      const action = list[1] || 'status';

      if (action === 'status') {
        const result = await performGateAction(
          ctx,
          inv.agent,
          inv.signal,
          project.root,
          { gate, action, interactive: false, language: runtime.language(inv.agent) },
        );
        return result.ok ? success(result.text) : failure(result.text);
      }

      const confirmed =
        list.includes('--yes') ||
        list.includes('-y') ||
        list.includes('确认') ||
        list.includes('通过') ||
        list.includes('确认跳过');
      const reason = list
        .slice(2)
        .filter((token) => !['--yes', '-y', '确认', '通过', '确认跳过'].includes(token))
        .join(' ');

      return runMutation(
        project.root,
        {
          command: 'sg-gate',
          args: { gate, action, reason, confirmed },
          target: gate,
          ttlMs: 0,
        },
        async () => {
          const state = readGate(project.root, gate);
          if (action === 'confirm' && state.confirmed) {
            return { result: success(`${gate} 已确认，幂等跳过。`), record: false };
          }
          if (action === 'waive' && state.waived) {
            return {
              result: success(`${gate} 已跳过（${state.reason || '未记录原因'}），幂等跳过。`),
              record: false,
            };
          }
          const result = await performGateAction(ctx, inv.agent, inv.signal, project.root, {
            gate,
            action,
            reason,
            confirmed,
            interactive: false,
            language: runtime.language(inv.agent),
          });
          return {
            result: result.ok ? success(result.text) : failure(result.text),
            record: false,
          };
        },
      );
    },
  });

  register({
    name: 'sg-deviation',
    description: d('记录偏离：/sg-deviation G3 原因 [--force]', 'Record a deviation: /sg-deviation G3 reason [--force]'),
    input: { hint: '<Gx|flow> <原因> [--force]' },
    async handler(inv) {
      const list = parts(inv.rawInput);
      const force = list.includes('--force');
      const filtered = list.filter((token) => token !== '--force');
      if (filtered.length < 2) {
        return failure('用法：/sg-deviation <Gx|flow> <原因> [--force]');
      }
      const project = loadProject(runtime.getCwd(inv.agent));
      const gate = filtered[0];
      const reason = filtered.slice(1).join(' ');
      return runMutation(
        project.root,
        {
          command: 'sg-deviation',
          args: { gate, reason },
          target: 'deviations',
          ttlMs: DAY_MS,
          force,
        },
        async ({ key }) => {
          const entry = appendDeviation(project.root, {
            gate,
            reason,
            impact: 'medium',
            opId: key,
          });
          invalidateStatusCache(project.root);
          return {
            result: success(`已记录偏离：${entry.gate} / ${entry.reason}`),
            summary: `偏离 ${entry.gate} / ${entry.reason}`,
            record: true,
          };
        },
      );
    },
  });

  register({
    name: 'sg-classify',
    description: d('建议 L1/L2/L3：/sg-classify [--apply] <变更描述>', 'Recommend L1/L2/L3: /sg-classify [--apply] <description>'),
    input: { hint: '[--apply] <变更描述>' },
    async handler(inv) {
      const list = parts(inv.rawInput);
      const apply = list[0] === '--apply';
      const description = (apply ? list.slice(1) : list).join(' ');
      if (!description) return failure('用法：/sg-classify [--apply] <变更描述>');
      const result = classifyRequest(description);
      const project = loadProject(runtime.getCwd(inv.agent));

      if (!apply) {
        return success(
          `建议范式：${result.paradigm}（${result.label}）\n理由：${result.reason}\n流程：${result.nextAction}\n下一步：/sg-gate G2 confirm --yes 确认范式。`,
        );
      }

      if (!readGate(project.root, 'G1').satisfied) {
        return failure('G1 需求确认尚未通过，不能记录范式。请先完成 /sg-gate G1 confirm --yes。');
      }

      return runMutation(
        project.root,
        {
          command: 'sg-classify',
          args: { description, paradigm: result.paradigm },
          target: 'config',
          ttlMs: 0,
        },
        async () => {
          const current = loadProject(project.root);
          if (current.paradigm === result.paradigm) {
            return {
              result: success(`范式已是 ${result.paradigm}，幂等跳过。`),
              record: false,
            };
          }
          setParadigm(project.root, result.paradigm);
          invalidateStatusCache(project.root);
          return {
            result: success(
              `建议范式：${result.paradigm}（${result.label}）\n理由：${result.reason}\n流程：${result.nextAction}\n已写入 .specgate/config.yaml。下一步：/sg-gate G2 confirm --yes。`,
            ),
            summary: `范式 ${result.paradigm}`,
            record: false,
          };
        },
      );
    },
  });

  register({
    name: 'sg-doctor',
    description: d('SpecGate 项目健康体检（多 Agent 并行）', 'SpecGate project health check (parallel agents)'),
    async handler(inv) {
      const project = loadProject(runtime.getCwd(inv.agent));
      const runner = createAgentRunner(ctx);
      let result;
      try {
        result = runner
          ? await runDoctorParallel({
              root: project.root,
              parent: inv.agent,
              runner,
              maxConcurrency: resolveMaxConcurrency(project.root, runtime.global.maxConcurrency),
              language: runtime.language(inv.agent),
            })
          : runDoctor(project.root);
      } catch {
        result = runDoctor(project.root);
      }
      return success(renderDoctor(result, runtime.language(inv.agent)));
    },
  });

  register({
    name: 'sg-enable',
    description: d('在当前项目启用 SpecGate（必要时先初始化）', 'Enable SpecGate in this project (initializing when needed)'),
    async handler(inv) {
      const cwd = runtime.getCwd(inv.agent);
      const project = loadProject(cwd);
      return runMutation(
        project.root,
        { command: 'sg-enable', args: {}, target: 'config', ttlMs: 0 },
        async () => {
          if (project.enabled) {
            return { result: success('SpecGate 已在当前项目启用，幂等跳过。'), record: false };
          }
          const result = enableProject(cwd, initOptionsFromGlobal(runtime.global, {}));
          if (result.initialized) {
            invalidateStatusCache(project.root);
            return { result: success(renderInitReport(result.report, runtime.language(inv.agent))), record: false };
          }
          invalidateStatusCache(project.root);
          return { result: success('SpecGate 已在当前项目启用。'), record: false };
        },
      );
    },
  });

  register({
    name: 'sg-disable',
    description: d('在当前项目停用 SpecGate（保留项目文件）', 'Disable SpecGate in this project (keep project files)'),
    async handler(inv) {
      const cwd = runtime.getCwd(inv.agent);
      const project = loadProject(cwd);
      if (!project.hasSpecgate) return failure('项目尚未初始化，无法停用。');
      return runMutation(
        project.root,
        { command: 'sg-disable', args: {}, target: 'config', ttlMs: 0 },
        async () => {
          if (!project.enabled) {
            return { result: success('SpecGate 已停用，幂等跳过。'), record: false };
          }
          const result = disableProject(cwd);
          invalidateStatusCache(project.root);
          return result.changed
            ? { result: success('SpecGate 已在当前项目停用。'), record: false }
            : { result: failure(result.reason), record: false };
        },
      );
    },
  });

  register({
    name: 'sg-migrate',
    description: d('迁移旧 .ak47/ 项目到 .specgate/：/sg-migrate [--dry-run] [--force]', 'Migrate an existing .ak47/ project to .specgate/: /sg-migrate [--dry-run] [--force]'),
    input: { hint: '[--dry-run] [--force]' },
    async handler(inv) {
      const list = parts(inv.rawInput);
      const dryRun = list.includes('--dry-run');
      const force = list.includes('--force');
      const cwd = runtime.getCwd(inv.agent);

      if (dryRun) {
        const result = migrateProject(cwd, { dryRun: true, force });
        return result.ok ? success(result.text) : failure(result.text);
      }

      return runMutation(
        cwd,
        { command: 'sg-migrate', args: { force }, target: 'migration', ttlMs: 0 },
        async () => {
          const result = migrateProject(cwd, { force });
          invalidateStatusCache(cwd);
          return {
            result: result.ok ? success(result.text) : failure(result.text),
            summary: 'SpecGate 迁移',
            record: false,
          };
        },
      );
    },
  });

  register({
    name: 'sg-propose',
    description: d('创建 OpenSpec change 骨架：/sg-propose <name> [描述]', 'Create an OpenSpec change skeleton: /sg-propose <name> [description]'),
    input: { hint: '<kebab-case-name> [描述]' },
    async handler(inv) {
      const list = parts(inv.rawInput);
      if (!list[0]) return failure('用法：/sg-propose <kebab-case-name> [描述]');
      const name = list[0];
      const description = list.slice(1).join(' ');
      const project = loadProject(runtime.getCwd(inv.agent));
      const proposalPath = path.join(project.root, 'openspec', 'changes', name, 'proposal.md');
      const existing = readIfExists(proposalPath);

      return runMutation(
        project.root,
        { command: 'sg-propose', args: { name, description }, target: name, ttlMs: 0 },
        async () => {
          if (changeExists(project.root, name)) {
            if (existing !== null && description && !existing.includes(description)) {
              return {
                result: failure(
                  `Change 已存在且描述不同：${name}。请换一个名称，或手工合并到现有 proposal。`,
                ),
                record: false,
              };
            }
            return { result: success(`Change 已存在：${name}，幂等跳过。`), record: false };
          }
          const required = requiredGatesFor('proposal', project.paradigm);
          const missing = missingGates(project.root, required);
          if (missing.length > 0) {
            return {
              result: failure(`无法创建 proposal：缺少门控 ${missing.join('、')}。请先 /sg-gate 确认。`),
              record: false,
            };
          }
          const created = createChange(project.root, name, description);
          invalidateStatusCache(project.root);
          return {
            result: success(
              `已创建 ${created.name}：${created.path}\n下一步：补齐 proposal，然后 /sg-gate G3 confirm --yes。`,
            ),
            summary: `创建 Change ${name}`,
            record: false,
          };
        },
      );
    },
  });

  register({
    name: 'sg-apply',
    description: d('执行/查看 change：/sg-apply [name] [--plan]', 'Execute or inspect a change: /sg-apply [name] [--plan]'),
    input: { hint: '[name] [--plan]' },
    async handler(inv) {
      const list = parts(inv.rawInput);
      const planOnly = list.includes('--plan');
      const name = list.find((token) => token !== '--plan');
      const project = loadProject(runtime.getCwd(inv.agent));

      if (!name) {
        const status = computeStatus(project.root, { fresh: true });
        return success(renderNext(status));
      }
      if (!changeExists(project.root, name)) return failure(`Change 不存在：${name}`);

      if (planOnly) {
        try {
          const report = await dispatchChange({
            root: project.root,
            change: name,
            parent: inv.agent,
            runner: null,
            maxConcurrency: resolveMaxConcurrency(project.root, runtime.global.maxConcurrency),
            planOnly: true,
          });
          return success(renderDispatch(report, runtime.language(inv.agent)));
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error));
        }
      }

      const required = requiredGatesFor('source', project.paradigm);
      const missing = missingGates(project.root, required);
      if (missing.length > 0) {
        return failure(`无法执行实施：缺少门控 ${missing.join('、')}。请先 /sg-gate 确认。`);
      }

      const runner = createAgentRunner(ctx);
      if (!runner) {
        return failure('当前 DSH composition 没有 agents 服务，无法派发并行 Agent。');
      }

      return runMutation(
        project.root,
        { command: 'sg-apply', args: { name }, target: name, ttlMs: 0 },
        async () => {
          try {
            const report = await dispatchChange({
              root: project.root,
              change: name,
              parent: inv.agent,
              runner,
              maxConcurrency: resolveMaxConcurrency(project.root, runtime.global.maxConcurrency),
            });
            let reportPath = null;
            try {
              reportPath = writeDispatchReport(project.root, report, runtime.language(inv.agent));
            } catch {
              reportPath = null;
            }
            invalidateStatusCache(project.root);
            const language = runtime.language(inv.agent);
            const text = renderDispatch(report, language) + (reportPath ? `\n${language === 'en' ? 'Report' : '报告'}: ${reportPath}` : '');
            return {
              result: report.ok ? success(text) : failure(text),
              summary: `派发 ${name}`,
              record: false,
            };
          } catch (error) {
            return {
              result: failure(error instanceof Error ? error.message : String(error)),
              record: false,
            };
          }
        },
      );
    },
  });

  register({
    name: 'sg-archive',
    description: d('归档 change：/sg-archive <name>（需 G9）', 'Archive a change: /sg-archive <name> (requires G9)'),
    input: { hint: '<name>' },
    async handler(inv) {
      const name = parts(inv.rawInput)[0];
      if (!name) return failure('用法：/sg-archive <name>');
      const project = loadProject(runtime.getCwd(inv.agent));
      const archived = archivedPath(project.root, name);
      if (archived) {
        return success(`已归档在 ${archived}，幂等跳过。`);
      }
      if (!changeExists(project.root, name)) return failure(`Change 不存在：${name}`);
      if (!readGate(project.root, 'G9').satisfied) {
        return failure('无法归档：G9（审查通过/提交）尚未确认。');
      }
      return runMutation(
        project.root,
        { command: 'sg-archive', args: { name }, target: name, ttlMs: 0 },
        async () => {
          const archivedAgain = archivedPath(project.root, name);
          if (archivedAgain) {
            return {
              result: success(`已归档在 ${archivedAgain}，幂等跳过。`),
              record: false,
            };
          }
          if (!changeExists(project.root, name)) {
            return { result: failure(`Change 不存在：${name}`), record: false };
          }
          const result = archiveChange(project.root, name);
          invalidateStatusCache(project.root);
          return {
            result: success(`已归档到 ${result.path}`),
            summary: `归档 ${name}`,
            record: false,
          };
        },
      );
    },
  });

  register({
    name: 'sg-explore',
    description: d('查看 OpenSpec 探索/状态', 'Inspect OpenSpec exploration/status'),
    async handler(inv) {
      const project = loadProject(runtime.getCwd(inv.agent));
      const status = computeStatus(project.root, { fresh: true });
      return success(renderStatus(status));
    },
  });

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
