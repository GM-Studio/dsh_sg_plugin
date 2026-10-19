import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { adoptWorkspace } from '../../src/v4/adopt.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v4-adopt-'));
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('v4 Phase 4：--adopt 原地接入单仓，只写基线不改代码', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"legacy"}\n', 'utf8');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const x = 1;\n', 'utf8');
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=T', '-c', 'user.email=t@e', 'commit', '-q', '-m', 'init']);

  const result = adoptWorkspace({ root });
  assert.equal(result.ok, true);
  assert.equal(result.sides[0], '.');
  assert.ok(fs.existsSync(path.join(root, '.specgate', 'workspace.yaml')));
  const req = fs.readFileSync(path.join(root, 'openspec', 'REQ.md'), 'utf8');
  assert.match(req, /REQ-001 存量系统基线/);
  assert.equal(
    fs.readFileSync(path.join(root, 'src', 'index.js'), 'utf8'),
    'export const x = 1;\n',
  );
  const log = git(root, ['log', '--oneline']);
  assert.match(log, /chore\(specgate\): 接入现有项目/);

  const again = adoptWorkspace({ root });
  assert.equal(again.skipped, true);
});

test('v4 Phase 4：--adopt 识别 api/web 目录', () => {
  const root = tempRoot();
  fs.mkdirSync(path.join(root, 'api'));
  fs.mkdirSync(path.join(root, 'web'));
  fs.writeFileSync(path.join(root, 'api', 'package.json'), '{"name":"api"}\n', 'utf8');
  fs.writeFileSync(path.join(root, 'web', 'package.json'), '{"name":"web"}\n', 'utf8');
  const result = adoptWorkspace({ root });
  assert.equal(result.ok, true);
  assert.deepEqual(result.sides.sort(), ['api', 'web']);
  assert.ok(fs.existsSync(path.join(root, 'api', '.specgate', 'config.yaml')));
  assert.ok(fs.existsSync(path.join(root, 'web', 'openspec', 'REQ.md')));
});
