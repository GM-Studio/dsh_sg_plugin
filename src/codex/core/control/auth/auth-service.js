import { createHash, timingSafeEqual } from 'node:crypto';
import {
  currentTotp,
  decodeBase32,
  generateTotpSecret,
  verifyTotp,
} from '../../../control/step-up.js';
import { AUTH_ROLES } from './store-contract.js';
import { hashPassword, verifyPassword } from './password.js';
import { createSecretBox } from './secret-box.js';
import { requiredAuth } from './policy.js';

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PROOF_TTL_MS = 2 * 60 * 1000;
const DEFAULT_LOGIN_LIMIT = Object.freeze({ limit: 5, windowMs: 60 * 1000 });
const DEFAULT_TOTP_LIMIT = Object.freeze({ limit: 5, windowMs: 60 * 1000 });
const MAX_NONCE_TTL_MS = 24 * 60 * 60 * 1000;
const TOTP_STEP_SECONDS = 30;
const TOTP_WINDOW = 1;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/i;

const failure = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const iso = (value) => new Date(value).toISOString();
const validText = (value, maximum = 256) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;

function constantTimeHashEqual(expected, supplied) {
  if (!validText(expected, 128) || typeof supplied !== 'string') return false;
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(sha256(supplied), 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeRateLimit(value, fallback, name) {
  const selected =
    value && typeof value === 'object' && !Array.isArray(value)
      ? { ...fallback, ...value }
      : fallback;
  if (
    !Number.isSafeInteger(selected.limit) ||
    selected.limit < 1 ||
    selected.limit > 1000 ||
    !Number.isSafeInteger(selected.windowMs) ||
    selected.windowMs < 1000 ||
    selected.windowMs > 24 * 60 * 60 * 1000
  )
    throw new TypeError(`${name} rate limit is invalid`);
  return Object.freeze({ limit: selected.limit, windowMs: selected.windowMs });
}

function passwordHasher(passwordHash) {
  if (passwordHash && typeof passwordHash === 'object') {
    const hash = passwordHash.hash ?? passwordHash.hashPassword;
    const verify = passwordHash.verify ?? passwordHash.verifyPassword;
    if (typeof hash === 'function' && typeof verify === 'function') return { hash, verify };
  }
  if (typeof passwordHash === 'function') {
    return {
      hash: passwordHash,
      verify: async (password, stored) => (await passwordHash(password)) === stored,
    };
  }
  return { hash: hashPassword, verify: verifyPassword };
}

function publicUser(user) {
  return {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
  };
}

function publicDevice(device) {
  return {
    deviceId: device.deviceId,
    name: device.name,
    status: device.status,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt ?? null,
    revokedAt: device.revokedAt ?? null,
  };
}

function publicSession(session) {
  const visible = { ...session };
  delete visible.tokenHash;
  return visible;
}

function recordFrom(result, key) {
  return result?.ok === true ? (result[key] ?? null) : null;
}

export function createAuthService({
  store,
  encryptionKey,
  clock = Date.now,
  randomId,
  randomToken,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  challengeTtlMs = DEFAULT_CHALLENGE_TTL_MS,
  stepUpProofTtlMs = DEFAULT_PROOF_TTL_MS,
  rateLimit,
  loginRateLimit,
  totpRateLimit,
  passwordHash,
  deviceConfirmationCodeHash,
} = {}) {
  const requiredMethods = [
    'findUserByUsername',
    'getUser',
    'createUser',
    'updateUser',
    'consumeTotpCounter',
    'getDevice',
    'saveDevice',
    'listDevices',
    'saveSession',
    'getSessionByTokenHash',
    'touchSession',
    'revokeSession',
    'revokeSessionsForDevice',
    'saveChallenge',
    'getChallenge',
    'consumeChallenge',
    'findChallengeByProofHash',
    'saveNonce',
    'consumeNonce',
    'consumeRateLimit',
    'appendAuthAudit',
    'listAuthAudit',
  ];
  if (!store || requiredMethods.some((method) => typeof store[method] !== 'function'))
    throw new TypeError('Authentication store does not implement the required contract');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs <= 0)
    throw new TypeError('sessionTtlMs must be a positive integer');
  if (!Number.isSafeInteger(challengeTtlMs) || challengeTtlMs <= 0)
    throw new TypeError('challengeTtlMs must be a positive integer');
  if (!Number.isSafeInteger(stepUpProofTtlMs) || stepUpProofTtlMs <= 0)
    throw new TypeError('stepUpProofTtlMs must be a positive integer');
  if (deviceConfirmationCodeHash !== undefined && !HASH.test(deviceConfirmationCodeHash))
    throw new TypeError('deviceConfirmationCodeHash must be a SHA-256 hex digest');

  const box = createSecretBox(encryptionKey);
  const hasher = passwordHasher(passwordHash);
  const makeId = (kind) => {
    if (typeof randomId === 'function') return randomId(kind);
    return `${kind}_${createHash('sha256')
      .update(`${clock()}:${Math.random()}:${kind}`)
      .digest('hex')
      .slice(0, 32)}`;
  };
  const makeToken = () => {
    if (typeof randomToken === 'function') return randomToken();
    return createHash('sha256')
      .update(`${clock()}:${Math.random()}:${Math.random()}`)
      .digest('base64url');
  };
  const requireIdentifier = (kind) => {
    const value = makeId(kind);
    if (!ID.test(value || '')) throw new TypeError(`${kind} id generator returned an invalid id`);
    return value;
  };
  const requireToken = () => {
    const value = makeToken();
    if (!validText(value, 512)) throw new TypeError('Token generator returned an invalid token');
    return value;
  };
  const clockNow = () => {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError('clock returned invalid time');
    return value;
  };
  const rateLimits = {
    login: normalizeRateLimit(
      loginRateLimit ?? rateLimit?.login ?? rateLimit?.loginAttempts ?? rateLimit,
      DEFAULT_LOGIN_LIMIT,
      'login',
    ),
    totp: normalizeRateLimit(
      totpRateLimit ?? rateLimit?.totp ?? rateLimit?.totpAttempts ?? rateLimit,
      DEFAULT_TOTP_LIMIT,
      'totp',
    ),
  };
  let ownerInitialized = false;
  let ownerInitializationQueue = Promise.resolve();
  let dummyHashPromise = null;

  async function audit(event, outcome, fields = {}, detail = {}) {
    const result = await store.appendAuthAudit({
      event,
      outcome,
      actorId: fields.userId ?? fields.actorId ?? 'anonymous',
      userId: fields.userId,
      sessionId: fields.sessionId,
      deviceId: fields.deviceId,
      attentionId: fields.attentionId,
      detail,
    });
    return recordFrom(result, 'audit');
  }

  async function ownerExists() {
    if (ownerInitialized) return true;
    if (typeof store.findUserByRole === 'function') {
      const result = await store.findUserByRole('owner');
      if (recordFrom(result, 'user')) {
        ownerInitialized = true;
        return true;
      }
    }
    return false;
  }

  function otpauth(username, secret) {
    const label = encodeURIComponent(`SpecGate:${username}`);
    const issuer = encodeURIComponent('SpecGate');
    return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  }

  async function createUserRecord({
    username,
    password,
    displayName,
    role,
    initializeOwner = false,
  }) {
    if (!validText(username, 128)) return failure('USERNAME_INVALID', 'Username is invalid');
    if (typeof password !== 'string' || password.length < 1 || password.length > 1024)
      return failure('PASSWORD_INVALID', 'Password is invalid');
    if (!validText(displayName, 256))
      return failure('DISPLAY_NAME_INVALID', 'Display name is invalid');
    if (!AUTH_ROLES.includes(role)) return failure('ROLE_INVALID', 'Role is invalid');
    if (initializeOwner && (await ownerExists()))
      return failure('OWNER_ALREADY_INITIALIZED', 'An owner account already exists');
    const duplicate = await store.findUserByUsername(username);
    if (recordFrom(duplicate, 'user')) return failure('USERNAME_EXISTS', 'Username already exists');
    const userId = requireIdentifier('user');
    const totpSecret = generateTotpSecret();
    decodeBase32(totpSecret);
    const passwordDigest = await hasher.hash(password);
    const now = clockNow();
    const at = iso(now);
    const totpSecretCiphertext = box.seal(totpSecret, `totp:${userId}`);
    const created = await store.createUser({
      userId,
      username,
      displayName,
      passwordHash: passwordDigest,
      role,
      status: 'ACTIVE',
      totpSecretCiphertext,
      totpLastCounter: -1,
      createdAt: at,
      updatedAt: at,
    });
    const user = recordFrom(created, 'user');
    if (!user) return failure(created?.code ?? 'USER_CREATE_FAILED', 'User was not created');
    if (initializeOwner) ownerInitialized = true;
    await audit(
      initializeOwner ? 'owner_initialized' : 'user_created',
      'success',
      { userId: user.userId },
      { role: user.role },
    );
    return {
      ok: true,
      userId: user.userId,
      username: user.username,
      role: user.role,
      totpSecret,
      otpauth: otpauth(user.username, totpSecret),
      user: publicUser(user),
    };
  }

  async function consumeLimit(kind, username, clientKey, fields) {
    const config = rateLimits[kind];
    const key = `auth:${kind}:${sha256(username.trim().toLowerCase())}:${sha256(clientKey ?? '')}`;
    const result = await store.consumeRateLimit({ key, ...config, at: clockNow() });
    if (!result.ok) return failure('RATE_LIMITED', 'Authentication is temporarily unavailable');
    if (!result.allowed) {
      await audit('rate_limited', 'failure', fields, {
        attempt: kind,
        retryAfterMs: result.retryAfterMs,
      });
      return failure('RATE_LIMITED', 'Too many authentication attempts', {
        retryAfterMs: result.retryAfterMs,
      });
    }
    return { ok: true, remaining: result.remaining };
  }

  async function verifySecondFactor({ user, totpCode, username, clientKey, context, fields }) {
    const limited = await consumeLimit('totp', username, clientKey, fields);
    if (!limited.ok) return limited;
    let secret;
    try {
      secret = box.open(user.totpSecretCiphertext, `totp:${user.userId}`);
      decodeBase32(secret);
    } catch {
      await audit('totp_failed', 'failure', fields, { reason: 'seed_unavailable', context });
      return failure('TOTP_UNAVAILABLE', 'TOTP authentication is unavailable');
    }
    if (
      !verifyTotp(secret, totpCode, { clock, stepSeconds: TOTP_STEP_SECONDS, window: TOTP_WINDOW })
    ) {
      await audit('totp_failed', 'failure', fields, { reason: 'invalid', context });
      return failure('INVALID_TOTP', 'TOTP code is invalid');
    }
    const baseCounter = Math.floor(clockNow() / 1000 / TOTP_STEP_SECONDS);
    let matchedCounter = null;
    for (const offset of [0, -1, 1]) {
      const candidate = baseCounter + offset;
      const expected = currentTotp(secret, {
        clock: () => candidate * TOTP_STEP_SECONDS * 1000,
        stepSeconds: TOTP_STEP_SECONDS,
      });
      const left = Buffer.from(expected);
      const right = Buffer.from(totpCode);
      if (left.length === right.length && timingSafeEqual(left, right)) {
        matchedCounter = candidate;
        break;
      }
    }
    if (matchedCounter === null) {
      await audit('totp_failed', 'failure', fields, { reason: 'invalid', context });
      return failure('INVALID_TOTP', 'TOTP code is invalid');
    }
    const consumed = await store.consumeTotpCounter({
      userId: user.userId,
      counter: matchedCounter,
    });
    if (!consumed.ok) {
      await audit('totp_replayed', 'failure', fields, { context });
      return failure('TOTP_REPLAYED', 'TOTP code was already used');
    }
    return { ok: true, counter: matchedCounter };
  }

  async function sessionByToken(token, { touch = false } = {}) {
    if (!validText(token, 512)) return failure('UNAUTHORIZED', 'Authentication is required');
    const found = await store.getSessionByTokenHash(sha256(token));
    const session = recordFrom(found, 'session');
    if (!session) return failure('UNAUTHORIZED', 'Authentication is required');
    const userResult = await store.getUser(session.userId);
    const deviceResult = await store.getDevice(session.deviceId);
    const user = recordFrom(userResult, 'user');
    const device = recordFrom(deviceResult, 'device');
    const invalid =
      session.status !== 'ACTIVE' ||
      Date.parse(session.expiresAt) <= clockNow() ||
      !user ||
      user.status !== 'ACTIVE' ||
      !device ||
      device.status !== 'ACTIVE' ||
      device.userId !== user.userId;
    if (invalid) {
      if (session.status === 'ACTIVE')
        await store.revokeSession(session.sessionId, { at: clockNow() });
      await audit(
        'session_rejected',
        'failure',
        {
          userId: session.userId,
          sessionId: session.sessionId,
          deviceId: session.deviceId,
        },
        { reason: session.status !== 'ACTIVE' ? 'session_inactive' : 'binding_invalid' },
      );
      return failure('UNAUTHORIZED', 'Authentication is required');
    }
    const touched = touch
      ? recordFrom(await store.touchSession(session.sessionId), 'session')
      : null;
    return {
      ok: true,
      session: publicSession(touched ?? session),
      user: publicUser(user),
      device: publicDevice(device),
    };
  }

  async function requireSessionAndCsrf({ token, csrf }) {
    const authenticated = await sessionByToken(token, { touch: true });
    if (!authenticated.ok) return authenticated;
    if (!service.verifyCsrf(authenticated.session, csrf)) {
      await audit(
        'csrf_failed',
        'failure',
        {
          userId: authenticated.user.userId,
          sessionId: authenticated.session.sessionId,
          deviceId: authenticated.device.deviceId,
        },
        { operation: 'session_mutation' },
      );
      return failure('CSRF_INVALID', 'CSRF validation failed');
    }
    return authenticated;
  }

  async function verifiedOwnerState(username, clientKey) {
    const normalizedClient = typeof clientKey === 'string' ? clientKey : 'unknown';
    const findByUsername = await store.findUserByUsername(username);
    return {
      user: recordFrom(findByUsername, 'user'),
      clientKey: normalizedClient,
    };
  }

  const service = Object.freeze({
    async initializeOwner({ username, password, displayName } = {}) {
      const operation = ownerInitializationQueue.then(
        () =>
          createUserRecord({
            username,
            password,
            displayName,
            role: 'owner',
            initializeOwner: true,
          }),
        () =>
          createUserRecord({
            username,
            password,
            displayName,
            role: 'owner',
            initializeOwner: true,
          }),
      );
      ownerInitializationQueue = operation.catch(() => {});
      return operation;
    },

    async createUser({ username, password, displayName, role = 'approver' } = {}) {
      return createUserRecord({ username, password, displayName, role });
    },

    async login({
      username,
      password,
      totpCode,
      deviceId,
      deviceName,
      deviceConfirmationCode,
      clientKey,
    } = {}) {
      const normalizedClient = typeof clientKey === 'string' ? clientKey : 'unknown';
      if (!validText(username, 128)) {
        await audit('login_failed', 'failure', {}, { reason: 'invalid_request' });
        return failure('INVALID_CREDENTIALS', 'Authentication failed');
      }
      const loginLimited = await consumeLimit('login', username, normalizedClient, {});
      if (!loginLimited.ok) return loginLimited;
      const { user } = await verifiedOwnerState(username, normalizedClient);
      const passwordValid = user
        ? await hasher.verify(password, user.passwordHash)
        : await (async () => {
            dummyHashPromise ??= hasher.hash('dummy-authentication-password');
            const dummyHash = await dummyHashPromise;
            await hasher.verify(password, dummyHash);
            return false;
          })();
      if (!user || !passwordValid) {
        await audit('login_failed', 'failure', user ? { userId: user.userId } : {}, {
          reason: 'credentials',
        });
        return failure('INVALID_CREDENTIALS', 'Authentication failed');
      }
      if (user.status !== 'ACTIVE') {
        await audit(
          'login_failed',
          'failure',
          { userId: user.userId },
          {
            reason: 'user_inactive',
          },
        );
        return failure('INVALID_CREDENTIALS', 'Authentication failed');
      }
      if (!validText(deviceId, 128) || !validText(deviceName, 256)) {
        await audit(
          'login_failed',
          'failure',
          { userId: user.userId },
          {
            reason: 'device_invalid',
          },
        );
        return failure('DEVICE_INVALID', 'Device information is invalid');
      }
      const deviceResult = await store.getDevice(deviceId);
      let device = recordFrom(deviceResult, 'device');
      if (device && device.userId !== user.userId) {
        await audit(
          'login_failed',
          'failure',
          { userId: user.userId, deviceId },
          {
            reason: 'device_owner',
          },
        );
        return failure('INVALID_CREDENTIALS', 'Authentication failed');
      }
      if (device?.status === 'REVOKED') {
        await audit(
          'login_failed',
          'failure',
          { userId: user.userId, deviceId },
          {
            reason: 'device_revoked',
          },
        );
        return failure('DEVICE_REVOKED', 'Device has been revoked');
      }
      if (!device) {
        const confirmed =
          deviceConfirmationCodeHash !== undefined &&
          constantTimeHashEqual(
            deviceConfirmationCodeHash,
            deviceConfirmationCode === undefined ? '' : String(deviceConfirmationCode),
          );
        if (!confirmed) {
          await audit(
            'device_enrollment_failed',
            'failure',
            { userId: user.userId, deviceId },
            {
              reason: 'confirmation',
            },
          );
          return failure(
            'DEVICE_CONFIRMATION_REQUIRED',
            'New device requires an additional confirmation code',
          );
        }
      }
      const totp = await verifySecondFactor({
        user,
        totpCode,
        username,
        clientKey: normalizedClient,
        context: 'login',
        fields: { userId: user.userId, deviceId },
      });
      if (!totp.ok) {
        if (totp.code === 'TOTP_REPLAYED')
          await audit(
            'login_failed',
            'failure',
            { userId: user.userId, deviceId },
            {
              reason: 'totp_replay',
            },
          );
        else if (totp.code !== 'RATE_LIMITED')
          await audit(
            'login_failed',
            'failure',
            { userId: user.userId, deviceId },
            {
              reason: 'totp',
            },
          );
        return totp;
      }
      const now = clockNow();
      const at = iso(now);
      if (!device) {
        const savedDevice = await store.saveDevice({
          deviceId,
          userId: user.userId,
          name: deviceName,
          status: 'ACTIVE',
          publicKeyFingerprint: null,
          createdAt: at,
          updatedAt: at,
          lastSeenAt: at,
          revokedAt: null,
        });
        device = recordFrom(savedDevice, 'device');
        if (!device)
          return failure(
            savedDevice?.code ?? 'DEVICE_ENROLLMENT_FAILED',
            'Device was not enrolled',
          );
        await audit('device_enrolled', 'success', { userId: user.userId, deviceId }, {});
      } else {
        device = recordFrom(
          await store.saveDevice({
            ...device,
            name: deviceName,
            lastSeenAt: at,
            updatedAt: at,
          }),
          'device',
        );
      }
      const sessionId = requireIdentifier('session');
      const token = requireToken();
      const csrfToken = requireToken();
      const expiresAt = now + sessionTtlMs;
      const savedSession = await store.saveSession({
        sessionId,
        userId: user.userId,
        deviceId: device.deviceId,
        tokenHash: sha256(token),
        csrfHash: sha256(csrfToken),
        authLevel: 'session',
        status: 'ACTIVE',
        expiresAt: iso(expiresAt),
        createdAt: at,
        updatedAt: at,
        lastSeenAt: at,
      });
      const session = recordFrom(savedSession, 'session');
      if (!session)
        return failure(savedSession?.code ?? 'SESSION_CREATE_FAILED', 'Session was not created');
      await audit('login_succeeded', 'success', { userId: user.userId, sessionId, deviceId }, {});
      return {
        ok: true,
        token,
        csrfToken,
        expiresAt,
        user: publicUser(user),
        device: publicDevice(device),
        session: publicSession(session),
      };
    },

    async authenticate({ token } = {}) {
      return sessionByToken(token, { touch: true });
    },

    verifyCsrf(session, csrf) {
      return constantTimeHashEqual(session?.csrfHash, csrf);
    },

    async logout({ token, csrf } = {}) {
      const authenticated = await requireSessionAndCsrf({ token, csrf });
      if (!authenticated.ok) return authenticated;
      const revoked = await store.revokeSession(authenticated.session.sessionId, {
        at: clockNow(),
      });
      if (!revoked.ok) return failure(revoked.code, 'Session was not revoked');
      await audit(
        'logout',
        'success',
        {
          userId: authenticated.user.userId,
          sessionId: authenticated.session.sessionId,
          deviceId: authenticated.device.deviceId,
        },
        {},
      );
      return { ok: true };
    },

    async beginStepUp({ token, csrf, action, resourceId } = {}) {
      const authenticated = await requireSessionAndCsrf({ token, csrf });
      if (!authenticated.ok) return authenticated;
      const authLevel = requiredAuth(action);
      if (authLevel !== 'step-up') {
        await audit(
          'step_up_failed',
          'failure',
          {
            userId: authenticated.user.userId,
            sessionId: authenticated.session.sessionId,
            deviceId: authenticated.device.deviceId,
          },
          { reason: 'action_not_allowed' },
        );
        return failure('STEP_UP_NOT_REQUIRED', 'Action does not support step-up authorization');
      }
      if (!validText(resourceId, 256)) {
        await audit(
          'step_up_failed',
          'failure',
          {
            userId: authenticated.user.userId,
            sessionId: authenticated.session.sessionId,
            deviceId: authenticated.device.deviceId,
          },
          { reason: 'resource_invalid' },
        );
        return failure('RESOURCE_INVALID', 'Resource id is invalid');
      }
      const challengeId = requireIdentifier('challenge');
      const now = clockNow();
      const expiresAt = now + challengeTtlMs;
      const saved = await store.saveChallenge({
        challengeId,
        userId: authenticated.user.userId,
        sessionId: authenticated.session.sessionId,
        deviceId: authenticated.device.deviceId,
        action,
        resourceId,
        status: 'PENDING',
        createdAt: iso(now),
        expiresAt: iso(expiresAt),
        consumedAt: null,
        proofHash: null,
        proofExpiresAt: null,
      });
      const challenge = recordFrom(saved, 'challenge');
      if (!challenge)
        return failure(
          saved?.code ?? 'STEP_UP_CHALLENGE_FAILED',
          'Step-up challenge was not created',
        );
      await audit(
        'step_up_challenge_created',
        'success',
        {
          userId: authenticated.user.userId,
          sessionId: authenticated.session.sessionId,
          deviceId: authenticated.device.deviceId,
        },
        { action, resourceId, challengeId },
      );
      return { ok: true, challengeId, expiresAt, action, resourceId };
    },

    async completeStepUp({ token, csrf, challengeId, totpCode } = {}) {
      const authenticated = await requireSessionAndCsrf({ token, csrf });
      if (!authenticated.ok) return authenticated;
      const challengeResult = await store.getChallenge(challengeId);
      const challenge = recordFrom(challengeResult, 'challenge');
      const fields = {
        userId: authenticated.user.userId,
        sessionId: authenticated.session.sessionId,
        deviceId: authenticated.device.deviceId,
      };
      if (!challenge) return failure('STEP_UP_CHALLENGE_INVALID', 'Step-up challenge is invalid');
      if (
        challenge.userId !== fields.userId ||
        challenge.sessionId !== fields.sessionId ||
        challenge.deviceId !== fields.deviceId
      ) {
        await audit('step_up_failed', 'failure', fields, { reason: 'binding' });
        return failure('STEP_UP_BINDING_MISMATCH', 'Step-up challenge binding does not match');
      }
      if (challenge.status !== 'PENDING') {
        await audit('step_up_failed', 'failure', fields, { reason: 'challenge_replayed' });
        return failure('STEP_UP_CHALLENGE_REPLAYED', 'Step-up challenge was already consumed');
      }
      if (Date.parse(challenge.expiresAt) <= clockNow()) {
        await audit('step_up_failed', 'failure', fields, { reason: 'challenge_expired' });
        return failure('STEP_UP_CHALLENGE_EXPIRED', 'Step-up challenge has expired');
      }
      const userResult = await store.getUser(authenticated.user.userId);
      const user = recordFrom(userResult, 'user');
      if (!user) return failure('UNAUTHORIZED', 'Authentication is required');
      const factor = await verifySecondFactor({
        user,
        totpCode,
        username: user.username,
        clientKey: authenticated.device.deviceId,
        context: 'step_up',
        fields,
      });
      if (!factor.ok) {
        if (factor.code === 'TOTP_REPLAYED')
          await audit('step_up_failed', 'failure', fields, { reason: 'totp_replay' });
        else if (factor.code !== 'RATE_LIMITED')
          await audit('step_up_failed', 'failure', fields, { reason: 'totp' });
        return factor;
      }
      const proof = requireToken();
      const proofHash = sha256(proof);
      const proofExpiresAt = clockNow() + stepUpProofTtlMs;
      const consumed = await store.consumeChallenge({
        challengeId,
        expectedStatus: 'PENDING',
        proofHash,
        proofExpiresAt,
        at: clockNow(),
      });
      const ready = recordFrom(consumed, 'challenge');
      if (!ready) {
        const code = consumed?.code ?? 'STEP_UP_CHALLENGE_REPLAYED';
        const reason = code === 'CHALLENGE_EXPIRED' ? 'challenge_expired' : 'challenge_replayed';
        await audit('step_up_failed', 'failure', fields, { reason });
        return failure(
          code === 'CHALLENGE_EXPIRED' ? 'STEP_UP_CHALLENGE_EXPIRED' : 'STEP_UP_CHALLENGE_REPLAYED',
          'Step-up challenge is no longer available',
        );
      }
      await audit('step_up_completed', 'success', fields, {
        action: challenge.action,
        resourceId: challenge.resourceId,
        challengeId,
      });
      return {
        ok: true,
        proof,
        proofExpiresAt,
        challengeId,
        action: challenge.action,
        resourceId: challenge.resourceId,
        userId: challenge.userId,
        sessionId: challenge.sessionId,
        deviceId: challenge.deviceId,
      };
    },

    async authorizeStepUp({ token, proof, action, resourceId } = {}) {
      const authenticated = await sessionByToken(token, { touch: true });
      if (!authenticated.ok) return authenticated;
      const fields = {
        userId: authenticated.user.userId,
        sessionId: authenticated.session.sessionId,
        deviceId: authenticated.device.deviceId,
      };
      if (!validText(proof, 1024)) {
        await audit('step_up_authorization_failed', 'failure', fields, { reason: 'proof_invalid' });
        return failure('STEP_UP_PROOF_INVALID', 'Step-up proof is invalid');
      }
      const proofHash = sha256(proof);
      const found = await store.findChallengeByProofHash(proofHash);
      const challenge = recordFrom(found, 'challenge');
      if (!challenge) {
        await audit('step_up_authorization_failed', 'failure', fields, { reason: 'proof_invalid' });
        return failure('STEP_UP_PROOF_INVALID', 'Step-up proof is invalid');
      }
      if (challenge.status === 'PROOF_CONSUMED') {
        await audit('step_up_authorization_failed', 'failure', fields, {
          reason: 'proof_replayed',
        });
        return failure('STEP_UP_PROOF_REPLAYED', 'Step-up proof was already consumed');
      }
      if (challenge.status !== 'PROOF_READY') {
        await audit('step_up_authorization_failed', 'failure', fields, { reason: 'proof_invalid' });
        return failure('STEP_UP_PROOF_INVALID', 'Step-up proof is invalid');
      }
      if (
        challenge.userId !== fields.userId ||
        challenge.sessionId !== fields.sessionId ||
        challenge.deviceId !== fields.deviceId ||
        challenge.action !== action ||
        challenge.resourceId !== resourceId
      ) {
        await audit('step_up_authorization_failed', 'failure', fields, {
          reason: 'binding',
        });
        return failure('STEP_UP_BINDING_MISMATCH', 'Step-up proof binding does not match');
      }
      if (
        Date.parse(challenge.proofExpiresAt) <= clockNow() ||
        Date.parse(challenge.expiresAt) <= clockNow()
      ) {
        await audit('step_up_authorization_failed', 'failure', fields, { reason: 'expired' });
        return failure('STEP_UP_PROOF_EXPIRED', 'Step-up proof has expired');
      }
      const consumed = await store.consumeChallenge({
        challengeId: challenge.challengeId,
        expectedStatus: 'PROOF_READY',
        expectedProofHash: proofHash,
        at: clockNow(),
      });
      const authorization = recordFrom(consumed, 'challenge');
      if (!authorization) {
        await audit('step_up_authorization_failed', 'failure', fields, {
          reason: 'proof_replayed',
        });
        return failure('STEP_UP_PROOF_REPLAYED', 'Step-up proof was already consumed');
      }
      await audit('step_up_authorized', 'success', fields, {
        action,
        resourceId,
        challengeId: challenge.challengeId,
      });
      return {
        ok: true,
        authorization: {
          action,
          resourceId,
          userId: fields.userId,
          sessionId: fields.sessionId,
          deviceId: fields.deviceId,
          authorizedAt: authorization.proofConsumedAt,
        },
      };
    },

    async listDevices({ token } = {}) {
      const authenticated = await sessionByToken(token, { touch: true });
      if (!authenticated.ok) return authenticated;
      const result = await store.listDevices(authenticated.user.userId);
      if (!result.ok)
        return failure(result.code ?? 'DEVICE_LIST_FAILED', 'Devices were not listed');
      return {
        ok: true,
        devices: result.devices.map((device) => ({
          ...publicDevice(device),
          current: device.deviceId === authenticated.device.deviceId,
        })),
      };
    },

    async revokeDevice({ token, csrf, deviceId, proof } = {}) {
      const authenticated = await requireSessionAndCsrf({ token, csrf });
      if (!authenticated.ok) return authenticated;
      const deviceResult = await store.getDevice(deviceId);
      const target = recordFrom(deviceResult, 'device');
      if (!target || target.userId !== authenticated.user.userId) {
        await audit(
          'device_revocation_failed',
          'failure',
          {
            userId: authenticated.user.userId,
            sessionId: authenticated.session.sessionId,
            deviceId: authenticated.device.deviceId,
          },
          { reason: 'device_not_found' },
        );
        return failure('DEVICE_NOT_FOUND', 'Device was not found');
      }
      const authorized = await service.authorizeStepUp({
        token,
        proof,
        action: 'device.revoke',
        resourceId: deviceId,
      });
      if (!authorized.ok) return authorized;
      if (target.status === 'REVOKED')
        return failure('DEVICE_ALREADY_REVOKED', 'Device is already revoked');
      const now = clockNow();
      const saved = await store.saveDevice({
        ...target,
        status: 'REVOKED',
        revokedAt: iso(now),
        updatedAt: iso(now),
      });
      if (!saved.ok) return failure(saved.code ?? 'DEVICE_REVOKE_FAILED', 'Device was not revoked');
      const revoked = await store.revokeSessionsForDevice(deviceId, { at: now });
      if (!revoked.ok)
        return failure(revoked.code ?? 'SESSION_REVOKE_FAILED', 'Device sessions were not revoked');
      await audit(
        'device_revoked',
        'success',
        {
          userId: authenticated.user.userId,
          sessionId: authenticated.session.sessionId,
          deviceId: target.deviceId,
        },
        { revokedSessions: revoked.count },
      );
      return {
        ok: true,
        deviceId,
        revokedSessions: revoked.count,
        revokedAt: iso(now),
      };
    },

    async createAttentionNonce({ attentionId, ttlMs = challengeTtlMs } = {}) {
      if (!validText(attentionId, 256)) {
        await audit(
          'attention_nonce_issued',
          'failure',
          { attentionId },
          {
            reason: 'attention_invalid',
          },
        );
        return failure('ATTENTION_ID_INVALID', 'Attention id is invalid');
      }
      if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_NONCE_TTL_MS) {
        await audit(
          'attention_nonce_issued',
          'failure',
          { attentionId },
          {
            reason: 'ttl_invalid',
          },
        );
        return failure('NONCE_TTL_INVALID', 'Attention nonce TTL is invalid');
      }
      const now = clockNow();
      const nonce = requireToken();
      const expiresAt = now + ttlMs;
      const saved = await store.saveNonce({
        nonceId: requireIdentifier('nonce'),
        attentionId,
        nonceHash: sha256(nonce),
        status: 'ACTIVE',
        createdAt: iso(now),
        expiresAt: iso(expiresAt),
        version: 1,
      });
      if (!saved.ok)
        return failure(saved.code ?? 'NONCE_CREATE_FAILED', 'Attention nonce was not created');
      await audit('attention_nonce_issued', 'success', { attentionId }, { expiresAt });
      return { ok: true, nonce, expiresAt };
    },

    async redeemAttentionNonce({ token, nonce } = {}) {
      const authenticated = await sessionByToken(token, { touch: true });
      if (!authenticated.ok) {
        await audit('attention_nonce_redeemed', 'failure', {}, { reason: 'authentication' });
        return authenticated;
      }
      const fields = {
        userId: authenticated.user.userId,
        sessionId: authenticated.session.sessionId,
        deviceId: authenticated.device.deviceId,
      };
      if (!validText(nonce, 1024)) {
        await audit('attention_nonce_redeemed', 'failure', fields, { reason: 'nonce_invalid' });
        return failure('ATTENTION_NONCE_INVALID', 'Attention nonce is invalid');
      }
      const consumed = await store.consumeNonce({
        nonceHash: sha256(nonce),
        userId: fields.userId,
        sessionId: fields.sessionId,
        at: clockNow(),
      });
      const redeemed = recordFrom(consumed, 'nonce');
      if (!redeemed) {
        const code = consumed?.code ?? 'ATTENTION_NONCE_INVALID';
        await audit('attention_nonce_redeemed', 'failure', fields, {
          reason:
            code === 'ATTENTION_NONCE_EXPIRED'
              ? 'expired'
              : code === 'ATTENTION_NONCE_REPLAYED'
                ? 'replayed'
                : 'invalid',
        });
        return failure(code, 'Attention nonce is invalid or unavailable');
      }
      await audit('attention_nonce_redeemed', 'success', fields, {
        attentionId: redeemed.attentionId,
      });
      return { ok: true, attentionId: redeemed.attentionId };
    },
  });

  return service;
}
