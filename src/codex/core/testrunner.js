import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createTemporaryDirectory } from './temp.js';

export function runTestCommand({ argv, cwd, env = {}, timeoutMs = 0 }) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return {
      ok: false,
      code: 'COMMAND_MISSING',
      exitCode: null,
      message: '测试命令为空',
    };
  }

  const temporary = createTemporaryDirectory('sg-report-');
  const reportPath = path.join(temporary.path, 'report.json');
  try {
    const startedAt = new Date().toISOString();
    const result = spawnSync(argv[0], argv.slice(1), {
      cwd,
      env: { ...process.env, ...env, SG_REPORT: reportPath },
      encoding: 'utf8',
      shell: false,
      timeout: timeoutMs > 0 ? timeoutMs : undefined,
      windowsHide: true,
    });
    const finishedAt = new Date().toISOString();

    let report = null;
    let reportError = null;
    if (fs.existsSync(reportPath)) {
      try {
        report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      } catch {
        reportError = '报告不是合法 JSON';
      }
    } else {
      reportError = '命令没有写 SG_REPORT';
    }

    return {
      ok: result.status === 0,
      exitCode: typeof result.status === 'number' ? result.status : -1,
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || ''),
      error: result.error ? String(result.error.message) : null,
      report,
      reportError,
      reportPath,
      startedAt,
      finishedAt,
    };
  } finally {
    try {
      temporary.cleanup();
    } catch (error) {
      process.stderr.write(`[specgate] test report cleanup failed: ${error.message}\n`);
    }
  }
}
