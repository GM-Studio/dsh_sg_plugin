import fs from 'node:fs';
import path from 'node:path';
import { initProject, createChange } from './change.js';
import { renderStatusAt, statusJsonAt, resolveRepoPath, loadProjectAt } from './status-query.js';
import { renderStatus } from './status.js';
import { exists } from './util/fsx.js';
import { ensureV3 } from './tools.js';
import { headCommit, isGitRepo } from './util/git.js';
import { loadSkill } from './skills.js';
import { suggestSuites } from './suites.js';
import { detectInitMode, startInitProject, collectContext } from './init.js';
import { writeText } from './util/fsx.js';
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

export function registerCommands(ctx, runtime) {
  const commands =
    ctx.commands || (typeof ctx.get === 'function' ? ctx.get('commands') : undefined);
  if (!commands) return () => {};

  const disposers = [];
  const register = (definition) => {
    try {
      const dispose = commands.register(definition);
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (error) {
      console.warn(`[specgate] failed to register command ${definition.name}:`, error);
    }
  };

  register({
    name: 'sg-init',
    description: '初始化 SpecGate v3 项目（创建 .specgate 配置与 openspec 目录）',
    input: { hint: '（无需参数）' },
    async handler(inv) {
      const root = runtime.getCwd(inv?.agent);
      const userQuestions = runtime.service('userQuestions');
      if (
        detectInitMode(root) === 'new' &&
        userQuestions &&
        typeof userQuestions.ask === 'function'
      ) {
        const result = await startInitProject({
          root,
          userQuestions,
          agent: inv?.agent,
          signal: inv?.signal,
        });
        if (!result.ok) return { kind: 'error', text: `初始化失败：${result.message}` };
        writeText(
          path.join(root, '.specgate', 'init-result.json'),
          `${JSON.stringify(result, null, 2)}\n`,
        );
        return {
          kind: 'success',
          text: [
            `已采集新建项目上下文（${result.context.stack}），阶段 H0_PENDING。`,
            '请执行 /sg-approve H0 审阅上下文；批准后执行 /sg-run 生成脚手架与首个 change。',
            '需要修改上下文时执行 /sg-context --reset。',
            '结构化结果：.specgate/init-result.json',
          ].join('\n'),
        };
      }
      const result = initProject(root);
      if (!result.ok) return { kind: 'error', text: `初始化失败：${result.message}` };
      const changed =
        result.created.length > 0 ? `新建 ${result.created.length} 项` : '已完整，幂等跳过';
      const suggestions = suggestSuites(root);
      const hint = suggestions.length
        ? `\n检测到可能的套件（仅建议，未写入配置）：${suggestions
            .map((suite) => `${suite.id}(${suite.kind}@${suite.cwd})`)
            .join('、')}`
        : '';
      return {
        kind: 'success',
        text: `SpecGate v3 已初始化（${changed}）。下一步：/sg-change <name> --type feature${hint}`,
      };
    },
  });

  register({
    name: 'sg-change',
    description:
      '创建 v3 change：/sg-change <name> [--type feature|modify|fix|remove] [--link <changeKey>]',
    input: { hint: '<name> [--type feature|modify|fix|remove] [--link <changeKey>]' },
    async handler(inv) {
      const project = runtime.project(inv?.agent);
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
        text: '已回到 H0_PENDING 并重新采集上下文。请 /sg-approve H0；批准后 /sg-run 重新生成脚手架。',
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
