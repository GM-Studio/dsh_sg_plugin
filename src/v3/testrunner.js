import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function runTestCommand({ argv, cwd, env = {}, timeoutMs = 0 }) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return {
      ok: false,
      code: 'COMMAND_MISSING',
      exitCode: null,
      message: '测试命令为空',
    };
  }

  const reportPath = path.join(
    os.tmpdir(),
    `sg-report-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
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
    try {
      fs.unlinkSync(reportPath);
    } catch {
      // ignore cleanup failure
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
}
