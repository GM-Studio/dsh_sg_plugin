import { readMysqlConfig } from './auth-runtime.js';
import { createMemoryWorkerStore } from '../core/control/worker/memory-worker-store.js';
import { createMysqlWorkerStore } from '../core/control/worker/mysql-worker-store.js';
import { createWorkerGateway } from '../core/control/worker/worker-gateway.js';
import { createMysqlPool, migrateMysql } from '../core/control/persistence/mysql-repository.js';

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

export async function createConfiguredWorkerGateway({
  config = {},
  controlService,
  clock = Date.now,
  leaseMs = 60_000,
  heartbeatIntervalMs = 15_000,
  offlineAfterMs = 45_000,
  waitMs = 0,
} = {}) {
  if (!controlService || typeof controlService.claimNext !== 'function')
    return failure('WORKER_CONTROL_REQUIRED', 'A control service is required');

  if (!config.mysqlConfigPath) {
    const store = createMemoryWorkerStore({ clock });
    const gateway = createWorkerGateway({
      store,
      controlService,
      clock,
      leaseMs,
      heartbeatIntervalMs,
      offlineAfterMs,
      waitMs,
    });
    return {
      ok: true,
      workerGateway: gateway,
      store,
      storage: 'memory',
      close: async () => {},
    };
  }

  const loaded = await readMysqlConfig(config.mysqlConfigPath);
  if (!loaded.ok) return loaded;
  let pool;
  try {
    pool = createMysqlPool(loaded.value);
    const migrated = await migrateMysql({ pool });
    if (!migrated.ok) {
      await pool.end();
      return migrated;
    }
    const store = createMysqlWorkerStore({ pool, clock });
    const workerGateway = createWorkerGateway({
      store,
      controlService,
      clock,
      leaseMs,
      heartbeatIntervalMs,
      offlineAfterMs,
      waitMs,
    });
    return {
      ok: true,
      workerGateway,
      store,
      storage: 'mysql',
      close: async () => {
        await pool.end();
      },
    };
  } catch (error) {
    try {
      await pool?.end();
    } catch {
      // Preserve the Worker initialization failure.
    }
    return failure('WORKER_CONFIG_INVALID', 'Worker gateway could not be initialized', {
      cause: error.code ?? null,
    });
  }
}
