import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveMaven, mavenWrapperBin, systemMavenBin } from '../../src/v3/env/maven.js';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sg-v3-maven-'));
}

function writeScript(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  if (process.platform !== 'win32') fs.chmodSync(file, 0o755);
  return file;
}

function wrapperScript(root, version, { failing = false } = {}) {
  if (process.platform === 'win32') {
    const body = failing ? '@exit /b 1\r\n' : `@echo Apache Maven ${version}\r\n@exit /b 0\r\n`;
    return writeScript(path.join(root, 'mvnw.cmd'), body);
  }
  const body = failing ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\necho "Apache Maven ${version}"\n`;
  return writeScript(path.join(root, 'mvnw'), body);
}

function systemMaven(binDir, version) {
  if (process.platform === 'win32') {
    return writeScript(path.join(binDir, 'mvn.cmd'), `@echo Apache Maven ${version}\r\n`);
  }
  return writeScript(path.join(binDir, 'mvn'), `#!/bin/sh\necho "Apache Maven ${version}"\n`);
}

function envWithPath(binDir) {
  return { ...process.env, PATH: binDir };
}

test('优先使用项目 mvnw Wrapper 并解析版本', () => {
  const root = tempRoot();
  const wrapper = wrapperScript(root, '3.9.6');
  const systemDir = path.join(root, 'system-bin');
  systemMaven(systemDir, '3.8.8');

  const result = resolveMaven({ root, env: envWithPath(systemDir) });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.wrapper, true);
  assert.equal(result.bin, wrapper);
  assert.equal(result.version, '3.9.6');
  assert.deepEqual(result.argsPrefix, ['-B', '-ntp', '-Dstyle.color=never']);
  const expectedName = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
  assert.equal(path.basename(result.bin), expectedName);
  assert.equal(mavenWrapperBin(root), wrapper);
});

test('无 Wrapper 时回退到系统 mvn', () => {
  const root = tempRoot();
  const systemDir = path.join(root, 'system-bin');
  const bin = systemMaven(systemDir, '3.9.6');

  const result = resolveMaven({ root, env: envWithPath(systemDir) });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.wrapper, false);
  assert.equal(result.bin, bin);
  assert.equal(result.version, '3.9.6');
  assert.equal(systemMavenBin(envWithPath(systemDir)), bin);
});

test('Wrapper 与系统 Maven 都缺失返回 BUILD_TOOL_NOT_FOUND', () => {
  const root = tempRoot();
  const emptyBin = path.join(root, 'empty-bin');
  fs.mkdirSync(emptyBin, { recursive: true });

  const result = resolveMaven({ root, env: envWithPath(emptyBin) });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BUILD_TOOL_NOT_FOUND');
  assert.match(result.message, /Maven/);
  assert.match(result.message, /Wrapper/);
  assert.equal(systemMavenBin(envWithPath(emptyBin)), null);
});

test('mvn -v 失败不阻断解析，version 记为 null', () => {
  const root = tempRoot();
  wrapperScript(root, '3.9.6', { failing: true });

  const result = resolveMaven({ root, env: envWithPath(path.join(root, 'empty-bin')) });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.wrapper, true);
  assert.equal(result.version, null);
});

test('忽略空 PATH 条目与带引号的 PATH 条目', () => {
  const root = tempRoot();
  const systemDir = path.join(root, 'bin with space');
  const bin = systemMaven(systemDir, '3.9.6');
  const env = {
    ...process.env,
    PATH: `${path.delimiter}${path.delimiter}"${systemDir}"${path.delimiter}`,
  };
  assert.equal(systemMavenBin(env), bin);
});
