import fs from 'node:fs/promises';
import path from 'node:path';
import { createAuthService } from '../core/control/auth/auth-service.js';
import { createMysqlAuthStore } from '../core/control/auth/mysql-auth-store.js';
import { createMysqlPool, migrateMysql } from '../core/control/persistence/mysql-repository.js';

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

export async function readMysqlConfig(configPath) {
  if (typeof configPath !== 'string' || !path.isAbsolute(configPath))
    return failure('MYSQL_CONFIG_INVALID', 'An absolute MySQL config path is required');
  let value;
  try {
    value = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    return failure('MYSQL_CONFIG_UNREADABLE', 'The MySQL config cannot be read', {
      cause: error.code ?? null,
    });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return failure('MYSQL_CONFIG_INVALID', 'The MySQL config must be a JSON object');
  return { ok: true, value };
}

export async function createConfiguredAuthService({
  config = {},
  clock = Date.now,
  sessionTtlMs = 8 * 60 * 60 * 1000,
  challengeTtlMs = 5 * 60 * 1000,
  stepUpProofTtlMs = 2 * 60 * 1000,
} = {}) {
  if (
    !config.mysqlConfigPath ||
    !config.authEncryptionKey ||
    !config.authDeviceConfirmationCodeHash
  )
    return failure(
      'AUTH_CONFIG_REQUIRED',
      'MySQL, TOTP encryption and device confirmation configuration are required',
    );
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
    const store = createMysqlAuthStore({ pool });
    const authService = createAuthService({
      store,
      encryptionKey: config.authEncryptionKey,
      deviceConfirmationCodeHash: config.authDeviceConfirmationCodeHash,
      clock,
      sessionTtlMs,
      challengeTtlMs,
      stepUpProofTtlMs,
    });
    return {
      ok: true,
      authService,
      store,
      close: async () => {
        await pool.end();
      },
    };
  } catch (error) {
    try {
      await pool?.end();
    } catch {
      // Preserve the authentication initialization failure.
    }
    return failure('AUTH_CONFIG_INVALID', 'Authentication could not be initialized', {
      cause: error.code ?? null,
    });
  }
}

export async function initializeConfiguredOwner({
  config = {},
  username,
  password,
  displayName,
  clock = Date.now,
} = {}) {
  const initialized = await createConfiguredAuthService({ config, clock });
  if (!initialized.ok) return initialized;
  try {
    const result = await initialized.authService.initializeOwner({
      username,
      password,
      displayName,
    });
    await initialized.close();
    return result;
  } catch (error) {
    await initialized.close();
    return failure('AUTH_PROVISION_FAILED', 'The owner account could not be initialized', {
      cause: error.code ?? null,
    });
  }
}
