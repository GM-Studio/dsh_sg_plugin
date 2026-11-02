import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { diagnosticFailure } from './core/diagnostics.js';
import { diagnoseBootstrap, hostGuidance } from './core/bootstrap-diagnostics.js';

// Keep the portable entry outside the runtime import graph so malformed plugin
// metadata or a missing module can still produce a safe host-readable diagnosis.
const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
let runtime;
let stage = 'bootstrap.config';
let guidance;
try {
  const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(
    fs.readFileSync(new URL('../../.codex-plugin/plugin.json', import.meta.url), 'utf8'),
  );
  if (
    typeof manifest.name !== 'string' ||
    typeof manifest.version !== 'string' ||
    !pkg.engines ||
    typeof pkg.engines.node !== 'string'
  )
    throw Object.assign(new Error('Invalid plugin metadata'), { code: 'HOST_CONFIG_INVALID' });
  stage = 'bootstrap.runtime';
  const diagnosis = diagnoseBootstrap({ engines: pkg.engines, projectBound: false });
  if (diagnosis.reason === 'host-runtime-unsupported') {
    guidance = hostGuidance(diagnosis).lines;
    throw Object.assign(new Error('Unsupported Node runtime'), {
      code: 'HOST_RUNTIME_UNSUPPORTED',
    });
  }
  const args = process.argv.slice(2);
  if (
    isMain &&
    args.length !== 0 &&
    (args.length !== 2 || args[0] !== '--project-root' || !args[1])
  ) {
    stage = 'bootstrap.config';
    throw Object.assign(new Error('Invalid startup options'), {
      code: 'HOST_CONFIG_INVALID',
      usage: true,
    });
  }
  if (isMain && args[1]) {
    stage = 'bootstrap.project-binding';
    const resolved = fs.realpathSync(path.resolve(args[1]));
    if (!fs.statSync(resolved).isDirectory())
      throw Object.assign(new Error('Project is not a directory'), { code: 'ENOTDIR' });
  }
  stage = 'bootstrap.load';
  runtime = await import('./stdio-server.js');
  if (isMain)
    runtime.serveStdio({
      projectRoot: args[1] || process.cwd(),
      explicitProjectRoot: Boolean(args[1]),
      onFailure: () => {
        process.exitCode = 1;
      },
    });
} catch (error) {
  if (!isMain) throw error;
  const diagnosis = diagnosticFailure(error, {
    stage,
    code: 'BOOTSTRAP_FAILED',
    ...(error?.usage
      ? { message: 'Usage: node src/codex/server.js [--project-root <project>]' }
      : {}),
  });
  if (stage === 'bootstrap.config')
    guidance = hostGuidance(diagnoseBootstrap({ configValid: false, projectBound: false })).lines;
  if (guidance) diagnosis.hostGuidance = guidance;
  process.stderr.write(JSON.stringify(diagnosis) + '\n');
  process.exitCode = 1;
}

export const MAX_MESSAGE_BYTES = runtime?.MAX_MESSAGE_BYTES ?? 1024 * 1024;
export const serveStdio = (...args) => runtime.serveStdio(...args);
export const resolveProjectRoot = (...args) => runtime.resolveProjectRoot(...args);
