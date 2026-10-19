import path from 'node:path';
import { exists, readText } from './util/fsx.js';

const MAVEN_BUILD_FILE = 'pom.xml';
const GRADLE_GROOVY_FILE = 'build.gradle';
const GRADLE_KOTLIN_FILE = 'build.gradle.kts';
const GRADLE_SETTINGS = ['settings.gradle', 'settings.gradle.kts'];

const MAVEN_JDK_FIELDS = [
  'maven.compiler.release',
  'maven.compiler.source',
  'maven.compiler.target',
  'java.version',
];

const GRADLE_BOOT_PATTERNS = [
  /id\s*\(?\s*['"]org\.springframework\.boot['"]\s*\)?\s*version\s*\(?\s*['"]([^'"]+)['"]/,
  /['"]org\.springframework\.boot:spring-boot-gradle-plugin:([^'"]+)['"]/,
  /spring-boot-gradle-plugin:([\w.+-]+)/,
];

const GRADLE_JDK_PATTERNS = [
  {
    field: 'sourceCompatibility',
    pattern: /sourceCompatibility\s*=\s*JavaVersion\.VERSION_(\d+)(?:_(\d+))?/,
  },
  {
    field: 'sourceCompatibility',
    pattern: /sourceCompatibility\s*=\s*['"]?(\d+(?:\.\d+)*)['"]?/,
  },
  {
    field: 'targetCompatibility',
    pattern: /targetCompatibility\s*=\s*JavaVersion\.VERSION_(\d+)(?:_(\d+))?/,
  },
  {
    field: 'targetCompatibility',
    pattern: /targetCompatibility\s*=\s*['"]?(\d+(?:\.\d+)*)['"]?/,
  },
  { field: 'java.toolchain', pattern: /JavaLanguageVersion\.of\(\s*(\d+)\s*\)/ },
];

function readIfExists(filePath) {
  if (!exists(filePath)) return null;
  try {
    return readText(filePath);
  } catch {
    return null;
  }
}

/** Normalize a JDK value (17, 1.8, JavaVersion.VERSION_1_8) to a major version string. */
export function validateJavaSelection({ jdk, bootVersion } = {}) {
  const major = Number(normalizeJdk(jdk));
  const boot = String(bootVersion || '').startsWith('3')
    ? 3
    : String(bootVersion || '').startsWith('2.7')
      ? 2
      : null;
  const errors = [];
  if (![8, 11, 17, 21].includes(major)) errors.push(`JDK ${jdk} 不是支持的 LTS（8/11/17/21）`);
  if (boot === null)
    errors.push(`Spring Boot ${bootVersion || '未知'} 不在支持范围（2.7.x / 3.x）`);
  if (boot === 2 && ![8, 11, 17].includes(major))
    errors.push(`Boot 2.7 需要 JDK 8/11/17，当前 ${jdk}`);
  if (boot === 3 && ![17, 21].includes(major)) errors.push(`Boot 3.x 需要 JDK 17/21，当前 ${jdk}`);
  return { ok: errors.length === 0, errors };
}
export function normalizeJdk(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/^["']|["']$/g, '');
  const match = /(\d+)(?:[._](\d+))?/.exec(text);
  if (!match) return null;
  const first = Number(match[1]);
  const second = match[2] === undefined ? null : Number(match[2]);
  if (first === 1 && second !== null && second >= 2) return String(second);
  return String(first);
}

function resolveProperty(value, properties) {
  let current = String(value ?? '').trim();
  for (let depth = 0; depth < 5; depth += 1) {
    const match = /^\$\{([^}]+)\}$/.exec(current);
    if (!match) break;
    const next = properties[match[1]];
    if (next === undefined || String(next).trim() === current) break;
    current = String(next).trim();
  }
  return current;
}

function pomProperties(text) {
  const properties = {};
  for (const block of text.matchAll(/<properties>([\s\S]*?)<\/properties>/g)) {
    for (const entry of block[1].matchAll(/<([A-Za-z0-9_.-]+)>\s*([^<]*?)\s*<\/\1>/g)) {
      properties[entry[1]] = entry[2].trim();
    }
  }
  return properties;
}

function pomBootVersion(text, properties) {
  for (const parent of text.matchAll(/<parent>([\s\S]*?)<\/parent>/g)) {
    const artifact = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/.exec(parent[1]);
    if (artifact?.[1] !== 'spring-boot-starter-parent') continue;
    const version = /<version>\s*([^<]+?)\s*<\/version>/.exec(parent[1]);
    if (!version) continue;
    const value = resolveProperty(version[1], properties);
    if (value) return { version: value, field: 'spring-boot-starter-parent' };
  }

  const bomPatterns = [
    /<artifactId>\s*spring-boot-dependencies\s*<\/artifactId>\s*<version>\s*([^<]+?)\s*<\/version>/,
    /<version>\s*([^<]+?)\s*<\/version>\s*<artifactId>\s*spring-boot-dependencies\s*<\/artifactId>/,
  ];
  for (const pattern of bomPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const value = resolveProperty(match[1], properties);
    if (value) return { version: value, field: 'spring-boot-dependencies' };
  }

  if (properties['spring-boot.version']) {
    return { version: properties['spring-boot.version'], field: 'spring-boot.version' };
  }
  return null;
}

function pomJdk(text, properties) {
  for (const field of MAVEN_JDK_FIELDS) {
    const pattern = new RegExp(`<${field.replace(/\./g, '\\.')}>\\s*([^<]+?)\\s*</`);
    const match = pattern.exec(text);
    if (!match) continue;
    const value = normalizeJdk(resolveProperty(match[1], properties));
    if (value) return { jdk: value, field };
  }
  return null;
}

function pomModules(text) {
  const block = /<modules>([\s\S]*?)<\/modules>/.exec(text);
  if (!block) return [];
  return [...block[1].matchAll(/<module>\s*([^<]+?)\s*<\/module>/g)]
    .map((match) => match[1].trim().replace(/^\.\//, '').replace(/\\/g, '/'))
    .filter(Boolean);
}

function gradleBootVersion(text) {
  for (const pattern of GRADLE_BOOT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[1].trim();
  }
  return null;
}

function gradleJdk(text) {
  for (const { field, pattern } of GRADLE_JDK_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const raw = match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`;
    const value = normalizeJdk(raw);
    if (value) return { jdk: value, field };
  }
  return null;
}

function gradleModules(files) {
  const modules = [];
  for (const file of files) {
    const text = readIfExists(file);
    if (!text) continue;
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*include\s*\(?\s*(.+)$/.exec(line);
      if (!match) continue;
      for (const quoted of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
        modules.push(quoted[1].replace(/^:/, '').replace(/:/g, '/'));
      }
    }
  }
  return [...new Set(modules)];
}

function detectWrapper(root) {
  const mavenScript = ['mvnw', 'mvnw.cmd'].find((name) => exists(path.join(root, name)));
  const maven = Boolean(mavenScript) || exists(path.join(root, '.mvn', 'wrapper'));
  const gradleScript = ['gradlew', 'gradlew.bat'].find((name) => exists(path.join(root, name)));
  const gradle = Boolean(gradleScript) || exists(path.join(root, 'gradle', 'wrapper'));
  return {
    wrapper: { maven, gradle },
    evidence: [
      maven && {
        file: mavenScript || '.mvn/wrapper',
        field: 'wrapper',
        value: 'maven',
      },
      gradle && {
        file: gradleScript || 'gradle/wrapper',
        field: 'wrapper',
        value: 'gradle',
      },
    ].filter(Boolean),
  };
}

function jdkFromJavaHome(javaHome) {
  if (!javaHome) return null;
  const release = path.join(javaHome, 'release');
  if (exists(release)) {
    const text = readIfExists(release) || '';
    const match = /JAVA_VERSION\s*=\s*["']?([^"'\r\n]+)["']?/.exec(text);
    if (match) {
      const value = normalizeJdk(match[1]);
      if (value) return value;
    }
  }
  const base = path.basename(path.resolve(javaHome));
  const match =
    /(?:jdk|java|jvm)[-_]?(\d+(?:[._]\d+)*)/i.exec(base) || /(\d+(?:[._]\d+)*)/.exec(base);
  return match ? normalizeJdk(match[1]) : null;
}

/**
 * Detect a Java project without running Maven/Gradle and without network access.
 * `ok` is true when a Maven or Gradle build file was found.
 */
export function detectJavaProject(root, { env = process.env } = {}) {
  const evidence = [];
  const wrapper = detectWrapper(root);
  evidence.push(...wrapper.evidence);

  let buildTool = null;
  let gradleDsl = null;
  let bootVersion = null;
  let jdk = null;
  let jdkSource = null;
  let modules = [];

  const pomFile = path.join(root, MAVEN_BUILD_FILE);
  const groovyFile = path.join(root, GRADLE_GROOVY_FILE);
  const kotlinFile = path.join(root, GRADLE_KOTLIN_FILE);
  const pomText = readIfExists(pomFile);
  const groovyText = readIfExists(groovyFile);
  const kotlinText = readIfExists(kotlinFile);

  if (groovyText !== null) gradleDsl = 'groovy';
  else if (kotlinText !== null) gradleDsl = 'kotlin';

  if (pomText !== null) {
    buildTool = 'maven';
    evidence.push({ file: MAVEN_BUILD_FILE, field: 'buildTool', value: 'maven' });
    const properties = pomProperties(pomText);

    const boot = pomBootVersion(pomText, properties);
    if (boot) {
      bootVersion = boot.version;
      evidence.push({ file: MAVEN_BUILD_FILE, field: boot.field, value: boot.version });
    }

    const compiler = pomJdk(pomText, properties);
    if (compiler) {
      jdk = compiler.jdk;
      jdkSource = 'pom';
      evidence.push({ file: MAVEN_BUILD_FILE, field: compiler.field, value: compiler.jdk });
    }

    modules = pomModules(pomText);
    if (modules.length > 0) {
      evidence.push({ file: MAVEN_BUILD_FILE, field: 'modules', value: modules.join(',') });
    }
  } else if (groovyText !== null || kotlinText !== null) {
    buildTool = 'gradle';
    const gradleFile = groovyText !== null ? GRADLE_GROOVY_FILE : GRADLE_KOTLIN_FILE;
    const gradleText = groovyText !== null ? groovyText : kotlinText;
    evidence.push({ file: gradleFile, field: 'buildTool', value: 'gradle' });
    evidence.push({ file: gradleFile, field: 'gradleDsl', value: gradleDsl });

    bootVersion = gradleBootVersion(gradleText);
    if (bootVersion) {
      evidence.push({ file: gradleFile, field: 'org.springframework.boot', value: bootVersion });
    }

    const compiler = gradleJdk(gradleText);
    if (compiler) {
      jdk = compiler.jdk;
      jdkSource = 'gradle';
      evidence.push({ file: gradleFile, field: compiler.field, value: compiler.jdk });
    }

    const settingsFile = GRADLE_SETTINGS.find((name) => exists(path.join(root, name)));
    modules = gradleModules(
      GRADLE_SETTINGS.map((name) => path.join(root, name)).filter((file) => exists(file)),
    );
    if (modules.length > 0) {
      evidence.push({
        file: settingsFile || GRADLE_SETTINGS[0],
        field: 'include',
        value: modules.join(','),
      });
    }
  }

  if (!jdk) {
    const versionFile = path.join(root, '.java-version');
    const raw = readIfExists(versionFile);
    if (raw) {
      const value = normalizeJdk(raw);
      if (value) {
        jdk = value;
        jdkSource = '.java-version';
        evidence.push({ file: '.java-version', field: 'jdk', value });
      }
    }
  }

  if (!jdk) {
    const value = jdkFromJavaHome(env.JAVA_HOME);
    if (value) {
      jdk = value;
      jdkSource = 'JAVA_HOME';
      evidence.push({ file: 'JAVA_HOME', field: 'jdk', value });
    }
  }

  return {
    ok: buildTool !== null,
    buildTool,
    gradleDsl,
    bootVersion,
    jdk,
    jdkSource,
    wrapper: wrapper.wrapper,
    modules,
    evidence,
  };
}
