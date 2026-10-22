import { hashValue } from './events.js';

const failure = (code, message) => ({ ok: false, code, message });

function version(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.version === 'string') return value.version;
  return null;
}

function major(value) {
  const matched = String(value || '').match(/\d+/);
  return matched ? Number(matched[0]) : null;
}

export function createEnvironmentFingerprint({
  environment,
  environmentVariableNames = [],
  externalServices = [],
  configuration = {},
} = {}) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment))
    return failure('ENVIRONMENT_INVALID', 'A verified environment description is required');
  if (
    !Array.isArray(environmentVariableNames) ||
    !environmentVariableNames.every((entry) => typeof entry === 'string') ||
    !Array.isArray(externalServices)
  )
    return failure('ENVIRONMENT_INVALID', 'Environment metadata is invalid');
  const javaVersions = Array.isArray(environment.java)
    ? environment.java.map(version).filter(Boolean).sort().reverse()
    : [version(environment.java)].filter(Boolean);
  const runtimes = {
    java: javaVersions[0] || null,
    node: version(environment.node),
    maven: version(environment.maven),
    npm: version(environment.npm),
  };
  const database = version(environment.database);
  const browser = version(environment.browser);
  const body = {
    schemaVersion: 1,
    os: String(environment.platform || process.platform),
    arch: String(environment.arch || process.arch),
    runtimes,
    packageManager: runtimes.npm ? 'npm' : null,
    database,
    browser,
    environmentVariableNames: [...new Set(environmentVariableNames)].sort(),
    externalServices: externalServices.map((entry) =>
      typeof entry === 'string'
        ? { name: entry, mode: 'unknown' }
        : { name: String(entry?.name || 'unknown'), mode: String(entry?.mode || 'unknown') },
    ),
    configurationHash: hashValue(configuration),
    createdAt: new Date().toISOString(),
  };
  const stableBody = { ...body };
  delete stableBody.createdAt;
  const fingerprint = {
    fingerprintId: hashValue(stableBody),
    ...body,
    majorVersions: {
      java: major(runtimes.java),
      node: major(runtimes.node),
      database: major(database),
      browser: major(browser),
    },
  };
  return { ok: true, fingerprint };
}

export function compareEnvironmentFingerprints(previous, current) {
  if (
    !previous ||
    !current ||
    !/^[a-f0-9]{64}$/i.test(previous.fingerprintId || '') ||
    !/^[a-f0-9]{64}$/i.test(current.fingerprintId || '')
  )
    return failure('ENVIRONMENT_INVALID', 'Both environment fingerprints must be valid');
  if (
    previous.os !== current.os ||
    previous.arch !== current.arch ||
    previous.majorVersions?.java !== current.majorVersions?.java ||
    previous.majorVersions?.node !== current.majorVersions?.node ||
    previous.majorVersions?.database !== current.majorVersions?.database
  )
    return failure(
      'ENVIRONMENT_REASSESSMENT_REQUIRED',
      'Environment changed enough to require verification reassessment',
    );
  return {
    ok: true,
    reusable: previous.fingerprintId === current.fingerprintId,
  };
}
