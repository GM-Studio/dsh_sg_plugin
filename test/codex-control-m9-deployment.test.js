import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createReleaseCheck,
  metricsSnapshot,
  validateDeploymentManifest,
} from '../src/codex/control/deployment-assurance.js';

const NOW = Date.parse('2026-10-24T08:00:00.000Z');
const AUTH_KEY = 'a'.repeat(64);
const DEVICE_HASH = 'b'.repeat(64);
const COMMIT = 'c'.repeat(40);
const HASH = 'd'.repeat(64);

const manifest = (overrides = {}) => ({
  deploymentMode: 'remote',
  publicUrl: 'https://control.example.test',
  allowedHosts: ['control.example.test'],
  allowedOrigins: ['https://control.example.test'],
  trustedProxies: ['127.0.0.1', '::1'],
  bindHost: '127.0.0.1',
  secureCookie: true,
  mysqlConfigPath: '/etc/specgate/mysql.cnf',
  authEncryptionKey: AUTH_KEY,
  deviceConfirmationRequired: true,
  deviceConfirmationCodeHash: DEVICE_HASH,
  serviceUser: 'specgate',
  backupDirectory: '/var/backups/specgate',
  backupPermissions: '0700',
  version: '0.3.4',
  commit: COMMIT,
  rpoMinutes: 15,
  rtoMinutes: 120,
  ...overrides,
});

const evidence = (overrides = {}) => ({
  real: true,
  status: 'PASSED',
  executedAt: '2026-10-24T07:00:00.000Z',
  checks: [
    {
      id: 'deployment-smoke',
      executed: true,
      status: 'PASSED',
      command: 'npm test',
      outputHash: HASH,
    },
  ],
  unexecutedChecks: [],
  ...overrides,
});

const backupReport = (overrides = {}) => ({
  real: true,
  status: 'PASSED',
  restoreVerified: true,
  checksumVerified: true,
  productionBinlog: true,
  measuredRpoMinutes: 10,
  measuredRtoMinutes: 60,
  restoredAt: '2026-10-24T07:10:00.000Z',
  unexecutedChecks: [],
  ...overrides,
});

const securityDrills = (overrides = {}) => ({
  real: true,
  status: 'PASSED',
  drills: [
    { name: 'link_forwarding', executed: true, status: 'PASSED' },
    { name: 'token_leak', executed: true, status: 'PASSED' },
    { name: 'replay', executed: true, status: 'PASSED' },
    { name: 'disconnect', executed: true, status: 'PASSED' },
  ],
  unexecutedChecks: [],
  ...overrides,
});

const pilot = (overrides = {}) => ({
  real: true,
  status: 'COMPLETED',
  completedAt: '2026-10-24T07:30:00.000Z',
  cloudUrl: 'https://control.example.test',
  projects: 2,
  workerCount: 1,
  channels: { feishu: true, dingtalk: true },
  decision: true,
  recovery: true,
  redelivery: true,
  unexecutedChecks: [],
  ...overrides,
});

test('deployment manifest accepts a secure remote boundary without echoing secrets', () => {
  const validated = validateDeploymentManifest(manifest());
  assert.equal(validated.ok, true);
  assert.equal(validated.manifest.publicUrl, 'https://control.example.test');
  assert.deepEqual(validated.manifest.allowedHosts, ['control.example.test']);
  assert.deepEqual(validated.manifest.trustedProxies, ['127.0.0.1', '::1']);
  assert.equal(validated.manifest.authEncryptionConfigured, true);
  assert.equal(validated.manifest.deviceConfirmationConfigured, true);
  const serialized = JSON.stringify(validated);
  assert.doesNotMatch(serialized, new RegExp(AUTH_KEY));
  assert.doesNotMatch(serialized, new RegExp(DEVICE_HASH));
});

test('deployment manifest accepts explicit nested deployment, database and release fields', () => {
  const validated = validateDeploymentManifest({
    deployment: {
      mode: 'remote',
      publicUrl: 'https://control.example.test',
      allowedHosts: ['control.example.test'],
      allowedOrigins: ['https://control.example.test'],
      trustedProxies: ['127.0.0.1'],
      bindHost: '::1',
      secureCookie: true,
      serviceUser: 'specgate',
    },
    database: { configPath: '/etc/specgate/mysql.cnf' },
    auth: {
      encryptionKey: AUTH_KEY,
      deviceConfirmation: { required: true, codeHash: DEVICE_HASH },
    },
    backup: {
      directory: '/var/backups/specgate',
      mode: '700',
      rpoMinutes: 10,
      rtoMinutes: 90,
    },
    release: { version: '0.3.4', commit: COMMIT },
  });
  assert.equal(validated.ok, true);
  assert.equal(validated.manifest.bindHost, '::1');
  assert.equal(validated.manifest.targets.rpoMinutes, 10);
});

test('deployment manifest fails closed for insecure or incomplete values', () => {
  const candidates = [
    manifest({ publicUrl: 'http://control.example.test' }),
    manifest({ allowedHosts: ['*'] }),
    manifest({ allowedOrigins: ['http://control.example.test'] }),
    manifest({ trustedProxies: ['0.0.0.0/0'] }),
    manifest({ bindHost: '0.0.0.0' }),
    manifest({ secureCookie: false }),
    manifest({ mysqlConfigPath: 'mysql.cnf' }),
    manifest({ authEncryptionKey: 'short' }),
    manifest({ deviceConfirmationRequired: false }),
    manifest({ deviceConfirmationCodeHash: 'not-a-hash' }),
    manifest({ serviceUser: 'root' }),
    manifest({ backupDirectory: '/' }),
    manifest({ backupPermissions: '0755' }),
    manifest({ backupPermissions: '0500' }),
    manifest({ version: 'latest' }),
    manifest({ commit: 'abc' }),
    manifest({ rpoMinutes: 16 }),
    manifest({ rtoMinutes: 121 }),
  ];
  for (const candidate of candidates) {
    const validated = validateDeploymentManifest(candidate);
    assert.equal(validated.ok, false);
    assert.equal(validated.code, 'DEPLOYMENT_MANIFEST_INVALID');
    assert.ok(validated.blockers.length > 0);
    assert.doesNotMatch(JSON.stringify(validated), new RegExp(AUTH_KEY));
  }
});

test('release check reaches PASS only with fresh real evidence and measured targets', () => {
  const result = createReleaseCheck({
    manifest: manifest(),
    evidence: evidence(),
    backupReport: backupReport(),
    securityDrills: securityDrills(),
    pilot: pilot(),
    clock: () => NOW,
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.unexecuted, []);
});

test('release check remains PARTIAL when external cloud and pilot evidence is absent', () => {
  const result = createReleaseCheck({
    manifest: manifest(),
    clock: () => NOW,
  });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.ok, false);
  const codes = result.blockers.map((entry) => entry.code);
  assert.ok(codes.includes('RELEASE_VERIFICATION_NOT_RUN'));
  assert.ok(codes.includes('RELEASE_BACKUP_NOT_RUN'));
  assert.ok(codes.includes('RELEASE_SECURITY_DRILLS_NOT_RUN'));
  assert.ok(codes.includes('RELEASE_PILOT_NOT_RUN'));
});

test('release check blocks failed or untruthful evidence and RPO/RTO excess', () => {
  const invalidManifest = createReleaseCheck({
    manifest: manifest({ secureCookie: false }),
    clock: () => NOW,
  });
  assert.equal(invalidManifest.status, 'BLOCKED');

  const failedEvidence = createReleaseCheck({
    manifest: manifest(),
    evidence: evidence({ real: false }),
    backupReport: backupReport({ measuredRpoMinutes: 16, measuredRtoMinutes: 180 }),
    securityDrills: securityDrills({
      drills: [{ name: 'replay', executed: true, status: 'FAILED' }],
      status: 'FAILED',
    }),
    pilot: pilot({ status: 'FAILED' }),
    clock: () => NOW,
  });
  assert.equal(failedEvidence.status, 'BLOCKED');
  assert.ok(
    failedEvidence.blockers.some((entry) => entry.code === 'RELEASE_VERIFICATION_NOT_REAL'),
  );
  assert.ok(failedEvidence.blockers.some((entry) => entry.code === 'RELEASE_RPO_EXCEEDED'));
  assert.ok(failedEvidence.blockers.some((entry) => entry.code === 'RELEASE_RTO_EXCEEDED'));
});

test('release check rejects stale evidence and requires unexecuted checks to be listed', () => {
  const stale = createReleaseCheck({
    manifest: manifest(),
    evidence: evidence({ executedAt: '2026-10-20T07:00:00.000Z', unexecutedChecks: undefined }),
    backupReport: backupReport(),
    securityDrills: securityDrills(),
    pilot: pilot(),
    clock: () => NOW,
  });
  assert.equal(stale.status, 'BLOCKED');
  const partial = createReleaseCheck({
    manifest: manifest(),
    evidence: evidence({ unexecutedChecks: undefined }),
    backupReport: backupReport(),
    securityDrills: securityDrills(),
    pilot: pilot(),
    clock: () => NOW,
  });
  assert.equal(partial.status, 'PARTIAL');
  assert.ok(
    partial.blockers.some((entry) => entry.code === 'RELEASE_UNEXECUTED_CHECKS_UNRECORDED'),
  );
});

test('release check cannot pass when a required external check remains NOT_RUN', () => {
  const result = createReleaseCheck({
    manifest: manifest(),
    evidence: evidence({
      unexecutedChecks: [
        { id: 'cloud-deployment', status: 'NOT_RUN', reasonCode: 'EXTERNAL_RESOURCE' },
        { id: 'https-proxy', status: 'NOT_RUN', reasonCode: 'EXTERNAL_RESOURCE' },
        {
          id: 'production-binlog-backup',
          status: 'NOT_RUN',
          reasonCode: 'EXTERNAL_RESOURCE',
        },
        { id: 'real-pilot', status: 'NOT_RUN', reasonCode: 'EXTERNAL_RESOURCE' },
      ],
    }),
    backupReport: backupReport(),
    securityDrills: securityDrills(),
    pilot: pilot(),
    clock: () => NOW,
  });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.unexecuted.length, 4);
  assert.ok(
    result.blockers.some((entry) => entry.code === 'RELEASE_REQUIRED_EXTERNAL_CHECK_NOT_RUN'),
  );
});

test('metrics snapshot exposes only bounded operational fields and redacts sensitive service data', async () => {
  const snapshot = await metricsSnapshot({
    clock: () => NOW,
    service: {
      projectRoot: '/srv/customers/acme-private',
      workerToken: 'sgw_secret-token',
      customerName: 'Acme Holdings',
      rawError: 'database password leaked',
      version: '0.3.4',
      commit: COMMIT,
      workers: { online: 1, offline: 2 },
      pendingAttentionCount: 3,
      notificationFailures: 1,
      lastHeartbeatAt: '2026-10-24T07:59:30.000Z',
      database: { status: 'UP', backupAgeSeconds: 600 },
      backup: { ageSeconds: 600 },
    },
  });
  assert.equal(snapshot.ok, true);
  assert.deepEqual(snapshot.workers, { online: 1, offline: 2, total: 3 });
  assert.equal(snapshot.attention.pending, 3);
  assert.equal(snapshot.notifications.failed, 1);
  assert.equal(snapshot.database.up, true);
  assert.equal(snapshot.backup.ageSeconds, 600);
  assert.equal(snapshot.lastHeartbeat.ageSeconds, 30);
  assert.equal(snapshot.processUp, true);
  assert.equal(snapshot.runtimeUp, true);
  assert.equal(snapshot.workerOnline, 1);
  assert.equal(snapshot.pendingAttention, 3);
  assert.equal(snapshot.notificationFailures, 1);
  assert.equal(snapshot.backupAgeSeconds, 600);
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /acme|secret-token|Acme Holdings|password leaked/i);
  assert.doesNotMatch(serialized, /projectRoot|customerName|rawError/i);
});

test('metrics snapshot fails soft without exposing a raw exception', async () => {
  const snapshot = await metricsSnapshot({
    clock: () => NOW,
    service: () => {
      throw new Error('token=secret /srv/customer');
    },
  });
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.runtime.up, false);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret|\/srv\/customer|token=/);
});

test('systemd and Caddy templates enforce the single-host deployment boundary', () => {
  const systemd = readFileSync(resolve('deploy/systemd/specgate-control.service'), 'utf8');
  assert.match(systemd, /^User=specgate$/m);
  assert.match(systemd, /^Group=specgate$/m);
  assert.match(systemd, /^EnvironmentFile=\/etc\/specgate\/control\.env$/m);
  assert.match(systemd, /^Restart=on-failure$/m);
  assert.match(systemd, /^NoNewPrivileges=true$/m);
  assert.match(systemd, /^ProtectSystem=strict$/m);
  assert.match(systemd, /SPECGATE_MANAGEMENT_BIND=127\.0\.0\.1/);
  assert.doesNotMatch(systemd, /AUTH_ENCRYPTION_KEY=|PASSWORD=|TOKEN=/);

  const caddy = readFileSync(resolve('deploy/caddy/Caddyfile.example'), 'utf8');
  assert.match(caddy, /https:\/\/control\.example\.com/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:43120/);
  assert.match(caddy, /Strict-Transport-Security/);
  assert.match(caddy, /header_up X-Forwarded-For \{remote_host\}/);
  assert.doesNotMatch(caddy, /0\.0\.0\.0|listen\s+.*:443|\*/);
});

test('backup and restore scripts enforce strict mode, checksums and metadata contracts', () => {
  const backup = readFileSync(resolve('deploy/mysql/backup.sh'), 'utf8');
  assert.match(backup, /set -euo pipefail/);
  assert.match(backup, /umask 077/);
  assert.match(backup, /--defaults-extra-file="\$MYSQL_CONFIG"/);
  assert.match(backup, /--single-transaction/);
  assert.match(backup, /--source-data=2/);
  assert.match(backup, /SHOW BINARY LOG STATUS/);
  assert.match(backup, /manifest\.json/);
  assert.match(backup, /sha256sum mysql\.sql\.gz binlog\.tsv manifest\.json/);
  assert.match(backup, /-mtime \+"\$BACKUP_RETENTION_DAYS"/);
  assert.match(backup, /specgate-backup-\*/);
  assert.doesNotMatch(
    backup,
    /set -x|^[ \t]*(?:mysqldump|mysql)\b[^\n]*(?:--password(?:=|\s)|[ \t]-p(?:[A-Za-z0-9]|$))/m,
  );

  const restore = readFileSync(resolve('deploy/mysql/restore.sh'), 'utf8');
  assert.match(restore, /set -euo pipefail/);
  assert.match(restore, /I_UNDERSTAND_THIS_DATABASE_IS_EMPTY/);
  assert.match(restore, /sha256sum --check --strict SHA256SUMS/);
  assert.match(restore, /information_schema\.tables/);
  assert.match(restore, /target database is not empty/);
  assert.match(restore, /--defaults-extra-file="\$MYSQL_CONFIG"/);
  assert.doesNotMatch(
    restore,
    /set -x|^[ \t]*(?:mysqldump|mysql)\b[^\n]*(?:--password(?:=|\s)|[ \t]-p(?:[A-Za-z0-9]|$))/m,
  );
});

test('release-check CLI is read-only and reports missing evidence as machine-readable blockers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'specgate-m9-'));
  try {
    const manifestFile = join(directory, 'manifest.json');
    writeFileSync(manifestFile, JSON.stringify(manifest()), 'utf8');
    const child = spawnSync(
      process.execPath,
      [resolve('scripts/specgate-release-check.mjs'), '--manifest', manifestFile, '--json'],
      {
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
      },
    );
    assert.equal(child.status, 1, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'PARTIAL');
    assert.ok(result.blockers.some((entry) => entry.code === 'RELEASE_VERIFICATION_NOT_RUN'));
    assert.ok(result.blockers.some((entry) => entry.code === 'RELEASE_PILOT_NOT_RUN'));
    assert.equal(child.stderr, '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('release-check CLI fails closed when the manifest is missing or insecure', () => {
  const directory = mkdtempSync(join(tmpdir(), 'specgate-m9-bad-'));
  try {
    const insecureFile = join(directory, 'insecure.json');
    writeFileSync(
      insecureFile,
      JSON.stringify(manifest({ publicUrl: 'http://control.example.test' })),
      'utf8',
    );
    const child = spawnSync(
      process.execPath,
      [resolve('scripts/specgate-release-check.mjs'), '--manifest', insecureFile, '--json'],
      { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } },
    );
    assert.equal(child.status, 2);
    const result = JSON.parse(child.stdout);
    assert.equal(result.status, 'BLOCKED');
    assert.ok(result.blockers.some((entry) => entry.code === 'DEPLOYMENT_PUBLIC_URL_INSECURE'));
    assert.doesNotMatch(child.stdout, new RegExp(AUTH_KEY));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
