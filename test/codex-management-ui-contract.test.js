import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src/codex/management/public');

function readAll() {
  return ['index.html', 'app.js', 'style.css']
    .map((name) => fs.readFileSync(path.join(root, name), 'utf8'))
    .join('\n');
}

test('management UI exposes attention, monitoring, evidence and controlled actions', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const all = `${html}\n${app}`;
  for (const expected of [
    'Attention',
    'Projects',
    'WorkItems',
    'Execution',
    'Evidence',
    'Decisions',
    'Notifications',
    'Pause',
    'Resume',
    'Retry',
    'Cancel',
  ])
    assert.match(all, new RegExp(expected, 'i'));
  assert.match(app, /x-specgate-csrf/);
  assert.match(app, /signal|AbortController/);
  assert.match(app, /\['OPEN',\s*'DELIVERED',\s*'REMINDED'\]/);
  assert.match(app, /\/api\/deliveries\/accept/);
  assert.match(app, /不可变 DeliveryRecord/);
});

test('management UI exposes the cross-project portfolio aggregate view', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  // A dedicated navigation entry and view section for the aggregate portfolio.
  assert.match(html, /data-view="portfolio"/);
  assert.match(html, /id="view-portfolio"/);
  assert.match(html, /id="portfolio-list"/);
  assert.match(html, /id="portfolio-summary"/);
  assert.match(html, /Portfolio aggregate/i);
  assert.match(html, /跨项目组合总览/);

  // One row per project with WorkItem counts, running/waiting/blocked/failed
  // rollups and host health, expandable to that project's WorkItems.
  assert.match(app, /function renderPortfolio\(/);
  assert.match(app, /function projectRollup\(/);
  assert.match(app, /function hostHealthLabel\(/);
  assert.match(app, /hostHealth/);
  assert.match(app, /expandedProjects/);
  assert.match(app, /data-project-toggle/);
  assert.match(app, /renderPortfolio\(\);/);
  for (const counter of ['running', 'waiting', 'blocked', 'failed'])
    assert.match(app, new RegExp(`counts\\.${counter}`));
});

test('management UI renders a cross-project attention home ordered by severity', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  // Severity ordering mirrors the control plane so the home shows the highest
  // risk gates first, then oldest.
  assert.match(app, /const ATTENTION_SEVERITY/);
  assert.match(app, /function attentionSeverity\(/);
  assert.match(app, /function compareAttention\(/);
  assert.match(app, /\.sort\(compareAttention\)/);
  // Each attention card shows the owning project.
  assert.match(app, /function projectLabel\(/);
  assert.match(app, /projectLabel\(entry\.projectId\)/);
  // Existing per-item decision buttons and their bound data attributes remain.
  assert.match(app, /data-decision-action=/);
  assert.match(app, /data-attention-id=/);
  assert.match(app, /打开审批文档/);
  assert.match(app, /\/api\/attention\/.*\/document/s);
  assert.match(app, /function runDecision\(/);
});

test('management UI stays read-only plus the allow-listed mutation routes', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const all = `${html}\n${app}`;
  const allowed = new Set([
    '/api/session',
    '/api/health',
    '/api/projects',
    '/api/work-items',
    '/api/work-items/',
    '/api/work-items/create',
    '/api/work-items/pause',
    '/api/work-items/resume',
    '/api/work-items/retry',
    '/api/work-items/cancel',
    '/api/work-items/request-changes',
    '/api/decisions',
    '/api/deliveries/accept',
    '/api/attention',
    '/api/attention/',
    '/api/notifications',
    '/api/auth/methods',
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/devices',
    '/api/auth/devices/revoke',
    '/api/auth/step-up/challenge',
    '/api/auth/step-up/verify',
    '/api/auth/attention/redeem',
  ]);
  const referenced = all.match(/\/api\/[a-z0-9/-]+/gi) || [];
  assert.ok(referenced.length > 0);
  for (const route of referenced)
    assert.ok(allowed.has(route.toLowerCase()), `unexpected management route: ${route}`);
});

test('management UI contains no arbitrary shell, file picker or approval bypass', () => {
  const all = readAll();
  assert.doesNotMatch(all, /child_process|execFile|spawn\(|file input|type=["']file["']/i);
  assert.doesNotMatch(all, /approvalHandle|actorId=|authorization:\s*bearer/i);
  // The portfolio/attention home must not open new raw-DOM sinks either.
  assert.doesNotMatch(all, /insertAdjacentHTML|document\.write|\bouterHTML\b/i);
  assert.doesNotMatch(all, /\beval\s*\(|new Function\s*\(/i);
  // Client never handles the server-side actor identity or bearer credentials.
  assert.doesNotMatch(all, /actorId|bearer/i);
  // API-derived text is always escaped before it reaches innerHTML.
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(app, /function escapeHtml\(/);
  assert.ok((app.match(/escapeHtml\(/g) || []).length >= 10);
});
