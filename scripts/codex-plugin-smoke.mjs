import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));

// A real client: wait for each reply before sending the next request. It also
// runs against an unpacked/installed package, independently of repository cwd.
export async function smokePlugin({
  pluginRoot = repository,
  projectRoot = process.cwd(),
  mcpFile,
} = {}) {
  const startedAt = new Date().toISOString();
  pluginRoot = fs.realpathSync(path.resolve(pluginRoot));
  const invalid = () =>
    Object.assign(
      new Error(
        'MCP_CONFIGURATION_INVALID: expected an enabled local Node stdio configuration inside the plugin',
      ),
      { code: 'MCP_CONFIGURATION_INVALID' },
    );
  let config, configurationFile;
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, '.codex-plugin/plugin.json'), 'utf8'),
    );
    const selected = mcpFile ?? manifest.mcpServers;
    if (typeof selected !== 'string' || path.isAbsolute(selected)) throw invalid();
    const target = path.resolve(pluginRoot, selected);
    const relative = path.relative(pluginRoot, target);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith('..' + path.sep) ||
      path.isAbsolute(relative)
    )
      throw invalid();
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw invalid();
    const physical = path.relative(pluginRoot, fs.realpathSync(target));
    if (path.isAbsolute(physical) || physical === '..' || physical.startsWith('..' + path.sep))
      throw invalid();
    config = JSON.parse(fs.readFileSync(target, 'utf8'));
    configurationFile = relative.replaceAll('\\', '/');
  } catch {
    throw invalid();
  }
  const entry = config?.mcpServers?.specgate;
  if (
    !entry ||
    entry.command !== 'node' ||
    entry.enabled === false ||
    (entry.type !== undefined && entry.type !== 'stdio') ||
    !Array.isArray(entry.args) ||
    !entry.args.length ||
    !entry.args.every((arg) => typeof arg === 'string') ||
    (entry.env !== undefined &&
      (!entry.env ||
        typeof entry.env !== 'object' ||
        Array.isArray(entry.env) ||
        !Object.entries(entry.env).every(
          ([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string',
        )))
  )
    throw invalid();
  const argv = entry.args.map((arg) => arg.replaceAll('${PLUGIN_ROOT}', pluginRoot));
  const command = [entry.command, ...argv];
  const child = spawn(command[0], command.slice(1), {
    cwd: projectRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, ...entry.env, PLUGIN_ROOT: pluginRoot },
  });
  const stdin = [];
  const stdout = [];
  let stderr = '';
  let protocolFailure = null;
  let sequence = 0;
  const waiting = new Map();
  const rejectAll = (error) => {
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
  };
  const exit = new Promise((resolve) => {
    child.once('error', (error) => {
      rejectAll(error);
      resolve({ exitCode: null, signal: null, error: error.message });
    });
    child.once('close', (exitCode, signal) => {
      rejectAll(new Error('MCP closed before replying'));
      resolve({ exitCode, signal });
    });
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text) => {
    stderr += text;
  });
  child.stdin.on('error', rejectAll);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    stdout.push(line);
    try {
      const message = JSON.parse(line);
      const pending = waiting.get(message.id);
      if (!pending) throw new Error('Unexpected MCP response');
      waiting.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    } catch (error) {
      protocolFailure = error;
      rejectAll(error);
    }
  });
  const send = (message) => {
    const line = JSON.stringify(message);
    stdin.push(line);
    child.stdin.write(line + '\n');
  };
  const request = async (method, params = {}) => {
    const id = ++sequence;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`MCP timeout: ${method}`));
        }, 5000);
        waiting.set(id, { resolve, reject });
        send({ jsonrpc: '2.0', id, method, params });
      });
    } finally {
      clearTimeout(timer);
    }
  };
  const deadline = setTimeout(() => {
    rejectAll(new Error('MCP smoke timeout'));
    child.kill();
  }, 15000);
  try {
    const initialized = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'specgate-smoke', version: '1.0.0' },
    });
    if (initialized.protocolVersion !== '2025-06-18')
      throw new Error('Unexpected protocol version');
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const listing = await request('tools/list');
    const tools = listing.tools.map((tool) => tool.name);
    const diagnosticTools = ['health', 'version', 'status'];
    if (diagnosticTools.some((name) => !tools.includes(name)))
      throw new Error('Missing diagnostic tools');
    const results = {};
    for (const name of diagnosticTools) {
      const result = await request('tools/call', { name, arguments: {} });
      if (
        result.isError ||
        !result.structuredContent ||
        JSON.stringify(JSON.parse(result.content[0].text)) !==
          JSON.stringify(result.structuredContent)
      ) {
        throw new Error(`Invalid tool result: ${name}`);
      }
      results[name] = result.structuredContent;
    }
    await request('ping');
    child.stdin.end();
    const ended = await exit;
    if (protocolFailure) throw protocolFailure;
    if (ended.exitCode !== 0 || stderr)
      throw new Error(`MCP shutdown failed: ${JSON.stringify(ended)} ${stderr}`);
    return {
      status: 'passed',
      scope: 'stdio-diagnostics',
      configurationFile,
      configuredEnvironmentKeys: Object.keys(entry.env || {}).sort(),
      command,
      cwd: path.resolve(projectRoot),
      startedAt,
      endedAt: new Date().toISOString(),
      ...ended,
      stdin,
      stdout,
      stderr,
      tools,
      testedTools: diagnosticTools,
      unexecutedTools: tools.filter((name) => !diagnosticTools.includes(name)),
      projectStatus: results.status,
      hostInstallation: 'not-run',
      trustedApproval: 'not-run',
      subagents: 'not-run',
    };
  } finally {
    clearTimeout(deadline);
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output'))
    throw new Error('Usage: node scripts/codex-plugin-smoke.mjs [--output <evidence.json>]');
  const result = await smokePlugin();
  result.configurationChecks = [
    {
      file: result.configurationFile,
      status: result.status,
      command: result.command,
      exitCode: result.exitCode,
    },
  ];
  if (fs.existsSync(path.join(repository, '.mcp.json'))) {
    const workspace = await smokePlugin({ mcpFile: '.mcp.json' });
    result.configurationChecks.push({
      file: workspace.configurationFile,
      status: workspace.status,
      command: workspace.command,
      exitCode: workspace.exitCode,
    });
  }
  if (args[1]) {
    fs.mkdirSync(path.dirname(path.resolve(args[1])), { recursive: true });
    fs.writeFileSync(args[1], JSON.stringify(result, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  });
}
