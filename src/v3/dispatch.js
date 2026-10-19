import { randomUUID } from 'node:crypto';

const ROLE_PROMPTS = {
  implementer:
    '你是 implementer。只修改源码与 docs，不要碰 tests、openspec/specs 或 change 包。完成后在 worktree 内 git commit，并只回复完成摘要与 commit hash。',
  tester:
    '你是 tester。只允许新增 openspec/changes/<change>/tests/automation/**，或修改 H2 清单内的测试文件。不要改源码。完成后 git commit。',
  reviewer:
    '你是 reviewer。只做审查，不修改任何文件。输出 JSON：{"verdict":"pass|fail","blocking":[{"file":"","line":0,"reason":""}],"nonBlocking":[]}。',
};

export function createDispatcher(runtime) {
  return async function dispatch({ role, task, worktree, prompt, skills = [], parent }) {
    const scripted = runtime.agentRunner();
    if (typeof scripted === 'function') {
      const result = await scripted({ role, task, worktree, prompt, skills });
      return {
        ok: result?.ok !== false,
        text: String(result?.text || ''),
        code: result?.code,
        message: result?.message,
      };
    }

    const agents = runtime.service('agents');
    if (!agents || typeof agents.create !== 'function') {
      return {
        ok: false,
        code: 'AGENTS_UNAVAILABLE',
        message: '宿主不提供 agents 服务，无法派发子 Agent',
      };
    }

    let handle;
    try {
      handle = await agents.create({
        sessionId: randomUUID(),
        parentAgent: parent,
        agentOptions: { ...(parent?.options || {}) },
        meta: { cwd: worktree, origin: 'specgate-v3' },
        setup(agentCtx) {
          const systemPrompt = agentCtx.get?.('systemPrompt');
          if (systemPrompt && typeof systemPrompt.context === 'function') {
            const text = [ROLE_PROMPTS[role] || '', ...skills.map((item) => item.text || '')]
              .filter(Boolean)
              .join('\n\n');
            systemPrompt.context({ name: 'specgate-v3-role', order: 50, text });
          }
        },
      });

      handle.agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'specgate-v3' },
      });
      await handle.agent.whenIdle();

      const messages = handle.agent.session.deriveMessages();
      const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
      const text = (assistant?.content || [])
        .filter((block) => block && block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();
      return { ok: true, text };
    } catch (error) {
      return {
        ok: false,
        code: 'DISPATCH_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      try {
        handle?.dispose?.();
      } catch {
        // ignore dispose failure
      }
    }
  };
}
