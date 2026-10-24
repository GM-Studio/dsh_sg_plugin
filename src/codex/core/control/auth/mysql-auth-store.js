import { createHash, randomUUID } from 'node:crypto';

const USER_ROLES = new Set(['owner', 'operator', 'approver', 'viewer', 'customer_acceptor']);
const USER_STATUSES = new Set(['ACTIVE', 'DISABLED']);
const DEVICE_STATUSES = new Set(['ACTIVE', 'REVOKED']);
const SESSION_STATUSES = new Set(['ACTIVE', 'REVOKED', 'EXPIRED']);
const SESSION_AUTH_LEVELS = new Set(['session', 'step-up']);
const CHALLENGE_TYPES = new Set(['PASSWORD', 'TOTP_ENROLLMENT', 'STEP_UP', 'NEW_DEVICE']);
const CHALLENGE_STATUSES = new Set([
  'PENDING',
  'PROOF_READY',
  'PROOF_CONSUMED',
  'CONSUMED',
  'EXPIRED',
  'REVOKED',
]);
const AUDIT_EVENTS = new Set([
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILURE',
  'AUTH_LOGIN_FAILED',
  'AUTH_TOTP_SUCCESS',
  'AUTH_TOTP_FAILURE',
  'AUTH_TOTP_REPLAY',
  'AUTH_DEVICE_REGISTERED',
  'AUTH_DEVICE_REVOKED',
  'AUTH_SESSION_CREATED',
  'AUTH_SESSION_REVOKED',
  'AUTH_SESSION_EXPIRED',
  'AUTH_CHALLENGE_CREATED',
  'AUTH_CHALLENGE_CONSUMED',
  'AUTH_CHALLENGE_FAILED',
  'AUTH_NONCE_CREATED',
  'AUTH_NONCE_CONSUMED',
  'AUTH_NONCE_REJECTED',
  'AUTH_RATE_LIMITED',
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'TOTP_SUCCESS',
  'TOTP_FAILURE',
  'TOTP_REPLAY',
  'DEVICE_REGISTERED',
  'DEVICE_REVOKED',
  'SESSION_CREATED',
  'SESSION_REVOKED',
  'CHALLENGE_CREATED',
  'CHALLENGE_CONSUMED',
  'NONCE_CREATED',
  'NONCE_CONSUMED',
  'RATE_LIMITED',
  'owner_initialized',
  'user_created',
  'rate_limited',
  'totp_failed',
  'totp_replayed',
  'login_failed',
  'login_succeeded',
  'device_enrollment_failed',
  'device_enrolled',
  'session_rejected',
  'csrf_failed',
  'step_up_challenge_created',
  'step_up_failed',
  'step_up_completed',
  'step_up_authorization_failed',
  'step_up_authorized',
  'device_revocation_failed',
  'device_revoked',
  'attention_nonce_issued',
  'attention_nonce_redeemed',
  'logout',
]);
const HASH = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY =
  /(?:password|passwd|secret|token|csrf|proof|nonce|seed|cipher|confirmation.?code|totp.?code|authorization|api.?key|private.?key|credential|cookie)/i;

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const success = (value = {}) => ({ ok: true, ...value });
const nonEmpty = (value, max = 256) =>
  typeof value === 'string' && value.length > 0 && value.length <= max && value.trim().length > 0;
const iso = (value) => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
};
const sqlDate = (value) => iso(value)?.replace('T', ' ').slice(0, 23) ?? null;
const dbDate = (value) => {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`).toISOString();
};
const epoch = (value) => Date.parse(dbDate(value));
const bool = (value) => value === true || value === 1 || value === '1';
const integer = (value) => (Number.isSafeInteger(Number(value)) ? Number(value) : null);
const hashText = (value) => createHash('sha256').update(String(value)).digest('hex');
const parseJson = (value) => (typeof value === 'string' ? JSON.parse(value) : clone(value ?? {}));
const json = (value) => JSON.stringify(value ?? {});

function normalizedHash(value) {
  if (typeof value !== 'string') return null;
  const hash = value.toLowerCase();
  return HASH.test(hash) ? hash : null;
}

function redactDetail(value, depth = 0, seen = new WeakSet()) {
  if (depth > 3) return '[truncated]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, 512);
  if (typeof value !== 'object') return null;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value))
    return value.slice(0, 32).map((item) => redactDetail(item, depth + 1, seen));
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 32)) {
    if (!key || SENSITIVE_KEY.test(key)) continue;
    output[key] = redactDetail(item, depth + 1, seen);
  }
  return output;
}

function userRecord(row) {
  return {
    id: row.user_id,
    userId: row.user_id,
    username: row.username,
    normalizedUsername: row.username.trim().toLowerCase(),
    displayName: row.display_name,
    passwordHash: row.password_hash,
    totpSecretCiphertext: row.totp_secret_ciphertext,
    totpEnrolledAt: dbDate(row.totp_enrolled_at),
    totpEnrollmentRequired: bool(row.totp_enrollment_required),
    totpLastUsedCounter: integer(row.totp_last_used_counter),
    totpLastCounter: integer(row.totp_last_used_counter),
    role: row.role,
    status: row.status,
    createdAt: dbDate(row.created_at),
    updatedAt: dbDate(row.updated_at),
    version: Number(row.version),
  };
}

function deviceRecord(row) {
  return {
    id: row.device_id,
    deviceId: row.device_id,
    userId: row.user_id,
    name: row.name,
    publicKeyFingerprint: row.public_key_fingerprint,
    status: row.status,
    lastSeenAt: dbDate(row.last_seen_at),
    revokedAt: dbDate(row.revoked_at),
    createdAt: dbDate(row.created_at),
    updatedAt: dbDate(row.updated_at),
    version: Number(row.version),
  };
}

function sessionRecord(row) {
  return {
    id: row.session_id,
    sessionId: row.session_id,
    userId: row.user_id,
    deviceId: row.device_id,
    tokenHash: row.token_hash,
    csrfHash: row.csrf_hash,
    authLevel: row.auth_level,
    status: row.status,
    expiresAt: dbDate(row.expires_at),
    lastSeenAt: dbDate(row.last_seen_at),
    revokedAt: dbDate(row.revoked_at),
    createdAt: dbDate(row.created_at),
    updatedAt: dbDate(row.updated_at),
    version: Number(row.version),
  };
}

function challengeRecord(row) {
  return {
    id: row.challenge_id,
    challengeId: row.challenge_id,
    userId: row.user_id,
    sessionId: row.session_id,
    deviceId: row.device_id,
    type: row.challenge_type,
    challengeType: row.challenge_type,
    action: row.action,
    resourceId: row.resource_id,
    proofHash: row.proof_hash,
    proofExpiresAt: dbDate(row.proof_expires_at),
    status: row.status,
    attempts: Number(row.attempts),
    metadata: parseJson(row.metadata_json),
    expiresAt: dbDate(row.expires_at),
    consumedAt: dbDate(row.consumed_at),
    proofConsumedAt: dbDate(row.proof_consumed_at),
    createdAt: dbDate(row.created_at),
    updatedAt: dbDate(row.updated_at),
  };
}

function nonceRecord(row) {
  return {
    id: row.nonce_id,
    nonceId: row.nonce_id,
    attentionId: row.attention_id,
    nonceHash: row.token_hash,
    tokenHash: row.token_hash,
    status: row.status,
    expiresAt: dbDate(row.expires_at),
    consumedAt: dbDate(row.consumed_at),
    redeemedAt: dbDate(row.redeemed_at),
    redeemedByUserId: row.redeemed_by_user_id,
    redeemedBySessionId: row.redeemed_by_session_id,
    createdAt: dbDate(row.created_at),
  };
}

function auditRecord(row) {
  return {
    id: row.auth_audit_id,
    auditId: row.auth_audit_id,
    sequence: Number(row.sequence),
    event: row.event,
    action: row.event,
    outcome: row.outcome,
    actorId: row.actor_id,
    userId: row.user_id,
    sessionId: row.session_id,
    deviceId: row.device_id,
    attentionId: row.attention_id,
    sourceIpHash: row.source_ip_hash,
    userAgentHash: row.user_agent_hash,
    detail: parseJson(row.detail_json),
    createdAt: dbDate(row.created_at),
  };
}

function optionsFrom(index, args) {
  const value = args[index];
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return null;
}

function explicitTime(options, positional) {
  return (
    options.at ??
    (typeof positional === 'string' || typeof positional === 'number' ? positional : null)
  );
}

function timestamp(value, fallback) {
  const normalized = iso(value) ?? fallback();
  return { iso: normalized, sql: sqlDate(normalized) };
}

export function createMysqlAuthStore({ pool, clock = Date.now } = {}) {
  if (!pool || typeof pool.getConnection !== 'function' || typeof clock !== 'function')
    throw new TypeError('A MySQL pool and a clock function are required');

  const now = () => new Date(clock()).toISOString();
  const one = async (db, sql, parameters = []) => (await db.execute(sql, parameters))[0][0];

  async function run(work, { duplicateCode = 'AUTH_RECORD_CONFLICT' } = {}) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let db;
      let started = false;
      try {
        db = await pool.getConnection();
        await db.beginTransaction();
        started = true;
        const result = await work(db);
        await db.commit();
        return result;
      } catch (error) {
        if (started) {
          try {
            await db.rollback();
          } catch {
            db.destroy();
            db = null;
          }
        }
        if (attempt < 2 && ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) {
          db?.release();
          db = null;
          continue;
        }
        if (error.code === 'ER_DUP_ENTRY')
          return failure(duplicateCode, 'An authentication record already exists');
        if (error.code === 'ER_NO_REFERENCED_ROW_2')
          return failure(
            'AUTH_REFERENCE_NOT_FOUND',
            'A referenced authentication record was not found',
          );
        if (error.code === 'ER_ROW_IS_REFERENCED_2')
          return failure('AUTH_REFERENCE_IN_USE', 'An authentication record is still referenced');
        return failure('AUTH_PERSISTENCE_FAILED', 'Authentication persistence failed', {
          cause: error.code ?? null,
        });
      } finally {
        db?.release();
      }
    }
    return failure('AUTH_PERSISTENCE_FAILED', 'Authentication persistence failed');
  }

  const userById = async (db, userId) =>
    one(db, 'SELECT * FROM control_user WHERE user_id = ?', [userId]);
  const deviceById = async (db, deviceId) =>
    one(db, 'SELECT * FROM device WHERE device_id = ?', [deviceId]);
  const sessionById = async (db, sessionId) =>
    one(db, 'SELECT * FROM auth_session WHERE session_id = ?', [sessionId]);
  const challengeById = async (db, challengeId) =>
    one(db, 'SELECT * FROM auth_challenge WHERE challenge_id = ?', [challengeId]);

  async function revokeDeviceSessions(db, deviceId, at) {
    const [result] = await db.execute(
      `UPDATE auth_session
       SET status = 'REVOKED', revoked_at = ?, updated_at = ?, version = version + 1
       WHERE device_id = ? AND status = 'ACTIVE'`,
      [sqlDate(at), sqlDate(at), deviceId],
    );
    return result.affectedRows;
  }

  return Object.freeze({
    async findUserByUsername(username) {
      const normalizedUsername = typeof username === 'string' ? username.trim() : username;
      if (!nonEmpty(normalizedUsername, 128))
        return failure('USERNAME_INVALID', 'A username is required');
      return run(async (db) => {
        const row = await one(db, 'SELECT * FROM control_user WHERE username = ?', [
          normalizedUsername,
        ]);
        return success({ user: row ? userRecord(row) : null });
      });
    },

    async findUserByRole(role) {
      if (!USER_ROLES.has(role)) return failure('ROLE_INVALID', 'User role is invalid');
      return run(async (db) => {
        const row = await one(
          db,
          `SELECT * FROM control_user
           WHERE role = ? AND status = 'ACTIVE'
           ORDER BY created_at, user_id LIMIT 1`,
          [role],
        );
        return success({ user: row ? userRecord(row) : null });
      });
    },

    async getUser(userId) {
      if (!nonEmpty(userId, 128)) return failure('USER_ID_INVALID', 'A user id is required');
      return run(async (db) => {
        const row = await userById(db, userId);
        return success({ user: row ? userRecord(row) : null });
      });
    },

    async createUser(input = {}) {
      const username = typeof input.username === 'string' ? input.username.trim() : input.username;
      if (
        !nonEmpty(input.userId, 128) ||
        !nonEmpty(username, 128) ||
        !nonEmpty(input.displayName, 256) ||
        !nonEmpty(input.passwordHash, 512) ||
        !USER_ROLES.has(input.role ?? 'owner') ||
        !USER_STATUSES.has(input.status ?? 'ACTIVE') ||
        (input.totpEnrolledAt != null && !iso(input.totpEnrolledAt)) ||
        (input.totpSecretCiphertext != null && !nonEmpty(input.totpSecretCiphertext, 65535))
      )
        return failure('USER_INVALID', 'User configuration is invalid');
      const at = timestamp(input.createdAt, now);
      return run(
        async (db) => {
          const existing = await one(db, 'SELECT user_id FROM control_user WHERE username = ?', [
            username,
          ]);
          if (existing) return failure('USERNAME_EXISTS', 'Username is already registered');
          const lastCounter = integer(input.totpLastCounter ?? input.totpLastUsedCounter);
          await db.execute(
            `INSERT INTO control_user (
               user_id, username, display_name, password_hash, totp_secret_ciphertext,
               totp_enrolled_at, totp_enrollment_required, totp_last_used_counter,
               role, status, created_at, updated_at, version
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [
              input.userId,
              username,
              input.displayName,
              input.passwordHash,
              input.totpSecretCiphertext ?? null,
              sqlDate(input.totpEnrolledAt ?? (input.totpSecretCiphertext == null ? null : at.iso)),
              bool(input.totpEnrollmentRequired ?? input.totpSecretCiphertext == null) ? 1 : 0,
              lastCounter != null && lastCounter >= 0 ? lastCounter : 0,
              input.role ?? 'owner',
              input.status ?? 'ACTIVE',
              at.sql,
              at.sql,
            ],
          );
          return success({ user: userRecord(await userById(db, input.userId)) });
        },
        { duplicateCode: 'USERNAME_EXISTS' },
      );
    },

    async updateUser(userIdOrInput, patch = {}) {
      const request =
        userIdOrInput && typeof userIdOrInput === 'object'
          ? userIdOrInput
          : { ...patch, userId: userIdOrInput };
      const input = request.user ?? request;
      if (!nonEmpty(input.userId, 128)) return failure('USER_ID_INVALID', 'A user id is required');
      return run(
        async (db) => {
          const current = await userById(db, input.userId);
          if (!current) return failure('USER_NOT_FOUND', 'User was not found');
          const next = {
            username:
              typeof (input.username ?? current.username) === 'string'
                ? (input.username ?? current.username).trim()
                : (input.username ?? current.username),
            displayName: input.displayName ?? current.display_name,
            passwordHash: input.passwordHash ?? current.password_hash,
            totpSecretCiphertext:
              input.totpSecretCiphertext === undefined
                ? current.totp_secret_ciphertext
                : input.totpSecretCiphertext,
            totpEnrolledAt:
              input.totpEnrolledAt === undefined ? current.totp_enrolled_at : input.totpEnrolledAt,
            totpEnrollmentRequired:
              input.totpEnrollmentRequired === undefined
                ? current.totp_enrollment_required
                : bool(input.totpEnrollmentRequired),
            role: input.role ?? current.role,
            status: input.status ?? current.status,
          };
          if (
            !nonEmpty(next.username, 128) ||
            !nonEmpty(next.displayName, 256) ||
            !nonEmpty(next.passwordHash, 512) ||
            (next.totpSecretCiphertext != null && !nonEmpty(next.totpSecretCiphertext, 65535)) ||
            (next.totpEnrolledAt != null && !iso(next.totpEnrolledAt)) ||
            !USER_ROLES.has(next.role) ||
            !USER_STATUSES.has(next.status)
          )
            return failure('USER_INVALID', 'User configuration is invalid');
          if (
            request.expectedVersion !== undefined &&
            request.expectedVersion !== Number(current.version)
          )
            return failure('USER_VERSION_CONFLICT', 'User changed concurrently');
          const at = timestamp(input.updatedAt, now);
          const [result] = await db.execute(
            `UPDATE control_user
           SET username = ?, display_name = ?, password_hash = ?, totp_secret_ciphertext = ?,
               totp_enrolled_at = ?, totp_enrollment_required = ?, role = ?, status = ?,
               updated_at = ?, version = version + 1
           WHERE user_id = ? AND version = ?`,
            [
              next.username,
              next.displayName,
              next.passwordHash,
              next.totpSecretCiphertext,
              sqlDate(next.totpEnrolledAt),
              next.totpEnrollmentRequired ? 1 : 0,
              next.role,
              next.status,
              at.sql,
              input.userId,
              Number(current.version),
            ],
          );
          if (result.affectedRows !== 1)
            return failure('USER_VERSION_CONFLICT', 'User changed concurrently');
          return success({ user: userRecord(await userById(db, input.userId)) });
        },
        { duplicateCode: 'USERNAME_EXISTS' },
      );
    },

    async consumeTotpCounter(userIdOrInput, counterArgument, atOrOptions) {
      const input =
        userIdOrInput && typeof userIdOrInput === 'object'
          ? userIdOrInput
          : { userId: userIdOrInput, counter: counterArgument };
      const realUserId = input.userId;
      const counterValue = integer(input.counter);
      if (!nonEmpty(realUserId, 128) || counterValue == null || counterValue < 0)
        return failure('TOTP_COUNTER_INVALID', 'TOTP counter is invalid');
      const options = input.at != null ? { at: input.at } : (optionsFrom(2, arguments) ?? {});
      const at = timestamp(
        options.at ?? (typeof atOrOptions === 'string' ? atOrOptions : null),
        now,
      );
      return run(async (db) => {
        const current = await userById(db, realUserId);
        if (!current) return failure('USER_NOT_FOUND', 'User was not found');
        const [result] = await db.execute(
          `UPDATE control_user
           SET totp_last_used_counter = ?, updated_at = ?, version = version + 1
           WHERE user_id = ? AND totp_last_used_counter < ?`,
          [counterValue, at.sql, realUserId, counterValue],
        );
        if (result.affectedRows !== 1)
          return failure('TOTP_COUNTER_REPLAY', 'TOTP counter was already used');
        return success({
          user: userRecord(await userById(db, realUserId)),
          counter: counterValue,
        });
      });
    },

    async getDevice(deviceId) {
      if (!nonEmpty(deviceId, 128)) return failure('DEVICE_ID_INVALID', 'A device id is required');
      return run(async (db) => {
        const row = await deviceById(db, deviceId);
        return success({ device: row ? deviceRecord(row) : null });
      });
    },

    async saveDevice(input = {}) {
      const deviceId = input.deviceId ?? input.id;
      if (
        !nonEmpty(deviceId, 128) ||
        !nonEmpty(input.userId, 128) ||
        !nonEmpty(input.name, 256) ||
        (input.status !== undefined && !DEVICE_STATUSES.has(input.status)) ||
        (input.publicKeyFingerprint != null && !nonEmpty(input.publicKeyFingerprint, 64)) ||
        (input.lastSeenAt != null && !iso(input.lastSeenAt))
      )
        return failure('DEVICE_INVALID', 'Device configuration is invalid');
      const at = timestamp(input.updatedAt ?? input.createdAt, now);
      return run(
        async (db) => {
          const user = await userById(db, input.userId);
          if (!user) return failure('USER_NOT_FOUND', 'User was not found');
          const current = await one(db, 'SELECT * FROM device WHERE device_id = ? FOR UPDATE', [
            deviceId,
          ]);
          if (current && current.user_id !== input.userId)
            return failure('DEVICE_OWNER_MISMATCH', 'A device cannot change owner');
          if (current?.status === 'REVOKED' && input.status !== 'REVOKED')
            return failure('DEVICE_REVOKED', 'A revoked device cannot be reactivated');
          const status = input.status ?? current?.status ?? 'ACTIVE';
          const revokedAt =
            status === 'REVOKED' ? timestamp(input.revokedAt ?? at.iso, now).sql : null;
          if (current) {
            await db.execute(
              `UPDATE device
               SET name = ?, public_key_fingerprint = ?, status = ?, last_seen_at = ?,
                   revoked_at = ?, updated_at = ?, version = version + 1
               WHERE device_id = ? AND version = ?`,
              [
                input.name,
                input.publicKeyFingerprint ?? current.public_key_fingerprint,
                status,
                sqlDate(input.lastSeenAt ?? dbDate(current.last_seen_at)),
                revokedAt,
                at.sql,
                deviceId,
                Number(current.version),
              ],
            );
          } else {
            await db.execute(
              `INSERT INTO device (
                 device_id, user_id, name, public_key_fingerprint, status,
                 last_seen_at, revoked_at, created_at, updated_at, version
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
              [
                deviceId,
                input.userId,
                input.name,
                input.publicKeyFingerprint ?? null,
                status,
                sqlDate(input.lastSeenAt),
                revokedAt,
                sqlDate(input.createdAt ?? at.iso),
                at.sql,
              ],
            );
          }
          return success({ device: deviceRecord(await deviceById(db, deviceId)) });
        },
        { duplicateCode: 'DEVICE_CONFLICT' },
      );
    },

    async listDevices(userId) {
      if (!nonEmpty(userId, 128)) return failure('USER_ID_INVALID', 'A user id is required');
      return run(async (db) => {
        const [rows] = await db.execute(
          'SELECT * FROM device WHERE user_id = ? ORDER BY created_at, device_id',
          [userId],
        );
        return success({ devices: rows.map(deviceRecord) });
      });
    },

    async saveSession(input = {}) {
      const sessionId = input.sessionId ?? input.id;
      const tokenHash = normalizedHash(input.tokenHash);
      const csrfHash = normalizedHash(input.csrfHash);
      if (
        !nonEmpty(sessionId, 64) ||
        !nonEmpty(input.userId, 128) ||
        !nonEmpty(input.deviceId, 128) ||
        !tokenHash ||
        !csrfHash ||
        !iso(input.expiresAt) ||
        (input.authLevel !== undefined && !SESSION_AUTH_LEVELS.has(input.authLevel)) ||
        (input.status !== undefined && !SESSION_STATUSES.has(input.status))
      )
        return failure('SESSION_INVALID', 'Session configuration is invalid');
      const at = timestamp(input.updatedAt ?? input.createdAt, now);
      return run(
        async (db) => {
          const user = await userById(db, input.userId);
          if (!user) return failure('USER_NOT_FOUND', 'User was not found');
          const device = await one(db, 'SELECT * FROM device WHERE device_id = ? FOR UPDATE', [
            input.deviceId,
          ]);
          if (!device || device.user_id !== input.userId)
            return failure('DEVICE_NOT_FOUND', 'Session device was not found');
          if (device.status !== 'ACTIVE') return failure('DEVICE_REVOKED', 'Device is not active');
          const current = await sessionById(db, sessionId);
          if (current && (current.user_id !== input.userId || current.device_id !== input.deviceId))
            return failure('SESSION_IDENTITY_IMMUTABLE', 'Session binding cannot change');
          const status = input.status ?? current?.status ?? 'ACTIVE';
          if (current && current.status !== 'ACTIVE' && status === 'ACTIVE')
            return failure('SESSION_INACTIVE', 'An inactive session cannot be reactivated');
          const authLevel = input.authLevel ?? current?.auth_level ?? 'session';
          if (current) {
            await db.execute(
              `UPDATE auth_session
               SET token_hash = ?, csrf_hash = ?, auth_level = ?, status = ?, expires_at = ?,
                   last_seen_at = ?, revoked_at = ?, updated_at = ?, version = version + 1
               WHERE session_id = ? AND version = ?`,
              [
                tokenHash,
                csrfHash,
                authLevel,
                status,
                sqlDate(input.expiresAt),
                sqlDate(input.lastSeenAt ?? dbDate(current.last_seen_at)),
                status === 'REVOKED'
                  ? timestamp(input.revokedAt ?? at.iso, now).sql
                  : current.revoked_at,
                at.sql,
                sessionId,
                Number(current.version),
              ],
            );
          } else {
            await db.execute(
              `INSERT INTO auth_session (
                 session_id, user_id, device_id, token_hash, csrf_hash, auth_level, status,
                 expires_at, last_seen_at, revoked_at, created_at, updated_at, version
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
              [
                sessionId,
                input.userId,
                input.deviceId,
                tokenHash,
                csrfHash,
                authLevel,
                status,
                sqlDate(input.expiresAt),
                sqlDate(input.lastSeenAt),
                status === 'REVOKED' ? timestamp(input.revokedAt ?? at.iso, now).sql : null,
                sqlDate(input.createdAt ?? at.iso),
                at.sql,
              ],
            );
          }
          return success({ session: sessionRecord(await sessionById(db, sessionId)) });
        },
        { duplicateCode: 'SESSION_TOKEN_EXISTS' },
      );
    },

    async getSessionByTokenHash(tokenHash) {
      const normalized = normalizedHash(tokenHash);
      if (!normalized) return failure('SESSION_TOKEN_INVALID', 'Session token hash is invalid');
      return run(async (db) => {
        const row = await one(db, 'SELECT * FROM auth_session WHERE token_hash = ?', [normalized]);
        return success({ session: row ? sessionRecord(row) : null });
      });
    },

    async touchSession(sessionId, atOrOptions) {
      if (!nonEmpty(sessionId, 64))
        return failure('SESSION_ID_INVALID', 'A session id is required');
      const options = optionsFrom(1, arguments) ?? {};
      const at = timestamp(explicitTime(options, atOrOptions), now);
      return run(async (db) => {
        const current = await sessionById(db, sessionId);
        if (!current) return failure('SESSION_NOT_FOUND', 'Session was not found');
        if (current.status !== 'ACTIVE')
          return failure('SESSION_INACTIVE', 'Session is not active');
        if (epoch(current.expires_at) <= Date.parse(at.iso)) {
          await db.execute(
            `UPDATE auth_session
             SET status = 'EXPIRED', updated_at = ?, version = version + 1
             WHERE session_id = ? AND status = 'ACTIVE'`,
            [at.sql, sessionId],
          );
          return failure('SESSION_EXPIRED', 'Session has expired');
        }
        const [result] = await db.execute(
          `UPDATE auth_session
           SET last_seen_at = ?, updated_at = ?, version = version + 1
           WHERE session_id = ? AND status = 'ACTIVE'`,
          [at.sql, at.sql, sessionId],
        );
        if (result.affectedRows !== 1) return failure('SESSION_INACTIVE', 'Session is not active');
        return success({ session: sessionRecord(await sessionById(db, sessionId)) });
      });
    },

    async revokeSession(sessionId, atOrOptions) {
      if (!nonEmpty(sessionId, 64))
        return failure('SESSION_ID_INVALID', 'A session id is required');
      const options = optionsFrom(1, arguments) ?? {};
      const at = timestamp(explicitTime(options, atOrOptions), now);
      return run(async (db) => {
        const current = await sessionById(db, sessionId);
        if (!current) return failure('SESSION_NOT_FOUND', 'Session was not found');
        if (current.status === 'ACTIVE') {
          await db.execute(
            `UPDATE auth_session
             SET status = 'REVOKED', revoked_at = ?, updated_at = ?, version = version + 1
             WHERE session_id = ? AND status = 'ACTIVE'`,
            [at.sql, at.sql, sessionId],
          );
        }
        return success({
          session: sessionRecord(await sessionById(db, sessionId)),
          revoked: current.status === 'ACTIVE',
        });
      });
    },

    async revokeSessionsForDevice(deviceId, atOrOptions) {
      if (!nonEmpty(deviceId, 128)) return failure('DEVICE_ID_INVALID', 'A device id is required');
      const options = optionsFrom(1, arguments) ?? {};
      const at = timestamp(explicitTime(options, atOrOptions), now);
      return run(async (db) => {
        const device = await one(db, 'SELECT * FROM device WHERE device_id = ? FOR UPDATE', [
          deviceId,
        ]);
        if (!device) return failure('DEVICE_NOT_FOUND', 'Device was not found');
        await db.execute(
          `UPDATE device
           SET status = 'REVOKED', revoked_at = COALESCE(revoked_at, ?), updated_at = ?,
               version = version + 1
           WHERE device_id = ?`,
          [at.sql, at.sql, deviceId],
        );
        const revokedSessions = await revokeDeviceSessions(db, deviceId, at.iso);
        return success({
          device: deviceRecord(await deviceById(db, deviceId)),
          count: revokedSessions,
          revokedSessions,
          revokedAt: at.iso,
        });
      });
    },

    async saveChallenge(input = {}) {
      const challengeId = input.challengeId ?? input.id;
      const type = input.type ?? input.challengeType ?? 'STEP_UP';
      const proofHash = input.proofHash == null ? null : normalizedHash(input.proofHash);
      if (
        !nonEmpty(challengeId, 128) ||
        !nonEmpty(input.userId, 128) ||
        (input.sessionId != null && !nonEmpty(input.sessionId, 64)) ||
        (input.deviceId != null && !nonEmpty(input.deviceId, 128)) ||
        !CHALLENGE_TYPES.has(type) ||
        (input.action != null && !nonEmpty(input.action, 128)) ||
        (input.resourceId != null && !nonEmpty(input.resourceId, 256)) ||
        (input.proofHash != null && !proofHash) ||
        (input.proofExpiresAt != null && !iso(input.proofExpiresAt)) ||
        !iso(input.expiresAt) ||
        (input.status !== undefined && !CHALLENGE_STATUSES.has(input.status))
      )
        return failure('CHALLENGE_INVALID', 'Authentication challenge is invalid');
      const at = timestamp(input.createdAt, now);
      return run(
        async (db) => {
          if (!(await userById(db, input.userId)))
            return failure('USER_NOT_FOUND', 'User was not found');
          if (input.deviceId) {
            const device = await deviceById(db, input.deviceId);
            if (!device || device.user_id !== input.userId)
              return failure('DEVICE_NOT_FOUND', 'Challenge device was not found');
          }
          if (input.sessionId) {
            const session = await sessionById(db, input.sessionId);
            if (!session || session.user_id !== input.userId)
              return failure('SESSION_NOT_FOUND', 'Challenge session was not found');
          }
          if (proofHash) {
            const existing = await one(
              db,
              'SELECT challenge_id FROM auth_challenge WHERE proof_hash = ?',
              [proofHash],
            );
            if (existing)
              return failure('CHALLENGE_PROOF_CONFLICT', 'Challenge proof is already registered');
          }
          await db.execute(
            `INSERT INTO auth_challenge (
               challenge_id, user_id, session_id, device_id, challenge_type, action, resource_id,
               proof_hash, proof_expires_at, status, attempts, metadata_json, expires_at,
               consumed_at, proof_consumed_at, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
            [
              challengeId,
              input.userId,
              input.sessionId ?? null,
              input.deviceId ?? null,
              type,
              input.action ?? null,
              input.resourceId ?? null,
              proofHash,
              sqlDate(input.proofExpiresAt),
              input.status ?? 'PENDING',
              json(input.metadata ?? {}),
              sqlDate(input.expiresAt),
              sqlDate(input.consumedAt),
              sqlDate(input.proofConsumedAt),
              at.sql,
              at.sql,
            ],
          );
          return success({
            challenge: challengeRecord(await challengeById(db, challengeId)),
          });
        },
        { duplicateCode: 'CHALLENGE_PROOF_CONFLICT' },
      );
    },

    async getChallenge(challengeId) {
      if (!nonEmpty(challengeId, 128))
        return failure('CHALLENGE_ID_INVALID', 'A challenge id is required');
      return run(async (db) => {
        const row = await challengeById(db, challengeId);
        return success({ challenge: row ? challengeRecord(row) : null });
      });
    },

    async consumeChallenge(challengeIdOrInput, proofHashOrOptions, atArg) {
      const input =
        challengeIdOrInput && typeof challengeIdOrInput === 'object'
          ? challengeIdOrInput
          : {
              ...(proofHashOrOptions &&
              typeof proofHashOrOptions === 'object' &&
              !Array.isArray(proofHashOrOptions)
                ? proofHashOrOptions
                : {}),
              challengeId: challengeIdOrInput,
              ...(typeof proofHashOrOptions === 'string' ? { proofHash: proofHashOrOptions } : {}),
              at: typeof proofHashOrOptions === 'object' ? proofHashOrOptions?.at : atArg,
            };
      const challengeId = input.challengeId ?? input.id;
      const proofHash = input.proofHash == null ? null : normalizedHash(input.proofHash);
      const expectedProofHash =
        input.expectedProofHash == null ? null : normalizedHash(input.expectedProofHash);
      if (
        !nonEmpty(challengeId, 128) ||
        (input.proofHash != null && !proofHash) ||
        (input.expectedProofHash != null && !expectedProofHash)
      )
        return failure('CHALLENGE_INVALID', 'Challenge consumption is invalid');
      const at = timestamp(input.at, now);
      return run(
        async (db) => {
          const current = await one(
            db,
            'SELECT * FROM auth_challenge WHERE challenge_id = ? FOR UPDATE',
            [challengeId],
          );
          if (!current) return failure('CHALLENGE_NOT_FOUND', 'Challenge was not found');
          if (expectedProofHash && current.proof_hash !== expectedProofHash)
            return failure('CHALLENGE_PROOF_MISMATCH', 'Challenge proof does not match');
          if (
            epoch(current.expires_at) <= Date.parse(at.iso) &&
            !['CONSUMED', 'EXPIRED', 'PROOF_CONSUMED'].includes(current.status)
          ) {
            await db.execute(
              `UPDATE auth_challenge
               SET status = 'EXPIRED', updated_at = ?
               WHERE challenge_id = ? AND status IN ('PENDING','PROOF_READY')`,
              [at.sql, challengeId],
            );
            return failure('CHALLENGE_EXPIRED', 'Challenge has expired');
          }
          const expectedStatus = input.expectedStatus ?? 'PENDING';
          if (current.status !== expectedStatus)
            return failure('CHALLENGE_CONSUMED', 'Challenge was already consumed');
          let result;
          if (expectedStatus === 'PENDING') {
            [result] = await db.execute(
              `UPDATE auth_challenge
               SET status = ?, consumed_at = ?, proof_hash = ?, proof_expires_at = ?, updated_at = ?
               WHERE challenge_id = ? AND consumed_at IS NULL AND status = 'PENDING'`,
              [
                proofHash ? 'PROOF_READY' : 'CONSUMED',
                at.sql,
                proofHash,
                sqlDate(input.proofExpiresAt),
                at.sql,
                challengeId,
              ],
            );
          } else if (expectedStatus === 'PROOF_READY') {
            [result] = await db.execute(
              `UPDATE auth_challenge
               SET status = 'PROOF_CONSUMED', proof_consumed_at = ?, updated_at = ?
               WHERE challenge_id = ? AND status = 'PROOF_READY'`,
              [at.sql, at.sql, challengeId],
            );
          } else {
            return failure('CHALLENGE_INVALID_STATE', 'Challenge state is invalid');
          }
          if (result.affectedRows !== 1)
            return failure('CHALLENGE_CONSUMED', 'Challenge was already consumed');
          return success({
            challenge: challengeRecord(await challengeById(db, challengeId)),
          });
        },
        { duplicateCode: 'CHALLENGE_PROOF_CONFLICT' },
      );
    },

    async findChallengeByProofHash(proofHash) {
      const normalized = normalizedHash(proofHash);
      if (!normalized) return failure('PROOF_HASH_INVALID', 'Challenge proof hash is invalid');
      return run(async (db) => {
        const row = await one(db, 'SELECT * FROM auth_challenge WHERE proof_hash = ?', [
          normalized,
        ]);
        return success({ challenge: row ? challengeRecord(row) : null });
      });
    },

    async saveNonce(input = {}) {
      const nonceId = input.nonceId ?? input.id;
      const tokenHash = normalizedHash(input.nonceHash ?? input.tokenHash);
      if (
        !nonEmpty(nonceId, 128) ||
        !nonEmpty(input.attentionId, 128) ||
        !tokenHash ||
        !iso(input.expiresAt) ||
        (input.status !== undefined && !['ACTIVE', 'CONSUMED', 'EXPIRED'].includes(input.status))
      )
        return failure('NONCE_INVALID', 'Attention nonce is invalid');
      const at = timestamp(input.createdAt, now);
      return run(
        async (db) => {
          await db.execute(
            `INSERT INTO attention_nonce (
               nonce_id, attention_id, token_hash, status, expires_at, consumed_at,
               redeemed_at, redeemed_by_user_id, redeemed_by_session_id, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              nonceId,
              input.attentionId,
              tokenHash,
              input.status ?? 'ACTIVE',
              sqlDate(input.expiresAt),
              sqlDate(input.consumedAt),
              sqlDate(input.redeemedAt),
              input.redeemedByUserId ?? null,
              input.redeemedBySessionId ?? null,
              at.sql,
            ],
          );
          const row = await one(db, 'SELECT * FROM attention_nonce WHERE nonce_id = ?', [nonceId]);
          return success({ nonce: nonceRecord(row) });
        },
        { duplicateCode: 'NONCE_HASH_EXISTS' },
      );
    },

    async consumeNonce(nonceIdOrInput, tokenHashOrAt, atArg) {
      const input =
        nonceIdOrInput && typeof nonceIdOrInput === 'object'
          ? nonceIdOrInput
          : {
              ...(tokenHashOrAt &&
              typeof tokenHashOrAt === 'object' &&
              !Array.isArray(tokenHashOrAt)
                ? tokenHashOrAt
                : {}),
              nonceId:
                typeof nonceIdOrInput === 'string' && normalizedHash(nonceIdOrInput)
                  ? undefined
                  : nonceIdOrInput,
              nonceHash:
                normalizedHash(nonceIdOrInput) ??
                (typeof tokenHashOrAt === 'string' ? normalizedHash(tokenHashOrAt) : null),
              at:
                typeof tokenHashOrAt === 'object'
                  ? tokenHashOrAt?.at
                  : typeof tokenHashOrAt === 'string' && !normalizedHash(tokenHashOrAt)
                    ? tokenHashOrAt
                    : atArg,
            };
      const nonceId = input.nonceId ?? input.id;
      const tokenHash = normalizedHash(input.nonceHash ?? input.tokenHash);
      if (!nonEmpty(nonceId, 128) && !tokenHash)
        return failure('NONCE_INVALID', 'A nonce id or token hash is required');
      const at = timestamp(input.at, now);
      return run(async (db) => {
        let row;
        if (nonceId && tokenHash)
          row = await one(
            db,
            `SELECT * FROM attention_nonce
             WHERE nonce_id = ? AND token_hash = ? FOR UPDATE`,
            [nonceId, tokenHash],
          );
        else if (nonceId)
          row = await one(
            db,
            `SELECT * FROM attention_nonce
             WHERE nonce_id = ? OR token_hash = ? FOR UPDATE`,
            [nonceId, nonceId],
          );
        else
          row = await one(db, 'SELECT * FROM attention_nonce WHERE token_hash = ? FOR UPDATE', [
            tokenHash,
          ]);
        if (!row) return failure('ATTENTION_NONCE_INVALID', 'Attention nonce was not found');
        if (row.status === 'CONSUMED' || row.consumed_at != null || row.redeemed_at != null)
          return failure('ATTENTION_NONCE_REPLAYED', 'Attention nonce was used');
        if (row.status === 'EXPIRED' || epoch(row.expires_at) <= Date.parse(at.iso))
          return failure('ATTENTION_NONCE_EXPIRED', 'Attention nonce has expired');
        const [result] = await db.execute(
          `UPDATE attention_nonce
           SET status = 'CONSUMED', consumed_at = ?, redeemed_at = ?,
               redeemed_by_user_id = ?, redeemed_by_session_id = ?
           WHERE nonce_id = ? AND consumed_at IS NULL`,
          [at.sql, at.sql, input.userId ?? null, input.sessionId ?? null, row.nonce_id],
        );
        if (result.affectedRows !== 1)
          return failure('ATTENTION_NONCE_REPLAYED', 'Attention nonce was used');
        return success({
          nonce: nonceRecord(
            await one(db, 'SELECT * FROM attention_nonce WHERE nonce_id = ?', [row.nonce_id]),
          ),
        });
      });
    },

    async consumeRateLimit(scopeOrInput, options = {}) {
      const input =
        scopeOrInput && typeof scopeOrInput === 'object'
          ? scopeOrInput
          : { ...options, scope: scopeOrInput };
      const scope = input.scope ?? 'default';
      const keyHash =
        normalizedHash(input.keyHash) ?? (input.key == null ? null : hashText(String(input.key)));
      const limit = integer(input.limit);
      const windowMs = integer(input.windowMs);
      const blockMs = integer(input.blockMs) ?? windowMs;
      if (
        !nonEmpty(scope, 64) ||
        !keyHash ||
        limit == null ||
        limit < 1 ||
        limit > 1000 ||
        windowMs == null ||
        windowMs < 1000 ||
        windowMs > 24 * 60 * 60 * 1000 ||
        blockMs == null ||
        blockMs < 1
      )
        return failure('RATE_LIMIT_INVALID', 'Rate limit configuration is invalid');
      const at = timestamp(input.at, now);
      const nowMs = Date.parse(at.iso);
      return run(async (db) => {
        const resetSql = sqlDate(new Date(nowMs + windowMs).toISOString());
        await db.execute(
          `INSERT INTO auth_rate_limit (
             rate_limit_id, scope, rate_key_hash, attempts, window_started_at, reset_at,
             blocked_until, created_at, updated_at
           ) VALUES (?, ?, ?, 1, ?, ?, NULL, ?, ?)
           ON DUPLICATE KEY UPDATE
             attempts = IF(reset_at <= ?, 1, attempts + 1),
             window_started_at = IF(reset_at <= ?, ?, window_started_at),
             blocked_until = IF(reset_at <= ?, NULL, blocked_until),
             reset_at = IF(reset_at <= ?, ?, reset_at),
             updated_at = ?`,
          [
            `limit-${randomUUID()}`,
            scope,
            keyHash,
            at.sql, // window_started_at value
            resetSql, // reset_at value
            at.sql, // created_at
            at.sql, // updated_at value
            at.sql, // attempts condition
            at.sql, // window_started_at condition
            at.sql, // new window_started_at
            at.sql, // blocked_until condition
            at.sql, // reset_at condition
            resetSql, // new reset_at
            at.sql, // final updated_at
          ],
        );
        const current = await one(
          db,
          `SELECT * FROM auth_rate_limit
           WHERE scope = ? AND rate_key_hash = ? FOR UPDATE`,
          [scope, keyHash],
        );
        if (!current)
          return failure('AUTH_PERSISTENCE_FAILED', 'Rate-limit row could not be initialized');
        const attempts = Number(current.attempts);
        const resetAt = current.reset_at;
        const allowed = attempts <= limit;
        const blockedUntil = allowed
          ? null
          : sqlDate(new Date(Math.max(epoch(resetAt), nowMs + blockMs)).toISOString());
        if (!allowed)
          await db.execute(
            `UPDATE auth_rate_limit
             SET blocked_until = ?, updated_at = ?
             WHERE rate_limit_id = ?`,
            [blockedUntil, at.sql, current.rate_limit_id],
          );
        const remaining = Math.max(0, limit - attempts);
        const retryAt = dbDate(blockedUntil ?? resetAt);
        const retryAfterMs = allowed ? 0 : Math.max(1, epoch(resetAt) - nowMs);
        if (!allowed)
          return success({
            allowed: false,
            remaining: 0,
            retryAt,
            retryAfterMs,
          });
        return success({ allowed: true, remaining, retryAt, retryAfterMs: 0 });
      });
    },

    async appendAuthAudit(input = {}) {
      const event = input.event ?? input.action ?? '';
      const actorId =
        input.actorId ??
        input.actorUserId ??
        input.userId ??
        (input.targetType === 'user' ? input.targetId : null) ??
        'anonymous';
      const outcome = input.outcome === 'failure' ? 'failure' : 'success';
      const userId = input.userId ?? (input.targetType === 'user' ? input.targetId : null);
      if (
        typeof event !== 'string' ||
        !AUDIT_EVENTS.has(event) ||
        !nonEmpty(actorId, 256) ||
        (userId != null && !nonEmpty(userId, 128)) ||
        (input.sessionId != null && !nonEmpty(input.sessionId, 64)) ||
        (input.deviceId != null && !nonEmpty(input.deviceId, 128)) ||
        (input.attentionId != null && !nonEmpty(input.attentionId, 256)) ||
        (input.createdAt != null && !iso(input.createdAt)) ||
        (input.sourceIpHash != null && !normalizedHash(input.sourceIpHash)) ||
        (input.userAgentHash != null && !normalizedHash(input.userAgentHash))
      )
        return failure('AUTH_AUDIT_INVALID', 'Authentication audit entry is invalid');
      const at = timestamp(input.createdAt, now);
      const auditId = input.auditId ?? `auth-audit-${randomUUID()}`;
      const rawDetail = input.detail ?? {};
      const detailBody =
        rawDetail && typeof rawDetail === 'object' && !Array.isArray(rawDetail)
          ? rawDetail
          : { value: rawDetail };
      const detail = redactDetail({
        ...detailBody,
        ...(input.targetType == null ? {} : { targetType: input.targetType }),
        ...(input.targetId == null ? {} : { targetId: input.targetId }),
      });
      return run(
        async (db) => {
          await db.execute(
            `INSERT INTO auth_audit (
               auth_audit_id, event, outcome, actor_id, user_id, session_id, device_id,
               attention_id, source_ip_hash, user_agent_hash, detail_json, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              auditId,
              event,
              outcome,
              actorId,
              userId,
              input.sessionId ?? null,
              input.deviceId ?? null,
              input.attentionId ?? null,
              normalizedHash(input.sourceIpHash),
              normalizedHash(input.userAgentHash),
              json(detail),
              at.sql,
            ],
          );
          const row = await one(db, 'SELECT * FROM auth_audit WHERE auth_audit_id = ?', [auditId]);
          return success({ audit: auditRecord(row) });
        },
        { duplicateCode: 'AUTH_AUDIT_DUPLICATE' },
      );
    },

    async listAuthAudit(filter = {}) {
      const limit = integer(filter.limit) ?? 1000;
      if (limit < 1 || limit > 1000)
        return failure('AUTH_AUDIT_FILTER_INVALID', 'Audit limit is invalid');
      const clauses = [];
      const parameters = [];
      if (filter.actorId != null || filter.actorUserId != null) {
        const actorId = filter.actorId ?? filter.actorUserId;
        if (!nonEmpty(actorId, 256))
          return failure('AUTH_AUDIT_FILTER_INVALID', 'Audit actor filter is invalid');
        clauses.push('actor_id = ?');
        parameters.push(actorId);
      }
      if (filter.userId != null) {
        if (!nonEmpty(filter.userId, 128))
          return failure('AUTH_AUDIT_FILTER_INVALID', 'Audit user filter is invalid');
        clauses.push('user_id = ?');
        parameters.push(filter.userId);
      }
      if (filter.event != null || filter.action != null) {
        const event = filter.event ?? String(filter.action);
        if (!AUDIT_EVENTS.has(event))
          return failure('AUTH_AUDIT_FILTER_INVALID', 'Audit action filter is invalid');
        clauses.push('event = ?');
        parameters.push(event);
      }
      if (filter.targetType != null) {
        return failure(
          'AUTH_AUDIT_FILTER_INVALID',
          'Target type filtering is not supported by the authentication audit schema',
        );
      }
      if (filter.targetId != null) {
        return failure(
          'AUTH_AUDIT_FILTER_INVALID',
          'Target id filtering is not supported by the authentication audit schema',
        );
      }
      if (filter.since != null) {
        if (!iso(filter.since))
          return failure('AUTH_AUDIT_FILTER_INVALID', 'Audit since filter is invalid');
        clauses.push('created_at >= ?');
        parameters.push(sqlDate(filter.since));
      }
      if (filter.until != null) {
        if (!iso(filter.until))
          return failure('AUTH_AUDIT_FILTER_INVALID', 'Audit until filter is invalid');
        clauses.push('created_at <= ?');
        parameters.push(sqlDate(filter.until));
      }
      parameters.push(limit);
      return run(async (db) => {
        const [rows] = await db.execute(
          `SELECT * FROM (
             SELECT * FROM auth_audit
             ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
             ORDER BY sequence DESC LIMIT ?
           ) AS recent_auth_audit
           ORDER BY sequence`,
          parameters,
        );
        return success({ audits: rows.map(auditRecord) });
      });
    },

    // Exposed for service layers that need the same redaction guarantees.
    redactAuthAuditDetail(value) {
      return clone(redactDetail(value));
    },
  });
}
