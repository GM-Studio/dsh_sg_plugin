import { spawn } from 'node:child_process';

// 只在 Windows 的 cmd/bat 入口使用严格引用，其他命令始终以参数数组执行。
export function runEnvironmentCommand(
  command,
  args,
  { env = process.env, cwd, signal, timeout = 15000 } = {},
) {
  if (signal?.aborted) return Promise.resolve({ ok: false, status: null, code: 'CANCELLED' });
  let options = { command, args };
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)) {
    const quote = (arg) => {
      if (/["\r\n%&|<>^!]/.test(arg)) throw new Error('命令参数包含不安全字符');
      return `"${arg}"`;
    };
    options = {
      command: env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${[command, ...args].map(quote).join(' ')}"`],
      windowsVerbatimArguments: true,
    };
  }
  return new Promise((resolve) => {
    const child = spawn(options.command, options.args, {
      env,
      cwd,
      signal,
      timeout,
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const capture = (chunk) => {
      output = (output + chunk).slice(-65536);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (error) =>
      resolve({
        ok: false,
        status: null,
        code: signal?.aborted ? 'CANCELLED' : error.code || 'COMMAND_FAILED',
      }),
    );
    child.on('close', (status, exitSignal) =>
      resolve({ ok: status === 0, status, signal: exitSignal, output }),
    );
  });
}
