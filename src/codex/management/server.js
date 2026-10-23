import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PUBLIC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_BODY_BYTES = 256 * 1024;
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
]);

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
  if (['STEP_UP_REQUIRED', 'UNAUTHORIZED'].includes(result.code)) return 403;
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
  }

  const sessions = new Map();
  const rateBuckets = new Map();
  const pairingTokens = new Map();
  const hostSet = new Set(allowedHosts.map(normalizeHost).filter(Boolean));
  const originSet = new Set(allowedOrigins.map(normalizeOrigin).filter(Boolean));
  const proxySet = new Set(trustedProxies.map(normalizeAddress).filter(Boolean));
  const defaultActor = { kind: 'user', id: 'local-owner', source: 'web' };
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
    if (request.method === 'POST') {
      const origin = normalizeOrigin(request.headers.origin);
      if (!origin) return 'ORIGIN_REQUIRED';
      if (!originSet.has(origin)) return 'ORIGIN_NOT_ALLOWED';
    }
    return null;
  }

  async function sessionFor(request) {
    const token = parseCookies(request.headers.cookie).specgate_session;
    const session = token ? sessions.get(token) : null;
    if (!session) return null;
    if (session.expiresAt <= clock()) {
      await removeSession(token);
      return null;
    }
    return { id: token, ...session };
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
    if (!equalSecret(supplied, session.csrfToken)) {
      sendJson(response, 403, failure('CSRF_INVALID', 'CSRF validation failed'));
      return false;
    }
    return true;
  }

  async function sessionRoute(request, response) {
    if (request.method === 'GET') {
      const session = await requireSession(request, response);
      if (!session) return;
      sendJson(response, 200, {
        ok: true,
        csrfToken: session.csrfToken,
        expiresAt: new Date(session.expiresAt).toISOString(),
        actor: session.actor,
      });
      return;
    }
    if (request.method !== 'POST') return methodFailure(response, ['GET', 'POST']);
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
    const secure =
      secureCookie ||
      request.socket.encrypted ||
      (trustProxyHttps && request.headers['x-forwarded-proto'] === 'https')
        ? '; Secure'
        : '';
    response.setHeader(
      'Set-Cookie',
      `specgate_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(
        sessionTtlMs / 1000,
      )}${secure}`,
    );
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
    else result = failure('NOT_FOUND', 'Management route does not exist');
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
    if (body.stepUpCode !== undefined) {
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
      if (pathname === '/api/session') return await sessionRoute(request, response);
      if (MUTATIONS.has(pathname)) return await mutationRoute(request, response, pathname);
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
