import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jdkArchiveCandidates, jdkDownloadUrl, resolveMirrors } from '../../src/v4/mirrors.js';
import { planProvisioning, writeToolchainEnv } from '../../src/v4/provision.js';

function emptyEnv() {
  return {
    platform: 'win32',
    arch: 'x64',
    sandbox: { scope: 'project' },
    tools: { node: [], pnpm: [], npm: [], python: [], uv: [], java: [], mvn: [], gradle: [] },
  };
}

test('v4.2 JDK：Windows 下载 zip、Linux 下载 tar.gz，且没有 exe/msi', () => {
  const mirrors = resolveMirrors({});
  for (const major of ['8', '11', '17', '21']) {
    const win = jdkArchiveCandidates(mirrors, major, 'win32', 'x64');
    const linux = jdkArchiveCandidates(mirrors, major, 'linux', 'x64');
    assert.ok(win.length >= 1, 'windows ' + major);
    assert.ok(linux.length >= 1, 'linux ' + major);
    assert.match(win[0].url, /\.zip$/);
    assert.match(linux[0].url, /\.tar\.gz$/);
    for (const item of [...win, ...linux]) {
      assert.doesNotMatch(item.url, /\.(exe|msi)(\?|$)/i);
    }
  }
});

test('v4.2 JDK：默认华为云，JDK 8 走阿里云 Dragonwell，可切换 provider', () => {
  const mirrors = resolveMirrors({});
  assert.equal(jdkArchiveCandidates(mirrors, '21', 'win32', 'x64')[0].provider, 'huawei');
  assert.equal(jdkArchiveCandidates(mirrors, '8', 'win32', 'x64')[0].provider, 'aliyun');
  const preferAliyun = resolveMirrors({ SG_JDK_PROVIDER: 'aliyun' });
  assert.equal(jdkArchiveCandidates(preferAliyun, '8', 'linux', 'x64')[0].provider, 'aliyun');
});

test('v4.2 JDK：SG_JDK_URL 自定义模板优先且只使用自定义源', () => {
  const mirrors = resolveMirrors({
    SG_JDK_URL: 'https://mirror.example.com/jdk-{major}-{os}-{arch}.{ext}',
    SG_JDK_VERSION: '21.0.9',
  });
  const list = jdkArchiveCandidates(mirrors, '21', 'linux', 'x64');
  assert.equal(list.length, 1);
  assert.equal(list[0].url, 'https://mirror.example.com/jdk-21-linux-x64.tar.gz');
  assert.equal(list[0].provider, 'custom');
});

test('v4.2 JDK：无归档时计划直接给出可操作错误', () => {
  const mirrors = resolveMirrors({});
  assert.equal(jdkDownloadUrl(mirrors, '30', 'win32', 'x64'), null);
  const plan = planProvisioning({
    environment: emptyEnv(),
    selection: { sides: [{ stack: 'java', jdk: '30', buildTool: 'maven' }] },
    mirrors,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'JDK_MANUAL_INSTALL_REQUIRED');
});

test('v4.2 环境变量：Windows 生成 env.ps1/env.cmd，Linux 生成 env.sh', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-env-'));
  const jdkHome = path.join(root, 'jdk');
  fs.mkdirSync(path.join(jdkHome, 'bin'), { recursive: true });
  const win = writeToolchainEnv(
    root,
    {
      java: {
        path: path.join(jdkHome, 'bin', 'java.exe'),
        home: jdkHome,
        version: '1.8.0_502',
        major: 8,
      },
    },
    { platform: 'win32', arch: 'x64' },
  );
  assert.ok(fs.existsSync(win.ps1));
  assert.ok(fs.existsSync(win.cmd));
  assert.match(fs.readFileSync(win.ps1, 'utf8'), /JAVA_HOME/);
  assert.match(fs.readFileSync(win.cmd, 'utf8'), /PATH/);
  const linux = writeToolchainEnv(
    root,
    { java: { path: path.join(jdkHome, 'bin', 'java'), home: jdkHome } },
    { platform: 'linux', arch: 'x64' },
  );
  assert.ok(fs.existsSync(linux.sh));
  assert.match(fs.readFileSync(linux.sh, 'utf8'), /export PATH=/);
});
