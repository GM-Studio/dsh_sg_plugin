import { initProject, createChange } from './change.js';
import { renderStatus } from './status.js';
import { ensureV3 } from './tools.js';
import { headCommit, isGitRepo } from './util/git.js';
import { loadSkill } from './skills.js';

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
    input: { hint: '' },
    async handler(inv) {
      const root = runtime.getCwd(inv?.agent);
      const result = initProject(root);
      if (!result.ok) return { kind: 'error', text: `初始化失败：${result.message}` };
      const changed = result.created.length > 0 ? `新建 ${result.created.length} 项` : '已完整，幂等跳过';
      return {
        kind: 'success',
        text: `SpecGate v3 已初始化（${changed}）。下一步：/sg-change <name> --type feature`,
      };
    },
  });

  register({
    name: 'sg-change',
    description: '创建 v3 change：/sg-change <name> [--type feature|modify|fix|remove] [--link <changeKey>]',
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
    description: '查看 SpecGate v3 项目状态：阶段、下一步、任务与证据',
    input: { hint: '' },
    async handler(inv) {
      const project = runtime.project(inv?.agent);
      return { kind: 'success', text: renderStatus(project) };
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
