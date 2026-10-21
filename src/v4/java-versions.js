import { createHash } from 'node:crypto';

export const DEFAULT_JAVA_PRESET = 'jdk8-boot2.7';

export const JAVA_PRESETS = [
  {
    id: 'jdk8-boot2.7',
    label: 'Java 8 + Spring Boot 2.7.18 + Maven',
    jdk: '8',
    javaVersion: '1.8',
    bootVersion: '2.7.18',
    bootLine: '2.7.x',
    legacy: true,
    preview: false,
    spotless: '2.30.0',
    gjf: '1.7',
    checkstyle: '9.3',
    h2: '2.1.214',
  },
  {
    id: 'jdk17-boot3.5',
    label: 'Java 17 + Spring Boot 3.5.16 + Maven',
    jdk: '17',
    javaVersion: '17',
    bootVersion: '3.5.16',
    bootLine: '3.5.x',
    legacy: false,
    preview: false,
    spotless: '2.44.0',
    gjf: '1.24.0',
    checkstyle: '10.20.1',
    h2: '2.3.232',
  },
  {
    id: 'jdk21-boot3.5',
    label: 'Java 21 + Spring Boot 3.5.16 + Maven',
    jdk: '21',
    javaVersion: '21',
    bootVersion: '3.5.16',
    bootLine: '3.5.x',
    legacy: false,
    preview: false,
    spotless: '2.44.0',
    gjf: '1.24.0',
    checkstyle: '10.20.1',
    h2: '2.3.232',
  },
  {
    id: 'jdk21-boot4.0',
    label: 'Java 21 + Spring Boot 4.0.0 + Maven (preview)',
    jdk: '21',
    javaVersion: '21',
    bootVersion: '4.0.0',
    bootLine: '4.0.x',
    legacy: false,
    preview: true,
    spotless: '2.44.0',
    gjf: '1.24.0',
    checkstyle: '10.20.1',
    h2: '2.3.232',
  },
];

/** Verification records are filled only after a real local build/test/start run. */
export const GOLDEN_MANIFEST = {
  schemaVersion: 1,
  updatedAt: '2026-10-21',
  presets: {
    'jdk8-boot2.7': {
      templateHash: 'ebd6e0d9c8bf4c984e7eddd2ae2d7bba80d57e63a81d3fb7e8c9793e1dbf6418',
      verifiedAt: '2026-10-21T01:47:13.670Z',
      verifiedBy: 'local:win32 x64',
      toolchain: 'JDK 1.8.0_472 + Maven 3.9.11 + Node 24.14.0',
      commands: [
        'C:\\Users\\Administrator\\.m2\\wrapper\\dists\\apache-maven-3.9.11\\03d7e36a140982eea48e22c1dcac01d8862b2550b2939e09a0809bbc5182a5bc\\bin\\mvn.cmd -B -ntp clean verify',
        'D:\\Program Files\\nodejs\\npm.cmd ci --no-audit --no-fund',
        'D:\\Program Files\\nodejs\\npm.cmd run build',
        'D:\\Program Files\\nodejs\\npm.cmd run test -- --reporter=json --outputFile=E:\\ai_workflow\\specgate\\.specgate\\template-qa\\1792547192172\\jdk8-boot2.7\\.specgate\\verify-runs\\2026-10-21T01-46-32-832Z-386ace66\\frontend-tests.json',
        'D:\\Program Files\\nodejs\\npm.cmd run lint',
        'D:\\Program Files\\nodejs\\npm.cmd run format:check',
      ],
      result: 'passed',
      evidence: 'docs/verification/2026-10-21-json-post-crud/jdk8-boot2.7/report.json',
    },
    'jdk17-boot3.5': {
      templateHash: '85f7a8cdebc2e9aa3b6070af71d3d7190683ce0555066b28939efb2dc1070a20',
      verifiedAt: '2026-10-21T01:48:00.550Z',
      verifiedBy: 'local:win32 x64',
      toolchain: 'JDK 17.0.18 + Maven 3.9.11 + Node 24.14.0',
      commands: [
        'C:\\Users\\Administrator\\.m2\\wrapper\\dists\\apache-maven-3.9.11\\03d7e36a140982eea48e22c1dcac01d8862b2550b2939e09a0809bbc5182a5bc\\bin\\mvn.cmd -B -ntp clean verify',
        'D:\\Program Files\\nodejs\\npm.cmd ci --no-audit --no-fund',
        'D:\\Program Files\\nodejs\\npm.cmd run build',
        'D:\\Program Files\\nodejs\\npm.cmd run test -- --reporter=json --outputFile=E:\\ai_workflow\\specgate\\.specgate\\template-qa\\1792547192172\\jdk17-boot3.5\\.specgate\\verify-runs\\2026-10-21T01-47-14-100Z-19111b02\\frontend-tests.json',
        'D:\\Program Files\\nodejs\\npm.cmd run lint',
        'D:\\Program Files\\nodejs\\npm.cmd run format:check',
      ],
      result: 'passed',
      evidence: 'docs/verification/2026-10-21-json-post-crud/jdk17-boot3.5/report.json',
    },
    'jdk21-boot3.5': {
      templateHash: '3b2451d286fad66f6f31f5bb2bb653798b72b8bae5290284d3b7e84d2380c9b9',
      verifiedAt: '2026-10-21T01:48:40.334Z',
      verifiedBy: 'local:win32 x64',
      toolchain: 'JDK 21.0.9 + Maven 3.9.11 + Node 24.14.0',
      commands: [
        'C:\\Users\\Administrator\\.m2\\wrapper\\dists\\apache-maven-3.9.11\\03d7e36a140982eea48e22c1dcac01d8862b2550b2939e09a0809bbc5182a5bc\\bin\\mvn.cmd -B -ntp clean verify',
        'D:\\Program Files\\nodejs\\npm.cmd ci --no-audit --no-fund',
        'D:\\Program Files\\nodejs\\npm.cmd run build',
        'D:\\Program Files\\nodejs\\npm.cmd run test -- --reporter=json --outputFile=E:\\ai_workflow\\specgate\\.specgate\\template-qa\\1792547192172\\jdk21-boot3.5\\.specgate\\verify-runs\\2026-10-21T01-48-01-184Z-93974417\\frontend-tests.json',
        'D:\\Program Files\\nodejs\\npm.cmd run lint',
        'D:\\Program Files\\nodejs\\npm.cmd run format:check',
      ],
      result: 'passed',
      evidence: 'docs/verification/2026-10-21-json-post-crud/jdk21-boot3.5/report.json',
    },
    'jdk21-boot4.0': {
      templateHash: 'c0d138ee94f9a6ccc0782043c104b0cf83d7e2cf6e141392f34398f3d5503823',
      verifiedAt: '2026-10-21T01:49:47.345Z',
      verifiedBy: 'local:win32 x64',
      toolchain: 'JDK 21.0.9 + Maven 3.9.11 + Node 24.14.0',
      commands: [
        'C:\\Users\\Administrator\\.m2\\wrapper\\dists\\apache-maven-3.9.11\\03d7e36a140982eea48e22c1dcac01d8862b2550b2939e09a0809bbc5182a5bc\\bin\\mvn.cmd -B -ntp clean verify',
        'D:\\Program Files\\nodejs\\npm.cmd ci --no-audit --no-fund',
        'D:\\Program Files\\nodejs\\npm.cmd run build',
        'D:\\Program Files\\nodejs\\npm.cmd run test -- --reporter=json --outputFile=E:\\ai_workflow\\specgate\\.specgate\\template-qa\\1792547346704\\jdk21-boot4.0\\.specgate\\verify-runs\\2026-10-21T01-49-07-238Z-9c54636c\\frontend-tests.json',
        'D:\\Program Files\\nodejs\\npm.cmd run lint',
        'D:\\Program Files\\nodejs\\npm.cmd run format:check',
      ],
      result: 'passed',
      evidence: 'docs/verification/2026-10-21-json-post-crud/jdk21-boot4.0/report.json',
      preview: true,
    },
  },
};

export function normalizeJavaPreset(value) {
  const id = String(value || '').trim() || DEFAULT_JAVA_PRESET;
  const preset = JAVA_PRESETS.find((item) => item.id === id);
  if (!preset) {
    return {
      ok: false,
      code: 'E_JAVA_VERSION',
      message:
        '未知 Java 版本档：' + id + '；可选：' + JAVA_PRESETS.map((item) => item.id).join(' / '),
    };
  }
  return { ok: true, preset };
}

function frontendVersionSection(security) {
  const marker = '## Exact frontend versions';
  const index = security.indexOf(marker);
  return index >= 0 ? security.slice(index) : '';
}

function readmeFor(readme, preset) {
  let value = readme;
  value = value.replace(
    '# Java 8 + Vue task monorepo',
    '# Java ' + preset.jdk + ' + Spring Boot ' + preset.bootVersion + ' + Vue task monorepo',
  );
  value = value.replace(
    'Maintained Java 8 JDK, Maven 3.9.11 (3.9.x supported). Set JAVA_HOME and put its bin on PATH.',
    'JDK ' +
      preset.jdk +
      ' (maintained vendor distribution). Set JAVA_HOME and put its bin on PATH. Maven 3.9.x is supported.',
  );
  value = value.replace(
    'docs/security.md for the mandatory legacy-stack risk assessment.',
    'docs/security.md for the stack risk assessment.',
  );
  if (preset.preview) {
    value =
      '> Preview preset: Spring Boot ' +
      preset.bootVersion +
      ' is newer than the stable 3.5 line. Verify it in your environment before production use.\n\n' +
      value;
  }
  if (!preset.legacy) {
    value = value.replace(
      'All source, tests and docs are generated unconditionally. Generation does NOT download, execute\ncommands or start services. A separate orchestrator may execute only when authorized.',
      'All source, tests and docs are generated unconditionally. Generation does NOT download, execute\ncommands or start services. A separate verification step may execute only when authorized.',
    );
  }
  return value;
}

function securityFor(security, preset) {
  if (preset.legacy) {
    return security
      .replace('H2 2.1.214', 'H2 ' + preset.h2)
      .replace(
        'pins Spotless 2.30.0 + Google Java Format 1.7 (Java 8 compatible); Checkstyle 9.3 is also Java 8\ncompatible.',
        'pins Spotless ' +
          preset.spotless +
          ' + Google Java Format ' +
          preset.gjf +
          ' (Java 8 compatible); Checkstyle ' +
          preset.checkstyle +
          ' is also Java 8 compatible.',
      );
  }
  const tail = frontendVersionSection(security);
  const header =
    '# ' +
    preset.label +
    ' security posture\n\n' +
    'This starter pins Java ' +
    preset.jdk +
    ', Spring Boot ' +
    preset.bootVersion +
    ' and H2 ' +
    preset.h2 +
    ' for a local demonstration. Pinned versions ensure compatibility, not security; review dependency advisories and SBOMs before deployment.\n\n' +
    'This application is a local demonstration: no authentication, authorization, CSRF protection, rate limiting or production migration framework is supplied. Do not expose it to untrusted networks. Default loopback binding, disabled H2 console, safe Vue text interpolation and generic server errors reduce accidental exposure but do NOT replace those controls. Keep DB files private and protect backups.\n\n';
  return header + (tail ? tail + '\n' : '');
}

export function applyJavaPreset(files, preset) {
  if (!preset || !preset.id) throw new Error('Missing Java preset');
  const out = { ...files };
  const pom = out['backend/pom.xml'];
  if (typeof pom !== 'string') throw new Error('Template is missing backend/pom.xml');
  out['backend/pom.xml'] = pom
    .replace('<version>2.7.18</version>', '<version>' + preset.bootVersion + '</version>')
    .replace(
      '<java.version>1.8</java.version>',
      '<java.version>' + preset.javaVersion + '</java.version>',
    )
    .replace('<version>2.30.0</version>', '<version>' + preset.spotless + '</version>')
    .replace('<version>1.7</version>', '<version>' + preset.gjf + '</version>')
    .replace('<version>9.3</version>', '<version>' + preset.checkstyle + '</version>')
    .replace('<version>2.1.214</version>', '<version>' + preset.h2 + '</version>');
  if (preset.jdk !== '8') {
    for (const key of Object.keys(out)) {
      if (!key.endsWith('.java')) continue;
      out[key] = out[key]
        .replaceAll('javax.persistence', 'jakarta.persistence')
        .replaceAll('javax.validation', 'jakarta.validation')
        .replace(
          /(?:^import (?!static ).+;\n)+/gm,
          (block) => block.trimEnd().split('\n').sort().join('\n') + '\n',
        );
    }
    // Google Java Format sorts jakarta.* before java.*; the base template was Java 8 order.
    const controller = 'backend/src/main/java/com/example/tasks/TaskController.java';
    if (typeof out[controller] === 'string') {
      out[controller] = out[controller].replace(
        'import java.net.URI;\nimport java.util.List;\nimport jakarta.validation.Valid;',
        'import jakarta.validation.Valid;\nimport java.net.URI;\nimport java.util.List;',
      );
    }
    if (String(preset.bootVersion).startsWith('4')) {
      const testFile = 'backend/src/test/java/com/example/tasks/TaskApiTest.java';
      out['backend/pom.xml'] = out['backend/pom.xml'].replace(
        '    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>',
        '    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>\n' +
          '    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-webmvc-test</artifactId><scope>test</scope></dependency>',
      );
      let test = out[testFile];
      test = test
        .replace('import com.fasterxml.jackson.databind.ObjectMapper;\n', '')
        .replace(
          'import org.springframework.test.web.servlet.MockMvc;',
          'import org.springframework.test.web.servlet.MockMvc;\nimport tools.jackson.databind.ObjectMapper;',
        )
        .replace(
          'import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;\n',
          '',
        )
        .replace(
          'import org.springframework.boot.test.context.SpringBootTest;',
          'import org.springframework.boot.test.context.SpringBootTest;\nimport org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;',
        );
      out[testFile] = test;
    }
  }
  out['.java-version'] = preset.jdk + '\n';
  out['README.md'] = readmeFor(out['README.md'], preset);
  out['docs/security.md'] = securityFor(out['docs/security.md'], preset);
  return out;
}

export function templateHash(files) {
  const digest = createHash('sha256');
  for (const key of Object.keys(files).sort()) {
    digest.update(key);
    digest.update('\0');
    digest.update(String(files[key]));
    digest.update('\0');
  }
  return digest.digest('hex');
}

export function goldenStatus(preset, hash) {
  const record = GOLDEN_MANIFEST.presets[preset.id];
  if (!record) {
    return {
      verified: false,
      reason: '该版本档尚未登记发版验收记录；先执行 /sg-verify 或完成发版前本地验收',
      record: null,
    };
  }
  if (record.templateHash !== hash) {
    return {
      verified: false,
      reason: '模板内容与验收记录不一致（模板已变化，需要重新验收）',
      record,
    };
  }
  return { verified: true, reason: null, record };
}

export function listJavaPresets() {
  return JAVA_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    jdk: preset.jdk,
    bootVersion: preset.bootVersion,
    preview: preset.preview,
    legacy: preset.legacy,
  }));
}
