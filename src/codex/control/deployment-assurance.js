const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);
const HASH = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40,64}$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SERVICE_USER = /^[a-z_][a-z0-9_-]{0,31}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ABSOLUTE_PATH = /^\/(?:[^/\0]+\/?)+$/;
const DNS_HOST =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_COUNT = 1_000_000_000;
const MAX_AGE_SECONDS = 10 * 365 * 24 * 60 * 60;
const REQUIRED_SECURITY_DRILLS = Object.freeze([
  'link_forwarding',
  'token_leak',
  'replay',
  'disconnect',
]);
const REQUIRED_EXTERNAL_CHECKS = Object.freeze([
  'cloud_deployment',
  'https_proxy',
  'production_binlog_backup',
  'real_pilot',
]);

export const RELEASE_STATUSES = Object.freeze({
  PASS: 'PASS',
  PARTIAL: 'PARTIAL',
  BLOCKED: 'BLOCKED',
});

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const blocker = (code, field, message, severity = 'blocking') => ({
  code,
  field,
  message,
  severity,
});

const resultFailure = (blockers) => ({
  ok: false,
  code: 'DEPLOYMENT_MANIFEST_INVALID',
  blockers,
  manifest: null,
});

const present = (value) => value !== undefined && value !== null && value !== '';
const firstPresent = (...values) => values.find(present);
const normalizedStatus = (value) =>
  typeof value === 'string' ? value.trim().toUpperCase().replaceAll('-', '_') : '';

function validIso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function currentTime(clock) {
  const value = typeof clock === 'function' ? clock() : Date.now();
  const parsed =
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError('clock must return a valid timestamp');
  return parsed;
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(MAX_COUNT, value) : 0;
}

function safeAgeSeconds(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(MAX_AGE_SECONDS, value) : null;
}

function ageSeconds(value, now) {
  const timestamp = validIso(value);
  if (!timestamp) return null;
  return Math.max(0, Math.min(MAX_AGE_SECONDS, Math.floor((now - Date.parse(timestamp)) / 1000)));
}

function normalizeHostList(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  const hosts = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > 255 || /[*\s/@\\]/.test(entry)) return null;
    try {
      const parsed = new URL(`https://${entry}`);
      if (
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      ) {
        return null;
      }
      hosts.push(parsed.host.toLowerCase());
    } catch {
      return null;
    }
  }
  return [...new Set(hosts)];
}

function normalizeOriginList(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  const origins = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > 2048) return null;
    try {
      const parsed = new URL(entry);
      if (
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      ) {
        return null;
      }
      origins.push(parsed.origin);
    } catch {
      return null;
    }
  }
  return [...new Set(origins)];
}

function normalizeTrustedProxies(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  const proxies = [];
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    const normalized = entry.trim().toLowerCase();
    if (normalized === '::1' || normalized === '127.0.0.1') {
      proxies.push(normalized);
      continue;
    }
    if (normalized === '127.0.0.0/8' || normalized === '::1/128') {
      proxies.push(normalized);
      continue;
    }
    return null;
  }
  return [...new Set(proxies)];
}

function normalizeBackupMode(value) {
  if (typeof value !== 'string' || !/^(?:0?[0-7]{3,4})$/.test(value)) return null;
  const parsed = Number.parseInt(value, 8);
  return parsed === 0o700 ? '0700' : null;
}

function normalizeAuthKey(value) {
  if (typeof value !== 'string' || value.length > 256 || /\s/.test(value)) return false;
  return HASH.test(value) || /^[A-Za-z0-9+/]{43}=?$/.test(value);
}

function normalizeTarget(value, maximum, fallback) {
  const candidate = value === undefined ? fallback : value;
  return Number.isSafeInteger(candidate) && candidate > 0 && candidate <= maximum
    ? candidate
    : null;
}

function manifestInput(input) {
  const auth = isPlainObject(input.auth) ? input.auth : {};
  const deployment = isPlainObject(input.deployment) ? input.deployment : {};
  const release = isPlainObject(input.release) ? input.release : {};
  const security = isPlainObject(input.security) ? input.security : {};
  const device = isPlainObject(input.deviceConfirmation)
    ? input.deviceConfirmation
    : isPlainObject(security.deviceConfirmation)
      ? security.deviceConfirmation
      : isPlainObject(auth.deviceConfirmation)
        ? auth.deviceConfirmation
        : {};
  const backup = isPlainObject(input.backup) ? input.backup : {};
  const database = isPlainObject(input.database) ? input.database : {};
  const service = isPlainObject(input.service) ? input.service : {};
  const targets = isPlainObject(input.targets) ? input.targets : {};
  return {
    deploymentMode: firstPresent(input.deploymentMode, deployment.mode),
    publicUrl: firstPresent(input.publicUrl, input.managementPublicUrl, deployment.publicUrl),
    allowedHosts: firstPresent(
      input.allowedHosts,
      input.managementAllowedHosts,
      deployment.allowedHosts,
    ),
    allowedOrigins: firstPresent(
      input.allowedOrigins,
      input.managementAllowedOrigins,
      deployment.allowedOrigins,
    ),
    trustedProxies: firstPresent(
      input.trustedProxies,
      input.managementTrustedProxies,
      deployment.trustedProxies,
    ),
    bindHost: firstPresent(
      input.bindHost,
      input.managementBindHost,
      input.host,
      deployment.bindHost,
    ),
    secureCookie: firstPresent(
      input.secureCookie,
      input.managementSecureCookie,
      deployment.secureCookie,
    ),
    mysqlConfigPath: firstPresent(
      input.mysqlConfigPath,
      input.mysqlConfig,
      database.mysqlConfigPath,
      database.configPath,
      database.config,
    ),
    authEncryptionKey: firstPresent(
      input.authEncryptionKey,
      input.encryptionKey,
      auth.encryptionKey,
    ),
    deviceConfirmationRequired: firstPresent(
      input.deviceConfirmationRequired,
      device.required,
      auth.deviceConfirmationRequired,
    ),
    deviceConfirmationCodeHash: firstPresent(
      input.deviceConfirmationCodeHash,
      device.codeHash,
      auth.deviceConfirmationCodeHash,
    ),
    serviceUser: firstPresent(input.serviceUser, service.user, deployment.serviceUser),
    backupDirectory: firstPresent(input.backupDirectory, backup.directory),
    backupPermissions: firstPresent(input.backupPermissions, backup.mode, backup.permissions),
    version: firstPresent(input.version, input.packageVersion, release.version),
    commit: firstPresent(input.commit, input.gitCommit, release.commit),
    rpoMinutes: firstPresent(
      input.rpoMinutes,
      input.rpoTargetMinutes,
      targets.rpoMinutes,
      backup.rpoMinutes,
    ),
    rtoMinutes: firstPresent(
      input.rtoMinutes,
      input.rtoTargetMinutes,
      targets.rtoMinutes,
      backup.rtoMinutes,
    ),
    verificationMaxAgeHours: firstPresent(
      input.verificationMaxAgeHours,
      targets.verificationMaxAgeHours,
    ),
    backupVerificationMaxAgeHours: firstPresent(
      input.backupVerificationMaxAgeHours,
      targets.backupVerificationMaxAgeHours,
    ),
    pilotVerificationMaxAgeHours: firstPresent(
      input.pilotVerificationMaxAgeHours,
      targets.pilotVerificationMaxAgeHours,
    ),
  };
}

/**
 * Validates the immutable single-host remote deployment contract. Secret
 * material is checked but never copied into the returned manifest or errors.
 */
export function validateDeploymentManifest(input) {
  if (!isPlainObject(input)) {
    return resultFailure([
      blocker(
        'DEPLOYMENT_MANIFEST_REQUIRED',
        'manifest',
        'A deployment manifest object is required',
      ),
    ]);
  }

  const value = manifestInput(input);
  const blockers = [];
  const add = (code, field, message) => {
    blockers.push(blocker(code, field, message));
  };

  if (value.deploymentMode !== 'remote') {
    add('DEPLOYMENT_MODE_INVALID', 'deploymentMode', 'Remote deployment mode must be explicit');
  }

  let publicUrl = null;
  try {
    publicUrl = new URL(value.publicUrl);
    if (
      publicUrl.protocol !== 'https:' ||
      publicUrl.username ||
      publicUrl.password ||
      publicUrl.pathname !== '/' ||
      publicUrl.search ||
      publicUrl.hash ||
      !DNS_HOST.test(publicUrl.hostname) ||
      publicUrl.hostname.toLowerCase() === 'localhost'
    ) {
      publicUrl = null;
    }
  } catch {
    publicUrl = null;
  }
  if (!publicUrl) {
    add(
      'DEPLOYMENT_PUBLIC_URL_INSECURE',
      'publicUrl',
      'An explicit public HTTPS URL with a public DNS host is required',
    );
  }

  const allowedHosts = normalizeHostList(value.allowedHosts);
  if (!allowedHosts) {
    add(
      'DEPLOYMENT_ALLOWED_HOSTS_INVALID',
      'allowedHosts',
      'An explicit Host allowlist without wildcards is required',
    );
  } else if (publicUrl && !allowedHosts.includes(publicUrl.host.toLowerCase())) {
    add(
      'DEPLOYMENT_ALLOWED_HOSTS_MISMATCH',
      'allowedHosts',
      'The Host allowlist must include the public URL host',
    );
  }

  const allowedOrigins = normalizeOriginList(value.allowedOrigins);
  if (!allowedOrigins) {
    add(
      'DEPLOYMENT_ALLOWED_ORIGINS_INVALID',
      'allowedOrigins',
      'An explicit HTTPS Origin allowlist is required',
    );
  } else if (publicUrl && !allowedOrigins.includes(publicUrl.origin)) {
    add(
      'DEPLOYMENT_ALLOWED_ORIGINS_MISMATCH',
      'allowedOrigins',
      'The Origin allowlist must include the public URL origin',
    );
  }

  const trustedProxies = normalizeTrustedProxies(value.trustedProxies);
  if (!trustedProxies) {
    add(
      'DEPLOYMENT_TRUSTED_PROXY_INVALID',
      'trustedProxies',
      'Only explicit loopback reverse proxies are trusted',
    );
  }

  if (typeof value.bindHost !== 'string' || !LOOPBACK_HOSTS.has(value.bindHost)) {
    add(
      'DEPLOYMENT_BIND_NOT_LOOPBACK',
      'bindHost',
      'The management service must bind to a loopback address',
    );
  }

  if (value.secureCookie !== true) {
    add(
      'DEPLOYMENT_SECURE_COOKIE_REQUIRED',
      'secureCookie',
      'Remote mode requires Secure, HttpOnly, SameSite cookies',
    );
  }

  if (
    typeof value.mysqlConfigPath !== 'string' ||
    !ABSOLUTE_PATH.test(value.mysqlConfigPath) ||
    value.mysqlConfigPath.split('/').includes('..')
  ) {
    add(
      'DEPLOYMENT_MYSQL_CONFIG_PATH_INVALID',
      'mysqlConfigPath',
      'An absolute MySQL option file path is required',
    );
  }

  if (!normalizeAuthKey(value.authEncryptionKey)) {
    add(
      'DEPLOYMENT_AUTH_KEY_INVALID',
      'authEncryptionKey',
      'A 32-byte authentication encryption key is required',
    );
  }

  if (
    value.deviceConfirmationRequired !== true ||
    typeof value.deviceConfirmationCodeHash !== 'string' ||
    !HASH.test(value.deviceConfirmationCodeHash)
  ) {
    add(
      'DEPLOYMENT_DEVICE_CONFIRMATION_INVALID',
      'deviceConfirmation',
      'Device confirmation and its SHA-256 code hash must be configured',
    );
  }

  if (
    typeof value.serviceUser !== 'string' ||
    !SERVICE_USER.test(value.serviceUser) ||
    ['root', 'daemon', 'bin', 'sys', 'nobody'].includes(value.serviceUser)
  ) {
    add(
      'DEPLOYMENT_SERVICE_USER_INVALID',
      'serviceUser',
      'A dedicated non-root service user is required',
    );
  }

  if (
    typeof value.backupDirectory !== 'string' ||
    !ABSOLUTE_PATH.test(value.backupDirectory) ||
    value.backupDirectory === '/' ||
    value.backupDirectory.split('/').includes('..')
  ) {
    add(
      'DEPLOYMENT_BACKUP_DIRECTORY_INVALID',
      'backupDirectory',
      'An absolute, non-root backup directory is required',
    );
  }

  const backupPermissions = normalizeBackupMode(value.backupPermissions);
  if (!backupPermissions) {
    add(
      'DEPLOYMENT_BACKUP_PERMISSIONS_INVALID',
      'backupPermissions',
      'The backup directory must use owner-only 0700 permissions',
    );
  }

  if (typeof value.version !== 'string' || !VERSION.test(value.version)) {
    add('DEPLOYMENT_VERSION_INVALID', 'version', 'A semantic release version is required');
  }
  if (typeof value.commit !== 'string' || !COMMIT.test(value.commit)) {
    add('DEPLOYMENT_COMMIT_INVALID', 'commit', 'A full Git commit identifier is required');
  }

  const rpoMinutes = normalizeTarget(value.rpoMinutes, 15, 15);
  const rtoMinutes = normalizeTarget(value.rtoMinutes, 120, 120);
  if (rpoMinutes === null) {
    add('DEPLOYMENT_RPO_INVALID', 'rpoMinutes', 'RPO must be between 1 and 15 minutes');
  }
  if (rtoMinutes === null) {
    add('DEPLOYMENT_RTO_INVALID', 'rtoMinutes', 'RTO must be between 1 and 120 minutes');
  }

  const verificationMaxAgeHours = normalizeTarget(value.verificationMaxAgeHours, 168, 24);
  const backupVerificationMaxAgeHours = normalizeTarget(
    value.backupVerificationMaxAgeHours,
    720,
    168,
  );
  const pilotVerificationMaxAgeHours = normalizeTarget(
    value.pilotVerificationMaxAgeHours,
    720,
    168,
  );
  if (verificationMaxAgeHours === null || backupVerificationMaxAgeHours === null) {
    add(
      'DEPLOYMENT_VERIFICATION_WINDOW_INVALID',
      'verificationMaxAgeHours',
      'Verification freshness windows must be positive and bounded',
    );
  }
  if (pilotVerificationMaxAgeHours === null) {
    add(
      'DEPLOYMENT_PILOT_WINDOW_INVALID',
      'pilotVerificationMaxAgeHours',
      'Pilot freshness window must be positive and bounded',
    );
  }

  if (blockers.length > 0) return resultFailure(blockers);

  return {
    ok: true,
    code: null,
    blockers: [],
    manifest: {
      deploymentMode: 'remote',
      publicUrl: publicUrl.origin,
      allowedHosts,
      allowedOrigins,
      trustedProxies,
      bindHost: value.bindHost,
      secureCookie: true,
      mysqlConfigPath: value.mysqlConfigPath,
      authEncryptionConfigured: true,
      deviceConfirmationConfigured: true,
      serviceUser: value.serviceUser,
      backupDirectory: value.backupDirectory,
      backupPermissions,
      version: value.version,
      commit: value.commit.toLowerCase(),
      targets: {
        rpoMinutes,
        rtoMinutes,
        verificationMaxAgeHours,
        backupVerificationMaxAgeHours,
        pilotVerificationMaxAgeHours,
      },
    },
  };
}

function safeUnexecuted(entries) {
  if (!Array.isArray(entries)) return null;
  return entries.slice(0, 500).flatMap((entry) => {
    if (typeof entry === 'string' && SAFE_ID.test(entry)) {
      return [{ checkId: entry, status: 'NOT_RUN' }];
    }
    if (!isPlainObject(entry)) return [];
    const checkId = entry.checkId ?? entry.id ?? entry.name;
    if (typeof checkId !== 'string' || !SAFE_ID.test(checkId)) return [];
    return [
      {
        checkId,
        status: normalizedStatus(entry.status) || 'NOT_RUN',
        reasonCode:
          typeof entry.reasonCode === 'string' && SAFE_ID.test(entry.reasonCode)
            ? entry.reasonCode
            : 'NOT_RUN',
      },
    ];
  });
}

function staleOrFuture(timestamp, now, maximumAgeHours) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return 'missing';
  if (parsed - now > MAX_FUTURE_SKEW_MS) return 'future';
  return now - parsed > maximumAgeHours * 60 * 60 * 1000 ? 'stale' : 'fresh';
}

function realEvidence(value) {
  if (value?.real === false) return false;
  if (value?.real === true) return true;
  const marker = normalizedStatus(
    value?.source ?? value?.mode ?? value?.environment ?? '',
  ).toLowerCase();
  return ['REAL', 'PRODUCTION', 'CLOUD', 'DEPLOYED', 'REAL_CLOUD', 'REAL_PRODUCTION'].includes(
    marker,
  );
}

function externalCheckKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = normalizedStatus(value).toLowerCase();
  if (
    ['cloud_deployment', 'deployment', 'real_cloud', 'real_cloud_deployment'].includes(normalized)
  ) {
    return 'cloud_deployment';
  }
  if (['https_proxy', 'proxy', 'real_https_proxy', 'public_https'].includes(normalized)) {
    return 'https_proxy';
  }
  if (
    [
      'production_binlog_backup',
      'binlog_backup',
      'production_backup',
      'mysql_backup_restore',
    ].includes(normalized)
  ) {
    return 'production_binlog_backup';
  }
  if (['real_pilot', 'pilot', 'cloud_pilot', 'production_pilot'].includes(normalized)) {
    return 'real_pilot';
  }
  return null;
}

function verifyEvidence(evidence, manifest, now) {
  if (!isPlainObject(evidence) || normalizedStatus(evidence.status) === 'NOT_RUN') {
    return {
      status: RELEASE_STATUSES.PARTIAL,
      blockers: [
        blocker(
          'RELEASE_VERIFICATION_NOT_RUN',
          'evidence',
          'Fresh deployment verification evidence has not been recorded',
          'incomplete',
        ),
      ],
      unexecuted: [],
    };
  }
  const blockers = [];
  if (!realEvidence(evidence)) {
    blockers.push(
      blocker(
        'RELEASE_VERIFICATION_NOT_REAL',
        'evidence.real',
        'Release verification must come from a real deployment',
        'incomplete',
      ),
    );
  }
  const status = normalizedStatus(evidence.status);
  if (!['PASS', 'PASSED', 'OK'].includes(status)) {
    blockers.push(
      blocker(
        status ? 'RELEASE_VERIFICATION_FAILED' : 'RELEASE_VERIFICATION_STATUS_MISSING',
        'evidence.status',
        status
          ? 'Deployment verification did not pass'
          : 'Deployment verification status is required',
        status ? 'blocking' : 'incomplete',
      ),
    );
  }
  const executedAt = validIso(evidence.executedAt ?? evidence.completedAt);
  if (!executedAt) {
    blockers.push(
      blocker(
        'RELEASE_VERIFICATION_TIME_MISSING',
        'evidence.executedAt',
        'Verification execution time is required',
        'incomplete',
      ),
    );
  } else {
    const freshness = staleOrFuture(executedAt, now, manifest.targets.verificationMaxAgeHours);
    if (freshness === 'stale') {
      blockers.push(
        blocker(
          'RELEASE_VERIFICATION_STALE',
          'evidence.executedAt',
          'Deployment verification evidence is stale',
        ),
      );
    } else if (freshness === 'future') {
      blockers.push(
        blocker(
          'RELEASE_VERIFICATION_TIME_INVALID',
          'evidence.executedAt',
          'Deployment verification time is in the future',
        ),
      );
    }
  }
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  if (checks.length === 0) {
    blockers.push(
      blocker(
        'RELEASE_VERIFICATION_CHECKS_MISSING',
        'evidence.checks',
        'Executed verification checks and command evidence are required',
        'incomplete',
      ),
    );
  }
  for (const check of checks.slice(0, 500)) {
    const id = isPlainObject(check) ? (check.id ?? check.name) : null;
    if (typeof id !== 'string' || !SAFE_ID.test(id)) {
      blockers.push(
        blocker(
          'RELEASE_VERIFICATION_CHECK_INVALID',
          'evidence.checks',
          'Verification checks must have stable identifiers',
        ),
      );
      continue;
    }
    if (
      check.executed === false ||
      !['PASS', 'PASSED', 'OK'].includes(normalizedStatus(check.status))
    ) {
      blockers.push(
        blocker(
          'RELEASE_VERIFICATION_CHECK_FAILED',
          'evidence.checks',
          'Every declared verification check must execute and pass',
        ),
      );
      continue;
    }
    const command = check.command ?? check.commandLine;
    const outputHash = check.outputHash ?? check.evidenceHash ?? check.evidence;
    if (
      (typeof command !== 'string' || command.trim().length === 0) &&
      (typeof outputHash !== 'string' || !/^[a-f0-9]{64}$/i.test(outputHash))
    ) {
      blockers.push(
        blocker(
          'RELEASE_VERIFICATION_EVIDENCE_MISSING',
          'evidence.checks',
          'Each verification check needs a command or evidence hash',
        ),
      );
    }
  }
  const unexecuted = safeUnexecuted(evidence.unexecutedChecks ?? evidence.unexecuted);
  if (unexecuted === null) {
    blockers.push(
      blocker(
        'RELEASE_UNEXECUTED_CHECKS_UNRECORDED',
        'evidence.unexecutedChecks',
        'The manifest of unexecuted checks must be explicit',
        'incomplete',
      ),
    );
  }
  return {
    status: blockers.length ? RELEASE_STATUSES.PARTIAL : RELEASE_STATUSES.PASS,
    blockers,
    unexecuted: unexecuted ?? [],
  };
}

function verifyBackup(report, manifest, now) {
  if (!isPlainObject(report) || normalizedStatus(report.status) === 'NOT_RUN') {
    return {
      status: RELEASE_STATUSES.PARTIAL,
      blockers: [
        blocker(
          'RELEASE_BACKUP_NOT_RUN',
          'backupReport',
          'A real MySQL backup and restore drill has not been recorded',
          'incomplete',
        ),
      ],
      unexecuted: [],
    };
  }
  const blockers = [];
  const status = normalizedStatus(report.status);
  if (status === 'FAILED' || report.ok === false) {
    blockers.push(
      blocker(
        'RELEASE_BACKUP_FAILED',
        'backupReport.status',
        'The MySQL backup or restore drill failed',
      ),
    );
  }
  if (!realEvidence(report)) {
    blockers.push(
      blocker(
        'RELEASE_BACKUP_NOT_REAL',
        'backupReport.real',
        'Backup evidence must come from a real MySQL instance',
        'incomplete',
      ),
    );
  }
  if (report.restoreVerified !== true && report.restorePassed !== true) {
    blockers.push(
      blocker(
        'RELEASE_BACKUP_RESTORE_UNVERIFIED',
        'backupReport.restoreVerified',
        'Restore verification is required',
      ),
    );
  }
  if (report.checksumVerified !== true && report.checksumPassed !== true) {
    blockers.push(
      blocker(
        'RELEASE_BACKUP_CHECKSUM_UNVERIFIED',
        'backupReport.checksumVerified',
        'Backup checksum verification is required',
      ),
    );
  }
  const binlogStatus = normalizedStatus(report.binlog?.status ?? report.binlogStatus);
  const productionBinlog =
    report.productionBinlog === true ||
    report.binlogVerified === true ||
    report.binlog?.production === true ||
    ['PASS', 'PASSED', 'OK', 'ENABLED', 'VERIFIED'].includes(binlogStatus);
  if (!productionBinlog) {
    blockers.push(
      blocker(
        'RELEASE_BINLOG_NOT_VERIFIED',
        'backupReport.productionBinlog',
        'Production binlog backup coordinates must be verified',
      ),
    );
  }
  const rpo =
    report.measuredRpoMinutes ??
    report.rpoMinutes ??
    (Number.isFinite(report.measuredRpoSeconds) ? report.measuredRpoSeconds / 60 : undefined);
  const rto =
    report.measuredRtoMinutes ??
    report.rtoMinutes ??
    (Number.isFinite(report.measuredRtoSeconds) ? report.measuredRtoSeconds / 60 : undefined);
  if (!Number.isFinite(rpo) || rpo < 0) {
    blockers.push(
      blocker(
        'RELEASE_RPO_NOT_MEASURED',
        'backupReport.measuredRpoMinutes',
        'Measured RPO is required',
      ),
    );
  } else if (rpo > manifest.targets.rpoMinutes) {
    blockers.push(
      blocker(
        'RELEASE_RPO_EXCEEDED',
        'backupReport.measuredRpoMinutes',
        'Measured RPO exceeds the approved target',
      ),
    );
  }
  if (!Number.isFinite(rto) || rto < 0) {
    blockers.push(
      blocker(
        'RELEASE_RTO_NOT_MEASURED',
        'backupReport.measuredRtoMinutes',
        'Measured RTO is required',
      ),
    );
  } else if (rto > manifest.targets.rtoMinutes) {
    blockers.push(
      blocker(
        'RELEASE_RTO_EXCEEDED',
        'backupReport.measuredRtoMinutes',
        'Measured RTO exceeds the approved target',
      ),
    );
  }
  const restoredAt = validIso(report.restoredAt ?? report.measuredAt ?? report.completedAt);
  if (!restoredAt) {
    blockers.push(
      blocker(
        'RELEASE_BACKUP_TIME_MISSING',
        'backupReport.restoredAt',
        'Backup restore completion time is required',
        'incomplete',
      ),
    );
  } else {
    const freshness = staleOrFuture(
      restoredAt,
      now,
      manifest.targets.backupVerificationMaxAgeHours,
    );
    if (freshness !== 'fresh') {
      blockers.push(
        blocker(
          'RELEASE_BACKUP_EVIDENCE_STALE',
          'backupReport.restoredAt',
          'Backup restore evidence is missing, stale, or invalid',
        ),
      );
    }
  }
  const unexecuted = safeUnexecuted(report.unexecutedChecks ?? report.unexecuted);
  return {
    status: blockers.length ? RELEASE_STATUSES.BLOCKED : RELEASE_STATUSES.PASS,
    blockers,
    unexecuted: unexecuted ?? [],
  };
}

function drillKey(value) {
  const normalized = normalizedStatus(value).toLowerCase();
  if (['link_forwarding', 'forwarded_link', 'link_forward'].includes(normalized)) {
    return 'link_forwarding';
  }
  if (['token_leak', 'token_leakage', 'leaked_token'].includes(normalized)) {
    return 'token_leak';
  }
  if (['replay', 'replay_attack'].includes(normalized)) return 'replay';
  if (['disconnect', 'disconnection', 'offline'].includes(normalized)) return 'disconnect';
  return null;
}

function collectDrills(value) {
  const drills = new Map();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isPlainObject(entry)) continue;
      const key = drillKey(entry.name ?? entry.id ?? entry.type);
      if (key) drills.set(key, entry);
    }
    return drills;
  }
  if (isPlainObject(value)) {
    for (const [name, entry] of Object.entries(value)) {
      const key = drillKey(name);
      if (!key) continue;
      if (isPlainObject(entry)) drills.set(key, { name, ...entry });
      else if (typeof entry === 'string') drills.set(key, { name, status: entry });
    }
  }
  return drills;
}

function verifySecurityDrills(securityDrills) {
  if (!isPlainObject(securityDrills) || normalizedStatus(securityDrills.status) === 'NOT_RUN') {
    return {
      status: RELEASE_STATUSES.PARTIAL,
      blockers: [
        blocker(
          'RELEASE_SECURITY_DRILLS_NOT_RUN',
          'securityDrills',
          'Real security drills have not been recorded',
          'incomplete',
        ),
      ],
      unexecuted: [],
    };
  }
  const blockers = [];
  const status = normalizedStatus(securityDrills.status);
  if (status === 'FAILED' || securityDrills.ok === false) {
    blockers.push(
      blocker(
        'RELEASE_SECURITY_DRILLS_FAILED',
        'securityDrills.status',
        'One or more security drills failed',
      ),
    );
  }
  if (!realEvidence(securityDrills)) {
    blockers.push(
      blocker(
        'RELEASE_SECURITY_DRILLS_NOT_REAL',
        'securityDrills.real',
        'Security drills must run against a real deployment',
        'incomplete',
      ),
    );
  }
  const drills = collectDrills(
    securityDrills.drills ?? securityDrills.results ?? securityDrills.checks,
  );
  const missing = [];
  for (const required of REQUIRED_SECURITY_DRILLS) {
    const drill = drills.get(required);
    if (!drill) {
      missing.push(required);
      continue;
    }
    if (
      drill.executed === false ||
      !['PASS', 'PASSED', 'OK'].includes(normalizedStatus(drill.status))
    ) {
      blockers.push(
        blocker(
          'RELEASE_SECURITY_DRILL_FAILED',
          'securityDrills.drills',
          `Required security drill ${required} did not pass`,
        ),
      );
    }
  }
  if (missing.length > 0) {
    blockers.push(
      blocker(
        'RELEASE_SECURITY_DRILLS_INCOMPLETE',
        'securityDrills.drills',
        `Required security drills are missing: ${missing.join(', ')}`,
        'incomplete',
      ),
    );
  }
  const unexecuted = safeUnexecuted(securityDrills.unexecutedChecks ?? securityDrills.unexecuted);
  const blocking = blockers.some((entry) => entry.severity === 'blocking');
  return {
    status: blocking
      ? RELEASE_STATUSES.BLOCKED
      : blockers.length
        ? RELEASE_STATUSES.PARTIAL
        : RELEASE_STATUSES.PASS,
    blockers,
    unexecuted: unexecuted ?? [],
  };
}

function verifyPilot(pilot, manifest, now) {
  if (!isPlainObject(pilot) || normalizedStatus(pilot.status) === 'NOT_RUN') {
    return {
      status: RELEASE_STATUSES.PARTIAL,
      blockers: [
        blocker(
          'RELEASE_PILOT_NOT_RUN',
          'pilot',
          'A real single-worker pilot has not completed',
          'incomplete',
        ),
      ],
      unexecuted: [],
    };
  }
  const blockers = [];
  const status = normalizedStatus(pilot.status);
  if (status === 'FAILED' || pilot.ok === false) {
    blockers.push(blocker('RELEASE_PILOT_FAILED', 'pilot.status', 'The real pilot failed'));
  }
  if (!realEvidence(pilot)) {
    blockers.push(
      blocker(
        'RELEASE_PILOT_NOT_REAL',
        'pilot.real',
        'Pilot completion must come from a real deployment',
        'incomplete',
      ),
    );
  }
  if (!['COMPLETE', 'COMPLETED', 'PASS', 'PASSED'].includes(status)) {
    blockers.push(
      blocker(
        'RELEASE_PILOT_STATUS_INVALID',
        'pilot.status',
        'Pilot must be explicitly marked complete',
        'incomplete',
      ),
    );
  }
  const completedAt = validIso(pilot.completedAt ?? pilot.finishedAt);
  if (!completedAt) {
    blockers.push(
      blocker(
        'RELEASE_PILOT_TIME_MISSING',
        'pilot.completedAt',
        'Pilot completion time is required',
        'incomplete',
      ),
    );
  } else {
    const freshness = staleOrFuture(
      completedAt,
      now,
      manifest.targets.pilotVerificationMaxAgeHours,
    );
    if (freshness !== 'fresh') {
      blockers.push(
        blocker(
          'RELEASE_PILOT_EVIDENCE_STALE',
          'pilot.completedAt',
          'Pilot evidence is missing, stale, or invalid',
        ),
      );
    }
  }
  let cloudUrl = null;
  try {
    cloudUrl = new URL(pilot.cloudUrl).origin;
  } catch {
    cloudUrl = null;
  }
  if (cloudUrl !== manifest.publicUrl) {
    blockers.push(
      blocker(
        'RELEASE_PILOT_CLOUD_MISMATCH',
        'pilot.cloudUrl',
        'Pilot evidence must match the approved cloud origin',
      ),
    );
  }
  const projectCount = Array.isArray(pilot.projects) ? pilot.projects.length : pilot.projects;
  if (!Number.isSafeInteger(projectCount) || projectCount < 2) {
    blockers.push(
      blocker(
        'RELEASE_PILOT_MULTI_PROJECT_MISSING',
        'pilot.projects',
        'The pilot must cover at least two projects',
      ),
    );
  }
  const workerCount = Array.isArray(pilot.workers) ? pilot.workers.length : pilot.workerCount;
  if (workerCount !== 1) {
    blockers.push(
      blocker(
        'RELEASE_PILOT_WORKER_COUNT_INVALID',
        'pilot.workerCount',
        'The first release pilot must use exactly one Worker',
      ),
    );
  }
  const channels = isPlainObject(pilot.channels) ? pilot.channels : {};
  const channelPassed = (value) =>
    value === true || (isPlainObject(value) && (value.delivered === true || value.passed === true));
  if (pilot.feishu !== true && !channelPassed(channels.feishu)) {
    blockers.push(
      blocker(
        'RELEASE_PILOT_FEISHU_MISSING',
        'pilot.channels.feishu',
        'The pilot must verify Feishu delivery',
      ),
    );
  }
  if (pilot.dingtalk !== true && !channelPassed(channels.dingtalk)) {
    blockers.push(
      blocker(
        'RELEASE_PILOT_DINGTALK_MISSING',
        'pilot.channels.dingtalk',
        'The pilot must verify DingTalk delivery',
      ),
    );
  }
  for (const [field, code, alias] of [
    ['decision', 'RELEASE_PILOT_DECISION_MISSING', 'decisionApplied'],
    ['recovery', 'RELEASE_PILOT_RECOVERY_MISSING', 'sessionResumed'],
    ['redelivery', 'RELEASE_PILOT_REDELIVERY_MISSING', 'redelivered'],
  ]) {
    const value =
      pilot[field] ?? pilot[alias] ?? pilot.outcomes?.[field] ?? pilot.outcomes?.[alias];
    if (value !== true) {
      blockers.push(blocker(code, `pilot.${field}`, `The pilot must verify ${field}`));
    }
  }
  const unexecuted = safeUnexecuted(pilot.unexecutedChecks ?? pilot.unexecuted);
  if (unexecuted === null) {
    blockers.push(
      blocker(
        'RELEASE_PILOT_UNEXECUTED_UNRECORDED',
        'pilot.unexecutedChecks',
        'Pilot unexecuted checks must be explicit',
        'incomplete',
      ),
    );
  }
  const blocking = blockers.some((entry) => entry.severity === 'blocking');
  return {
    status: blocking
      ? RELEASE_STATUSES.BLOCKED
      : blockers.length
        ? RELEASE_STATUSES.PARTIAL
        : RELEASE_STATUSES.PASS,
    blockers,
    unexecuted: unexecuted ?? [],
  };
}

/**
 * Combines independent evidence into a fail-closed release decision. Missing
 * external evidence is PARTIAL; contradictory or unsafe evidence is BLOCKED.
 */
export function createReleaseCheck({
  manifest,
  evidence,
  backupReport,
  securityDrills,
  pilot,
  clock = Date.now,
} = {}) {
  const now = currentTime(clock);
  const validated = validateDeploymentManifest(manifest);
  if (!validated.ok) {
    return {
      ok: false,
      status: RELEASE_STATUSES.BLOCKED,
      code: 'RELEASE_MANIFEST_BLOCKED',
      blockers: validated.blockers,
      checks: {
        manifest: {
          status: RELEASE_STATUSES.BLOCKED,
          blockers: validated.blockers,
        },
        verification: null,
        backup: null,
        security: null,
        pilot: null,
      },
      unexecuted: [],
      generatedAt: new Date(now).toISOString(),
    };
  }

  const verification = verifyEvidence(evidence, validated.manifest, now);
  const backup = verifyBackup(backupReport, validated.manifest, now);
  const security = verifySecurityDrills(securityDrills);
  const pilotResult = verifyPilot(pilot, validated.manifest, now);
  const sections = { verification, backup, security, pilot: pilotResult };
  const blockers = Object.values(sections).flatMap((section) => section.blockers);
  const status = blockers.some((entry) => entry.severity === 'blocking')
    ? RELEASE_STATUSES.BLOCKED
    : blockers.length
      ? RELEASE_STATUSES.PARTIAL
      : Object.values(sections).every((section) => section.status === RELEASE_STATUSES.PASS)
        ? RELEASE_STATUSES.PASS
        : RELEASE_STATUSES.PARTIAL;
  const unexecuted = Object.values(sections).flatMap((section) => section.unexecuted);
  const requiredNotRun = new Set(
    unexecuted.map((entry) => externalCheckKey(entry.checkId)).filter(Boolean),
  );
  for (const checkId of REQUIRED_EXTERNAL_CHECKS) {
    if (requiredNotRun.has(checkId)) {
      blockers.push(
        blocker(
          'RELEASE_REQUIRED_EXTERNAL_CHECK_NOT_RUN',
          `unexecutedChecks.${checkId}`,
          `Required external check ${checkId} is marked NOT_RUN`,
          'incomplete',
        ),
      );
    }
  }
  const finalStatus = blockers.some((entry) => entry.severity === 'blocking')
    ? RELEASE_STATUSES.BLOCKED
    : blockers.length || status !== RELEASE_STATUSES.PASS
      ? RELEASE_STATUSES.PARTIAL
      : RELEASE_STATUSES.PASS;

  return {
    ok: finalStatus === RELEASE_STATUSES.PASS,
    status: finalStatus,
    code: finalStatus === RELEASE_STATUSES.PASS ? null : `RELEASE_${finalStatus}`,
    blockers,
    checks: {
      manifest: {
        status: RELEASE_STATUSES.PASS,
        blockers: [],
        version: validated.manifest.version,
        commit: validated.manifest.commit,
      },
      ...sections,
    },
    unexecuted,
    generatedAt: new Date(now).toISOString(),
  };
}

function serviceValue(service, key) {
  return isPlainObject(service) ? service[key] : undefined;
}

function workerCounts(service) {
  const source = serviceValue(service, 'workerCounts') ?? serviceValue(service, 'workers') ?? {};
  if (Array.isArray(source)) {
    let online = 0;
    let offline = 0;
    for (const worker of source.slice(0, 10_000)) {
      if (!isPlainObject(worker)) continue;
      if (['ONLINE', 'ACTIVE'].includes(normalizedStatus(worker.status))) online += 1;
      else offline += 1;
    }
    return { online: safeCount(online), offline: safeCount(offline) };
  }
  return {
    online: safeCount(source.online),
    offline: safeCount(source.offline),
  };
}

function databaseState(service) {
  const source = serviceValue(service, 'database');
  if (!isPlainObject(source)) {
    return {
      up: normalizedStatus(serviceValue(service, 'databaseStatus')) === 'UP',
      ageSeconds: null,
    };
  }
  return {
    up: source.up === true || ['UP', 'HEALTHY', 'READY'].includes(normalizedStatus(source.status)),
    ageSeconds: safeAgeSeconds(
      source.ageSeconds ?? source.backupAgeSeconds ?? source.lastBackupAgeSeconds,
    ),
  };
}

function emptyMetrics(now, unavailable = false) {
  return {
    ok: !unavailable,
    ...(unavailable ? { code: 'METRICS_UNAVAILABLE' } : {}),
    generatedAt: new Date(now).toISOString(),
    process: { up: true, uptimeSeconds: 0 },
    runtime: { up: !unavailable, name: 'node' },
    workers: { online: 0, offline: 0, total: 0 },
    workerOnline: 0,
    workerOffline: 0,
    attention: { pending: 0 },
    pendingAttention: 0,
    notifications: { failed: 0 },
    notificationFailures: 0,
    lastHeartbeat: { at: null, ageSeconds: null },
    lastHeartbeatAt: null,
    database: { up: false, ageSeconds: null },
    databaseUp: false,
    backup: { ageSeconds: null },
    backupAgeSeconds: null,
    processUp: true,
    runtimeUp: !unavailable,
    version: null,
    commit: null,
  };
}

/**
 * Returns a deliberately whitelisted operational snapshot. Service-specific
 * roots, identifiers, credentials, customer labels and error text are dropped.
 */
export async function metricsSnapshot({ service = {}, clock = Date.now } = {}) {
  const now = currentTime(clock);
  let source;
  try {
    if (typeof service === 'function') source = await service();
    else if (typeof service?.getMetrics === 'function') source = await service.getMetrics();
    else if (typeof service?.metrics === 'function') source = await service.metrics();
    else if (typeof service?.snapshot === 'function') source = await service.snapshot();
    else source = service;
  } catch {
    return emptyMetrics(now, true);
  }
  if (!isPlainObject(source)) return emptyMetrics(now, true);

  const workers = workerCounts(source);
  const database = databaseState(source);
  const backupSource = serviceValue(source, 'backup');
  const backupAge = safeAgeSeconds(
    isPlainObject(backupSource)
      ? (backupSource.ageSeconds ?? backupSource.lastBackupAgeSeconds)
      : (backupSource ?? database.ageSeconds),
  );
  const heartbeat =
    source.lastHeartbeatAt ??
    source.lastWorkerHeartbeatAt ??
    source.workers?.lastHeartbeatAt ??
    source.heartbeat?.at;
  const heartbeatAt = validIso(heartbeat);
  const uptime = safeAgeSeconds(
    source.uptimeSeconds ??
      source.process?.uptimeSeconds ??
      (typeof process.uptime === 'function' ? Math.floor(process.uptime()) : 0),
  );
  const runtimeUp =
    source.runtimeUp === true ||
    source.runtime?.up === true ||
    (source.runtimeUp === undefined && source.runtime?.up === undefined && source.ok !== false);
  const version =
    typeof source.version === 'string' && VERSION.test(source.version) ? source.version : null;
  const commit =
    typeof source.commit === 'string' && COMMIT.test(source.commit)
      ? source.commit.toLowerCase()
      : null;
  const processUp = source.processUp !== false && source.process?.up !== false;
  const pendingAttention = safeCount(
    source.pendingAttentionCount ?? source.attentionPending ?? source.attention?.pending,
  );
  const notificationFailures = safeCount(
    source.notificationFailures ?? source.failedNotificationCount ?? source.notifications?.failed,
  );
  return {
    ok: true,
    generatedAt: new Date(now).toISOString(),
    process: {
      up: processUp,
      uptimeSeconds: uptime ?? 0,
    },
    runtime: { up: runtimeUp, name: 'node' },
    workers: {
      ...workers,
      total: Math.min(MAX_COUNT, workers.online + workers.offline),
    },
    workerOnline: workers.online,
    workerOffline: workers.offline,
    attention: {
      pending: pendingAttention,
    },
    pendingAttention,
    notifications: {
      failed: notificationFailures,
    },
    notificationFailures,
    lastHeartbeat: {
      at: heartbeatAt,
      ageSeconds: heartbeatAt ? ageSeconds(heartbeatAt, now) : null,
    },
    lastHeartbeatAt: heartbeatAt,
    database: {
      up: database.up,
      ageSeconds: database.ageSeconds,
    },
    databaseUp: database.up,
    backup: { ageSeconds: backupAge },
    backupAgeSeconds: backupAge,
    processUp,
    runtimeUp,
    version,
    commit,
  };
}
