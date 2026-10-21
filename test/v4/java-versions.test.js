import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GOLDEN_MANIFEST,
  JAVA_PRESETS,
  goldenStatus,
  normalizeJavaPreset,
  templateHash,
} from '../../src/v4/java-versions.js';
import { javaFullstackFiles } from '../../src/v4/java-fullstack-template.js';

test('all Java presets are stable and have a golden record', () => {
  for (const preset of JAVA_PRESETS) {
    const first = javaFullstackFiles({ preset });
    const second = javaFullstackFiles({ preset });
    const hash = templateHash(first);
    assert.equal(hash, templateHash(second), preset.id + ' hash must be deterministic');
    const record = GOLDEN_MANIFEST.presets[preset.id];
    assert.ok(record, preset.id + ' must have a verification record');
    assert.equal(record.templateHash, hash, preset.id + ' record hash must match template');
    assert.equal(record.result, 'passed');
  }
});

test('preset transforms select the requested Java, Boot, and jakarta stack', () => {
  for (const id of ['jdk17-boot3.5', 'jdk21-boot3.5', 'jdk21-boot4.0']) {
    const normalized = normalizeJavaPreset(id);
    assert.equal(normalized.ok, true);
    const files = javaFullstackFiles({ preset: normalized.preset });
    const pom = files['backend/pom.xml'];
    assert.match(
      pom,
      new RegExp('<java.version>' + normalized.preset.javaVersion + '</java.version>'),
    );
    assert.match(pom, new RegExp('<version>' + normalized.preset.bootVersion + '</version>'));
    assert.match(
      files['backend/src/main/java/com/example/tasks/entity/Task.java'],
      /import jakarta\.persistence\.Entity;/,
    );
  }
  const boot4 = javaFullstackFiles({
    preset: normalizeJavaPreset('jdk21-boot4.0').preset,
  });
  assert.match(boot4['backend/pom.xml'], /spring-boot-starter-webmvc-test/);
  assert.match(
    boot4['backend/src/test/java/com/example/tasks/TaskApiTest.java'],
    /import tools\.jackson\.databind\.ObjectMapper;/,
  );
  assert.match(
    boot4['backend/src/test/java/com/example/tasks/TaskApiTest.java'],
    /import org\.springframework\.boot\.webmvc\.test\.autoconfigure\.AutoConfigureMockMvc;/,
  );
});

test('unknown presets fail closed and goldenStatus rejects a changed template', () => {
  assert.equal(normalizeJavaPreset('jdk11-boot3.0').code, 'E_JAVA_VERSION');
  const preset = normalizeJavaPreset('jdk17-boot3.5').preset;
  const files = javaFullstackFiles({ preset });
  assert.equal(goldenStatus(preset, templateHash(files)).verified, true);
  assert.equal(goldenStatus(preset, '0'.repeat(64)).verified, false);
});
