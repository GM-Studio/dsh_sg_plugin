import fs from 'node:fs';
import path from 'node:path';
import { createChange } from './change.js';
import { renderStatusAt, statusJsonAt, resolveRepoPath, loadProjectAt } from './status-query.js';
import { renderStatus } from './status.js';
import { exists } from './util/fsx.js';
import { ensureV3 } from './tools.js';
import { headCommit, isGitRepo } from './util/git.js';
import { loadSkill } from './skills.js';
import { collectContext, inspectInit, startRequirementsInit, summarizeInitResult } from './init.js';
import { withNotice } from './notice.js';
import { maybeBuildBootstrap } from './bootstrap.js';
import { resolveInitRoot, shouldUseV4Default, startV4Init, summarizeV4Result } from '../v4/init.js';
import { adoptWorkspace, summarizeAdopt } from '../v4/adopt.js';
import { readWorkspace } from '../v4/workspace.js';
import {
  prepareWorkspaceChange,
  startWorkspaceChange,
  summarizeWorkspaceChange,
} from '../v4/workspace-change.js';
import { digest } from './util/hash.js';
import { patchState } from './state.js';

function tokens(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function parseChangeArgs(rawInput) {
  const parts = tokens(rawInput);
  let name = '';
  let type = 'feature';
  let link = null;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === '--type' || part === '-t') {
      type = parts[index + 1] || type;
      index += 1;
    } else if (part === '--link' || part === '-l') {
      link = parts[index + 1] || null;
      index += 1;
    } else if (!part.startsWith('-') && !name) {
      name = part;
    }
  }
  return { name, type, link };
}

function splitArgs(raw) {
  const text = String(raw || '');
  const out = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match = pattern.exec(text);
  while (match) {
    out.push(match[1] ?? match[2] ?? match[3]);
    match = pattern.exec(text);
  }
  return out;
}

/** /sg-init [-req <path>] [自由描述] */
export function parseInitArgs(rawInput) {
  const parts = splitArgs(rawInput);
  let req = null;
  let v4 = false;
  let adopt = false;
  let v3 = false;
  let targetPath = null;
  let backend = null;
  let frontend = null;
  let preset = null;
  const rest = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === '-req' || part === '--req') {
      const value = parts[index + 1];
      if (!value) {
        return { ok: false, code: 'E_ARGS_CONFLICT', message: '-req 需要一个文档路径' };
      }
      req = value;
      index += 1;
    } else if (part === '--v4') {
      v4 = true;
    } else if (part === '--adopt') {
      adopt = true;
    } else if (part === '--v3') {
      v3 = true;
    } else if (part === '--path') {
      const value = parts[index + 1];
      if (!value) return { ok: false, code: 'E_ARGS_CONFLICT', message: '--path 需要一个目录路径' };
      targetPath = value;
      index += 1;
    } else if (part === '--backend' || part === '--frontend' || part === '--preset') {
      const value = parts[index + 1];
      if (!value) {
        return { ok: false, code: 'E_ARGS_CONFLICT', message: part + ' 需要一个值' };
      }
      if (part === '--backend') backend = value;
      if (part === '--frontend') frontend = value;
      if (part === '--preset') preset = value;
      index += 1;
    } else {
      rest.push(part);
    }
  }
  if (req && rest.length) {
    return {
      ok: false,
      code: 'E_ARGS_CONFLICT',
      message: '-req 与自由描述不能同时使用',
    };
  }
  return {
    ok: true,
    req,
    v4,
    adopt,
    v3,
    path: targetPath,
    backend,
    frontend,
    preset,
    description: rest.join(' ').trim(),
  };
}

export function registerCommands(ctx, runtime) {
  const commands =
    ctx.commands || (typeof ctx.get === 'function' ? ctx.get('commands') : undefined);
  if (!commands) return () => {};

  const disposers = [];
  const register = (definition) => {
    try {
      const dispose = commands.register({
        ...definition,
        handler: withNotice(definition.handler, { forceNotice: definition.name === 'sg-init' }),
      });
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (error) {
      console.warn(`[specgate] failed to register command ${definition.name}:`, error);
    }
  };

  register({
    name: 'sg-init',
    description:
      '初始化 SpecGate v4：/sg-init [--path <目录>] [--backend node|python|java|none] [--frontend vue|react|none] [--preset <name>] [--adopt]。' +
      '未指定 --path 时使用当前目录；v3 兼容：[-req <需求文档>] [自由描述] [--v3]。',
    input: { hint: '[--path <目录>] [--backend ...] [--frontend ...] [--preset ...] [--adopt]' },
    async handler(inv) {
      const cwd = runtime.getCwd(inv?.agent);
      const userQuestions = runtime.service('userQuestions');
      const parsed = parseInitArgs(inv?.rawInput);
      if (!parsed.ok) {
        return { kind: 'error', text: '初始化失败（' + parsed.code + '）：' + parsed.message };
      }
      const resolved = resolveInitRoot(cwd, parsed.path, { create: !parsed.adopt });
      if (!resolved.ok) {
        return { kind: 'error', text: '初始化失败（' + resolved.code + '）：' + resolved.message };
      }
      const root = resolved.root;

      if (parsed.adopt) {
        const adopted = adoptWorkspace({ root });
        if (!adopted.ok) return { kind: 'error', text: summarizeAdopt(adopted) };
        return { kind: 'success', text: summarizeAdopt(adopted) };
      }

      if (!parsed.v3 && (parsed.v4 || shouldUseV4Default(root, { v3: parsed.v3 }))) {
        const v4 = await startV4Init({
          root,
          userQuestions,
          agent: inv?.agent,
          signal: inv?.signal,
          backend: parsed.backend,
          frontend: parsed.frontend,
          preset: parsed.preset,
        });
        if (!v4.ok) return { kind: 'error', text: summarizeV4Result(v4) };
        return { kind: 'success', text: summarizeV4Result(v4) };
      }

      const guard = inspectInit(root);
      if (guard.skip) {
        return {
          kind: 'success',
          text: summarizeInitResult({
            ...guard,
            ok: true,
            skipped: true,
          }),
        };
      }

      let result = await startRequirementsInit({
        root,
        userQuestions,
        agent: inv?.agent,
        signal: inv?.signal,
        req: parsed.req,
        description: parsed.description,
      });
      if (!result.ok) {
        return { kind: 'error', text: summarizeInitResult(result) };
      }
      const built = await maybeBuildBootstrap({
        root,
        result,
        runtime,
        agent: inv?.agent,
      });
      if (!built.ok) return { kind: 'error', text: summarizeInitResult(built) };
      if (built.result) result = built.result;
      if (built.skipped && built.reason) result = { ...result, autoBuildSkipped: built.reason };
      return { kind: 'success', text: summarizeInitResult(result) };
    },
  });

  register({
    name: 'sg-change',
    description:
      '创建 v3 change：/sg-change <name> [--type feature|modify|fix|remove] [--link <changeKey>]',
    input: { hint: '<name> [--type feature|modify|fix|remove] [--link <changeKey>]' },
    async handler(inv) {
      const project = runtime.project(inv?.agent);
      const workspace = readWorkspace(project.root);
      if (workspace) {
        const { name, type } = parseChangeArgs(inv?.rawInput);
        if (!name)
          return {
            kind: 'error',
            text: '用法：/sg-change <name> [--type feature|modify|fix|remove]',
          };
        const prepared = await prepareWorkspaceChange({
          root: project.root,
          name,
          type,
          userQuestions: runtime.service('userQuestions'),
          agent: inv?.agent,
          signal: inv?.signal,
        });
        if (!prepared.ok) {
          return { kind: 'error', text: prepared.message || prepared.code };
        }
        const result = startWorkspaceChange({
          root: project.root,
          name,
          type,
          requirements: prepared.requirements,
        });
        if (!result.ok) return { kind: 'error', text: summarizeWorkspaceChange(result) };
        return { kind: 'success', text: summarizeWorkspaceChange(result) };
      }
      const guard = ensureV3(project);
      if (!guard.ok) return { kind: 'error', text: guard.message };

      const { name, type, link } = parseChangeArgs(inv?.rawInput);
      if (!name) {
        return {
          kind: 'error',
          text: '用法：/sg-change <name> [--type feature|modify|fix|remove] [--link <changeKey>]',
        };
      }
      const baseCommit = isGitRepo(project.root) ? headCommit(project.root) : null;
      const result = createChange(project.root, { name, type, baseCommit, changeKey: link });
      if (!result.ok) return { kind: 'error', text: result.message };
      return {
        kind: 'success',
        text: `已创建 change ${name}（${type}），阶段 H1_PENDING。下一步：写 proposal 与 specs delta，然后 /sg-run`,
      };
    },
  });

  register({
    name: 'sg-status',
    description: '查看 SpecGate v3 状态：/sg-status [--path <repo>] [--json] [--verbose]',
    input: { hint: '[--path <repo>] [--json] [--verbose]' },
    async handler(inv) {
      const args = tokens(inv?.rawInput);
      let pathArg = null;
      let json = false;
      let verbose = false;
      for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--path') {
          pathArg = args[index + 1];
          index += 1;
          if (!pathArg) return { kind: 'error', text: '--path 需要目录参数' };
        } else if (args[index] === '--json') json = true;
        else if (args[index] === '--verbose') verbose = true;
        else return { kind: 'error', text: `未知参数：${args[index]}` };
      }
      const cwd = runtime.getCwd(inv?.agent);
      if (!pathArg && !exists(path.join(cwd, '.specgate', 'state.json'))) {
        const project = { root: cwd, state: null, config: {} };
        const data = statusJsonAt(project, { verbose });
        return {
          kind: 'success',
          text: json ? JSON.stringify(data, null, 2) : renderStatus(project),
        };
      }
      const resolved = resolveRepoPath(cwd, pathArg);
      if (!resolved.ok) return { kind: 'error', text: `${resolved.code}：${resolved.message}` };
      const loaded = loadProjectAt(resolved.root);
      if (!loaded.ok)
        return { kind: 'error', text: `${loaded.code || 'STATE_INVALID'}：${loaded.message}` };
      if (json) {
        return {
          kind: 'success',
          text: JSON.stringify(statusJsonAt(loaded.project, { verbose }), null, 2),
        };
      }
      return { kind: 'success', text: renderStatusAt(loaded.project, { verbose }) };
    },
  });

  register({
    name: 'sg-context',
    description: 'H0 上下文回退：/sg-context --reset',
    input: { hint: '--reset' },
    async handler(inv) {
      const project = runtime.project(inv?.agent);
      const guard = ensureV3(project);
      if (!guard.ok) return { kind: 'error', text: guard.message };
      if (tokens(inv?.rawInput).join(' ') !== '--reset') {
        return { kind: 'error', text: '用法：/sg-context --reset（仅用于回到 H0 重新确认上下文）' };
      }
      if (!project.state || !['H0_PENDING', 'H1_PENDING'].includes(project.state.phase)) {
        return { kind: 'error', text: `当前阶段 ${project.state?.phase || '未知'} 不能回退 H0` };
      }
      const userQuestions = runtime.service('userQuestions');
      if (!userQuestions || typeof userQuestions.ask !== 'function') {
        return { kind: 'error', text: '回退上下文需要用户问答通道' };
      }
      if (project.state.phase === 'H1_PENDING' && project.state.change) {
        fs.rmSync(path.join(project.root, 'openspec', 'changes', project.state.change), {
          recursive: true,
          force: true,
        });
      }
      const context = await collectContext({
        userQuestions,
        agent: inv?.agent,
        signal: inv?.signal,
      });
      patchState(project.root, (draft) => {
        draft.phase = 'H0_PENDING';
        draft.change = null;
        draft.context = context;
        draft.h0 = { hash: digest(JSON.stringify(context)), approvedAt: null };
        draft.approvals.H0 = {
          artifactHash: null,
          issuedAt: null,
          expiresAt: null,
          consumedAt: null,
        };
      });
      return {
        kind: 'success',
        text: '已回到 H0_PENDING 并重新采集上下文。请调用 sg_approve 工具（gate="H0"）；批准后 /sg-run 重新生成脚手架。',
      };
    },
  });

  register({
    name: 'sg-skill',
    description: '加载技能正文：/sg-skill <name>',
    input: { hint: '<name>' },
    async handler(inv) {
      const id = tokens(inv?.rawInput)[0];
      if (!id) return { kind: 'error', text: '用法：/sg-skill <name>' };
      const text = loadSkill(id);
      if (!text) return { kind: 'error', text: `未知技能：${id}` };
      return { kind: 'success', text };
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
