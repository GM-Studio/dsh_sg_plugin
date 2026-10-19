import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceLayout, resolveSelection } from '../../src/v4/workspace.js';
import { runWorkspaceSides } from '../../src/v4/scheduler.js';

function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v4-sched-'));
  createWorkspaceLayout({ root: dir, selection: resolveSelection({ preset: 'node-fullstack' }) });
  return dir;
}

test('v4 Phase 5：并发检查两侧，单侧失败不阻塞另一侧', async () => {
  const dir = root();
  const started = Date.now();
  const result = await runWorkspaceSides({
    root: dir,
    runner: async (side) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (side.id === 'api') throw new Error('api down');
      return { phase: 'IDLE', change: null };
    },
  });
  assert.equal(result.results.length, 2);
  assert.equal(result.ok, false);
  const api = result.results.find((item) => item.side.id === 'api');
  const web = result.results.find((item) => item.side.id === 'web');
  assert.equal(api.ok, false);
  assert.equal(web.ok, true);
  assert.ok(Date.now() - started < 260, '两侧应并发执行');
});
