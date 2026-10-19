/**
 * REQ-009:在只含命令事件的新会话里，命令结果必须可见。
 * DSH 会把「只有命令事件」的会话留在欢迎页，因此追加一条 notice 上下文消息。
 * 端口自 dsh-plugin-ak47 的已验证实现，参数与约束保持一致。
 */

export function firstLine(text, fallback = 'SpecGate 命令完成') {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] || fallback;
}

export function noticeSummary(result, fallback) {
  if (result && typeof result === 'object' && typeof result.text === 'string') {
    return firstLine(result.text, fallback);
  }
  if (typeof result === 'string') return firstLine(result, fallback);
  return fallback || 'SpecGate 命令完成';
}

/** 新会话的第一条命令才需要 notice：非空会话与运行中的 agent 都不追加。 */
export function needsCommandNotice(session, agent) {
  if (!session || typeof session.append !== 'function') return false;
  if (agent && agent.status === 'running') return false;
  if (typeof session.deriveMessages === 'function') {
    return session.deriveMessages().length === 0;
  }
  return false;
}

export function appendCommandNotice(invocation, result, options = {}) {
  const session = options.session ?? (invocation && invocation.session);
  const agent = options.agent;
  if (!needsCommandNotice(session, agent)) return { appended: false, reason: 'not-eligible' };
  const summary = noticeSummary(result, options.fallback);
  const message = {
    role: 'user',
    source: {
      kind: options.kind || 'specgate',
      form: 'notice',
      summary,
    },
    content: [{ type: 'text', text: summary }],
  };
  try {
    // 只在会话末尾追加，绝不插入到工具调用与工具结果之间。
    session.append(message, { surfaceOp: 'append' });
  } catch {
    return { appended: false, reason: 'append-failed' };
  }
  return { appended: true, summary };
}

/**
 * 把命令结果交回会话：优先 agent.followup（活跃会话也能出现在对话历史），
 * 没有 followup 时才退回新会话 notice。
 */
export function deliverCommandResult(invocation, result, options = {}) {
  const agent = options.agent ?? invocation?.agent;
  const text = result && typeof result === 'object' ? result.text : result;
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return { delivered: false, reason: 'empty' };
  if (agent && typeof agent.followup === 'function' && agent.status !== 'running') {
    try {
      const pending = agent.followup({
        content: [{ type: 'text', text: String(text) }],
        source: { kind: options.kind || 'specgate' },
      });
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      return { delivered: true, via: 'followup' };
    } catch {
      // followup 不可用时退回 notice
    }
  }
  const appended = appendCommandNotice(invocation, result, options);
  return { delivered: appended.appended, via: 'notice', ...appended };
}

/** 包装命令 handler：抛出的异常也要变成可见的失败文本。 */
export function withNotice(handler, options = {}) {
  return async (invocation) => {
    let result;
    try {
      result = await handler(invocation);
    } catch (error) {
      result = {
        text: '命令执行失败：' + (error instanceof Error ? error.message : String(error)),
        failed: true,
      };
    }
    try {
      deliverCommandResult(invocation, result, {
        session: invocation && invocation.session,
        agent: invocation && invocation.agent,
        kind: options.kind,
        fallback: options.fallback,
      });
    } catch {
      // 结果交回只是可见性增强，失败不能影响命令结果。
    }
    return result;
  };
}
