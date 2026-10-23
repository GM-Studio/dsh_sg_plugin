// 维护验收程序：隔离下载测试夹具并运行真实矩阵；不作为用户环境安装入口。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createTemporaryDirectory } from '../src/codex/core/temp.js';
import { installEnvironmentComponent } from '../src/codex/core/environment-install.js';
import { createEnvironmentService } from '../src/codex/core/environment.js';
import { runEnvironmentCommand } from '../src/codex/core/environment-process.js';
import { smokePlugin } from './codex-plugin-smoke.mjs';
import { verifyMatrix } from './verify-codex-matrix.mjs';

export function environmentSourceHash(repository) {
  const hash = createHash('sha256');
  const visit = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.name === 'node_modules') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile())
        hash
          .update(path.relative(repository, file).replaceAll('\\', '/') + '\n')
          .update(fs.readFileSync(file).toString().replaceAll('\r\n', '\n'));
    }
  };
  for (const directory of ['src', 'skills', 'assets/codex', 'assets/java-vue', 'scripts'])
    visit(path.join(repository, directory));
  for (const file of ['package.json', 'package-lock.json', 'plugin.json', 'mcp.json'])
    hash.update(file).update(fs.readFileSync(path.join(repository, file)));
  return hash.digest('hex');
}

export async function verifyEnvironment({ output, installFixtures = false, matrix = false } = {}) {
  const repository = path.resolve(import.meta.dirname, '..');
  output = path.resolve(output);
  if (fs.existsSync(output) && fs.readdirSync(output).length)
    throw new Error('证据目录非空，请保留历史并选择新目录');
  fs.mkdirSync(output, { recursive: true });
  const temporary = createTemporaryDirectory('sg-env-acceptance-');
  const report = {
    startedAt: new Date().toISOString(),
    platform: process.platform,
    os: os.release(),
    arch: process.arch,
    sourceHash: environmentSourceHash(repository),
    baseCommit: null,
    installs: [],
    checks: [],
    matrices: [],
    status: 'running',
    hostSessionSkillInvocation: 'not-run',
    trustedApproval: 'not-run',
  };
  const saved = { ...process.env };
  const save = () =>
    fs.writeFileSync(path.join(output, 'environment.json'), JSON.stringify(report, null, 2) + '\n');
  try {
    const commit = await runEnvironmentCommand('git', ['rev-parse', 'HEAD'], { cwd: repository });
    report.baseCommit = commit.ok ? commit.output.trim() : null;
    const root = path.join(temporary.path, 'project'),
      cacheRoot = path.join(temporary.path, 'toolchains');
    fs.mkdirSync(root);
    if (installFixtures) {
      for (const id of ['node', 'jdk17', 'maven', 'jdk8', 'jdk21']) {
        process.stdout.write(`实际下载并校验隔离夹具：${id}\n`);
        const javaHome = report.installs.find((entry) => entry.id === 'jdk17')?.location;
        const installed = await installEnvironmentComponent(id, { cacheRoot, javaHome });
        report.installs.push(installed);
        save();
        if (!installed.ok) throw new Error(`隔离安装失败：${id}`);
        if (id.startsWith('jdk')) process.env[`JAVA${id.slice(3)}_HOME`] = installed.location;
        if (id === 'maven') process.env.SG_MAVEN_HOME = installed.location;
        if (id === 'node')
          process.env.PATH = [
            path.join(installed.location, process.platform === 'win32' ? '' : 'bin'),
            process.env.PATH,
          ].join(path.delimiter);
      }
    }
    const service = createEnvironmentService({ root, cacheRoot });
    const first = await service.check({ preset: 'jdk17-boot3.5', frontend: 'vue' });
    const second = await service.prepare({ preset: 'jdk17-boot3.5', frontend: 'vue' });
    report.checks.push(
      { name: 'real-tool-preflight', report: first },
      { name: 'idempotent-ready-rerun', report: second },
    );
    if (!first.environmentReady || !second.environmentReady) throw new Error('真实环境预检未通过');
    for (const preset of ['jdk8-boot2.7', 'jdk21-boot3.5']) {
      const result = await service.check({ preset, frontend: 'react' });
      report.checks.push({ name: `stack-${preset}`, report: result });
      if (!result.environmentReady) throw new Error(`技术栈未就绪：${preset}`);
    }
    const smoke = await smokePlugin({ projectRoot: root });
    fs.writeFileSync(path.join(output, 'smoke.json'), JSON.stringify(smoke, null, 2) + '\n');
    report.checks.push({ name: 'stdio-smoke', status: smoke.status });
    if (matrix)
      for (const frontend of ['vue', 'react']) {
        const result = await verifyMatrix({
          output: path.join(output, frontend),
          frontend,
          concurrency: 1,
        });
        report.matrices.push({ frontend, report: result });
        save();
        if (result.presets?.some((entry) => entry.status !== 'passed'))
          throw new Error(`真实 ${frontend} 矩阵失败`);
      }
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    try {
      temporary.cleanup();
      report.cleanup = 'completed';
    } catch (error) {
      report.cleanup = 'failed';
      report.cleanupError = error.message;
      report.status = 'failed';
    }
    report.endedAt = new Date().toISOString();
    save();
  }
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (
    args[0] !== '--output' ||
    !args[1] ||
    args.slice(2).some((arg) => !['--install-fixtures', '--matrix'].includes(arg))
  )
    throw new Error('维护验收用法：--output <新目录> [--install-fixtures] [--matrix]');
  const report = await verifyEnvironment({
    output: args[1],
    installFixtures: args.includes('--install-fixtures'),
    matrix: args.includes('--matrix'),
  });
  process.stdout.write(
    JSON.stringify({ status: report.status, error: report.error, cleanup: report.cleanup }) + '\n',
  );
  if (report.status !== 'passed') process.exitCode = 1;
}
