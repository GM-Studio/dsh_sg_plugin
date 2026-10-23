import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_TEMPLATE_REVISIONS,
  GOLDEN_MANIFEST,
  JAVA_PRESETS,
  goldenStatus,
  platformVerificationRecord,
} from '../src/codex/core/java/java-versions.js';
import { javaFullstackFiles } from '../src/codex/core/java/java-fullstack-template.js';

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

test('current frontend-specific template revisions are pending rather than mismatched', () => {
  for (const preset of JAVA_PRESETS) {
    for (const frontend of ['vue', 'react']) {
      const files = javaFullstackFiles({ preset, frontend, company: 'company', business: 'tasks' });
      const hash = files.__specgateCanonicalTemplateHash;
      assert.equal(hash, CURRENT_TEMPLATE_REVISIONS[preset.id][frontend].templateHash);
      const status = goldenStatus(preset, hash, frontend);
      assert.equal(status.status, 'awaiting-verification');
      assert.equal(status.blocking, false);
      assert.equal(status.action, 'RUN_SG_VERIFY');
      assert.equal(status.record.templateHash, hash);
      assert.equal(status.record.result, 'not-run');
      assert.equal(status.record.verifiedAt, null);
      assert.deepEqual(status.pendingPlatforms, GOLDEN_MANIFEST.requiredPlatforms);
      for (const platform of GOLDEN_MANIFEST.requiredPlatforms)
        assert.equal(status.record.platforms[platform].result, 'not-run');
      assert.doesNotMatch(status.reason, /不一致|已变化/);
    }
  }
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

test('the source manifest never claims verified without both platforms passing', () => {
  for (const preset of JAVA_PRESETS) {
    const entry = GOLDEN_MANIFEST.presets[preset.id];
    const records = [
      { frontend: 'vue', record: entry },
      { frontend: 'react', record: entry.frontends?.react },
    ].filter((item) => item.record);
    for (const { frontend, record } of records) {
      const status = goldenStatus(preset, record.templateHash, frontend);
      if (status.verified) {
        for (const platform of GOLDEN_MANIFEST.requiredPlatforms) {
          const platformRecord = record.platforms?.[platform];
          assert.equal(platformRecord?.result, 'passed', preset.id + ' ' + platform);
          assert.equal(platformRecord.evidence?.ok, true, preset.id + ' evidence');
          assert.match(platformRecord.evidence.runId, /^[\w-]+$/);
          assert.match(platformRecord.evidence.sourceHash, /^[a-f\d]{64}$/);
        }
      } else {
        assert.ok(
          record.result !== 'passed' ||
            GOLDEN_MANIFEST.requiredPlatforms.some(
              (platform) => record.platforms?.[platform]?.result !== 'passed',
            ),
          preset.id + ' ' + frontend + ' must keep a pending result or platform',
        );
      }
    }
  }
});
