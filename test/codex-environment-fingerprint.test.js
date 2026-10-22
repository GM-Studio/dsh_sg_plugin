import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareEnvironmentFingerprints,
  createEnvironmentFingerprint,
} from '../src/codex/environment-fingerprint.js';

const environment = {
  platform: 'win32',
  arch: 'x64',
  java: [
    { version: '21.0.8', major: 21, home: 'C:/secret/java-home' },
    { version: '17.0.12', major: 17, home: 'C:/other/java-home' },
  ],
  maven: { version: '3.9.11', path: 'C:/tools/maven' },
  node: { version: '20.19.0', path: 'C:/Program Files/nodejs/node.exe' },
  npm: '10.8.2',
  database: { version: 'postgresql-16' },
  browser: { version: 'chromium-140' },
};

test('environment fingerprints record versions but no secret values or absolute installation paths', () => {
  const result = createEnvironmentFingerprint({
    environment,
    environmentVariableNames: ['JAVA_HOME', 'DB_PASSWORD', 'API_TOKEN'],
    externalServices: [{ name: 'payments', mode: 'mock' }],
    configuration: { mode: 'test', token: 'do-not-store' },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.fingerprint.fingerprintId, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.fingerprint.environmentVariableNames, [
    'API_TOKEN',
    'DB_PASSWORD',
    'JAVA_HOME',
  ]);
  assert.equal(result.fingerprint.runtimes.java, '21.0.8');
  assert.equal(result.fingerprint.runtimes.node, '20.19.0');
  const serialized = JSON.stringify(result.fingerprint);
  assert.doesNotMatch(serialized, /C:\/secret|Program Files|do-not-store|21\.0\.8\?/);
  assert.doesNotMatch(serialized, /postgresql-16.*secret/i);
});

test('major Java or Node changes require evidence reassessment', () => {
  const first = createEnvironmentFingerprint({ environment });
  assert.equal(first.ok, true);
  const javaChanged = createEnvironmentFingerprint({
    environment: { ...environment, java: [{ version: '17.0.12', major: 17 }] },
  });
  const nodeChanged = createEnvironmentFingerprint({
    environment: { ...environment, node: { version: '22.12.0' } },
  });
  assert.equal(
    compareEnvironmentFingerprints(first.fingerprint, javaChanged.fingerprint).code,
    'ENVIRONMENT_REASSESSMENT_REQUIRED',
  );
  assert.equal(
    compareEnvironmentFingerprints(first.fingerprint, nodeChanged.fingerprint).code,
    'ENVIRONMENT_REASSESSMENT_REQUIRED',
  );
});

test('matching fingerprints are reusable and malformed fingerprints fail closed', () => {
  const first = createEnvironmentFingerprint({ environment });
  const second = createEnvironmentFingerprint({ environment });
  assert.deepEqual(compareEnvironmentFingerprints(first.fingerprint, second.fingerprint), {
    ok: true,
    reusable: true,
  });
  assert.equal(
    compareEnvironmentFingerprints(null, second.fingerprint).code,
    'ENVIRONMENT_INVALID',
  );
  assert.equal(createEnvironmentFingerprint({ environment: null }).code, 'ENVIRONMENT_INVALID');
});
