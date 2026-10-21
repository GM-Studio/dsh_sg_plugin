import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProtocol, rpcError } from './protocol.js';
import { createMcpPeer } from './peer.js';
import { createToolRegistry } from './workflow-tools.js';
import { interactiveHostIdentity } from './host-input.js';

export const MAX_MESSAGE_BYTES = 1024 * 1024;

function ordinaryProjectRoot(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const root = fs.realpathSync(path.resolve(value));
    return fs.lstatSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

export async function resolveProjectRoot(
  peer,
  fallback,
  { env = process.env, timeoutMs = 5000 } = {},
) {
  const configured = ordinaryProjectRoot(env.SPECGATE_PROJECT_ROOT);
  if (configured) return configured;
  if (peer.capabilities().rootsSupported !== true) return path.resolve(fallback);
  try {
    const result = await peer.request('roots/list', {}, { timeoutMs });
    const roots = Array.isArray(result?.roots) ? result.roots : [];
    const pluginRoot = ordinaryProjectRoot(env.PLUGIN_ROOT) || ordinaryProjectRoot(fallback);
    for (const entry of roots) {
      if (typeof entry?.uri !== 'string') continue;
      let candidate = entry.uri;
      if (candidate.startsWith('file:')) {
        try {
          candidate = fileURLToPath(candidate);
        } catch {
          continue;
        }
      }
      const root = ordinaryProjectRoot(candidate);
      if (!root) continue;
      const relativeToPlugin = pluginRoot ? path.relative(pluginRoot, root) : null;
      if (
        (pluginRoot && root === pluginRoot) ||
        (relativeToPlugin &&
          !relativeToPlugin.startsWith('..' + path.sep) &&
          relativeToPlugin !== '..')
      )
        continue;
      return root;
    }
  } catch {
    // Roots are optional; retain the host-provided fallback.
  }
  return path.resolve(fallback);
}

export function serveStdio({
  projectRoot = process.cwd(),
  trustedUserIdentity = interactiveHostIdentity(),
  nativeAgents = process.env.SPECGATE_NATIVE_AGENTS === '1',
  input = process.stdin,
  output = process.stdout,
  onFailure = () => {},
  toolRegistryFactory = createToolRegistry,
} = {}) {
  let pending = '';
  let failed = false;
  let queue = Promise.resolve();
  let queuedToolActive = false;
  const running = new Map();
  const send = (message) => {
    if (message !== null) output.write(`${JSON.stringify(message)}\n`);
  };
  const peer = createMcpPeer({ send });
  const registryOptions = {
    requestPeer: peer.request,
    peerCapabilities: peer.capabilities,
    trustedUserIdentity,
    nativeAgents,
  };
  let registry = toolRegistryFactory({
    ...registryOptions,
    projectRoot: path.resolve(projectRoot),
  });
  const dynamicRegistry = {
    get definitions() {
      return registry.definitions;
    },
    validate(name, args) {
      return typeof registry.validate === 'function' ? registry.validate(name, args) : true;
    },
    call(name, args, context) {
      return registry.call(name, args, context);
    },
  };
  const dispatch = createProtocol({
    projectRoot: path.resolve(projectRoot),
    registry: dynamicRegistry,
    onInitialize: async (capabilities) => {
      peer.initialize(capabilities);
      const resolved = await resolveProjectRoot(peer, projectRoot);
      if (resolved !== path.resolve(projectRoot))
        registry = toolRegistryFactory({ ...registryOptions, projectRoot: resolved });
    },
  });
  const close = () => {
    peer.close();
    for (const controller of running.values()) controller.abort();
  };
  const accept = (message) => {
    if (
      message &&
      typeof message === 'object' &&
      !Array.isArray(message) &&
      message.jsonrpc === '2.0' &&
      !Object.hasOwn(message, 'method') &&
      (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error'))
    ) {
      peer.receive(message);
      return;
    }
    if (message?.jsonrpc === '2.0' && message.method === 'notifications/cancelled') {
      running.get(message.params?.requestId)?.abort();
      return;
    }
    if (message && Object.hasOwn(message, 'id') && running.has(message.id)) {
      send(rpcError(message.id, -32600, 'Duplicate in-flight request id'));
      return;
    }
    const controller = new AbortController();
    const tracked =
      message?.method === 'tools/call' &&
      (typeof message.id === 'string' || Number.isSafeInteger(message.id));
    if (tracked) running.set(message.id, controller);
    const execute = async (queued = false) => {
      if (queued && tracked) queuedToolActive = true;
      try {
        const response = await dispatch(message, { signal: controller.signal });
        send(response);
        if (
          response?.result?.structuredContent?.state &&
          ['PAUSED', 'CANCELLED'].includes(response.result.structuredContent.state.phase)
        ) {
          for (const active of running.values()) if (active !== controller) active.abort();
        }
      } catch {
        send(rpcError(message?.id ?? null, -32603, 'Internal protocol error'));
      } finally {
        if (tracked && running.get(message.id) === controller) running.delete(message.id);
        if (queued && tracked) queuedToolActive = false;
      }
    };
    // Peer responses and cancellation notifications bypass this queue, so an
    // elicitation or long command cannot deadlock the response channel.
    const readOnlyWhileBusy =
      queuedToolActive &&
      (message?.method === 'ping' ||
        (message?.method === 'tools/call' &&
          dynamicRegistry.definitions.some(
            (tool) => tool.name === message.params?.name && tool.annotations?.readOnlyHint === true,
          )));
    if (
      readOnlyWhileBusy ||
      (message?.method === 'tools/call' && ['sg_pause', 'sg_cancel'].includes(message.params?.name))
    )
      void execute();
    else queue = queue.then(() => execute(true));
  };
  const fail = (message) => {
    if (failed) return;
    failed = true;
    close();
    send(rpcError(null, -32700, message));
    onFailure();
    // Drain stdin until EOF without retaining further bytes. Avoid closing the
    // pipe while a client is still writing a rejected oversized frame.
    pending = '';
  };
  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    if (failed) return;
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (Buffer.byteLength(line, 'utf8') > MAX_MESSAGE_BYTES) {
        fail('MCP message exceeds 1 MiB');
        return;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        send(rpcError(null, -32700, 'Parse error'));
        continue;
      }
      accept(message);
    }
    if (Buffer.byteLength(pending, 'utf8') > MAX_MESSAGE_BYTES) fail('MCP message exceeds 1 MiB');
  });
  input.on('end', () => {
    if (pending.length) fail('Truncated MCP message: newline required');
    close();
  });
  input.on('error', () => {
    failed = true;
    close();
    onFailure();
  });
  output.on('error', () => {
    failed = true;
    close();
    input.destroy();
    onFailure();
  });
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--project-root' || !args[1])) {
    process.stderr.write('Usage: node src/codex/server.js [--project-root <project>]\n');
    process.exitCode = 1;
    return;
  }
  serveStdio({
    projectRoot: args[1] || process.cwd(),
    onFailure: () => {
      process.exitCode = 1;
    },
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  main();
