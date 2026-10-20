import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveMirrors, jdkDownloadUrl, writeMirrorFiles } from '../../src/v4/mirrors.js';

test('v4.1 镜像：默认国内源，可切换清华/阿里云', () => {
  const aliyun = resolveMirrors({ SG_MIRROR: 'aliyun' });
  assert.match(aliyun.npm, /npmmirror\.com/);
  assert.match(aliyun.pypi, /aliyun\.com/);
  assert.match(aliyun.maven, /maven\.aliyun\.com/);

  const tsinghua = resolveMirrors({ SG_MIRROR: 'tsinghua' });
  assert.match(tsinghua.pypi, /pypi\.tuna\.tsinghua\.edu\.cn/);
});

test('v4.1 镜像：生成可编辑配置文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-mirror-'));
  const mirrors = resolveMirrors({ SG_MIRROR: 'aliyun' });
  const files = writeMirrorFiles(root, mirrors);
  assert.match(fs.readFileSync(files.npmrc, 'utf8'), /registry=https:\/\/registry\.npmmirror\.com/);
  assert.match(fs.readFileSync(files.pip, 'utf8'), /index-url = https:\/\/mirrors\.aliyun\.com/);
  assert.match(fs.readFileSync(files.mavenSettings, 'utf8'), /maven\.aliyun\.com/);
  assert.match(fs.readFileSync(files.gradleInit, 'utf8'), /maven\.aliyun\.com/);
});

test('v4.1 镜像：JDK 11/13/17/21 有国内下载地址，JDK 8 需系统安装', () => {
  const mirrors = resolveMirrors();
  for (const major of ['11', '13', '17', '21']) {
    assert.match(jdkDownloadUrl(mirrors, major, 'win32', 'x64'), /mirrors\.huaweicloud\.com/);
  }
  assert.equal(jdkDownloadUrl(mirrors, '8', 'win32', 'x64'), null);
});
