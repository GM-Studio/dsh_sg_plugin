/* global document, history, location, alert */

const state = {
  csrfToken: null,
  currentView: 'attention',
  overview: null,
  workItems: [],
  attention: [],
  notifications: [],
  expandedProjects: new Set(),
  selectedWorkItemId: null,
  refreshTimer: null,
  abortController: null,
  action: null,
};

const elements = {
  app: document.querySelector('#app'),
  pairing: document.querySelector('#pairing'),
  workspace: document.querySelector('#workspace'),
  pairingForm: document.querySelector('#pairing-form'),
  pairingToken: document.querySelector('#pairing-token'),
  pairingError: document.querySelector('#pairing-error'),
  connection: document.querySelector('#connection'),
  refresh: document.querySelector('#refresh'),
  attentionCount: document.querySelector('#attention-count'),
  attentionList: document.querySelector('#attention-list'),
  projectList: document.querySelector('#project-list'),
  portfolioList: document.querySelector('#portfolio-list'),
  portfolioSummary: document.querySelector('#portfolio-summary'),
  workItemList: document.querySelector('#work-item-list'),
  monitoringList: document.querySelector('#monitoring-list'),
  notificationList: document.querySelector('#notification-list'),
  newWorkItemForm: document.querySelector('#new-work-item-form'),
  newWorkItemTitle: document.querySelector('#new-work-item-title'),
  newWorkItemRequest: document.querySelector('#new-work-item-request'),
  newWorkItemError: document.querySelector('#new-work-item-error'),
  filter: document.querySelector('#work-item-filter'),
  detail: document.querySelector('#detail'),
  detailTitle: document.querySelector('#detail-title'),
  detailContent: document.querySelector('#detail-content'),
  closeDetail: document.querySelector('#close-detail'),
  actionDialog: document.querySelector('#action-dialog'),
  actionForm: document.querySelector('#action-form'),
  actionTitle: document.querySelector('#action-title'),
  actionDescription: document.querySelector('#action-description'),
  actionComment: document.querySelector('#action-comment'),
  commentField: document.querySelector('#comment-field'),
  budgetField: document.querySelector('#budget-field'),
  budgetModels: document.querySelector('#action-budget-models'),
  stepUpField: document.querySelector('#step-up-field'),
  stepUpCode: document.querySelector('#step-up-code'),
  actionError: document.querySelector('#action-error'),
  cancelAction: document.querySelector('#cancel-action'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function statusLabel(status) {
  return (
    {
      QUEUED: '排队中',
      RUNNING: 'AI 执行中',
      WAITING_FOR_USER: '需要你决定',
      PAUSED: '已暂停',
      BLOCKED: '已阻塞',
      FAILED: '执行失败',
      COMPLETED: '已完成',
      CANCELLED: '已取消',
      OFFLINE: '宿主离线',
      INTERRUPTED: '执行中断',
    }[status] ||
    status ||
    '未知'
  );
}

// Cross-project attention severity, lowest rank first. Mirrors the control
// plane's ATTENTION_SEVERITY ordering so the console home matches the queue:
// high-risk human gates precede blocking/failure escalations, which precede
// routine clarifications and the terminal completion notice.
const ATTENTION_SEVERITY = {
  H1_APPROVAL: 0,
  H3_APPROVAL: 1,
  BLOCKED: 2,
  FAILED: 3,
  BUDGET: 4,
  CUSTOMER_ACCEPTANCE: 5,
  CLARIFICATION: 6,
  OFFLINE: 7,
  COMPLETION: 8,
};

function attentionSeverity(type) {
  const rank = ATTENTION_SEVERITY[type];
  return Number.isFinite(rank) ? rank : 99;
}

function timeValue(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareAttention(left, right) {
  return (
    attentionSeverity(left?.type) - attentionSeverity(right?.type) ||
    timeValue(left?.createdAt) - timeValue(right?.createdAt) ||
    String(left?.requestId || '').localeCompare(String(right?.requestId || ''))
  );
}

function setConnection(text, stateValue) {
  elements.connection.textContent = text;
  elements.connection.dataset.state = stateValue;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.method === 'POST' && state.csrfToken) headers.set('x-specgate-csrf', state.csrfToken);
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
    signal: options.signal,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = { ok: false, code: 'INVALID_RESPONSE', message: '服务返回了无法解析的响应' };
  }
  if (response.status === 401) showPairing();
  return { response, body };
}

async function openSession(token) {
  const { response, body } = await api('/api/session', {
    method: 'POST',
    body: { token },
  });
  if (!response.ok || !body.ok) throw new Error(body.message || '配对失败');
  state.csrfToken = body.csrfToken;
}

async function restoreSession() {
  const { response, body } = await api('/api/session');
  if (!response.ok || !body.ok) return false;
  state.csrfToken = body.csrfToken;
  return true;
}

function showPairing() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = null;
  state.csrfToken = null;
  elements.workspace.classList.add('hidden');
  elements.pairing.classList.remove('hidden');
  setConnection('未连接', 'offline');
}

function showWorkspace() {
  elements.pairing.classList.add('hidden');
  elements.workspace.classList.remove('hidden');
  setConnection('已连接', 'online');
}

function empty(message = '当前没有需要展示的内容') {
  return `<div class="empty-state"><strong>${escapeHtml(message)}</strong></div>`;
}

function renderAttention() {
  elements.attentionCount.textContent = String(state.attention.length);
  if (!state.attention.length) {
    elements.attentionList.innerHTML = empty('目前没有需要你处理的决定');
    return;
  }
  elements.attentionList.innerHTML = state.attention
    .map(
      (entry) => `
      <article class="attention-card">
        <div class="card-topline">
          <span class="status status-warning">${escapeHtml(entry.type || '决策')}</span>
          <span class="muted">${escapeHtml(entry.status || 'OPEN')}</span>
        </div>
        <h3>${escapeHtml(entry.question || entry.reason || '需要你的决定')}</h3>
        <p>${escapeHtml(entry.summary || entry.reason || '')}</p>
        <dl class="compact">
          <div><dt>项目</dt><dd>${escapeHtml(projectLabel(entry.projectId))}</dd></div>
          <div><dt>类型</dt><dd>${escapeHtml(entry.type || '决策')}</dd></div>
          <div><dt>失效时间</dt><dd>${escapeHtml(entry.expiresAt || '未设置')}</dd></div>
          <div><dt>版本</dt><dd>${escapeHtml(entry.revision || 1)}</dd></div>
        </dl>
        <div class="button-row">
          ${(entry.actions || [])
            .map(
              (action) =>
                `<button class="button ${action === 'approve' ? '' : 'secondary'}"
                   data-decision-action="${escapeHtml(action)}"
                   data-attention-id="${escapeHtml(entry.requestId)}"
                   data-work-item-id="${escapeHtml(entry.workItemId)}"
                   data-revision="${escapeHtml(entry.revision)}"
                   data-version="${escapeHtml(entry.workItemVersion)}"
                   data-artifact="${escapeHtml(entry.artifactHash)}"
                   data-attention-type="${escapeHtml(entry.type)}"
                   type="button">${escapeHtml(actionLabel(action))}</button>`,
            )
            .join('')}
          <button class="button ghost" data-open-work-item="${escapeHtml(entry.workItemId)}" type="button">查看详情</button>
        </div>
      </article>`,
    )
    .join('');
}

function actionLabel(action) {
  return (
    {
      approve: '安全检查并批准',
      request_changes: '要求修改',
      answer: '提交回答',
      pause: '暂停',
      resume: '恢复',
      retry: '重试',
      cancel: '取消 WorkItem',
      accept_delivery: '确认接收交付',
    }[action] || action
  );
}

function renderProjects() {
  const projects = state.overview?.projects || [];
  if (!projects.length) {
    elements.projectList.innerHTML = empty('还没有已登记项目');
    return;
  }
  elements.projectList.innerHTML = projects
    .map((project) => {
      const items = state.workItems.filter((item) => item.projectId === project.projectId);
      const running = items.filter((item) => item.executionState === 'RUNNING').length;
      const waiting = items.filter((item) => item.executionState === 'WAITING_FOR_USER').length;
      return `<article class="panel card">
        <div class="card-topline"><span class="status">${escapeHtml(project.status || 'READY')}</span></div>
        <h3>${escapeHtml(project.name || project.projectId)}</h3>
        <p class="muted">${escapeHtml(project.projectId)}</p>
        <dl class="metrics">
          <div><dt>WorkItems</dt><dd>${items.length}</dd></div>
          <div><dt>执行中</dt><dd>${running}</dd></div>
          <div><dt>待决策</dt><dd>${waiting}</dd></div>
        </dl>
      </article>`;
    })
    .join('');
}

function projectLabel(projectId) {
  const project = (state.overview?.projects || []).find((entry) => entry.projectId === projectId);
  return (project && project.name) || projectId || '未登记项目';
}

function hostHealthLabel(health) {
  return (
    {
      ONLINE: '宿主在线',
      OFFLINE: '宿主离线',
      INTERRUPTED: '宿主中断',
      SUSPECT: '宿主可疑',
    }[health] || '宿主未知'
  );
}

// Roll one project up from the WorkItems the projection already exposes:
// counts per executionState and the worst host health seen across its items.
function projectRollup(items) {
  const counts = { total: items.length, running: 0, waiting: 0, blocked: 0, failed: 0 };
  for (const item of items) {
    if (item.executionState === 'RUNNING') counts.running += 1;
    else if (item.executionState === 'WAITING_FOR_USER') counts.waiting += 1;
    else if (item.executionState === 'BLOCKED') counts.blocked += 1;
    else if (item.executionState === 'FAILED') counts.failed += 1;
  }
  const healths = items.map((item) => item.hostHealth).filter(Boolean);
  const hostHealth = healths.some((health) => ['OFFLINE', 'INTERRUPTED'].includes(health))
    ? 'OFFLINE'
    : healths.includes('SUSPECT')
      ? 'SUSPECT'
      : 'ONLINE';
  return { counts, hostHealth };
}

function portfolioItemRow(item) {
  return `<article class="work-item-row" data-open-work-item="${escapeHtml(item.workItemId)}" tabindex="0">
    <div>
      <div class="card-topline">
        <span class="status ${item.summary?.needsUser ? 'status-warning' : ''}">${escapeHtml(statusLabel(item.summary?.status || item.executionState))}</span>
        <span class="muted">${escapeHtml(item.priority || 'normal')}</span>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="muted">${escapeHtml(item.nextAction || '')}</p>
    </div>
    <div class="row-meta">
      <span>${escapeHtml(item.humanDecisionCount || 0)} 次决策</span>
      <span>${escapeHtml(item.updatedAt || '')}</span>
    </div>
  </article>`;
}

// Aggregate portfolio view: one row per registered project with its WorkItem
// counts, running/waiting/blocked/failed rollups and host health, expanding to
// that project's WorkItems. Built purely from /api/projects + /api/work-items.
function renderPortfolio() {
  const projects = state.overview?.projects || [];
  const totals = projectRollup(state.workItems);
  elements.portfolioSummary.innerHTML = `
    <div class="card-topline">
      <span class="status">组合 ${projects.length} 个项目</span>
      <span class="status ${totals.hostHealth === 'ONLINE' ? '' : 'status-error'}">${escapeHtml(hostHealthLabel(totals.hostHealth))}</span>
    </div>
    <dl class="metrics">
      <div><dt>WorkItems</dt><dd>${totals.counts.total}</dd></div>
      <div><dt>执行中</dt><dd>${totals.counts.running}</dd></div>
      <div><dt>待决策</dt><dd>${totals.counts.waiting}</dd></div>
      <div><dt>阻塞</dt><dd>${totals.counts.blocked}</dd></div>
      <div><dt>失败</dt><dd>${totals.counts.failed}</dd></div>
    </dl>`;
  if (!projects.length) {
    elements.portfolioList.innerHTML = empty('还没有已登记项目');
    return;
  }
  elements.portfolioList.innerHTML = projects
    .map((project) => {
      const items = state.workItems.filter((item) => item.projectId === project.projectId);
      const { counts, hostHealth } = projectRollup(items);
      const expanded = state.expandedProjects.has(project.projectId);
      return `<article class="portfolio-row${expanded ? ' expanded' : ''}">
        <div class="portfolio-head">
          <button class="project-toggle" data-project-toggle="${escapeHtml(project.projectId)}"
            aria-expanded="${expanded ? 'true' : 'false'}" type="button">
            <span class="portfolio-name">${escapeHtml(project.name || project.projectId)}</span>
            <span class="muted">${escapeHtml(project.projectId)}</span>
            <span class="status">${escapeHtml(project.status || 'READY')}</span>
          </button>
          <span class="status ${hostHealth === 'ONLINE' ? '' : 'status-error'}">${escapeHtml(hostHealthLabel(hostHealth))}</span>
        </div>
        <dl class="metrics">
          <div><dt>WorkItems</dt><dd>${counts.total}</dd></div>
          <div><dt>执行中</dt><dd>${counts.running}</dd></div>
          <div><dt>待决策</dt><dd>${counts.waiting}</dd></div>
          <div><dt>阻塞</dt><dd>${counts.blocked}</dd></div>
          <div><dt>失败</dt><dd>${counts.failed}</dd></div>
        </dl>
        ${
          expanded
            ? `<div class="portfolio-items">${
                items.length
                  ? items.map(portfolioItemRow).join('')
                  : '<p class="muted">该项目暂无 WorkItem</p>'
              }</div>`
            : ''
        }
      </article>`;
    })
    .join('');
}

function filteredWorkItems() {
  const filter = elements.filter.value;
  return filter
    ? state.workItems.filter((item) => item.executionState === filter)
    : state.workItems;
}

function renderWorkItems() {
  const items = filteredWorkItems();
  if (!items.length) {
    elements.workItemList.innerHTML = empty('没有匹配的 WorkItem');
    return;
  }
  elements.workItemList.innerHTML = items
    .map(
      (
        item,
      ) => `<article class="work-item-row" data-open-work-item="${escapeHtml(item.workItemId)}" tabindex="0">
        <div>
          <div class="card-topline">
            <span class="status ${item.summary?.needsUser ? 'status-warning' : ''}">${escapeHtml(statusLabel(item.summary?.status || item.executionState))}</span>
            <span class="muted">${escapeHtml(item.priority || 'normal')}</span>
          </div>
          <h3>${escapeHtml(item.title)}</h3>
          <p class="muted">${escapeHtml(item.nextAction || '')}</p>
        </div>
        <div class="row-meta">
          <span>${escapeHtml(item.humanDecisionCount || 0)} 次决策</span>
          <span>${escapeHtml(item.updatedAt || '')}</span>
        </div>
      </article>`,
    )
    .join('');
}

function renderMonitoring() {
  const items = state.workItems.filter((item) =>
    ['RUNNING', 'QUEUED', 'WAITING_FOR_USER', 'FAILED', 'BLOCKED'].includes(item.executionState),
  );
  if (!items.length) {
    elements.monitoringList.innerHTML = empty('没有正在运行或等待恢复的 WorkItem');
    return;
  }
  elements.monitoringList.innerHTML = items
    .map(
      (item) => `<article class="panel card">
        <div class="card-topline">
          <span class="status ${item.executionState === 'FAILED' ? 'status-error' : ''}">${escapeHtml(statusLabel(item.summary?.status || item.executionState))}</span>
          <span class="muted">${escapeHtml(item.hostHealth || 'ONLINE')}</span>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <p class="muted">${escapeHtml(item.nextAction || '')}</p>
        <dl class="compact">
          <div><dt>心跳</dt><dd>${escapeHtml(item.lastHeartbeatAt || '尚未开始')}</dd></div>
          <div><dt>预算</dt><dd>${escapeHtml(item.budgetUsage?.elapsedMs || 0)} ms</dd></div>
        </dl>
        <button class="button secondary" data-open-work-item="${escapeHtml(item.workItemId)}" type="button">打开详情</button>
      </article>`,
    )
    .join('');
}

function renderNotifications() {
  if (!state.notifications.length) {
    elements.notificationList.innerHTML = empty('尚无通知投递记录');
    return;
  }
  elements.notificationList.innerHTML = state.notifications
    .map(
      (entry) => `<article class="panel card">
        <div class="card-topline"><span class="status">${escapeHtml(entry.status)}</span><span class="muted">尝试 ${escapeHtml(entry.attemptCount || 0)}</span></div>
        <h3>${escapeHtml(entry.message?.title || entry.dedupeKey)}</h3>
        <p class="muted">${escapeHtml(entry.lastError?.message || '无投递错误')}</p>
        <p class="muted">${escapeHtml(entry.nextAttemptAt || '')}</p>
      </article>`,
    )
    .join('');
}

function renderAll() {
  renderAttention();
  renderPortfolio();
  renderProjects();
  renderWorkItems();
  renderMonitoring();
  renderNotifications();
}

async function refresh() {
  if (!state.csrfToken) return;
  state.abortController?.abort();
  const controller = new AbortController();
  state.abortController = controller;
  try {
    setConnection('同步中', 'syncing');
    const [overview, workItems, attention, notifications] = await Promise.all([
      api('/api/projects', { signal: controller.signal }),
      api('/api/work-items', { signal: controller.signal }),
      api('/api/attention', { signal: controller.signal }),
      api('/api/notifications', { signal: controller.signal }),
    ]);
    if ([overview, workItems, attention, notifications].some((entry) => !entry.response.ok))
      throw new Error('部分管理数据不可用');
    state.overview = { projects: overview.body.projects || [] };
    state.workItems = workItems.body.workItems || [];
    state.attention = (attention.body.attention || [])
      .filter((entry) => ['OPEN', 'DELIVERED', 'REMINDED'].includes(entry.status))
      .sort(compareAttention);
    state.notifications = notifications.body.notifications || [];
    renderAll();
    setConnection('已同步', 'online');
  } catch (error) {
    if (error.name !== 'AbortError') setConnection('同步失败', 'offline');
  } finally {
    if (state.abortController === controller) state.abortController = null;
  }
}

async function openDetail(workItemId) {
  state.selectedWorkItemId = workItemId;
  const { response, body } = await api(`/api/work-items/${encodeURIComponent(workItemId)}`);
  if (!response.ok || !body.ok) {
    await refresh();
    return;
  }
  const item = body.workItem;
  const run = body.run;
  elements.detailTitle.textContent = item.title;
  elements.detailContent.innerHTML = `
    <div class="detail-grid">
      <section>
        <h3>业务结果</h3>
        <p>${escapeHtml(item.nextAction || '')}</p>
        <dl class="compact">
          <div><dt>状态</dt><dd>${escapeHtml(statusLabel(item.summary?.status || item.executionState))}</dd></div>
          <div><dt>下一责任方</dt><dd>${escapeHtml(item.nextOwner)}</dd></div>
          <div><dt>人工决策</dt><dd>${escapeHtml(item.humanDecisionCount || 0)}</dd></div>
          <div><dt>最近心跳</dt><dd>${escapeHtml(item.lastHeartbeatAt || '无')}</dd></div>
        </dl>
        <details>
          <summary>Execution 技术细节</summary>
          <pre>${escapeHtml(JSON.stringify({ run, decisions: body.decisions, notifications: body.notifications }, null, 2))}</pre>
        </details>
        <details>
          <summary>Evidence 与风险</summary>
          <pre>${escapeHtml(JSON.stringify(item.outcome || {}, null, 2))}</pre>
        </details>
      </section>
      <aside>
        <h3>受控动作</h3>
        <div class="button-row">
          ${actionButton('pause', item, '暂停')}
          ${actionButton('resume', item, '恢复')}
          ${actionButton('retry', item, '重试')}
          ${actionButton('request-changes', item, '要求修改')}
          ${actionButton('cancel', item, '取消')}
        </div>
        <p class="muted">动作绑定当前版本；取消需要升级认证。</p>
      </aside>
    </div>`;
  elements.detail.classList.remove('hidden');
  elements.detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function actionButton(action, item, label) {
  return `<button class="button ${action === 'cancel' ? 'danger' : 'secondary'}"
    data-work-action="${action}"
    data-work-item-id="${escapeHtml(item.workItemId)}"
    data-version="${escapeHtml(item.revision)}"
    type="button">${escapeHtml(label)}</button>`;
}

function chooseView(view) {
  state.currentView = view;
  for (const button of document.querySelectorAll('[data-view]'))
    button.classList.toggle('active', button.dataset.view === view);
  for (const section of document.querySelectorAll('.view'))
    section.classList.toggle('hidden', section.id !== `view-${view}`);
}

function openActionDialog({
  title,
  description,
  needsComment = false,
  budgetCurrent = null,
  needsStepUp = false,
  action,
}) {
  state.action = action;
  elements.actionTitle.textContent = title;
  elements.actionDescription.textContent = description;
  elements.actionComment.value = '';
  elements.budgetModels.value =
    budgetCurrent === null ? '' : String(Math.min(2000000000, budgetCurrent * 2));
  elements.stepUpCode.value = '';
  elements.actionError.textContent = '';
  elements.commentField.classList.toggle('hidden', !needsComment);
  elements.budgetField.classList.toggle('hidden', budgetCurrent === null);
  elements.stepUpField.classList.toggle('hidden', !needsStepUp);
  elements.actionDialog.classList.remove('hidden');
  (needsComment
    ? elements.actionComment
    : budgetCurrent !== null
      ? elements.budgetModels
      : needsStepUp
        ? elements.stepUpCode
        : elements.actionForm
  ).focus?.();
}

function closeActionDialog() {
  state.action = null;
  elements.actionDialog.classList.add('hidden');
}

async function submitAction(event) {
  event.preventDefault();
  if (!state.action) return;
  const payload = { ...state.action.body };
  const decisionPayload = {
    ...(elements.commentField.classList.contains('hidden')
      ? {}
      : { comment: elements.actionComment.value }),
    ...(elements.budgetField.classList.contains('hidden')
      ? {}
      : { budget: { maxModelTokens: Number(elements.budgetModels.value) } }),
  };
  if (Object.keys(decisionPayload).length) payload.payload = decisionPayload;
  if (!elements.stepUpField.classList.contains('hidden'))
    payload.stepUpCode = elements.stepUpCode.value;
  const { response, body } = await api(state.action.path, {
    method: 'POST',
    body: payload,
  });
  if (!response.ok || !body.ok) {
    elements.actionError.textContent = body.message || '动作未完成';
    return;
  }
  closeActionDialog();
  await refresh();
  if (state.selectedWorkItemId) await openDetail(state.selectedWorkItemId);
}

async function runWorkAction(action, button) {
  const item = state.workItems.find((entry) => entry.workItemId === button.dataset.workItemId);
  if (!item) return;
  const base = {
    workItemId: item.workItemId,
    expectedVersion: Number(button.dataset.version),
    idempotencyKey: `web-${item.workItemId}-${action}-${button.dataset.version}`,
  };
  if (action === 'request-changes') {
    openActionDialog({
      title: '要求修改',
      description: '说明需要改变的业务结果；本说明会进入下一轮 AI 执行。',
      needsComment: true,
      action: { path: '/api/work-items/request-changes', body: base },
    });
    return;
  }
  if (action === 'cancel') {
    openActionDialog({
      title: '取消 WorkItem',
      description: '取消会终止当前工作。请输入升级认证码以继续。',
      needsStepUp: true,
      action: { path: '/api/work-items/cancel', body: base },
    });
    return;
  }
  const { response, body } = await api(`/api/work-items/${action}`, {
    method: 'POST',
    body: base,
  });
  if (!response.ok || !body.ok) alert(body.message || '动作未完成');
  await refresh();
  if (state.selectedWorkItemId) await openDetail(state.selectedWorkItemId);
}

function runDecision(button) {
  const action = button.dataset.decisionAction;
  const body = {
    workItemId: button.dataset.workItemId,
    attentionId: button.dataset.attentionId,
    attentionRevision: Number(button.dataset.revision),
    expectedWorkItemVersion: Number(button.dataset.version),
    artifactHash: button.dataset.artifact,
    action,
    idempotencyKey: `${button.dataset.attentionId}:${action}`,
  };
  if (action === 'request_changes' || action === 'answer') {
    openActionDialog({
      title: actionLabel(action),
      description: '补充业务说明后提交受控 Decision。',
      needsComment: true,
      needsStepUp: ['H1_APPROVAL', 'H3_APPROVAL', 'CUSTOMER_ACCEPTANCE'].includes(
        button.dataset.attentionType,
      ),
      action: { path: '/api/decisions', body },
    });
    return;
  }
  if (action === 'accept_delivery') {
    openActionDialog({
      title: actionLabel(action),
      description: '将先校验不可变 DeliveryRecord，再写入客户接受回执。请输入升级认证码。',
      needsStepUp: true,
      action: { path: '/api/deliveries/accept', body },
    });
    return;
  }
  if (action === 'resume' && button.dataset.attentionType === 'BUDGET') {
    const item = state.workItems.find((entry) => entry.workItemId === button.dataset.workItemId);
    openActionDialog({
      title: '增加预算并恢复',
      description: '输入高于当前上限的模型 Token 预算；该变更会进入受审计 Decision。',
      budgetCurrent: item?.budget?.maxModelTokens || 500000,
      needsStepUp: true,
      action: { path: '/api/decisions', body },
    });
    return;
  }
  openActionDialog({
    title: actionLabel(action),
    description: '高风险 Decision 需要升级认证码。对象和版本已绑定。',
    needsStepUp: true,
    action: { path: '/api/decisions', body },
  });
}

async function bootstrap() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const pairingToken = hash.get('token');
  if (pairingToken) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    try {
      await openSession(pairingToken);
    } catch (error) {
      elements.pairingError.textContent = error.message;
      showPairing();
      return;
    }
  } else if (!(await restoreSession())) {
    showPairing();
    return;
  }
  showWorkspace();
  await refresh();
  state.refreshTimer = setInterval(refresh, 4000);
}

elements.pairingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.pairingError.textContent = '';
  try {
    await openSession(elements.pairingToken.value.trim());
    elements.pairingToken.value = '';
    showWorkspace();
    await refresh();
    state.refreshTimer = setInterval(refresh, 4000);
  } catch (error) {
    elements.pairingError.textContent = error.message;
  }
});

elements.refresh.addEventListener('click', refresh);
elements.filter.addEventListener('change', renderWorkItems);
elements.newWorkItemForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.newWorkItemError.textContent = '';
  const { response, body } = await api('/api/work-items/create', {
    method: 'POST',
    body: {
      title: elements.newWorkItemTitle.value.trim(),
      request: elements.newWorkItemRequest.value.trim(),
    },
  });
  if (!response.ok || !body.ok) {
    elements.newWorkItemError.textContent = body.message || 'WorkItem 创建失败';
    return;
  }
  elements.newWorkItemForm.reset();
  await refresh();
  if (body.workItem?.workItemId) await openDetail(body.workItem.workItemId);
});
elements.closeDetail.addEventListener('click', () => elements.detail.classList.add('hidden'));
elements.cancelAction.addEventListener('click', closeActionDialog);
elements.actionForm.addEventListener('submit', submitAction);

document.addEventListener('click', async (event) => {
  const view = event.target.closest('[data-view]');
  if (view) chooseView(view.dataset.view);
  const toggle = event.target.closest('[data-project-toggle]');
  if (toggle) {
    const projectId = toggle.dataset.projectToggle;
    if (state.expandedProjects.has(projectId)) state.expandedProjects.delete(projectId);
    else state.expandedProjects.add(projectId);
    renderPortfolio();
  }
  const open = event.target.closest('[data-open-work-item]');
  if (open) await openDetail(open.dataset.openWorkItem);
  const workAction = event.target.closest('[data-work-action]');
  if (workAction) await runWorkAction(workAction.dataset.workAction, workAction);
  const decision = event.target.closest('[data-decision-action]');
  if (decision) runDecision(decision);
});

document.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('.work-item-row[data-open-work-item]');
  if (!row) return;
  event.preventDefault();
  await openDetail(row.dataset.openWorkItem);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  } else if (state.csrfToken && !state.refreshTimer) {
    void refresh();
    state.refreshTimer = setInterval(refresh, 4000);
  }
});

bootstrap();
