import { createWebhookAdapter, redactNotificationText, validateWebhookUrl } from './adapter.js';
import { validateManagementUrl } from './feishu.js';

const failure = (code, message) => ({ ok: false, code, message });

export function validateDingTalkWebhook(value) {
  const checked = validateWebhookUrl(value);
  return checked.ok
    ? checked
    : failure('DINGTALK_WEBHOOK_INVALID', 'A DingTalk HTTPS webhook URL is required');
}

function attentionTitle(type) {
  return (
    {
      H1_APPROVAL: '需求确认',
      H3_APPROVAL: '发布审批',
      CLARIFICATION: '需要补充信息',
      BLOCKED: '执行阻塞',
      FAILED: '执行失败',
      OFFLINE: '宿主机离线',
      BUDGET: '运行预算',
      CUSTOMER_ACCEPTANCE: '客户验收',
      COMPLETION: '交付结果',
    }[type] || '需要你的处理'
  );
}

function notificationTitle(notification) {
  const stage = notification.stage || notification.outcome || notification.status;
  if (stage === 'completed') return 'SpecGate · 已完成';
  if (stage === 'recovered') return 'SpecGate · 已恢复';
  if (stage === 'failed' || stage === 'EXPIRED' || stage === 'expired') return 'SpecGate · 已失效';
  if (stage === 'error') return 'SpecGate · 执行异常';
  if (notification.kind === 'resolution') return 'SpecGate · 已处理';
  return null;
}

export function renderDingTalkCard({
  workItem = {},
  attention = {},
  notification = null,
  managementUrl,
} = {}) {
  const target = validateManagementUrl(managementUrl);
  if (!target.ok) return failure('DINGTALK_MANAGEMENT_URL_INVALID', target.message);
  const title = redactNotificationText(workItem.title || workItem.workItemId || 'WorkItem');
  const followup = notification && typeof notification === 'object';
  const followupTitle = followup ? notificationTitle(notification) : null;
  if (followupTitle) {
    const outcome =
      notification.summary ||
      notification.nextAction ||
      (notification.status === 'DECIDED'
        ? `已记录操作：${notification.action || 'Decision'}`
        : notification.status === 'SUPERSEDED'
          ? '该请求已由更新版本替代。'
          : notification.stage === 'completed'
            ? '交付流程已完成。'
            : notification.stage === 'recovered'
              ? '执行已恢复。'
              : notification.stage === 'failed'
                ? '执行未完成，请打开管理端处理。'
                : '该请求已过期。');
    return {
      ok: true,
      body: {
        msgtype: 'actionCard',
        actionCard: {
          title: followupTitle,
          text: [
            `### ${title}`,
            '',
            redactNotificationText(outcome),
            '',
            '原消息不再可操作；请以认证管理端当前状态为准。',
          ].join('\n\n'),
          btnOrientation: '0',
          singleTitle: '查看最新状态',
          singleURL: target.url,
        },
      },
    };
  }

  const risks = Array.isArray(attention.risks)
    ? attention.risks.map(redactNotificationText).filter(Boolean).slice(0, 8)
    : [];
  const actions = Array.isArray(attention.actions)
    ? attention.actions
        .filter((entry) => typeof entry === 'string' && entry.length <= 128)
        .map(redactNotificationText)
        .slice(0, 8)
    : [];
  const expiresAt =
    typeof attention.expiresAt === 'string' && Number.isFinite(Date.parse(attention.expiresAt))
      ? new Date(attention.expiresAt).toISOString()
      : '以管理端当前提示为准';
  return {
    ok: true,
    body: {
      msgtype: 'actionCard',
      actionCard: {
        title: `SpecGate · ${attentionTitle(attention.type)}`,
        text: [
          `### ${title}`,
          `**为什么需要你**：${redactNotificationText(
            attention.reason || '系统需要你的业务判断。',
          )}`,
          `**需要决定**：${redactNotificationText(attention.question || '请查看当前结果并处理。')}`,
          `**当前结果**：${redactNotificationText(
            attention.summary || '完整上下文请在管理端查看。',
          )}`,
          `**可选动作**：${actions.length ? actions.join(' / ') : '查看详情'}`,
          `**风险**：${risks.length ? risks.join('；') : '详见管理端'}`,
          `**有效期**：${expiresAt}`,
        ].join('\n\n'),
        btnOrientation: '0',
        singleTitle: '查看并安全处理',
        singleURL: target.url,
      },
    },
  };
}

export function createDingTalkNotifier(options = {}) {
  for (const key of ['callbackUrl', 'callback', 'onMessage', 'listen', 'receive', 'handle']) {
    if (Object.hasOwn(options, key))
      throw new TypeError('Inbound callbacks are not supported by outbound channel adapters');
  }
  const {
    webhookUrl,
    fetchImpl = fetch,
    timeoutMs = 10_000,
    clock = Date.now,
    dedupeLimit = 1024,
  } = options;
  const checked = validateDingTalkWebhook(webhookUrl);
  if (!checked.ok) throw new TypeError(checked.message);
  return createWebhookAdapter({
    name: 'dingtalk',
    webhookUrl: checked.url,
    render: renderDingTalkCard,
    fetchImpl,
    timeoutMs,
    clock,
    dedupeLimit,
  });
}

export const createDingTalkAdapter = createDingTalkNotifier;
