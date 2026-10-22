const failure = (code, message) => ({ ok: false, code, message });

export function redact(value) {
  return String(value || '')
    .replace(
      /(?:\bBearer\s+[A-Za-z0-9._~+/-]{12,}|\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*["']?[^\s,;"']{6,})/gi,
      '<redacted>',
    )
    .replace(/[A-Za-z]:[\\/][^\s"'`，。；、)]+/g, '<local-path>')
    .replace(/\/(?:tmp|home|Users|opt|var|private)\/[^\s"'`，。；、)]+/g, '<local-path>')
    .slice(0, 16000);
}

export function validateFeishuWebhook(value) {
  if (typeof value !== 'string' || !value || value.length > 4096)
    return failure('FEISHU_WEBHOOK_INVALID', 'A Feishu webhook URL is required');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:')
      return failure('FEISHU_WEBHOOK_INVALID', 'Feishu webhook must use HTTPS');
    if (url.username || url.password)
      return failure('FEISHU_WEBHOOK_INVALID', 'Feishu webhook must not embed credentials');
    return { ok: true, url: url.href };
  } catch {
    return failure('FEISHU_WEBHOOK_INVALID', 'Feishu webhook URL is invalid');
  }
}

export function validateManagementUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4096)
    return failure('MANAGEMENT_URL_INVALID', 'A management URL is required');
  try {
    const url = new URL(value);
    const local =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !local)
      return failure('MANAGEMENT_URL_INVALID', 'Remote management links must use HTTPS');
    if (url.username || url.password)
      return failure('MANAGEMENT_URL_INVALID', 'Management URL must not embed credentials');
    return { ok: true, url: url.href };
  } catch {
    return failure('MANAGEMENT_URL_INVALID', 'Management URL is invalid');
  }
}

function attentionTitle(type) {
  const labels = {
    H1_APPROVAL: '需求确认',
    H3_APPROVAL: '发布审批',
    CLARIFICATION: '需要补充信息',
    BLOCKED: '执行阻塞',
    FAILED: '执行失败',
    OFFLINE: '宿主机离线',
    BUDGET: '运行预算',
    CUSTOMER_ACCEPTANCE: '客户验收',
    COMPLETION: '交付结果',
  };
  return labels[type] || '需要你的处理';
}

export function renderFeishuCard({
  workItem = {},
  attention = {},
  managementUrl,
  notification = null,
} = {}) {
  const target = validateManagementUrl(managementUrl);
  if (!target.ok) return target;
  const resolution =
    notification && typeof notification === 'object' && notification.kind === 'resolution';
  if (resolution) {
    const handled =
      notification.status === 'DECIDED' ||
      notification.status === 'SUPERSEDED' ||
      notification.status === 'EXPIRED';
    const title = handled ? 'SpecGate · 已处理' : 'SpecGate · 已失效';
    const outcome =
      notification.status === 'DECIDED'
        ? `已记录操作：${redact(notification.action || 'Decision')}`
        : notification.status === 'SUPERSEDED'
          ? '该请求已由更新版本替代。'
          : '该请求已过期。';
    return {
      ok: true,
      msg_type: 'interactive',
      card: {
        config: { wide_screen_mode: true, enable_forward: false },
        header: {
          template: notification.status === 'DECIDED' ? 'green' : 'grey',
          title: { tag: 'plain_text', content: title },
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: [
                `**${redact(workItem.title || workItem.workItemId || 'WorkItem')}**`,
                '',
                outcome,
                `**处理时间**：${redact(
                  notification.decidedAt || notification.updatedAt || new Date().toISOString(),
                )}`,
                '',
                '原消息不再可操作；请以管理端当前状态为准。',
              ].join('\n'),
            },
          },
          { tag: 'hr' },
          {
            tag: 'action',
            actions: [
              {
                tag: 'button',
                text: { tag: 'plain_text', content: '查看最新状态' },
                type: 'default',
                url: target.url,
              },
            ],
          },
        ],
      },
    };
  }
  const title = `SpecGate · ${attentionTitle(attention.type)}`;
  const workItemTitle = redact(workItem.title || workItem.workItemId || 'WorkItem');
  const reason = redact(attention.reason || '系统需要你的业务判断。');
  const question = redact(attention.question || '请查看当前结果并处理。');
  const summary = redact(attention.summary || '完整上下文请在管理端查看。');
  const risks = Array.isArray(attention.risks)
    ? attention.risks.map(redact).filter(Boolean).slice(0, 8)
    : [];
  const actions = Array.isArray(attention.actions)
    ? attention.actions
        .filter((entry) => typeof entry === 'string' && entry.length <= 128)
        .slice(0, 8)
    : [];
  const expiresAt =
    typeof attention.expiresAt === 'string' && Number.isFinite(Date.parse(attention.expiresAt))
      ? new Date(attention.expiresAt).toISOString()
      : '以管理端当前提示为准';
  const button = {
    tag: 'button',
    text: { tag: 'plain_text', content: '查看并安全处理' },
    type:
      attention.type === 'H1_APPROVAL' || attention.type === 'H3_APPROVAL' ? 'primary' : 'default',
    url: target.url,
  };
  return {
    ok: true,
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true, enable_forward: false },
      header: {
        template: attention.type === 'FAILED' || attention.type === 'OFFLINE' ? 'red' : 'orange',
        title: { tag: 'plain_text', content: title },
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: [
              `**${workItemTitle}**`,
              '',
              `**为什么需要你**：${reason}`,
              `**需要决定**：${question}`,
              `**当前结果**：${summary}`,
              `**可选动作**：${actions.length ? actions.join(' / ') : '查看详情'}`,
              `**风险**：${risks.length ? risks.join('；') : '详见管理端'}`,
              `**有效期**：${expiresAt}`,
            ].join('\n'),
          },
        },
        { tag: 'hr' },
        { tag: 'action', actions: [button] },
        {
          tag: 'note',
          elements: [
            {
              tag: 'plain_text',
              content: '按钮仅打开认证管理页；消息文字和按钮回调不是审批本身。',
            },
          ],
        },
      ],
    },
  };
}

function classifyFetchError(error) {
  if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR')
    return failure('FEISHU_TIMEOUT', 'Feishu notification timed out');
  return failure('FEISHU_NETWORK_ERROR', 'Feishu notification could not be delivered');
}

export function createFeishuNotifier({
  webhookUrl,
  fetchImpl = fetch,
  timeoutMs = 10000,
  clock = Date.now,
} = {}) {
  const webhook = validateFeishuWebhook(webhookUrl);
  if (!webhook.ok) throw new TypeError(webhook.message);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new TypeError('timeoutMs must be a positive integer');

  async function send(input) {
    const rendered = renderFeishuCard(input);
    if (!rendered.ok) return rendered;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = new Date(clock()).toISOString();
    try {
      const response = await fetchImpl(webhook.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(rendered),
        signal: controller.signal,
      });
      let body = {};
      try {
        body = await response.json();
      } catch {
        body = {};
      }
      if (!response.ok)
        return failure('FEISHU_HTTP_ERROR', `Feishu returned HTTP ${response.status}`);
      const code = body?.code ?? body?.StatusCode;
      if (code !== 0 && code !== undefined)
        return failure('FEISHU_API_ERROR', `Feishu rejected the notification (code ${code})`);
      return {
        ok: true,
        receipt: {
          provider: 'feishu',
          status: response.status,
          code: code ?? 0,
          messageId: body?.data?.message_id || body?.message_id || null,
          startedAt,
          finishedAt: new Date(clock()).toISOString(),
        },
      };
    } catch (error) {
      return classifyFetchError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ send });
}
