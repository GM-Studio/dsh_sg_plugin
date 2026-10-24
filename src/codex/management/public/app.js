/* global alert, document, EventSource, history, location */

const DEVICE_ID_STORAGE_KEY = 'specgate.auth.deviceId';
const STEP_UP_ERROR_CODES = new Set([
  'STEP_UP_REQUIRED',
  'STEP_UP_EXPIRED',
  'CHALLENGE_EXPIRED',
  'STEP_UP_CHALLENGE_EXPIRED',
  'STEP_UP_PROOF_EXPIRED',
  'STEP_UP_PROOF_REPLAYED',
  'STEP_UP_BINDING_MISMATCH',
]);

const state = {
  authMode: null,
  csrfToken: null,
  user: null,
  deviceId: null,
  devices: [],
  deepLink: null,
  currentView: 'attention',
  overview: null,
  workItems: [],
  attention: [],
  notifications: [],
  inboxVersion: 0,
  inboxFilters: { projectId: '', risk: '', status: '' },
  eventSource: null,
  refreshDebounce: null,
  expandedProjects: new Set(),
  selectedWorkItemId: null,
  refreshTimer: null,
  abortController: null,
  action: null,
  actionConfig: null,
};

const elements = {
  app: document.querySelector('#app'),
  auth: document.querySelector('#auth'),
  accountLogin: document.querySelector('#account-login'),
  accountLoginForm: document.querySelector('#account-login-form'),
  loginUsername: document.querySelector('#login-username'),
  loginPassword: document.querySelector('#login-password'),
  loginTotp: document.querySelector('#login-totp'),
  loginDeviceName: document.querySelector('#login-device-name'),
  loginDeviceConfirmation: document.querySelector('#login-device-confirmation'),
  accountLoginError: document.querySelector('#account-login-error'),
  pairing: document.querySelector('#pairing'),
  workspace: document.querySelector('#workspace'),
  pairingForm: document.querySelector('#pairing-form'),
  pairingToken: document.querySelector('#pairing-token'),
  pairingError: document.querySelector('#pairing-error'),
  authNotice: document.querySelector('#auth-notice'),
  workspaceNotice: document.querySelector('#workspace-notice'),
  currentUser: document.querySelector('#current-user'),
  connection: document.querySelector('#connection'),
  refresh: document.querySelector('#refresh'),
  logout: document.querySelector('#logout'),
  attentionCount: document.querySelector('#attention-count'),
  inboxProjectFilter: document.querySelector('#inbox-project-filter'),
  inboxRiskFilter: document.querySelector('#inbox-risk-filter'),
  inboxStatusFilter: document.querySelector('#inbox-status-filter'),
  securityNav: document.querySelector('[data-view="security"]'),
  attentionList: document.querySelector('#attention-list'),
  projectList: document.querySelector('#project-list'),
  portfolioList: document.querySelector('#portfolio-list'),
  portfolioSummary: document.querySelector('#portfolio-summary'),
  workItemList: document.querySelector('#work-item-list'),
  monitoringList: document.querySelector('#monitoring-list'),
  notificationList: document.querySelector('#notification-list'),
  securitySummary: document.querySelector('#security-summary'),
  securityError: document.querySelector('#security-error'),
  deviceList: document.querySelector('#device-list'),
  refreshDevices: document.querySelector('#refresh-devices'),
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
  stepUpLabel: document.querySelector('#step-up-label'),
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
  if (response.status === 401) showAuthRequired();
  return { response, body };
}

function generateDeviceId() {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  const bytes = webCrypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function persistentDeviceId() {
  if (state.deviceId) return state.deviceId;
  try {
    const stored = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (stored && /^[A-Za-z0-9_-]{16,128}$/.test(stored)) state.deviceId = stored;
  } catch {
    // Storage can be disabled; the in-memory id still keeps this page coherent.
  }
  if (!state.deviceId) {
    const deviceId = generateDeviceId();
    state.deviceId = deviceId;
    try {
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
    } catch {
      // A non-persistent device id is safer than storing any credential here.
    }
  }
  return state.deviceId;
}

function defaultDeviceName() {
  const platform = String(navigator.platform || '').trim();
  return platform ? `${platform} 浏览器` : '浏览器设备';
}

function setAuthNotice(message = '') {
  elements.authNotice.textContent = message;
  elements.authNotice.classList.toggle('hidden', !message);
}

function setWorkspaceNotice(message = '') {
  elements.workspaceNotice.textContent = message;
  elements.workspaceNotice.classList.toggle('hidden', !message);
}

function setSession(body) {
  state.csrfToken = body.csrfToken;
  state.user = body.user || state.user;
}

async function openPairingSession(token) {
  const { response, body } = await api('/api/session', {
    method: 'POST',
    body: { token },
  });
  if (!response.ok || !body.ok) throw new Error(body.message || '配对失败');
  setSession(body);
}

async function restoreSession() {
  const { response, body } = await api('/api/session');
  if (!response.ok || !body.ok) return false;
  setSession(body);
  return true;
}

function hideWorkspaceForAuthentication() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = null;
  clearTimeout(state.refreshDebounce);
  state.refreshDebounce = null;
  state.eventSource?.close();
  state.eventSource = null;
  state.abortController?.abort();
  state.csrfToken = null;
  state.action = null;
  state.actionConfig = null;
  elements.actionDialog.classList.add('hidden');
  elements.workspace.classList.add('hidden');
  elements.auth.classList.remove('hidden');
  elements.logout.classList.add('hidden');
  elements.currentUser.classList.add('hidden');
  setConnection('未连接', 'offline');
}

function showAuthRequired(notice = '') {
  const mode = state.authMode || 'account';
  hideWorkspaceForAuthentication();
  elements.accountLogin.classList.toggle('hidden', mode !== 'account');
  elements.pairing.classList.toggle('hidden', mode !== 'pairing');
  elements.accountLoginError.textContent = '';
  elements.pairingError.textContent = '';
  if (mode === 'account') {
    elements.loginUsername.focus?.();
    if (!elements.loginDeviceName.value) elements.loginDeviceName.value = defaultDeviceName();
  } else {
    elements.pairingToken.focus?.();
  }
  setAuthNotice(notice);
}

function showWorkspace() {
  elements.auth.classList.add('hidden');
  elements.pairing.classList.add('hidden');
  elements.accountLogin.classList.add('hidden');
  elements.workspace.classList.remove('hidden');
  elements.securityNav.classList.toggle('hidden', state.authMode !== 'account');
  if (state.authMode === 'account') {
    elements.logout.classList.remove('hidden');
    elements.currentUser.textContent =
      state.user?.displayName || state.user?.username || state.user?.email || '已认证 Owner';
    elements.currentUser.classList.remove('hidden');
  } else if (state.currentView === 'security') {
    chooseView('attention');
  }
  setConnection('已连接', 'online');
}

function captureDeepLink() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const attentionId = hash.get('attention');
  const nonce = hash.get('nonce');
  const pairingToken = hash.get('token');
  if (pairingToken) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
  if (!attentionId && !nonce) return { pairingToken };
  state.deepLink = { attentionId: attentionId || null, nonce: nonce || null };
  // Keep the nonce in memory for one redemption only; never leave it in history.
  history.replaceState(
    null,
    '',
    `${location.pathname}${location.search}${
      attentionId ? `#attention=${encodeURIComponent(attentionId)}` : ''
    }`,
  );
  return { pairingToken };
}

async function redeemDeepLink() {
  if (!state.deepLink?.nonce) return true;
  const nonce = state.deepLink.nonce;
  state.deepLink.nonce = null;
  const { response, body } = await api('/api/auth/attention/redeem', {
    method: 'POST',
    body: { nonce },
  });
  if (!response.ok || !body.ok) {
    const message =
      body.message || '该消息链接已失效或无权访问。链接不会建立管理会话，请从受信任入口重新登录。';
    setAuthNotice(message);
    setWorkspaceNotice(message);
    return false;
  }
  const attentionId = body.attentionId || state.deepLink.attentionId;
  if (attentionId) state.deepLink = { attentionId, nonce: null };
  chooseView('attention');
  setAuthNotice('');
  setWorkspaceNotice('');
  return true;
}

function focusDeepLinkedAttention() {
  const attentionId = state.deepLink?.attentionId;
  if (!attentionId) return;
  for (const card of document.querySelectorAll('[data-attention-card]')) {
    if (card.dataset.attentionCard !== attentionId) continue;
    card.classList.add('focused');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
}

function empty(message = '当前没有需要展示的内容') {
  return `<div class="empty-state"><strong>${escapeHtml(message)}</strong></div>`;
}

function renderInboxFilters() {
  const projects = state.overview?.projects || [];
  const selected = state.inboxFilters.projectId;
  elements.inboxProjectFilter.innerHTML = [
    '<option value="">全部项目</option>',
    ...projects.map(
      (project) =>
        `<option value="${escapeHtml(project.projectId)}">${escapeHtml(
          project.name || project.projectId,
        )}</option>`,
    ),
  ].join('');
  elements.inboxProjectFilter.value = selected;
}

function renderAttention() {
  renderInboxFilters();
  elements.attentionCount.textContent = String(state.attention.length);
  if (!state.attention.length) {
    elements.attentionList.innerHTML = empty('目前没有需要你处理的决定');
    return;
  }
  elements.attentionList.innerHTML = state.attention
    .map(
      (entry) => `
      <article class="attention-card" data-attention-card="${escapeHtml(entry.requestId)}">
        <div class="card-topline">
          <span class="status status-warning">${escapeHtml(entry.type || '决策')}</span>
          <span class="status ${
            entry.expired || entry.notificationFailure ? 'status-error' : ''
          }">${escapeHtml(
            entry.expired ? 'EXPIRED' : entry.notificationFailure ? '通知失败' : entry.status,
          )}</span>
        </div>
        <h3>${escapeHtml(entry.question || entry.reason || entry.title || '需要你的决定')}</h3>
        <p>${escapeHtml(entry.summary || entry.reason || '')}</p>
        <dl class="compact">
          <div><dt>项目</dt><dd>${escapeHtml(projectLabel(entry.projectId))}</dd></div>
          <div><dt>类型</dt><dd>${escapeHtml(entry.type || '决策')}</dd></div>
          <div><dt>风险</dt><dd class="risk-${escapeHtml(entry.risk || 'low')}">${escapeHtml(
            entry.risk || 'low',
          )}</dd></div>
          <div><dt>失效时间</dt><dd>${escapeHtml(entry.expiresAt || '未设置')}</dd></div>
          <div><dt>等待</dt><dd>${escapeHtml(Math.round((entry.waitingMs || 0) / 60000))} 分钟</dd></div>
        </dl>
        ${
          entry.notificationFailure
            ? '<p class="error">通知渠道有失败记录；事项仍需处理，请检查通知健康。</p>'
            : ''
        }
        <div class="button-row">
          ${(entry.attentionId ? entry.actions || [] : [])
            .map(
              (action) =>
                `<button class="button ${action === 'approve' ? '' : 'secondary'}"
                   data-decision-action="${escapeHtml(action)}"
                   data-attention-id="${escapeHtml(entry.attentionId)}"
                   data-work-item-id="${escapeHtml(entry.workItemId)}"
                   data-revision="${escapeHtml(entry.revision)}"
                   data-version="${escapeHtml(entry.workItemVersion || entry.revision)}"
                   data-artifact="${escapeHtml(entry.artifactHash)}"
                   data-attention-type="${escapeHtml(entry.type)}"
                   type="button">${escapeHtml(actionLabel(action))}</button>`,
            )
            .join('')}
          ${
            entry.documentPath
              ? `<a class="button ghost" href="/api/attention/${encodeURIComponent(
                  entry.requestId,
                )}/document" target="_blank" rel="noopener noreferrer">打开审批文档</a>`
              : ''
          }
          <button class="button ghost" data-open-work-item="${escapeHtml(
            entry.workItemId,
          )}" type="button">查看详情</button>
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

function deviceKey(device) {
  return device?.deviceId || device?.id || '';
}

function isCurrentDevice(device) {
  return Boolean(
    device?.current ||
    device?.isCurrent ||
    (state.deviceId && deviceKey(device) === state.deviceId),
  );
}

function renderSecurity() {
  const userLabel =
    state.user?.displayName || state.user?.username || state.user?.email || '当前认证 Owner';
  const current = state.devices.find(isCurrentDevice);
  elements.securitySummary.innerHTML = `
    <div class="card-topline">
      <span class="status">${escapeHtml(userLabel)}</span>
      <span class="muted">${escapeHtml(state.devices.length)} 台已登记设备</span>
    </div>
    <p class="muted">当前设备：${escapeHtml(
      current?.name || current?.deviceName || (state.deviceId ? '本浏览器' : '未识别'),
    )}</p>
    <p class="muted">撤销其他设备前需要输入动态验证码；验证码会被兑换为当前操作的短期证明。</p>`;

  if (!state.devices.length) {
    elements.deviceList.innerHTML = empty('尚未读取到已登记设备');
    return;
  }
  elements.deviceList.innerHTML = state.devices
    .map((device) => {
      const id = deviceKey(device);
      const currentDevice = isCurrentDevice(device);
      const name = device.name || device.deviceName || id || '未命名设备';
      const status = device.revokedAt ? '已撤销' : device.status || '可用';
      return `<article class="device-row${currentDevice ? ' current' : ''}">
        <div>
          <div class="card-topline">
            <h3>${escapeHtml(name)}</h3>
            <span class="status ${device.revokedAt ? 'status-error' : ''}">${escapeHtml(
              currentDevice ? '当前设备' : status,
            )}</span>
          </div>
          <div class="device-meta">
            <span>设备 ID：${escapeHtml(id || '未提供')}</span>
            <span>最近活动：${escapeHtml(
              device.lastSeenAt || device.lastUsedAt || device.updatedAt || '未提供',
            )}</span>
          </div>
        </div>
        ${
          currentDevice || device.revokedAt
            ? ''
            : `<button class="button danger" data-revoke-device="${escapeHtml(id)}" type="button">撤销设备</button>`
        }
      </article>`;
    })
    .join('');
}

async function loadDevices() {
  if (state.authMode !== 'account') {
    state.devices = [];
    elements.securityError.textContent = '';
    renderSecurity();
    return;
  }
  elements.securityError.textContent = '';
  const { response, body } = await api('/api/auth/devices');
  if (!response.ok || !body.ok) {
    elements.securityError.textContent = body.message || '设备列表读取失败';
    return;
  }
  state.devices = body.devices || [];
  renderSecurity();
}

function renderAll() {
  renderAttention();
  renderPortfolio();
  renderProjects();
  renderWorkItems();
  renderMonitoring();
  renderNotifications();
  renderSecurity();
}

async function refresh() {
  if (!state.csrfToken) return;
  state.abortController?.abort();
  const controller = new AbortController();
  state.abortController = controller;
  try {
    setConnection('同步中', 'syncing');
    const inboxQuery = new URLSearchParams({ limit: '100' });
    if (state.inboxFilters.projectId) inboxQuery.set('projectId', state.inboxFilters.projectId);
    if (state.inboxFilters.risk) inboxQuery.set('risk', state.inboxFilters.risk);
    if (state.inboxFilters.status) inboxQuery.set('status', state.inboxFilters.status);
    const [overview, workItems, inbox, notifications] = await Promise.all([
      api('/api/projects', { signal: controller.signal }),
      api('/api/work-items', { signal: controller.signal }),
      api(`/api/inbox?${inboxQuery}`, { signal: controller.signal }),
      api('/api/notifications', { signal: controller.signal }),
    ]);
    if ([overview, workItems, inbox, notifications].some((entry) => !entry.response.ok))
      throw new Error('部分管理数据不可用');
    state.overview = { projects: overview.body.projects || [] };
    state.workItems = workItems.body.workItems || [];
    state.inboxVersion = Number.isSafeInteger(inbox.body.version) ? inbox.body.version : 0;
    state.attention = (inbox.body.items || [])
      .map((item) => ({
        ...item,
        requestId: item.attentionId || item.id,
        question: item.title || item.summary,
        summary: item.summary,
        revision: item.attentionRevision,
        workItemVersion: item.workItemVersion,
        artifactHash: item.artifactHash,
        attentionType: item.type,
      }))
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
  const [{ response, body }, timelineResult] = await Promise.all([
    api(`/api/work-items/${encodeURIComponent(workItemId)}`),
    api(`/api/work-items/${encodeURIComponent(workItemId)}/timeline?limit=100`),
  ]);
  if (!response.ok || !body.ok) {
    await refresh();
    return;
  }
  const item = body.workItem;
  const run = body.run;
  const timeline =
    timelineResult.response.ok && timelineResult.body.ok ? timelineResult.body.events || [] : [];
  const timelineHtml = timeline.length
    ? timeline
        .map(
          (event) => `<li class="timeline-event">
            <div class="card-topline">
              <span class="status">${escapeHtml(event.type)}</span>
              <span class="muted">${escapeHtml(event.occurredAt)}</span>
            </div>
            <p>${escapeHtml(event.summary)}</p>
            <code>${escapeHtml(String(event.artifactHash || '').slice(0, 12))}</code>
          </li>`,
        )
        .join('')
    : '<li class="muted">尚无可回放证据。未执行检查不会被标记为通过。</li>';
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
        <details open>
          <summary>证据时间线</summary>
          <ol class="timeline-list">${timelineHtml}</ol>
          <a class="button ghost" href="/api/work-items/${encodeURIComponent(
            item.workItemId,
          )}/timeline/export?format=jsonl">导出时间线</a>
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
  if (view === 'security' && state.authMode === 'account') void loadDevices();
}

function openActionDialog({
  title,
  description,
  needsComment = false,
  budgetCurrent = null,
  needsStepUp = false,
  stepUpAction = null,
  resourceId = null,
  action,
  initialError = '',
}) {
  const pendingAction = { ...action, stepUpAction, resourceId };
  state.action = pendingAction;
  state.actionConfig = {
    title,
    description,
    needsComment,
    budgetCurrent,
    needsStepUp,
    stepUpAction,
    resourceId,
    action: pendingAction,
  };
  elements.actionTitle.textContent = title;
  elements.actionDescription.textContent = description;
  elements.actionComment.value = '';
  elements.budgetModels.value =
    budgetCurrent === null ? '' : String(Math.min(2000000000, budgetCurrent * 2));
  elements.stepUpCode.value = '';
  elements.stepUpCode.required = needsStepUp;
  elements.stepUpLabel.textContent =
    state.authMode === 'account' ? '动态验证码（当前操作专用）' : '升级认证码';
  elements.actionError.textContent = initialError;
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
  state.actionConfig = null;
  elements.actionDialog.classList.add('hidden');
}

function reopenActionDialog(message) {
  const config = state.actionConfig;
  if (!config) return;
  state.actionConfig = null;
  closeActionDialog();
  openActionDialog({ ...config, initialError: message });
}

function stepUpFailure(body) {
  const code = String(body?.code || '').toUpperCase();
  return (
    STEP_UP_ERROR_CODES.has(code) ||
    (code.includes('CHALLENGE') && (code.includes('EXPIRED') || code.includes('NOT_FOUND')))
  );
}

async function submitAction(event) {
  event.preventDefault();
  if (!state.action) return;
  const action = state.action;
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
  const needsStepUp = !elements.stepUpField.classList.contains('hidden');
  let proof = null;
  try {
    if (needsStepUp) {
      const totpCode = elements.stepUpCode.value.trim();
      if (!totpCode) {
        elements.actionError.textContent = '请输入动态验证码';
        elements.stepUpCode.focus();
        return;
      }
      if (state.authMode === 'pairing') {
        payload.stepUpCode = totpCode;
      } else {
        const stepUpAction = action.stepUpAction;
        const resourceId =
          action.resourceId ||
          action.body.attentionId ||
          action.body.workItemId ||
          action.body.deviceId;
        if (!stepUpAction || !resourceId) {
          elements.actionError.textContent = '当前动作缺少授权绑定信息';
          return;
        }
        const challenge = await api('/api/auth/step-up/challenge', {
          method: 'POST',
          body: { action: stepUpAction, resourceId },
        });
        if (!challenge.response.ok || !challenge.body.ok) {
          const message = challenge.body.message || '无法创建当前操作的授权挑战';
          if (stepUpFailure(challenge.body)) reopenActionDialog(message);
          else elements.actionError.textContent = message;
          return;
        }
        const verification = await api('/api/auth/step-up/verify', {
          method: 'POST',
          body: {
            challengeId: challenge.body.challengeId,
            totpCode,
          },
        });
        elements.stepUpCode.value = '';
        if (!verification.response.ok || !verification.body.ok) {
          const message = verification.body.message || '动态验证码验证失败，请重新输入';
          if (stepUpFailure(verification.body)) reopenActionDialog(message);
          else elements.actionError.textContent = message;
          return;
        }
        proof = verification.body.proof;
        if (!proof) {
          elements.actionError.textContent = '服务端未返回当前操作的授权证明';
          return;
        }
        payload.stepUpProof = proof;
      }
    }
    const { response, body } = await api(action.path, {
      method: 'POST',
      body: payload,
    });
    delete payload.stepUpProof;
    proof = null;
    if (!response.ok || !body.ok) {
      if (state.authMode === 'account' && stepUpFailure(body))
        reopenActionDialog(body.message || '授权已过期，请重新输入动态验证码');
      else elements.actionError.textContent = body.message || '动作未完成';
      return;
    }
    const afterSuccess = action.afterSuccess;
    closeActionDialog();
    if (afterSuccess === 'devices') {
      await loadDevices();
      return;
    }
    await refresh();
    if (state.selectedWorkItemId) await openDetail(state.selectedWorkItemId);
  } catch (error) {
    if (error.name !== 'AbortError')
      elements.actionError.textContent = error.message || '动作未完成';
  } finally {
    elements.stepUpCode.value = '';
    proof = null;
    delete payload.stepUpProof;
  }
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
      description:
        state.authMode === 'account'
          ? '说明需要改变的业务结果。当前操作需要动态验证码授权。'
          : '说明需要改变的业务结果；本说明会进入下一轮 AI 执行。',
      needsComment: true,
      needsStepUp: state.authMode === 'account',
      stepUpAction: 'request_changes',
      resourceId: item.workItemId,
      action: { path: '/api/work-items/request-changes', body: base },
    });
    return;
  }
  if (action === 'cancel') {
    openActionDialog({
      title: '取消 WorkItem',
      description: '取消会终止当前工作。请输入升级认证码以继续。',
      needsStepUp: true,
      stepUpAction: 'cancel',
      resourceId: item.workItemId,
      action: { path: '/api/work-items/cancel', body: base },
    });
    return;
  }
  if (state.authMode === 'account' && ['resume', 'retry'].includes(action)) {
    openActionDialog({
      title: actionLabel(action),
      description: '该状态变更需要近期动态验证码，授权只绑定当前 WorkItem。',
      needsStepUp: true,
      stepUpAction: action,
      resourceId: item.workItemId,
      action: { path: `/api/work-items/${action}`, body: base },
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
    const highRiskAttention = ['H1_APPROVAL', 'H3_APPROVAL', 'CUSTOMER_ACCEPTANCE'].includes(
      button.dataset.attentionType,
    );
    const needsStepUp =
      (highRiskAttention && action === 'approve') ||
      (action === 'request_changes' && state.authMode === 'account');
    openActionDialog({
      title: actionLabel(action),
      description: needsStepUp
        ? '补充业务说明后提交受控 Decision；动态验证码只兑换当前 Decision 的一次性证明。'
        : '补充业务说明后提交受控 Decision。',
      needsComment: true,
      needsStepUp,
      stepUpAction: action,
      resourceId: button.dataset.attentionId,
      action: { path: '/api/decisions', body },
    });
    return;
  }
  if (action === 'accept_delivery') {
    openActionDialog({
      title: actionLabel(action),
      description: '将先校验不可变 DeliveryRecord，再写入客户接受回执。请输入升级认证码。',
      needsStepUp: true,
      stepUpAction: 'accept_delivery',
      resourceId: button.dataset.attentionId,
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
      stepUpAction: 'resume',
      resourceId: button.dataset.attentionId,
      action: { path: '/api/decisions', body },
    });
    return;
  }
  openActionDialog({
    title: actionLabel(action),
    description: '高风险 Decision 需要升级认证码。对象和版本已绑定。',
    needsStepUp: true,
    stepUpAction: action,
    resourceId: button.dataset.attentionId,
    action: { path: '/api/decisions', body },
  });
}

async function discoverAuthMode() {
  try {
    const { response, body } = await api('/api/auth/methods');
    if (!response.ok || !body.ok) {
      showAuthRequired(body.message || '无法读取认证方式，请稍后刷新。');
      return false;
    }
    state.authMode = body.mode === 'account' ? 'account' : 'pairing';
    return true;
  } catch {
    showAuthRequired('无法连接认证服务，请检查服务状态后刷新。');
    return false;
  }
}

function startPolling() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(refresh, 15000);
}

function scheduleRefresh() {
  state.refreshDebounce ??= setTimeout(() => {
    state.refreshDebounce = null;
    void refresh();
  }, 250);
}

function startRealtime() {
  state.eventSource?.close();
  state.eventSource = null;
  if (typeof EventSource !== 'function') return;
  const params = new URLSearchParams();
  if (state.inboxFilters.projectId) params.set('projectId', state.inboxFilters.projectId);
  state.eventSource = new EventSource(`/api/events${params.size ? `?${params}` : ''}`, {
    withCredentials: true,
  });
  state.eventSource.addEventListener('state.changed', scheduleRefresh);
  state.eventSource.addEventListener('reset', scheduleRefresh);
  state.eventSource.onerror = () => {
    // Polling remains active as the bounded fallback when SSE disconnects.
    setConnection('实时连接中断，轮询中', 'syncing');
  };
}

async function finishAuthentication() {
  showWorkspace();
  setWorkspaceNotice('');
  await redeemDeepLink();
  if (!state.csrfToken) return;
  await refresh();
  focusDeepLinkedAttention();
  if (state.authMode === 'account') await loadDevices();
  startPolling();
  startRealtime();
}

async function loginAccount() {
  elements.accountLoginError.textContent = '';
  setAuthNotice('');
  const deviceId = persistentDeviceId();
  const { response, body } = await api('/api/auth/login', {
    method: 'POST',
    body: {
      username: elements.loginUsername.value.trim(),
      password: elements.loginPassword.value,
      totpCode: elements.loginTotp.value.trim(),
      deviceId,
      deviceName: elements.loginDeviceName.value.trim() || defaultDeviceName(),
      deviceConfirmationCode: elements.loginDeviceConfirmation.value.trim(),
    },
  });
  elements.loginTotp.value = '';
  if (!response.ok || !body.ok) {
    elements.accountLoginError.textContent = body.message || '账号登录失败';
    if (body.code === 'DEVICE_CONFIRMATION_REQUIRED') {
      elements.loginDeviceConfirmation.focus();
      setAuthNotice('这是新设备。请按服务端提示填写额外确认码后重试。');
    }
    return;
  }
  elements.loginPassword.value = '';
  elements.loginDeviceConfirmation.value = '';
  setSession(body);
  await finishAuthentication();
}

async function logoutAccount() {
  const { response, body } = await api('/api/auth/logout', { method: 'POST' });
  if (!response.ok || !body.ok) {
    setWorkspaceNotice(body.message || '退出登录失败');
    return;
  }
  state.csrfToken = null;
  state.user = null;
  state.devices = [];
  setWorkspaceNotice('');
  showAuthRequired('已安全退出。消息链接不会保留管理会话。');
}

function runRevokeDevice(button) {
  const deviceId = button.dataset.revokeDevice;
  if (!deviceId) return;
  openActionDialog({
    title: '撤销设备',
    description: '撤销后该设备绑定的现有会话将失效。请输入动态验证码确认当前操作。',
    needsStepUp: true,
    stepUpAction: 'device.revoke',
    resourceId: deviceId,
    action: {
      path: '/api/auth/devices/revoke',
      body: { deviceId },
      afterSuccess: 'devices',
    },
  });
}

async function bootstrap() {
  const { pairingToken } = captureDeepLink();
  if (!(await discoverAuthMode())) return;
  if (pairingToken) {
    if (state.authMode !== 'pairing') {
      showAuthRequired('当前服务使用账号认证，配对令牌不能建立管理会话。');
      return;
    }
    try {
      await openPairingSession(pairingToken);
    } catch (error) {
      elements.pairingError.textContent = error.message;
      showAuthRequired();
      return;
    }
    showWorkspace();
    await refresh();
    startPolling();
    return;
  }
  if (!(await restoreSession())) {
    showAuthRequired(
      state.deepLink?.nonce ? '该消息链接需要账号登录。转发链接不会建立管理会话。' : '',
    );
    return;
  }
  await finishAuthentication();
}

elements.accountLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await loginAccount();
  } catch (error) {
    elements.loginTotp.value = '';
    elements.accountLoginError.textContent = error.message || '账号登录失败';
  }
});

elements.pairingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  elements.pairingError.textContent = '';
  try {
    await openPairingSession(elements.pairingToken.value.trim());
    elements.pairingToken.value = '';
    showWorkspace();
    await refresh();
    startPolling();
  } catch (error) {
    elements.pairingError.textContent = error.message;
  }
});

elements.refresh.addEventListener('click', refresh);
elements.refreshDevices.addEventListener('click', loadDevices);
elements.logout.addEventListener('click', logoutAccount);
elements.filter.addEventListener('change', renderWorkItems);
for (const [element, key] of [
  [elements.inboxProjectFilter, 'projectId'],
  [elements.inboxRiskFilter, 'risk'],
  [elements.inboxStatusFilter, 'status'],
]) {
  element.addEventListener('change', () => {
    state.inboxFilters[key] = element.value;
    startRealtime();
    void refresh();
  });
}
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
  const revokeDevice = event.target.closest('[data-revoke-device]');
  if (revokeDevice) runRevokeDevice(revokeDevice);
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
