import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PLATFORM_EVIDENCE_DIRECTORY,
  evidenceFileName,
  readPlatformEvidence,
  declareSupportLevel,
  summarizePlatforms,
} from '../src/codex/core/platform-support.js';

const at = '2026-10-26T00:00:00.000Z';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-plat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeEvidence(root, platform, arch, body) {
  const directory = path.join(root, PLATFORM_EVIDENCE_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, evidenceFileName(platform, arch)),
    JSON.stringify(body, null, 2),
  );
}

const goodEvidence = (platform, arch) => ({
  platform,
  arch,
  status: 'passed',
  recordedAt: at,
  recordedBy: 'ci-runner',
  checks: [
    { command: 'npm test', exitCode: 0 },
    { command: 'npm run lint', exitCode: 0 },
  ],
});

test('macOS and ARM64 stay reserved even when evidence exists', (t) => {
  const root = workspace(t);
  writeEvidence(root, 'darwin', 'arm64', goodEvidence('darwin', 'arm64'));
  const declared = declareSupportLevel({ root, platform: 'darwin', arch: 'arm64' });
  assert.equal(declared.ok, true);
  assert.equal(declared.level, 'reserved', 'AC-17：预留平台不因证据自动升级');
  assert.equal(declared.evidencePresent, true, '但证据的存在仍然可见');
  assert.match(declared.note, /AC-17/);
});

test('a supported platform without evidence is declared unverified', (t) => {
  const root = workspace(t);
  for (const platform of ['win32', 'linux']) {
    const declared = declareSupportLevel({ root, platform, arch: 'x64' });
    assert.equal(declared.level, 'unverified', platform);
    assert.equal(declared.claimed, 'supported', '宣称等级与实际声明必须分开');
    assert.equal(declared.evidencePresent, false);
  }
});

test('a supported platform with genuine evidence becomes supported', (t) => {
  const root = workspace(t);
  writeEvidence(root, 'linux', 'x64', goodEvidence('linux', 'x64'));
  const declared = declareSupportLevel({ root, platform: 'linux', arch: 'x64' });
  assert.equal(declared.level, 'supported');
  assert.equal(declared.evidencePresent, true);
  assert.equal(declared.recordedBy, 'ci-runner');
  assert.equal(declared.recordedAt, at);
});

test('evidence that did not pass does not grant supported', (t) => {
  const root = workspace(t);
  const failed = { ...goodEvidence('win32', 'x64'), status: 'failed' };
  writeEvidence(root, 'win32', 'x64', failed);
  const declared = declareSupportLevel({ root, platform: 'win32', arch: 'x64' });
  assert.equal(declared.level, 'unverified');
  assert.equal(declared.reason, 'evidence-not-passed');
});

test('evidence with a non-zero check does not grant supported', (t) => {
  const root = workspace(t);
  const withFailure = {
    ...goodEvidence('win32', 'x64'),
    checks: [{ command: 'npm test', exitCode: 1 }],
  };
  writeEvidence(root, 'win32', 'x64', withFailure);
  const declared = declareSupportLevel({ root, platform: 'win32', arch: 'x64' });
  assert.equal(declared.level, 'unverified');
  assert.equal(declared.reason, 'evidence-check-failed');
});

test('evidence missing commands, timestamp or recorder is rejected', (t) => {
  const root = workspace(t);
  const cases = [
    [{ ...goodEvidence('win32', 'x64'), checks: [] }, 'evidence-has-no-checks'],
    [
      { ...goodEvidence('win32', 'x64'), checks: [{ exitCode: 0 }] },
      'evidence-check-without-command',
    ],
    [{ ...goodEvidence('win32', 'x64'), recordedAt: 'not-a-date' }, 'evidence-without-timestamp'],
    [{ ...goodEvidence('win32', 'x64'), recordedBy: '' }, 'evidence-without-recorder'],
    [{ ...goodEvidence('win32', 'x64'), platform: 'linux' }, 'evidence-platform-mismatch'],
  ];
  for (const [body, expected] of cases) {
    writeEvidence(root, 'win32', 'x64', body);
    const evidence = readPlatformEvidence({ root, platform: 'win32', arch: 'x64' });
    assert.equal(evidence.present, false, expected);
    assert.equal(evidence.reason, expected);
  }
});

test('a missing evidence file is reported as missing, not as an error', (t) => {
  const root = workspace(t);
  const evidence = readPlatformEvidence({ root, platform: 'linux', arch: 'x64' });
  assert.equal(evidence.ok, true);
  assert.equal(evidence.present, false);
  assert.equal(evidence.reason, 'evidence-missing');
});

test('the platform summary lists reserved platforms explicitly', (t) => {
  const root = workspace(t);
  const summary = summarizePlatforms({ root });
  assert.equal(summary.ok, true);
  const levels = Object.fromEntries(
    summary.rows.map((entry) => [entry.platform + '/' + entry.arch, entry.level]),
  );
  assert.equal(levels['win32/x64'], 'unverified');
  assert.equal(levels['linux/x64'], 'unverified');
  assert.equal(levels['darwin/arm64'], 'reserved', 'macOS/ARM64 必须在报告里可见');
  assert.equal(summary.allSupported, false, '未全部验证时不得宣称全平台通过');
  assert.equal(summary.reservedCount, 1);
  assert.equal(summary.unverifiedCount, 2);
});

test('allSupported is true only when every listed platform has passed evidence', (t) => {
  const root = workspace(t);
  writeEvidence(root, 'win32', 'x64', goodEvidence('win32', 'x64'));
  writeEvidence(root, 'linux', 'x64', goodEvidence('linux', 'x64'));
  const summary = summarizePlatforms({ root });
  // darwin 仍是 reserved，因此整体仍不算「全平台已验证」。
  assert.equal(summary.allSupported, false, '预留平台使其不可能全绿');
  assert.equal(summary.supportedCount, 2);
  assert.equal(summary.reservedCount, 1);
});

test('an invalid root or platform list is refused', () => {
  assert.equal(
    readPlatformEvidence({ root: '', platform: 'linux' }).code,
    'PLATFORM_EVIDENCE_INVALID',
  );
  assert.equal(
    summarizePlatforms({ root: process.cwd(), platforms: 'x' }).code,
    'PLATFORM_SUPPORT_INVALID',
  );
});

test('the evidence file name encodes platform and architecture', () => {
  assert.equal(evidenceFileName('linux', 'x64'), 'platform-linux-x64.json');
  assert.equal(evidenceFileName('darwin', 'arm64'), 'platform-darwin-arm64.json');
});
