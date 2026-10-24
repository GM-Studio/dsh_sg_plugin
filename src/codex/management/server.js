import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requiredAuth } from '../core/control/auth/policy.js';

const PUBLIC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_BODY_BYTES = 256 * 1024;
const AUTH_CONFIRMATION_HASH = /^[a-f0-9]{64}$/;
const AUTH_ENCRYPTION_KEY = /^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{43})$/;
const STATIC_FILES = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/style.css', { file: 'style.css', type: 'text/css; charset=utf-8' }],
]);
const MUTATIONS = new Set([
  '/api/work-items/create',
  '/api/decisions',
  '/api/work-items/pause',
  '/api/work-items/resume',
  '/api/work-items/retry',
  '/api/work-items/cancel',
  '/api/work-items/request-changes',
  '/api/notifications/resend',
  '/api/deliveries/accept',
  '/api/workers/register',
  '/api/workers/rotate',
  '/api/workers/revoke',
  '/api/workers/projects',
  '/api/workers/commands',
]);
const WORKER_ROUTES = new Set([
  '/api/worker/connect',
  '/api/worker/sync',
  '/api/worker/claim',
  '/api/worker/heartbeat',
  '/api/worker/events',
  '/api/worker/commands/ack',
  '/api/worker/release',
  '/api/worker/waiting',
  '/api/worker/finish',
  '/api/worker/decisions/apply',
  '/api/worker/decisions/complete',
  '/api/worker/decisions/fail',
]);
const MUTATION_ACTIONS = Object.freeze({
  '/api/work-items/pause': 'pause',
  '/api/work-items/resume': 'resume',
  '/api/work-items/retry': 'retry',
  '/api/work-items/cancel': 'cancel',
  '/api/work-items/request-changes': 'request_changes',
  '/api/deliveries/accept': 'accept_delivery',
  '/api/workers/register': 'worker.register',
  '/api/workers/rotate': 'worker.rotate',
  '/api/workers/revoke': 'worker.revoke',
  '/api/workers/projects': 'worker.projects',
});

function failure(code, message) {
  return { ok: false, code, message };
}

function remoteConfigurationError(message) {
  const error = new TypeError(message);
  error.code = 'REMOTE_MODE_CONFIG_INVALID';
  return error;
}

function normalizeHost(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function normalizeAddress(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/^::ffff:/, '');
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.origin.toLowerCase();
  } catch {
    return null;
  }
}

function isHttpsOrigin(value) {
  const normalized = normalizeOrigin(value);
  return normalized !== null && new URL(normalized).protocol === 'https:';
}

function isPublicBindAddress(value) {
  const normalized = normalizeAddress(value);
  return normalized === '0.0.0.0' || normalized === '::';
}

function equalSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function parseCookies(header) {
  const cookies = {};
  for (const entry of String(header || '').split(';')) {
    const index = entry.indexOf('=');
    if (index <= 0) continue;
    const key = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

function bearerToken(header) {
  const value = typeof header === 'string' ? header.trim() : '';
  const match = /^Bearer ([A-Za-z0-9._~+/-]{16,1024})$/i.exec(value);
  return match ? match[1] : null;
}

function isWorkerApiRequest(request) {
  const pathname = String(request.url || '').split('?')[0];
  return pathname === '/api/worker' || pathname.startsWith('/api/worker/');
}

function securityHeaders(response) {
  response.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; '),
  );
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const PRIVATE_KEYS = new Set([
  'projectRoot',
  'cwd',
  'worktree',
  'worktreePath',
  'checkoutPath',
  'environmentVariables',
  'credentials',
  'authorization',
  'webhookUrl',
  'tokenHash',
]);

function redactedText(value) {
  return String(value)
    .replace(/[A-Za-z]:[\\/][^\s"'`]+/g, '<local-path>')
    .replace(/\/(?:tmp|home|Users|opt|var|private)\/[^\s"'`]+/g, '<local-path>')
    .replace(
      /(?:\bBearer\s+[A-Za-z0-9._~+/-]{12,}|\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]{6,})/gi,
      '<redacted>',
    );
}

function sanitizeForWeb(value, key = null, depth = 0) {
  if (depth > 20) return null;
  if (key && PRIVATE_KEYS.has(key)) return undefined;
  if (typeof value === 'string') return redactedText(value).slice(0, 64000);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value))
    return value
      .map((entry) => sanitizeForWeb(entry, null, depth + 1))
      .filter((entry) => entry !== undefined)
      .slice(0, 500);
  if (typeof value === 'object') {
    const output = {};
    for (const [entryKey, entry] of Object.entries(value)) {
      const sanitized = sanitizeForWeb(entry, entryKey, depth + 1);
      if (sanitized !== undefined) output[entryKey] = sanitized;
    }
    return output;
  }
  return null;
}

function statusFor(result) {
  if (!result || result.ok !== false) return 200;
  if (
    [
      'UNAUTHORIZED',
      'INVALID_CREDENTIALS',
      'WORKER_UNAUTHORIZED',
      'WORKER_TOKEN_INVALID',
      'WORKER_AUTH_INVALID',
    ].includes(result.code)
  )
    return 401;
  if (
    [
      'STEP_UP_REQUIRED',
      'AUTH_FAILED',
      'DEVICE_REVOKED',
      'DEVICE_CONFIRMATION_REQUIRED',
      'TOTP_REPLAY',
      'TOTP_REPLAYED',
      'INVALID_TOTP',
      'CHALLENGE_INVALID',
      'NONCE_INVALID',
      'ATTENTION_NONCE_INVALID',
      'CSRF_INVALID',
      'STEP_UP_CHALLENGE_EXPIRED',
      'STEP_UP_CHALLENGE_REPLAYED',
      'STEP_UP_PROOF_EXPIRED',
      'STEP_UP_PROOF_REPLAYED',
      'STEP_UP_PROOF_INVALID',
      'STEP_UP_BINDING_MISMATCH',
      'WORKER_REVOKED',
      'WORKER_PROJECT_FORBIDDEN',
      'COMMAND_REJECTED',
    ].includes(result.code)
  )
    return 403;
  if (result.code === 'RATE_LIMITED') return 429;
  if (result.code === 'NOT_FOUND' || result.code?.endsWith('_NOT_FOUND')) return 404;
  if (
    [
      'VERSION_CONFLICT',
      'ATTENTION_REVISION_CONFLICT',
      'ATTENTION_EXPIRED',
      'ATTENTION_NOT_OPEN',
      'IDEMPOTENCY_CONFLICT',
      'ARTIFACT_MISMATCH',
      'DELIVERY_ARTIFACT_CHANGED',
      'DELIVERY_PROJECT_MISMATCH',
      'CUSTOMER_ALREADY_ACCEPTED',
      'ACTION_NOT_ALLOWED',
      'INVALID_TRANSITION',
      'LEASE_INVALID',
      'WORKER_EVENT_CONFLICT',
      'WORKER_OFFLINE',
      'RESUME_SESSION_REQUIRED',
      'DECISION_APPLY_FAILED',
      'DECISION_ALREADY_APPLIED',
    ].includes(result.code)
  )
    return 409;
  return 400;
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body exceeds the management limit');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const type = String(request.headers['content-type'] || '');
  if (!type.toLowerCase().startsWith('application/json')) {
    const error = new Error('Content-Type must be application/json');
    error.code = 'CONTENT_TYPE_REQUIRED';
    throw error;
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new TypeError('JSON body must be an object');
    return parsed;
  } catch (error) {
    error.code ||= 'INVALID_JSON';
    throw error;
  }
}

function methodFailure(response, allowed) {
  response.setHeader('Allow', allowed.join(', '));
  sendJson(response, 405, failure('METHOD_NOT_ALLOWED', 'HTTP method is not allowed'));
}

function decodeId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function createManagementServer({
  services,
  authService = null,
  workerGateway = null,
  clock = Date.now,
  pairingToken = randomBytes(24).toString('base64url'),
  sessionTtlMs = 8 * 60 * 60 * 1000,
  pairingTtlMs = 15 * 60 * 1000,
  host = '127.0.0.1',
  port = 0,
  publicRoot = PUBLIC_ROOT,
  rateLimitPerMinute = 120,
  secureCookie = false,
  trustProxyHttps = false,
  deploymentMode = 'local',
  allowedHosts = [],
  allowedOrigins = [],
  trustedProxies = [],
  sessionStore = null,
  mysqlConfigPath = null,
  authEncryptionKey = null,
  authDeviceConfirmationCodeHash = null,
} = {}) {
  if (!services?.projection || !services?.decisions)
    throw new TypeError('Management server requires projection and decision services');
  if (typeof pairingToken !== 'string' || pairingToken.length < 16)
    throw new TypeError('pairingToken must be a non-trivial secret');
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs <= 0)
    throw new TypeError('sessionTtlMs must be a positive integer');
  if (!Number.isSafeInteger(pairingTtlMs) || pairingTtlMs <= 0)
    throw new TypeError('pairingTtlMs must be a positive integer');
  if (!Number.isSafeInteger(rateLimitPerMinute) || rateLimitPerMinute <= 0)
    throw new TypeError('rateLimitPerMinute must be positive');
  if (
    sessionStore !== null &&
    (typeof sessionStore?.load !== 'function' || typeof sessionStore?.save !== 'function')
  )
    throw new TypeError('sessionStore must provide load() and save()');
  if (!['local', 'remote'].includes(deploymentMode))
    throw remoteConfigurationError('Deployment mode must be local or remote');
  if (
    authService !== null &&
    [
      'login',
      'authenticate',
      'verifyCsrf',
      'beginStepUp',
      'completeStepUp',
      'authorizeStepUp',
      'listDevices',
      'revokeDevice',
      'logout',
      'redeemAttentionNonce',
      'createAttentionNonce',
    ].some((method) => typeof authService[method] !== 'function')
  )
    throw new TypeError('authService does not implement the management authentication contract');
  if (deploymentMode === 'remote' && authService === null)
    throw remoteConfigurationError('Remote mode requires account authentication');
  if (
    workerGateway !== null &&
    [
      'register',
      'rotateToken',
      'revoke',
      'listWorkers',
      'setProjects',
      'connect',
      'sync',
      'claim',
      'heartbeat',
      'reportEvents',
      'pullCommands',
      'ackCommand',
      'release',
      'issueCommand',
      'reportWaiting',
      'finishRun',
      'beginDecisionApply',
      'completeDecisionApply',
      'failDecisionApply',
    ].some((method) => typeof workerGateway[method] !== 'function')
  )
    throw new TypeError('workerGateway does not implement the management Worker contract');
  if (deploymentMode === 'remote') {
    if (!secureCookie || !trustProxyHttps) {
      throw remoteConfigurationError('Remote mode requires Secure cookies and trusted HTTPS');
    }
    if (!Array.isArray(allowedHosts) || allowedHosts.length === 0)
      throw remoteConfigurationError('Remote mode requires allowed Host values');
    if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0)
      throw remoteConfigurationError('Remote mode requires allowed Origin values');
    if (!Array.isArray(trustedProxies) || trustedProxies.length === 0)
      throw remoteConfigurationError('Remote mode requires trusted proxy values');
    if (allowedOrigins.some((origin) => !isHttpsOrigin(origin)))
      throw remoteConfigurationError('Remote mode Origins must use HTTPS');
    if (isPublicBindAddress(host))
      throw remoteConfigurationError('Remote mode must not bind an unprotected public address');
    if (
      authService === null ||
      typeof mysqlConfigPath !== 'string' ||
      !path.isAbsolute(mysqlConfigPath) ||
      !AUTH_ENCRYPTION_KEY.test(authEncryptionKey || '') ||
      !AUTH_CONFIRMATION_HASH.test(authDeviceConfirmationCodeHash || '')
    )
      throw remoteConfigurationError(
        'Remote mode requires account authentication backed by MySQL and encrypted TOTP seeds',
      );
  }

  const sessions = new Map();
  const rateBuckets = new Map();
  const pairingTokens = new Map();
  const hostSet = new Set(allowedHosts.map(normalizeHost).filter(Boolean));
  const originSet = new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean));
  const proxySet = new Set(trustedProxies.map(normalizeAddress).filter(Boolean));
  const defaultActor = { kind: 'user', id: 'local-owner', source: 'web' };
  const accountMode = authService !== null;
  const pairKey = (value) =>
    typeof value === 'string' ? createHash('sha256').update(value).digest('hex') : null;
  pairingTokens.set(pairKey(pairingToken), {
    createdAt: clock(),
    expiresAt: clock() + pairingTtlMs,
  });

  // Durable state shape persisted through the optional injected store:
  //   sessions: { [sessionId]: { createdAt, expiresAt, csrf } }
  //   pairing:  { [sha256(pairingToken)]: { createdAt, expiresAt } }
  // Only the session id (the opaque cookie value), its CSRF token and TTLs plus
  // the already-hashed pairing key are written; no raw pairing token, password,
  // step-up code or other credential ever reaches the store.
  function snapshotState() {
    const durableSessions = {};
    for (const [id, session] of sessions)
      durableSessions[id] = {
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        csrf: session.csrfToken,
      };
    const durablePairing = {};
    for (const [key, entry] of pairingTokens)
      durablePairing[key] = { createdAt: entry.createdAt, expiresAt: entry.expiresAt };
    return { sessions: durableSessions, pairing: durablePairing };
  }

  function persistNow() {
    if (!sessionStore || !hydrated) return;
    try {
      const result = sessionStore.save(snapshotState());
      if (result && typeof result.then === 'function') result.catch(() => {});
    } catch {
      // A persistence failure must never break an established live session.
    }
  }

  async function persistState() {
    if (!sessionStore) return;
    await sessionStore.save(snapshotState());
  }

  async function removeSession(id) {
    sessions.delete(id);
    if (!sessionStore) return;
    if (typeof sessionStore.remove === 'function') await sessionStore.remove(id);
    else await persistState();
  }

  let hydrated = false;
  async function hydrate() {
    if (hydrated) return;
    hydrated = true;
    if (!sessionStore) return;
    let loaded = null;
    let loadedOk = false;
    try {
      loaded = await sessionStore.load();
      loadedOk = true;
    } catch {
      loaded = null;
      loadedOk = false;
    }
    const now = clock();
    const storedSessions =
      loaded && typeof loaded.sessions === 'object' && loaded.sessions ? loaded.sessions : {};
    for (const [id, session] of Object.entries(storedSessions)) {
      if (!id || !session || typeof session.csrf !== 'string') continue;
      if (!Number.isFinite(session.expiresAt) || session.expiresAt <= now) continue;
      sessions.set(id, {
        csrfToken: session.csrf,
        expiresAt: session.expiresAt,
        createdAt: Number.isFinite(session.createdAt) ? session.createdAt : now,
        actor: defaultActor,
      });
    }
    const storedPairing =
      loaded && typeof loaded.pairing === 'object' && loaded.pairing ? loaded.pairing : {};
    for (const [key, entry] of Object.entries(storedPairing)) {
      if (!/^[a-f0-9]{64}$/.test(key)) continue;
      if (!entry || !Number.isFinite(entry.expiresAt) || entry.expiresAt <= now) continue;
      pairingTokens.set(key, {
        createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : now,
        expiresAt: entry.expiresAt,
      });
    }
    if (loadedOk) await persistState();
  }

  function issuePairingToken({ ttlMs = 15 * 60 * 1000 } = {}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)
      throw new TypeError('Pairing token TTL must be a positive integer');
    const now = clock();
    for (const [key, entry] of pairingTokens) {
      if (entry && entry.expiresAt <= now) pairingTokens.delete(key);
    }
    if (pairingTokens.size >= 256) {
      const oldest = pairingTokens.keys().next().value;
      if (oldest !== undefined) pairingTokens.delete(oldest);
    }
    const token = randomBytes(24).toString('base64url');
    pairingTokens.set(pairKey(token), { createdAt: now, expiresAt: now + ttlMs });
    persistNow();
    return { token, expiresAt: new Date(now + ttlMs).toISOString() };
  }

  function withinRateLimit(request) {
    const key = request.socket?.remoteAddress || 'local';
    const now = clock();
    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.startedAt >= 60000) {
      bucket = { startedAt: now, count: 0 };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (rateBuckets.size > 1024) {
      const oldest = rateBuckets.keys().next().value;
      if (oldest !== undefined && oldest !== key) rateBuckets.delete(oldest);
    }
    return bucket.count <= rateLimitPerMinute;
  }

  function requestBoundary(request) {
    if (deploymentMode !== 'remote') return null;
    const remoteAddress = normalizeAddress(request.socket?.remoteAddress);
    if (!proxySet.has(remoteAddress)) return 'UNTRUSTED_PROXY';
    if (request.headers['x-forwarded-proto'] !== 'https') return 'HTTPS_REQUIRED';
    const host = normalizeHost(request.headers.host);
    if (!hostSet.has(host)) return 'HOST_NOT_ALLOWED';
    if (request.method === 'POST' && !isWorkerApiRequest(request)) {
      const origin = normalizeOrigin(request.headers.origin);
      if (!origin) return 'ORIGIN_REQUIRED';
      if (!originSet.has(origin)) return 'ORIGIN_NOT_ALLOWED';
    }
    return null;
  }

  function clientAddress(request) {
    if (deploymentMode === 'remote') {
      const forwarded = String(request.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
      const normalized = normalizeAddress(forwarded);
      if (normalized) return normalized;
    }
    return normalizeAddress(request.socket?.remoteAddress) || 'unknown';
  }

  async function sessionFor(request) {
    const token = parseCookies(request.headers.cookie).specgate_session;
    if (accountMode) {
      if (!token) return null;
      const authenticated = await authService.authenticate({ token });
      if (!authenticated.ok) return null;
      return {
        id: authenticated.session.sessionId,
        mode: 'account',
        token,
        csrfHash: authenticated.session.csrfHash,
        expiresAt: Date.parse(authenticated.session.expiresAt),
        createdAt: Date.parse(authenticated.session.createdAt),
        actor: {
          kind: 'user',
          id: authenticated.user.userId,
          username: authenticated.user.username,
          role: authenticated.user.role,
          source: 'web',
        },
        device: authenticated.device,
        authLevel: authenticated.session.authLevel,
      };
    }
    const session = token ? sessions.get(token) : null;
    if (!session) return null;
    if (session.expiresAt <= clock()) {
      await removeSession(token);
      return null;
    }
    return { id: token, mode: 'pairing', token, ...session };
  }

  async function requireSession(request, response) {
    const session = await sessionFor(request);
    if (!session) {
      sendJson(response, 401, failure('UNAUTHORIZED', 'A valid management session is required'));
      return null;
    }
    return session;
  }

  function verifyCsrf(request, session, response) {
    const supplied = request.headers['x-specgate-csrf'];
    const valid =
      session.mode === 'account'
        ? typeof supplied === 'string' && authService.verifyCsrf(session, supplied)
        : equalSecret(supplied, session.csrfToken);
    if (!valid) {
      sendJson(response, 403, failure('CSRF_INVALID', 'CSRF validation failed'));
      return false;
    }
    return true;
  }

  function sessionCookie(request, token, maxAgeSeconds) {
    const secure =
      secureCookie ||
      request.socket.encrypted ||
      (trustProxyHttps && request.headers['x-forwarded-proto'] === 'https');
    return `specgate_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${
      secure ? '; Secure' : ''
    }`;
  }

  function csrfCookie(request, token, maxAgeSeconds) {
    const secure =
      secureCookie ||
      request.socket.encrypted ||
      (trustProxyHttps && request.headers['x-forwarded-proto'] === 'https');
    return `specgate_csrf=${token}; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${
      secure ? '; Secure' : ''
    }`;
  }

  async function accountRoute(request, response, pathname) {
    if (pathname === '/api/auth/methods') {
      if (request.method !== 'GET') return methodFailure(response, ['GET']);
      sendJson(response, 200, {
        ok: true,
        mode: accountMode ? 'account' : 'pairing',
        methods: accountMode ? ['password', 'totp'] : ['pairing'],
      });
      return;
    }
    if (!accountMode) {
      sendJson(response, 404, failure('NOT_FOUND', 'Account authentication is not configured'));
      return;
    }
    if (pathname === '/api/auth/login') {
      if (request.method !== 'POST') return methodFailure(response, ['POST']);
      let body;
      try {
        body = await readBody(request);
      } catch (error) {
        sendJson(response, 400, failure(error.code, error.message));
        return;
      }
      const result = await authService.login({
        username: body.username,
        password: body.password,
        totpCode: body.totpCode,
        deviceId: body.deviceId,
        deviceName: body.deviceName,
        deviceConfirmationCode: body.deviceConfirmationCode,
        clientKey: clientAddress(request),
      });
      if (!result.ok) {
        sendJson(response, statusFor(result), result);
        return;
      }
      const expiresAt =
        typeof result.expiresAt === 'number' ? result.expiresAt : Date.parse(result.expiresAt);
      const maxAge = Math.max(1, Math.floor((expiresAt - clock()) / 1000));
      response.setHeader('Set-Cookie', [
        sessionCookie(request, result.token, maxAge),
        csrfCookie(request, result.csrfToken, maxAge),
      ]);
      sendJson(response, 200, {
        ok: true,
        csrfToken: result.csrfToken,
        expiresAt: new Date(expiresAt).toISOString(),
        user: result.user,
        device: result.device,
      });
      return;
    }

    const session = await requireSession(request, response);
    if (!session) return;
    if (request.method === 'GET' && pathname === '/api/auth/devices') {
      const result = await authService.listDevices({ token: session.token });
      sendJson(response, statusFor(result), sanitizeForWeb(result));
      return;
    }
    if (request.method !== 'POST') return methodFailure(response, ['GET', 'POST']);
    if (!verifyCsrf(request, session, response)) return;
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      sendJson(response, 400, failure(error.code, error.message));
      return;
    }
    let result;
    if (pathname === '/api/auth/logout') {
      result = await authService.logout({
        token: session.token,
        csrf: request.headers['x-specgate-csrf'],
      });
      if (result.ok)
        response.setHeader('Set-Cookie', [
          sessionCookie(request, '', 0),
          csrfCookie(request, '', 0),
        ]);
    } else if (pathname === '/api/auth/step-up/challenge') {
      result = await authService.beginStepUp({
        token: session.token,
        csrf: request.headers['x-specgate-csrf'],
        action: body.action,
        resourceId: body.resourceId,
      });
    } else if (pathname === '/api/auth/step-up/verify') {
      result = await authService.completeStepUp({
        token: session.token,
        csrf: request.headers['x-specgate-csrf'],
        challengeId: body.challengeId,
        totpCode: body.totpCode,
      });
    } else if (pathname === '/api/auth/attention/redeem') {
      result = await authService.redeemAttentionNonce({
        token: session.token,
        nonce: body.nonce,
      });
    } else if (pathname === '/api/auth/devices/revoke') {
      result = await authService.revokeDevice({
        token: session.token,
        csrf: request.headers['x-specgate-csrf'],
        deviceId: body.deviceId,
        proof: body.stepUpProof,
      });
    } else {
      result = failure('NOT_FOUND', 'Account authentication route does not exist');
    }
    sendJson(response, statusFor(result), sanitizeForWeb(result));
  }

  async function sessionRoute(request, response) {
    if (request.method === 'GET') {
      const session = await requireSession(request, response);
      if (!session) return;
      if (session.mode === 'account') {
        const csrfToken = parseCookies(request.headers.cookie).specgate_csrf;
        sendJson(response, 200, {
          ok: true,
          mode: 'account',
          csrfToken:
            typeof csrfToken === 'string' && authService.verifyCsrf(session, csrfToken)
              ? csrfToken
              : null,
          expiresAt: new Date(session.expiresAt).toISOString(),
          actor: session.actor,
          device: session.device,
        });
      } else {
        sendJson(response, 200, {
          ok: true,
          mode: 'pairing',
          csrfToken: session.csrfToken,
          expiresAt: new Date(session.expiresAt).toISOString(),
          actor: session.actor,
        });
      }
      return;
    }
    if (request.method !== 'POST') return methodFailure(response, ['GET', 'POST']);
    if (accountMode) {
      sendJson(response, 401, failure('PAIRING_DISABLED', 'Use account authentication'));
      return;
    }
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      sendJson(response, 400, failure(error.code, error.message));
      return;
    }
    const key = pairKey(body.token);
    const entry = key ? pairingTokens.get(key) : undefined;
    const expired = Boolean(entry) && entry.expiresAt <= clock();
    if (!entry || expired) {
      sendJson(response, 401, failure('PAIRING_FAILED', 'Pairing token is invalid or consumed'));
      return;
    }
    pairingTokens.delete(key);
    const id = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const createdAt = clock();
    const expiresAt = createdAt + sessionTtlMs;
    const actor = defaultActor;
    if (sessions.size >= 100) {
      const oldest = sessions.keys().next().value;
      if (oldest !== undefined) sessions.delete(oldest);
    }
    sessions.set(id, { csrfToken, expiresAt, createdAt, actor });
    await persistState();
    response.setHeader('Set-Cookie', sessionCookie(request, id, Math.floor(sessionTtlMs / 1000)));
    sendJson(response, 200, {
      ok: true,
      csrfToken,
      expiresAt: new Date(expiresAt).toISOString(),
      actor,
    });
  }

  async function queryRoute(request, response, pathname) {
    const session = await requireSession(request, response);
    if (!session) return;
    if (request.method !== 'GET') return methodFailure(response, ['GET']);
    const projection = services.projection;
    let result;
    if (pathname === '/api/health') result = await projection.health();
    else if (pathname === '/api/projects') {
      const overview = await projection.overview();
      result = overview.ok ? { ok: true, projects: overview.projects } : overview;
    } else if (pathname === '/api/work-items') result = await projection.listWorkItems();
    else if (pathname.startsWith('/api/work-items/')) {
      const workItemId = decodeId(pathname.slice('/api/work-items/'.length));
      result = workItemId
        ? await projection.getWorkItem(workItemId)
        : failure('INVALID_ARGUMENT', 'WorkItem id is invalid');
    } else if (pathname.startsWith('/api/runs/')) {
      const runId = decodeId(pathname.slice('/api/runs/'.length));
      result = runId
        ? await projection.getRun(runId)
        : failure('INVALID_ARGUMENT', 'Run id is invalid');
    } else if (pathname === '/api/attention') result = await projection.listAttention();
    else if (pathname === '/api/notifications') result = await projection.listNotifications();
    else if (pathname === '/api/workers')
      result = workerGateway
        ? await workerGateway.listWorkers()
        : failure('NOT_AVAILABLE', 'Worker management is not configured');
    else result = failure('NOT_FOUND', 'Management route does not exist');
    sendJson(response, statusFor(result), sanitizeForWeb(result));
  }

  async function attentionDocumentRoute(request, response, attentionId) {
    const session = await requireSession(request, response);
    if (!session) return;
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return methodFailure(response, ['GET', 'HEAD']);
    const result = await services.projection.getAttentionDocument(attentionId);
    if (!result.ok) return sendJson(response, statusFor(result), sanitizeForWeb(result));
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SpecGate 审批文档</title>
</head>
<body>
  <main>
    <p><a href="/">返回 SpecGate 控制台</a></p>
    <p>${escapeHtml(result.document.path)}</p>
    <pre>${escapeHtml(result.document.content)}</pre>
  </main>
</body>
</html>`;
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(request.method === 'HEAD' ? undefined : html);
  }

  async function workerRoute(request, response, url) {
    if (!workerGateway) {
      sendJson(response, 404, failure('NOT_FOUND', 'Worker API is not configured'));
      return;
    }
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      sendJson(response, 401, failure('WORKER_UNAUTHORIZED', 'A Worker bearer token is required'));
      return;
    }
    const pathname = url.pathname;
    let result;
    if (pathname === '/api/worker/commands') {
      if (request.method !== 'GET') return methodFailure(response, ['GET']);
      const after = url.searchParams.get('after');
      const limit = url.searchParams.get('limit');
      if (
        (after !== null && (!/^\d+$/.test(after) || !Number.isSafeInteger(Number(after)))) ||
        (limit !== null &&
          (!/^\d+$/.test(limit) ||
            !Number.isSafeInteger(Number(limit)) ||
            Number(limit) < 1 ||
            Number(limit) > 100))
      ) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'Command cursor is invalid'));
        return;
      }
      result = await workerGateway.pullCommands({
        token,
        ...(after === null ? {} : { after: Number(after) }),
        ...(limit === null ? {} : { limit: Number(limit) }),
      });
      sendJson(response, statusFor(result), sanitizeForWeb(result));
      return;
    }
    if (!WORKER_ROUTES.has(pathname)) {
      sendJson(response, 404, failure('NOT_FOUND', 'Worker route does not exist'));
      return;
    }
    if (request.method !== 'POST') return methodFailure(response, ['POST']);
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      sendJson(response, 400, failure(error.code, error.message));
      return;
    }
    if (pathname === '/api/worker/connect')
      result = await workerGateway.connect({ token, capabilities: body.capabilities });
    else if (pathname === '/api/worker/sync')
      result = await workerGateway.sync({
        token,
        cursor: body.cursor,
        waitMs: body.waitMs,
      });
    else if (pathname === '/api/worker/claim')
      result = await workerGateway.claim({ token, leaseMs: body.leaseMs });
    else if (pathname === '/api/worker/heartbeat')
      result = await workerGateway.heartbeat({ token, ...body });
    else if (pathname === '/api/worker/events')
      result = await workerGateway.reportEvents({ token, events: body.events });
    else if (pathname === '/api/worker/commands/ack')
      result = await workerGateway.ackCommand({ token, commandId: body.commandId });
    else if (pathname === '/api/worker/release')
      result = await workerGateway.release({ token, ...body });
    else if (pathname === '/api/worker/waiting')
      result = await workerGateway.reportWaiting({ token, ...body });
    else if (pathname === '/api/worker/finish')
      result = await workerGateway.finishRun({ token, ...body });
    else if (pathname === '/api/worker/decisions/apply')
      result = await workerGateway.beginDecisionApply({ token, ...body });
    else if (pathname === '/api/worker/decisions/complete')
      result = await workerGateway.completeDecisionApply({ token, ...body });
    else if (pathname === '/api/worker/decisions/fail')
      result = await workerGateway.failDecisionApply({ token, ...body });
    sendJson(response, statusFor(result), sanitizeForWeb(result));
  }

  async function mutationRoute(request, response, pathname) {
    const session = await requireSession(request, response);
    if (!session) return;
    if (request.method !== 'POST') return methodFailure(response, ['POST']);
    if (!verifyCsrf(request, session, response)) return;
    let body;
    try {
      body = await readBody(request);
    } catch (error) {
      sendJson(response, 400, failure(error.code, error.message));
      return;
    }
    let authLevel = 'session';
    let stepUpProof = body.stepUpProof;
    delete body.stepUpProof;
    const action =
      pathname === '/api/decisions' ? body.action : (MUTATION_ACTIONS[pathname] ?? null);
    const resourceId =
      body.attentionId || body.workItemId || body.deliveryId || body.workerId || null;
    if (session.mode === 'account') {
      if (requiredAuth(action) === 'step-up') {
        if (!stepUpProof) {
          sendJson(response, 403, failure('STEP_UP_REQUIRED', 'A one-time TOTP proof is required'));
          return;
        }
        const authorized = await authService.authorizeStepUp({
          token: session.token,
          proof: stepUpProof,
          action,
          resourceId,
        });
        if (!authorized.ok) {
          sendJson(response, statusFor(authorized), authorized);
          return;
        }
        authLevel = 'step-up';
      }
    } else if (
      (action?.startsWith('worker.') && requiredAuth(action) === 'step-up') ||
      body.stepUpCode !== undefined
    ) {
      let verified = false;
      try {
        verified = await services.verifyStepUp?.(body.stepUpCode);
      } catch {
        verified = false;
      }
      if (!verified) {
        sendJson(response, 403, failure('STEP_UP_REQUIRED', 'Step-up code is invalid'));
        return;
      }
      authLevel = verified === true ? 'step-up' : String(verified);
    }
    const input = { ...body };
    delete input.stepUpCode;
    delete input.stepUpProof;
    input.actorId = session.actor.id;
    input.source = 'web';
    input.authLevel = authLevel;
    let result;
    if (pathname === '/api/work-items/create') {
      const create =
        services.workItems?.create?.bind(services.workItems) ||
        services.createWorkItem?.bind(services);
      result = create
        ? await create(input)
        : failure('NOT_AVAILABLE', 'WorkItem creation is not configured');
    } else if (pathname === '/api/decisions') result = await services.decisions.create(input);
    else if (pathname === '/api/work-items/pause') result = await services.decisions.pause(input);
    else if (pathname === '/api/work-items/resume') result = await services.decisions.resume(input);
    else if (pathname === '/api/work-items/retry') result = await services.decisions.retry(input);
    else if (pathname === '/api/work-items/cancel') result = await services.decisions.cancel(input);
    else if (pathname === '/api/work-items/request-changes')
      result = await services.decisions.requestChanges(input);
    else if (pathname === '/api/notifications/resend') {
      result =
        typeof services.decisions.resendNotification === 'function'
          ? await services.decisions.resendNotification(input)
          : failure('NOT_AVAILABLE', 'Notification resend is not configured');
    } else if (pathname === '/api/deliveries/accept') {
      result =
        typeof services.deliveries?.accept === 'function'
          ? await services.deliveries.accept(input)
          : failure('NOT_AVAILABLE', 'Customer acceptance is not configured');
    } else if (pathname.startsWith('/api/workers/')) {
      const workerInput = { ...input };
      delete workerInput.source;
      delete workerInput.authLevel;
      if (!workerGateway) result = failure('NOT_AVAILABLE', 'Worker management is not configured');
      else if (pathname === '/api/workers/register')
        result = await workerGateway.register(workerInput);
      else if (pathname === '/api/workers/rotate')
        result = await workerGateway.rotateToken(workerInput);
      else if (pathname === '/api/workers/revoke') result = await workerGateway.revoke(workerInput);
      else if (pathname === '/api/workers/projects')
        result = await workerGateway.setProjects(workerInput);
      else if (pathname === '/api/workers/commands')
        result = await workerGateway.issueCommand(workerInput);
      else result = failure('NOT_FOUND', 'Worker management route does not exist');
    } else result = failure('NOT_FOUND', 'Management mutation does not exist');
    sendJson(response, statusFor(result), sanitizeForWeb(result));
  }

  async function staticRoute(request, response, pathname) {
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return methodFailure(response, ['GET', 'HEAD']);
    const entry = STATIC_FILES.get(pathname);
    if (!entry) {
      sendJson(response, 404, failure('NOT_FOUND', 'Static asset does not exist'));
      return;
    }
    try {
      const body = await fs.readFile(path.join(publicRoot, entry.file));
      securityHeaders(response);
      response.statusCode = 200;
      response.setHeader('Content-Type', entry.type);
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      sendJson(response, 404, failure('NOT_FOUND', 'Static asset is unavailable'));
    }
  }

  const server = http.createServer(async (request, response) => {
    securityHeaders(response);
    const boundaryFailure = requestBoundary(request);
    if (boundaryFailure) {
      const status = ['UNTRUSTED_PROXY', 'HTTPS_REQUIRED', 'ORIGIN_REQUIRED'].includes(
        boundaryFailure,
      )
        ? 403
        : boundaryFailure === 'HOST_NOT_ALLOWED'
          ? 400
          : 403;
      sendJson(response, status, failure(boundaryFailure, 'Management request boundary rejected'));
      return;
    }
    if (!withinRateLimit(request)) {
      sendJson(response, 429, failure('RATE_LIMITED', 'Too many management requests'));
      return;
    }
    let url;
    try {
      url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    } catch {
      sendJson(response, 400, failure('INVALID_REQUEST', 'Request URL is invalid'));
      return;
    }
    const pathname = url.pathname;
    try {
      if (pathname.startsWith('/api/worker/')) {
        return await workerRoute(request, response, url);
      }
      if (pathname.startsWith('/api/auth/')) {
        return await accountRoute(request, response, pathname);
      }
      if (pathname === '/api/session') return await sessionRoute(request, response);
      if (MUTATIONS.has(pathname)) return await mutationRoute(request, response, pathname);
      const documentMatch = /^\/api\/attention\/([^/]+)\/document$/.exec(pathname);
      if (documentMatch) {
        const attentionId = decodeId(documentMatch[1]);
        if (!attentionId) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'AttentionRequest id is invalid'));
          return;
        }
        return await attentionDocumentRoute(request, response, attentionId);
      }
      if (pathname.startsWith('/api/')) return await queryRoute(request, response, pathname);
      return await staticRoute(request, response, pathname);
    } catch {
      if (!response.headersSent)
        sendJson(response, 500, failure('INTERNAL_ERROR', 'Management request failed'));
      else response.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 100;

  async function start({ port: requestedPort = port, host: requestedHost = host } = {}) {
    await hydrate();
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        server.off('error', onError);
        const address = server.address();
        resolve({
          ok: true,
          host: address.address,
          port: address.port,
          baseUrl: `http://${address.address}:${address.port}`,
        });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(requestedPort, requestedHost);
    });
  }

  function close() {
    return new Promise((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  return Object.freeze({
    server,
    start,
    close,
    pairingToken,
    issuePairingToken,
    pairingUrl(baseUrl) {
      return `${baseUrl}/#token=${encodeURIComponent(pairingToken)}`;
    },
  });
}
