import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOLDEN_MANIFEST,
  JAVA_PRESETS,
  goldenStatus,
  platformVerificationRecord,
} from '../src/codex/core/java/java-versions.js';

const PRESET_ID = 'jdk17-boot3.5';
const REAL_HASH = GOLDEN_MANIFEST.presets[PRESET_ID].templateHash;
const SOURCE_HASH = 'a'.repeat(64);
const VERIFIED_AT = '2026-10-22T12:00:00.000Z';

// Swap a manifest record for the duration of one test, then restore the exact
// original reference. No test leaves a preset mutated, and no source
// templateHash is ever changed.
function patchPreset(t, id, patch) {
  const original = GOLDEN_MANIFEST.presets[id];
  GOLDEN_MANIFEST.presets[id] = { ...structuredClone(original), ...structuredClone(patch) };
  t.after(() => {
    GOLDEN_MANIFEST.presets[id] = original;
  });
  return GOLDEN_MANIFEST.presets[id];
}

test('both required platforms passed reports verified and matrixComplete', (t) => {
  patchPreset(t, PRESET_ID, {
    result: 'passed',
    verifiedAt: VERIFIED_AT,
    platforms: { win32: { result: 'passed' }, linux: { result: 'passed' } },
    matrixComplete: true,
  });
  const status = goldenStatus({ id: PRESET_ID }, REAL_HASH);
  assert.equal(status.verified, true, JSON.stringify(status));
  assert.equal(status.matrixComplete, true);
  assert.deepEqual(status.pendingPlatforms, []);
  assert.equal(status.reason, null);
});

test('one platform passed and one not-run is not verified and lists the pending platform', (t) => {
  patchPreset(t, PRESET_ID, {
    result: 'passed',
    verifiedAt: VERIFIED_AT,
    platforms: { win32: { result: 'passed' }, linux: { result: 'not-run' } },
  });
  const status = goldenStatus({ id: PRESET_ID }, REAL_HASH);
  assert.equal(
    status.verified,
    false,
    'a single passing platform must not mark the preset verified',
  );
  assert.equal(status.matrixComplete, false);
  assert.deepEqual(status.pendingPlatforms, ['linux']);
  assert.match(status.reason, /win32/, 'reason names the platform that passed');
  assert.match(status.reason, /linux/, 'reason names the platform still pending');
});

test('hash mismatch is not verified and the reason names the changed template', (t) => {
  patchPreset(t, PRESET_ID, {
    result: 'passed',
    verifiedAt: VERIFIED_AT,
    platforms: { win32: { result: 'passed' }, linux: { result: 'passed' } },
  });
  const status = goldenStatus({ id: PRESET_ID }, 'deadbeef'.repeat(8));
  assert.equal(status.verified, false);
  assert.match(status.reason, /模板已变化/);
});

test('the helper records a real pass and a not-run platform in one shape', () => {
  const passed = platformVerificationRecord(PRESET_ID, {
    platform: 'win32',
    result: 'passed',
    verifiedAt: VERIFIED_AT,
    evidence: { ok: true, runId: 'run-1', sourceHash: SOURCE_HASH },
  });
  assert.equal(passed.platform, 'win32');
  assert.equal(passed.record.result, 'passed');
  assert.equal(passed.record.verifiedAt, VERIFIED_AT);
  assert.equal(passed.record.evidence.runId, 'run-1');
  assert.equal(passed.record.evidence.sourceHash, SOURCE_HASH);

  const notRun = platformVerificationRecord(
    { id: PRESET_ID },
    { platform: 'linux', result: 'not-run' },
  );
  assert.equal(notRun.platform, 'linux');
  assert.equal(notRun.record.result, 'not-run');
  assert.equal(notRun.record.verifiedAt, null);
  assert.equal(notRun.record.evidence, null);
});

test('the helper refuses to record a fabricated pass', () => {
  // No evidence at all.
  assert.throws(
    () => platformVerificationRecord(PRESET_ID, { platform: 'win32', result: 'passed' }),
    /without real verification evidence/,
  );
  // A timestamp without evidence.
  assert.throws(
    () =>
      platformVerificationRecord(PRESET_ID, {
        platform: 'win32',
        result: 'passed',
        verifiedAt: VERIFIED_AT,
      }),
    /without real verification evidence/,
  );
  // Evidence that did not validate.
  assert.throws(
    () =>
      platformVerificationRecord(PRESET_ID, {
        platform: 'win32',
        result: 'passed',
        verifiedAt: VERIFIED_AT,
        evidence: { ok: false, code: 'VERIFY_EVIDENCE_INCOMPLETE' },
      }),
    /without real verification evidence/,
  );
  // Opted-in but still missing the real run identity.
  assert.throws(
    () =>
      platformVerificationRecord(PRESET_ID, {
        platform: 'win32',
        result: 'passed',
        verifiedAt: VERIFIED_AT,
        evidence: { ok: true },
      }),
    /without real verification evidence/,
  );
  assert.throws(
    () =>
      platformVerificationRecord(PRESET_ID, {
        platform: 'win32',
        result: 'passed',
        verifiedAt: VERIFIED_AT,
        evidence: { ok: true, runId: 'run-1', sourceHash: 'not-a-hash' },
      }),
    /without real verification evidence/,
  );
  // An unparseable timestamp is not real evidence either.
  assert.throws(
    () =>
      platformVerificationRecord(PRESET_ID, {
        platform: 'win32',
        result: 'passed',
        verifiedAt: 'not-a-date',
        evidence: { ok: true, runId: 'run-1', sourceHash: SOURCE_HASH },
      }),
    /without real verification evidence/,
  );
  // Unknown platform and unknown preset are rejected outright.
  assert.throws(
    () => platformVerificationRecord(PRESET_ID, { platform: 'darwin', result: 'not-run' }),
    /not a required golden platform/,
  );
  assert.throws(
    () => platformVerificationRecord('jdk99-boot9.9', { platform: 'win32', result: 'not-run' }),
    /Unknown Java preset/,
  );
});

test('the source manifest still records every preset as unverified', () => {
  for (const preset of JAVA_PRESETS) {
    const record = GOLDEN_MANIFEST.presets[preset.id];
    assert.notEqual(record.result, 'passed', preset.id + ' must stay pending in source');
    for (const platform of GOLDEN_MANIFEST.requiredPlatforms)
      assert.notEqual(
        record.platforms?.[platform]?.result,
        'passed',
        preset.id + ' must not claim a platform pass in source',
      );
    const status = goldenStatus(preset, record.templateHash);
    assert.equal(status.verified, false, preset.id + ' must not be verified in source');
  }
});
