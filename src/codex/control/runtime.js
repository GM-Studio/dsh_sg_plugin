import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createControlStore } from './store.js';
import { createControlService } from './service.js';
import { localControlEnvironment, resolveControlEnvironment } from './config.js';
import { loadProjectReadiness } from '../project-state.js';
import { createControlManagementServices } from './management-services.js';
import { createStepUpAuthority } from './step-up.js';

// Durable management-server session store. The management server hands it a
// snapshot of `{ sessions: { [id]: { createdAt, expiresAt, csrf } }, pairing:
// { [hashedKey]: { createdAt, expiresAt } } }`; only opaque session ids and the
// already-hashed pairing keys are written, never raw tokens or credentials.
// The methods are intentionally synchronous so a session/pairing issued just
// before a restart is already on disk; `load()`/`save()`/`remove()` may also be
// awaited by the server, so a future async implementation stays compatible.
export function createFileSessionStore({ root, fileName = 'web-sessions.json' } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root))
    throw new TypeError('Session store root must be an absolute path');
  const target = path.join(root, fileName);

  function readState() {
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      return {
        sessions:
          parsed && typeof parsed.sessions === 'object' && parsed.sessions ? parsed.sessions : {},
        pairing:
          parsed && typeof parsed.pairing === 'object' && parsed.pairing ? parsed.pairing : {},
      };
    } catch {
      return { sessions: {}, pairing: {} };
    }
  }

  function writeState(state) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      fs.rmSync(target, { force: true });
      fs.renameSync(temporary, target);
    }
  }

  return {
    root,
    path: target,
    load: () => readState(),
    save: (state) => writeState(state),
    remove(sessionId) {
      const state = readState();
      if (state.sessions[sessionId]) {
        delete state.sessions[sessionId];
        writeState(state);
      }
    },
  };
}

/**
 * Builds the local control runtime. When `mode`/`projectRoot` are supplied the
 * control home and management port are derived with `resolveControlEnvironment`:
 * aggregate keeps the shared home/port, isolated gets a per-project home under
 * `<controlRoot>/projects/<projectId>` and a deterministic port. An invalid
 * mode/root returns an ok:false failure (never throws and never silently writes
 * to the wrong home); callers that omit `mode` keep the shared aggregate home.
 */
export function createLocalControlRuntime({
  env = process.env,
  clock = Date.now,
  mode = null,
  projectRoot = null,
} = {}) {
  const config = resolveControlEnvironment({ env, mode, projectRoot });
  if (!config.ok) return config;
  const store = createControlStore({
    root: config.controlRoot,
    clock,
    ownerId: config.ownerId,
  });
  const service = createControlService({
    store,
    clock,
    ownerId: config.ownerId,
    readinessChecker: ({ projectRoot }) => loadProjectReadiness({ projectRoot }),
  });
  return { config, store, service };
}

export function createLocalManagementServices({
  env = process.env,
  clock = Date.now,
  service,
  defaultProjectRoot = null,
} = {}) {
  const config = localControlEnvironment(env);
  const control = service || createLocalControlRuntime({ env, clock }).service;
  const stepUp = config.mfaSecret
    ? createStepUpAuthority({ secret: config.mfaSecret, clock })
    : { verify: () => null };
  return {
    config,
    service: control,
    stepUp,
    services: createControlManagementServices({
      service: control,
      stepUp,
      defaultProjectRoot,
      clock,
    }),
  };
}
