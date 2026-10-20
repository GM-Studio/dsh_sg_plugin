import fs from 'node:fs';
import path from 'node:path';

const PRESETS = {
  aliyun: {
    npm: 'https://registry.npmmirror.com',
    pypi: 'https://mirrors.aliyun.com/pypi/simple/',
    maven: 'https://maven.aliyun.com/repository/public',
    gradle: 'https://maven.aliyun.com/repository/public',
  },
  tsinghua: {
    npm: 'https://registry.npmmirror.com',
    pypi: 'https://pypi.tuna.tsinghua.edu.cn/simple',
    maven: 'https://maven.aliyun.com/repository/public',
    gradle: 'https://maven.aliyun.com/repository/public',
  },
};

export function resolveMirrors(env = process.env) {
  const preset = String(env.SG_MIRROR || 'aliyun').toLowerCase();
  const base = PRESETS[preset] || PRESETS.aliyun;
  const pypi = env.SG_PYPI_INDEX || base.pypi;
  return {
    preset: PRESETS[preset] ? preset : 'aliyun',
    npm: env.SG_NPM_REGISTRY || base.npm,
    pypi,
    pypiHost: (() => {
      try {
        return new URL(pypi).hostname;
      } catch {
        return '';
      }
    })(),
    maven: env.SG_MAVEN_MIRROR || base.maven,
    gradle: env.SG_GRADLE_MIRROR || base.gradle,
    mavenDist:
      env.SG_MAVEN_DIST ||
      (env.SG_MAVEN_MIRROR || base.maven) +
        '/org/apache/maven/apache-maven/3.9.11/apache-maven-3.9.11-bin.zip',
    gradleDist:
      env.SG_GRADLE_DIST || 'https://mirrors.cloud.tencent.com/gradle/gradle-8.14-bin.zip',
    jdk: env.SG_JDK_MIRROR || 'https://mirrors.huaweicloud.com/openjdk',
  };
}

export function jdkDownloadUrl(mirrors, major, platform, arch) {
  const table = {
    11: '11.0.2',
    13: '13.0.2',
    17: '17.0.2',
    21: '21.0.2',
  };
  const version = table[Number(major)];
  if (!version) return null;
  const os =
    platform === 'win32'
      ? 'windows'
      : platform === 'darwin'
        ? Number(major) === 13
          ? 'osx'
          : 'macos'
        : 'linux';
  const cpu = arch === 'arm64' ? 'aarch64' : 'x64';
  const ext = platform === 'win32' ? '.zip' : '.tar.gz';
  return mirrors.jdk + '/' + version + '/openjdk-' + version + '_' + os + '-' + cpu + '_bin' + ext;
}

export function writeMirrorFiles(root, mirrors) {
  const dir = path.join(root, '.specgate', 'mirrors');
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    npmrc: 'registry=' + mirrors.npm + '\n',
    'pip.ini':
      '[global]\nindex-url = ' +
      mirrors.pypi +
      '\ntrusted-host = ' +
      mirrors.pypiHost +
      '\ndisable-pip-version-check = true\n',
    'settings.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<settings>',
      '  <mirrors>',
      '    <mirror>',
      '      <id>specgate-mirror</id>',
      '      <mirrorOf>*</mirrorOf>',
      '      <name>SpecGate domestic mirror</name>',
      '      <url>' + mirrors.maven + '</url>',
      '    </mirror>',
      '  </mirrors>',
      '</settings>',
      '',
    ].join('\n'),
    'init.gradle': [
      'allprojects {',
      '  repositories {',
      "    maven { url '" + mirrors.gradle + "' }",
      '  }',
      '}',
      'settingsEvaluated { settings ->',
      '  settings.pluginManagement {',
      '    repositories {',
      "      maven { url '" + mirrors.gradle + "' }",
      '    }',
      '  }',
      '}',
      '',
    ].join('\n'),
    'uv.toml': 'index-url = "' + mirrors.pypi + '"\n',
    'mirrors.json':
      JSON.stringify(
        {
          schemaVersion: 1,
          preset: mirrors.preset,
          npm: mirrors.npm,
          pypi: mirrors.pypi,
          maven: mirrors.maven,
          gradle: mirrors.gradle,
        },
        null,
        2,
      ) + '\n',
  };
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  const projectNpmrc = path.join(root, '.npmrc');
  if (!fs.existsSync(projectNpmrc)) {
    fs.writeFileSync(projectNpmrc, 'registry=' + mirrors.npm + '\n', 'utf8');
  }
  return {
    dir,
    npmrc: path.join(dir, 'npmrc'),
    projectNpmrc,
    pip: path.join(dir, 'pip.ini'),
    mavenSettings: path.join(dir, 'settings.xml'),
    gradleInit: path.join(dir, 'init.gradle'),
    uv: path.join(dir, 'uv.toml'),
  };
}

export function mirrorEnv(mirrors, files, base = process.env) {
  return {
    ...base,
    NPM_CONFIG_USERCONFIG: files.npmrc,
    npm_config_registry: mirrors.npm,
    NPM_CONFIG_REGISTRY: mirrors.npm,
    PIP_CONFIG_FILE: files.pip,
    PIP_INDEX_URL: mirrors.pypi,
    PIP_TRUSTED_HOST: mirrors.pypiHost,
    UV_DEFAULT_INDEX: mirrors.pypi,
    UV_INDEX_URL: mirrors.pypi,
    UV_CONFIG_FILE: files.uv,
  };
}
