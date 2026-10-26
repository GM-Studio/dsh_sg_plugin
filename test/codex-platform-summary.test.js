import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CAPABILITY_TIERS,
  capabilityTiers,
  platformSummary,
  assertIndependentEvidence,
} from '../src/codex/core/platform-summary.js';
import {
  PLATFORM_EVIDENCE_DIRECTORY,
  evidenceFileName,
} from '../src/codex/core/platform-support.js';

const at = '2026-10-26T00:00:00.000Z';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-summary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeEvidence(root, platform, arch = 'x64') {
  const directory = path.join(root, PLATFORM_EVIDENCE_DIRECTORY);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, evidenceFileName(platform, arch)),
    JSON.stringify({
      platform,
      arch,
      status: 'passed',
      recordedAt: at,
      recordedBy: 'ci',
      checks: [{ command: 'npm test', exitCode: 0 }],
    }),
  );
}

test('three capability tiers exist', () => {
  assert.deepEqual([...CAPABILITY_TIERS].sort(), ['default-public', 'shipped', 'source-only']);
});

test('every capability is assigned exactly one tier with a reason', () => {
  const result = capabilityTiers({
    capabilities: [
      { name: 'control-plane', tier: 'source-only', reason: '不进入 Core 包' },
      { name: 'sg_status', tier: 'default-public' },
      { name: 'sg_env_check', tier: 'shipped' },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, { sourceOnly: 1, defaultPublic: 1, shipped: 1 });
});

test('a capability with no tier or an unknown tier is refused', () => {
  const missing = capabilityTiers({ capabilities: [{ name: 'x' }] });
  assert.equal(missing.ok, false);
  assert.equal(missing.problems[0].code, 'TIER_UNKNOWN');

  const unknown = capabilityTiers({ capabilities: [{ name: 'x', tier: 'maybe' }] });
  assert.equal(unknown.ok, false);
});

test('a capability cannot sit in two tiers at once', () => {
  // 三态静默重叠会让人以为某能力既在源码里又在发行包里。
  const result = capabilityTiers({
    capabilities: [
      { name: 'sg_verify', tier: 'source-only' },
      { name: 'sg_verify', tier: 'shipped' },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].code, 'TIER_AMBIGUOUS');
});

test('no platform evidence means the release is not ready', (t) => {
  const root = workspace(t);
  const summary = platformSummary({ root });
  assert.equal(summary.ok, true);
  assert.equal(summary.releaseReady, false, '缺证据不得宣称可发布');
  assert.equal(summary.missing.length, 2);
});

test('one platform evidence is not enough to be release ready', (t) => {
  // AC-16：两平台记录不得互相代替。
  const root = workspace(t);
  writeEvidence(root, 'win32');
  const summary = platformSummary({ root });
  assert.equal(summary.releaseReady, false);
  assert.deepEqual(
    summary.missing.map((entry) => entry.platform),
    ['linux'],
  );
});

test('both platform evidences make the release ready', (t) => {
  const root = workspace(t);
  writeEvidence(root, 'win32');
  writeEvidence(root, 'linux');
  const summary = platformSummary({ root });
  assert.equal(summary.releaseReady, true);
  assert.equal(summary.missing.length, 0);
  assert.equal(summary.required.length, 2);
});

test('reserved platforms stay visible but do not gate the release', (t) => {
  const root = workspace(t);
  writeEvidence(root, 'win32');
  writeEvidence(root, 'linux');
  const summary = platformSummary({ root });
  assert.ok(summary.reservedPlatforms.includes('darwin'), 'macOS 必须在报告中可见');
  assert.equal(summary.releaseReady, true, '预留平台不参与发布判定');
});

test('each platform row names its own evidence file', (t) => {
  const root = workspace(t);
  writeEvidence(root, 'win32');
  const summary = platformSummary({ root });
  const winRow = summary.rows.find((entry) => entry.platform === 'win32');
  assert.equal(winRow.evidenceFile, 'platform-win32-x64.json');
  const linuxRow = summary.rows.find((entry) => entry.platform === 'linux');
  assert.equal(linuxRow.evidenceFile, 'platform-linux-x64.json');
});

test('a supported row without its own evidence file is rejected', () => {
  const problems = assertIndependentEvidence({
    rows: [
      {
        platform: 'linux',
        arch: 'x64',
        level: 'supported',
        evidenceFile: 'platform-win32-x64.json',
        evidencePresent: true,
      },
    ],
  });
  assert.equal(problems.ok, false);
  assert.equal(problems.problems[0].code, 'EVIDENCE_FILE_MISMATCH');
});

test('a supported row claiming no evidence is rejected', () => {
  const problems = assertIndependentEvidence({
    rows: [
      {
        platform: 'linux',
        arch: 'x64',
        level: 'supported',
        evidenceFile: 'platform-linux-x64.json',
        evidencePresent: false,
      },
    ],
  });
  assert.equal(problems.ok, false);
  assert.equal(problems.problems[0].code, 'SUPPORTED_WITHOUT_EVIDENCE');
});

test('independent evidence passes', () => {
  const result = assertIndependentEvidence({
    rows: [
      {
        platform: 'win32',
        arch: 'x64',
        level: 'supported',
        evidenceFile: 'platform-win32-x64.json',
        evidencePresent: true,
      },
      {
        platform: 'linux',
        arch: 'x64',
        level: 'supported',
        evidenceFile: 'platform-linux-x64.json',
        evidencePresent: true,
      },
    ],
  });
  assert.equal(result.ok, true);
});

test('invalid input is refused', () => {
  assert.equal(capabilityTiers({ capabilities: 'x' }).code, 'TIER_INVALID');
  assert.equal(assertIndependentEvidence({ rows: 'x' }).code, 'TIER_INVALID');
});
