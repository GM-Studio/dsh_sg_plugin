import { createControlStore } from './store.js';
import { createControlService } from './service.js';
import { localControlEnvironment } from './config.js';
import { loadProjectReadiness } from '../project-state.js';
import { createControlManagementServices } from './management-services.js';
import { createStepUpAuthority } from './step-up.js';

export function createLocalControlRuntime({ env = process.env, clock = Date.now } = {}) {
  const config = localControlEnvironment(env);
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
