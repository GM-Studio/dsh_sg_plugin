import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  pickVersion,
  readNodeRequirement,
  nodeDirCandidates,
  resolveNode,
} from '../../src/v3/env/node.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v31-node-'));
}

test('pickVersion 支持精确、主版本与范围', () => {
  const versions = ['18.19.0', '20.11.1', '22.3.0', '24.1.0'];
  assert.equal(pickVersion('18.19.0', versions), '18.19.0');
  assert.equal(pickVersion('18', versions), '18.19.0');
  assert.equal(pickVersion('>=20 <23', versions), '22.3.0');
  assert.equal(pickVersion('^22.12.0 || ^24.0.0', versions), '24.1.0');
  assert.equal(pickVersion('v22', versions), '22.3.0');
  assert.equal(pickVersion('99', versions), null);
});

test('readNodeRequirement 优先级：suite > config > .nvmrc > engines', () => {
  const root = tempRoot();
  fs.writeFileSync(path.join(root, '.nvmrc'), 'v18.19.0\n', 'utf8');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ engines: { node: '>=20' } }),
    'utf8',
  );
  assert.equal(readNodeRequirement(root, { suite: { node: '22' } }), '22');
  assert.equal(readNodeRequirement(root, { config: { node: '20' } }), '20');
  assert.equal(readNodeRequirement(root, {}), '18.19.0');
});

test('readNodeRequirement 回退到 engines', () => {
  const root = tempRoot();
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ engines: { node: '>=20 <23' } }),
    'utf8',
  );
  assert.equal(readNodeRequirement(root, {}), '>=20 <23');
});

test('nodeDirCandidates 读取本机 nvm 版本', (t) => {
  const candidates = nodeDirCandidates(process.env);
  assert.ok(candidates.some((item) => item.tool === 'current'));
  if (candidates.length === 0) {
    t.skip('本机没有可用的 Node 版本管理器');
    return;
  }
  assert.ok(candidates.some((item) => /^\d+\.\d+\.\d+$/.test(item.version)));
});

test('resolveNode 切换到本机 Node 18', (t) => {
  const candidates = nodeDirCandidates(process.env);
  const has18 = candidates.some((item) => String(item.version).startsWith('18.'));
  if (!has18) {
    t.skip('本机没有 Node 18');
    return;
  }
  const root = tempRoot();
  const result = resolveNode({ root, suite: { node: '18' } });
  assert.equal(result.ok, true, result.message);
  assert.match(result.version, /^18\./);
  assert.ok(result.env.PATH.startsWith(result.dir));

  const printed = spawnSync('node', ['-v'], { env: result.env, encoding: 'utf8' }).stdout.trim();
  assert.match(printed, /^v18\./);
});

test('resolveNode 对未安装版本返回明确错误码', (t) => {
  if (nodeDirCandidates(process.env).length === 0) {
    t.skip('本机没有可用的 Node 版本管理器');
    return;
  }
  const root = tempRoot();
  const result = resolveNode({ root, suite: { node: '99' } });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NODE_VERSION_NOT_INSTALLED');
});
