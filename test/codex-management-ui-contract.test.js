import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src/codex/management/public');

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

test('management UI contains no arbitrary shell, file picker or approval bypass', () => {
  const all = ['index.html', 'app.js', 'style.css']
    .map((name) => fs.readFileSync(path.join(root, name), 'utf8'))
    .join('\n');
  assert.doesNotMatch(all, /child_process|execFile|spawn\(|file input|type=["']file["']/i);
  assert.doesNotMatch(all, /approvalHandle|actorId=|authorization:\s*bearer/i);
});
