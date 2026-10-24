import { AUTH_KINDS, AUTH_ROLES, copyAuthRecord } from './store-contract.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/i;
const DEVICE_STATUS = new Set(['ACTIVE', 'REVOKED']);
const SESSION_STATUS = new Set(['ACTIVE', 'REVOKED', 'EXPIRED']);
const CHALLENGE_STATUS = new Set([
  'PENDING',
  'PROOF_READY',
  'PROOF_CONSUMED',
  'CONSUMED',
  'EXPIRED',
]);
const NONCE_STATUS = new Set(['ACTIVE', 'CONSUMED', 'EXPIRED']);
const SENSITIVE_AUDIT_KEY =
  /(?:password|passwd|secret|token|csrf|proof|nonce|confirmation.?code|totp.?code|authorization|api.?key)/i;

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const clone = (value) => copyAuthRecord(value);
const complete = (key, value, extra = {}) => ({ ok: true, [key]: clone(value), ...extra });
const validText = (value, maximum = 256) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
const iso = (value) => new Date(value).toISOString();

function sanitizeAuditDetail(value, depth = 0) {
  if (depth > 3) return '[truncated]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.slice(0, 512);
  if (Array.isArray(value))
    return value.slice(0, 32).map((entry) => sanitizeAuditDetail(entry, depth + 1));
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 32)) {
    if (!key || SENSITIVE_AUDIT_KEY.test(key)) continue;
    result[key] = sanitizeAuditDetail(entry, depth + 1);
  }
  return result;
}

function validUser(user) {
  return (
    user &&
    typeof user === 'object' &&
    !Array.isArray(user) &&
    ID.test(user.userId || '') &&
    validText(user.username, 128) &&
    validText(user.displayName, 256) &&
    validText(user.passwordHash, 512) &&
    AUTH_ROLES.includes(user.role)
  );
}

function validDevice(device) {
  return (
    device &&
    typeof device === 'object' &&
    !Array.isArray(device) &&
    ID.test(device.deviceId || '') &&
    ID.test(device.userId || '') &&
    validText(device.name, 256) &&
    DEVICE_STATUS.has(device.status)
  );
}

function validSession(session) {
  return (
    session &&
    typeof session === 'object' &&
    !Array.isArray(session) &&
    ID.test(session.sessionId || '') &&
    ID.test(session.userId || '') &&
    ID.test(session.deviceId || '') &&
    HASH.test(session.tokenHash || '') &&
    HASH.test(session.csrfHash || '') &&
    SESSION_STATUS.has(session.status)
  );
}

function validChallenge(challenge) {
  return (
    challenge &&
    typeof challenge === 'object' &&
    !Array.isArray(challenge) &&
    ID.test(challenge.challengeId || '') &&
    ID.test(challenge.userId || '') &&
    ID.test(challenge.sessionId || '') &&
    ID.test(challenge.deviceId || '') &&
    validText(challenge.action, 128) &&
    validText(challenge.resourceId, 256) &&
    CHALLENGE_STATUS.has(challenge.status)
  );
}

function validNonce(nonce) {
  return (
    nonce &&
    typeof nonce === 'object' &&
    !Array.isArray(nonce) &&
    ID.test(nonce.nonceId || '') &&
    validText(nonce.attentionId, 256) &&
    HASH.test(nonce.nonceHash || '') &&
    NONCE_STATUS.has(nonce.status)
  );
}

export function createMemoryAuthStore({ clock = Date.now } = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const collections = Object.fromEntries(AUTH_KINDS.map((kind) => [kind, new Map()]));
  const users = collections.users;
  const devices = collections.devices;
  const sessions = collections.sessions;
  const challenges = collections.challenges;
  const nonces = collections.nonces;
  const rateLimits = collections.rateLimits;
  const audits = [];
  let auditSequence = 0;
  let queue = Promise.resolve();

  const now = () => clock();
  const timestamp = () => iso(now());

  function atomic(operation) {
    const current = queue.then(operation, operation);
    queue = current.catch(() => {});
    return current;
  }

  function findBy(map, predicate) {
    return [...map.values()].find(predicate) ?? null;
  }

  return Object.freeze({
    async findUserByUsername(username) {
      return atomic(() => {
        if (typeof username !== 'string') return failure('USERNAME_INVALID', 'Username is invalid');
        const normalized = username.trim().toLowerCase();
        return complete(
          'user',
          findBy(users, (user) => user.normalizedUsername === normalized),
        );
      });
    },

    async findUserByRole(role) {
      return atomic(() =>
        complete(
          'user',
          findBy(users, (user) => user.role === role && user.status === 'ACTIVE'),
        ),
      );
    },

    async getUser(userId) {
      return atomic(() => complete('user', users.get(userId) ?? null));
    },

    async createUser(user) {
      return atomic(() => {
        if (!validUser(user) || !validText(user.totpSecretCiphertext, 4096))
          return failure('USER_INVALID', 'User is invalid');
        if (users.has(user.userId)) return failure('USER_EXISTS', 'User id already exists');
        const normalizedUsername = user.username.trim().toLowerCase();
        if (
          findBy(users, (existing) => existing.normalizedUsername === normalizedUsername) ||
          [...users.values()].some((existing) => existing.userId === user.userId)
        )
          return failure('USERNAME_EXISTS', 'Username already exists');
        const at = timestamp();
        const stored = {
          ...clone(user),
          username: user.username.trim(),
          normalizedUsername,
          status: 'ACTIVE',
          totpLastCounter: Number.isSafeInteger(user.totpLastCounter) ? user.totpLastCounter : -1,
          createdAt: user.createdAt ?? at,
          updatedAt: user.updatedAt ?? at,
          version: 1,
        };
        users.set(stored.userId, stored);
        return complete('user', stored);
      });
    },

    async updateUser(input) {
      return atomic(() => {
        const user = input?.user ?? input;
        if (!validUser(user)) return failure('USER_INVALID', 'User is invalid');
        const current = users.get(user.userId);
        if (!current) return failure('USER_NOT_FOUND', 'User was not found');
        const expectedVersion = input?.expectedVersion ?? current.version;
        if (expectedVersion !== current.version)
          return failure('USER_VERSION_CONFLICT', 'User version changed');
        const normalizedUsername = user.username.trim().toLowerCase();
        if (
          normalizedUsername !== current.normalizedUsername &&
          findBy(users, (existing) => existing.normalizedUsername === normalizedUsername)
        )
          return failure('USERNAME_EXISTS', 'Username already exists');
        const stored = {
          ...clone(user),
          username: user.username.trim(),
          normalizedUsername,
          totpLastCounter: Number.isSafeInteger(user.totpLastCounter)
            ? user.totpLastCounter
            : current.totpLastCounter,
          createdAt: current.createdAt,
          updatedAt: timestamp(),
          version: current.version + 1,
        };
        users.set(stored.userId, stored);
        return complete('user', stored);
      });
    },

    async consumeTotpCounter(input, counterArgument) {
      return atomic(() => {
        const userId = typeof input === 'string' ? input : input?.userId;
        const counter = typeof input === 'string' ? counterArgument : input?.counter;
        if (typeof userId !== 'string' || !Number.isSafeInteger(counter) || counter < 0)
          return failure('TOTP_COUNTER_INVALID', 'TOTP counter is invalid');
        const current = users.get(userId);
        if (!current) return failure('USER_NOT_FOUND', 'User was not found');
        if (counter <= current.totpLastCounter)
          return failure('TOTP_COUNTER_REPLAY', 'TOTP counter was already consumed');
        const stored = {
          ...current,
          totpLastCounter: counter,
          updatedAt: timestamp(),
          version: current.version + 1,
        };
        users.set(userId, stored);
        return complete('user', stored, { counter });
      });
    },

    async getDevice(deviceId) {
      return atomic(() => complete('device', devices.get(deviceId) ?? null));
    },

    async saveDevice(device) {
      return atomic(() => {
        if (!validDevice(device)) return failure('DEVICE_INVALID', 'Device is invalid');
        const current = devices.get(device.deviceId);
        if (current && current.userId !== device.userId)
          return failure('DEVICE_OWNER_MISMATCH', 'Device is bound to another user');
        const at = timestamp();
        const stored = {
          ...clone(device),
          createdAt: current?.createdAt ?? device.createdAt ?? at,
          updatedAt: device.updatedAt ?? at,
          version: current ? current.version + 1 : 1,
        };
        devices.set(stored.deviceId, stored);
        return complete('device', stored);
      });
    },

    async listDevices(userId) {
      return atomic(() => ({
        ok: true,
        devices: [...devices.values()]
          .filter((device) => device.userId === userId)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map(clone),
      }));
    },

    async saveSession(session) {
      return atomic(() => {
        if (!validSession(session)) return failure('SESSION_INVALID', 'Session is invalid');
        const current = sessions.get(session.sessionId);
        if (
          findBy(
            sessions,
            (existing) =>
              existing.tokenHash === session.tokenHash && existing.sessionId !== session.sessionId,
          )
        )
          return failure('SESSION_TOKEN_EXISTS', 'Session token already exists');
        const at = timestamp();
        const stored = {
          ...clone(session),
          createdAt: current?.createdAt ?? session.createdAt ?? at,
          updatedAt: session.updatedAt ?? at,
          version: current ? current.version + 1 : 1,
        };
        sessions.set(stored.sessionId, stored);
        return complete('session', stored);
      });
    },

    async getSessionByTokenHash(tokenHash) {
      return atomic(() =>
        complete(
          'session',
          findBy(sessions, (session) => session.tokenHash === tokenHash),
        ),
      );
    },

    async touchSession(sessionId, options = {}) {
      return atomic(() => {
        const current = sessions.get(sessionId);
        if (!current) return failure('SESSION_NOT_FOUND', 'Session was not found');
        const at = options.at ? iso(options.at) : timestamp();
        const stored = {
          ...current,
          lastSeenAt: at,
          updatedAt: at,
          version: current.version + 1,
        };
        sessions.set(sessionId, stored);
        return complete('session', stored);
      });
    },

    async revokeSession(sessionId, options = {}) {
      return atomic(() => {
        const current = sessions.get(sessionId);
        if (!current) return failure('SESSION_NOT_FOUND', 'Session was not found');
        const at = options.at ? iso(options.at) : timestamp();
        const stored = {
          ...current,
          status: 'REVOKED',
          revokedAt: at,
          updatedAt: at,
          version: current.version + 1,
        };
        sessions.set(sessionId, stored);
        return complete('session', stored);
      });
    },

    async revokeSessionsForDevice(deviceId, options = {}) {
      return atomic(() => {
        const at = options.at ? iso(options.at) : timestamp();
        let count = 0;
        for (const [sessionId, current] of sessions) {
          if (current.deviceId !== deviceId || current.status !== 'ACTIVE') continue;
          sessions.set(sessionId, {
            ...current,
            status: 'REVOKED',
            revokedAt: at,
            updatedAt: at,
            version: current.version + 1,
          });
          count += 1;
        }
        return { ok: true, count, revokedAt: at };
      });
    },

    async saveChallenge(challenge) {
      return atomic(() => {
        if (!validChallenge(challenge)) return failure('CHALLENGE_INVALID', 'Challenge is invalid');
        const current = challenges.get(challenge.challengeId);
        if (current && current.status !== 'PENDING')
          return failure('CHALLENGE_CONSUMED', 'Challenge was already consumed');
        const at = timestamp();
        const stored = {
          ...clone(challenge),
          createdAt: current?.createdAt ?? challenge.createdAt ?? at,
          version: current ? current.version + 1 : 1,
        };
        challenges.set(stored.challengeId, stored);
        return complete('challenge', stored);
      });
    },

    async getChallenge(challengeId) {
      return atomic(() => complete('challenge', challenges.get(challengeId) ?? null));
    },

    async consumeChallenge(input, options = {}) {
      return atomic(() => {
        const request = typeof input === 'string' ? { ...options, challengeId: input } : input;
        const current = challenges.get(request?.challengeId);
        if (!current) return failure('CHALLENGE_NOT_FOUND', 'Challenge was not found');
        const atMs = Number.isSafeInteger(request.at) ? request.at : now();
        if (
          request.expectedStatus === 'PROOF_READY' &&
          request.expectedProofHash &&
          current.proofHash !== request.expectedProofHash
        )
          return failure('CHALLENGE_PROOF_MISMATCH', 'Challenge proof does not match');
        if (
          Date.parse(current.expiresAt) <= atMs &&
          !['CONSUMED', 'EXPIRED'].includes(current.status)
        ) {
          challenges.set(current.challengeId, {
            ...current,
            status: 'EXPIRED',
            updatedAt: iso(atMs),
            version: current.version + 1,
          });
          return failure('CHALLENGE_EXPIRED', 'Challenge has expired');
        }
        const expectedStatus = request.expectedStatus ?? 'PENDING';
        if (current.status !== expectedStatus)
          return failure('CHALLENGE_CONSUMED', 'Challenge was already consumed');
        const at = iso(atMs);
        let stored;
        if (expectedStatus === 'PENDING') {
          stored = {
            ...current,
            status: request.proofHash ? 'PROOF_READY' : 'CONSUMED',
            consumedAt: at,
            proofHash: request.proofHash ?? null,
            proofExpiresAt: request.proofExpiresAt ? iso(request.proofExpiresAt) : null,
            updatedAt: at,
            version: current.version + 1,
          };
        } else if (expectedStatus === 'PROOF_READY') {
          stored = {
            ...current,
            status: 'PROOF_CONSUMED',
            proofConsumedAt: at,
            updatedAt: at,
            version: current.version + 1,
          };
        } else {
          return failure('CHALLENGE_INVALID_STATE', 'Challenge state is invalid');
        }
        challenges.set(stored.challengeId, stored);
        return complete('challenge', stored);
      });
    },

    async findChallengeByProofHash(proofHash) {
      if (typeof proofHash !== 'string' || !HASH.test(proofHash))
        return failure('PROOF_HASH_INVALID', 'Proof hash is invalid');
      return atomic(() =>
        complete(
          'challenge',
          findBy(challenges, (challenge) => challenge.proofHash === proofHash),
        ),
      );
    },

    async saveNonce(nonce) {
      return atomic(() => {
        if (!validNonce(nonce)) return failure('NONCE_INVALID', 'Nonce is invalid');
        if (nonces.has(nonce.nonceId)) return failure('NONCE_EXISTS', 'Nonce id already exists');
        if (findBy(nonces, (existing) => existing.nonceHash === nonce.nonceHash))
          return failure('NONCE_HASH_EXISTS', 'Nonce already exists');
        const stored = {
          ...clone(nonce),
          createdAt: nonce.createdAt ?? timestamp(),
          version: 1,
        };
        nonces.set(stored.nonceId, stored);
        return complete('nonce', stored);
      });
    },

    async consumeNonce(input, options = {}) {
      return atomic(() => {
        const request = typeof input === 'string' ? { ...options, nonceHash: input } : input;
        const current = findBy(nonces, (nonce) => nonce.nonceHash === request?.nonceHash);
        if (!current) return failure('ATTENTION_NONCE_INVALID', 'Attention nonce is invalid');
        const atMs = Number.isSafeInteger(request.at) ? request.at : now();
        if (current.status === 'CONSUMED')
          return failure('ATTENTION_NONCE_REPLAYED', 'Attention nonce was already consumed');
        if (current.status === 'EXPIRED' || Date.parse(current.expiresAt) <= atMs)
          return failure('ATTENTION_NONCE_EXPIRED', 'Attention nonce has expired');
        const at = iso(atMs);
        const stored = {
          ...current,
          status: 'CONSUMED',
          redeemedAt: at,
          redeemedByUserId: request.userId ?? null,
          redeemedBySessionId: request.sessionId ?? null,
          version: current.version + 1,
        };
        nonces.set(current.nonceId, stored);
        return complete('nonce', stored);
      });
    },

    async consumeRateLimit(input) {
      return atomic(() => {
        if (
          !validText(input?.key, 256) ||
          !Number.isSafeInteger(input.limit) ||
          input.limit < 1 ||
          input.limit > 1000 ||
          !Number.isSafeInteger(input.windowMs) ||
          input.windowMs < 1000 ||
          input.windowMs > 24 * 60 * 60 * 1000
        )
          return failure('RATE_LIMIT_INVALID', 'Rate limit configuration is invalid');
        const at = Number.isSafeInteger(input.at) ? input.at : now();
        let bucket = rateLimits.get(input.key);
        if (!bucket || at - bucket.windowStartedAt >= input.windowMs) {
          bucket = {
            id: input.key,
            key: input.key,
            count: 0,
            windowStartedAt: at,
            updatedAt: iso(at),
          };
        }
        if (bucket.count >= input.limit) {
          rateLimits.set(input.key, bucket);
          return {
            ok: true,
            allowed: false,
            remaining: 0,
            retryAfterMs: Math.max(1, input.windowMs - (at - bucket.windowStartedAt)),
          };
        }
        bucket.count += 1;
        bucket.updatedAt = iso(at);
        rateLimits.set(input.key, bucket);
        return {
          ok: true,
          allowed: true,
          remaining: Math.max(0, input.limit - bucket.count),
          retryAfterMs: 0,
        };
      });
    },

    async appendAuthAudit(entry) {
      return atomic(() => {
        if (!validText(entry?.event, 128) || !validText(entry?.actorId, 256))
          return failure('AUTH_AUDIT_INVALID', 'Authentication audit entry is invalid');
        const audit = {
          auditId: `auth-audit-${++auditSequence}`,
          sequence: auditSequence,
          event: entry.event,
          outcome: entry.outcome === 'failure' ? 'failure' : 'success',
          actorId: entry.actorId,
          userId: validText(entry.userId, 128) ? entry.userId : null,
          sessionId: validText(entry.sessionId, 128) ? entry.sessionId : null,
          deviceId: validText(entry.deviceId, 128) ? entry.deviceId : null,
          attentionId: validText(entry.attentionId, 256) ? entry.attentionId : null,
          detail: sanitizeAuditDetail(entry.detail ?? {}),
          createdAt: timestamp(),
        };
        audits.push(audit);
        return complete('audit', audit);
      });
    },

    async listAuthAudit(filter = {}) {
      return atomic(() => {
        let selected = audits;
        if (validText(filter.userId, 128))
          selected = selected.filter((audit) => audit.userId === filter.userId);
        if (validText(filter.event, 128))
          selected = selected.filter((audit) => audit.event === filter.event);
        if (Number.isFinite(Date.parse(filter.since))) {
          const since = Date.parse(filter.since);
          selected = selected.filter((audit) => Date.parse(audit.createdAt) >= since);
        }
        const limit =
          Number.isSafeInteger(filter.limit) && filter.limit > 0
            ? Math.min(filter.limit, 1000)
            : 1000;
        return { ok: true, audits: selected.slice(-limit).map(clone) };
      });
    },
  });
}
