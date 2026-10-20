export const LEGACY_MAVEN_MARK = 'add the full Maven Wrapper';
export const WRAPPER_MARK = 'SpecGate project toolchain wrapper v4';

/**
 * 项目内 Maven 包装器（Windows）：自动发现 .specgate/toolchains 下的 JDK 与 Maven
 * （当前目录，或 monorepo 的上一级），在未显式设置时补齐 JAVA_HOME / MAVEN_OPTS，
 * 因此不需要先激活 env 脚本也能直接 ./mvnw。找不到时才回退 PATH 上的 mvn。
 */
export function mavenWrapperCmd() {
  return [
    '@echo off',
    'setlocal',
    'rem ' + WRAPPER_MARK,
    'set "SG_ROOT=%~dp0"',
    'set "SG_TC="',
    'if exist "%SG_ROOT%.specgate\\toolchains" set "SG_TC=%SG_ROOT%.specgate\\toolchains"',
    'if not defined SG_TC if exist "%SG_ROOT%..\\.specgate\\toolchains" set "SG_TC=%SG_ROOT%..\\.specgate\\toolchains"',
    'if defined SG_TC if not defined JAVA_HOME (',
    '  for /d %%J in ("%SG_TC%\\jdk-*") do (',
    '    if exist "%%~fJ\\bin\\javac.exe" set "JAVA_HOME=%%~fJ"',
    '  )',
    ')',
    'if defined SG_TC if not defined MAVEN_OPTS if exist "%SG_TC%\\..\\m2repo" set "MAVEN_OPTS=-Dmaven.repo.local=%SG_TC%\\..\\m2repo"',
    'if defined SG_TC if not defined MAVEN_ARGS if exist "%SG_TC%\\..\\mirrors\\settings.xml" set MAVEN_ARGS=-s "%SG_TC%\\..\\mirrors\\settings.xml"',
    'if defined SG_TC (',
    '  for /d %%D in ("%SG_TC%\\apache-maven-*") do (',
    '    if exist "%%~fD\\bin\\mvn.cmd" (',
    '      call "%%~fD\\bin\\mvn.cmd" %*',
    '      exit /b %ERRORLEVEL%',
    '    )',
    '  )',
    ')',
    'where mvn >nul 2>nul',
    'if %ERRORLEVEL%==0 (',
    '  mvn %*',
    '  exit /b %ERRORLEVEL%',
    ')',
    'echo Maven not found. Run /sg-env install (SpecGate) or install Maven 3.9.x and add it to PATH.',
    'exit /b 1',
    '',
  ].join('\r\n');
}

/** 项目内 Maven 包装器（POSIX sh），同样自动发现 JDK/Maven 与项目内本地仓库。 */
export function mavenWrapperSh() {
  return [
    '#!/bin/sh',
    '# ' + WRAPPER_MARK,
    '# Prefer .specgate/toolchains (current dir, then parent for monorepo submodules).',
    'set -e',
    'DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'SG_TC=""',
    'if [ -d "$DIR/.specgate/toolchains" ]; then SG_TC="$DIR/.specgate/toolchains"; fi',
    'if [ -z "$SG_TC" ] && [ -d "$DIR/../.specgate/toolchains" ]; then SG_TC="$DIR/../.specgate/toolchains"; fi',
    'if [ -n "$SG_TC" ] && [ -z "$JAVA_HOME" ]; then',
    '  for jdk in "$SG_TC"/jdk-*; do',
    '    if [ -x "$jdk/bin/javac" ]; then JAVA_HOME="$jdk"; fi',
    '  done',
    'fi',
    'if [ -n "$SG_TC" ] && [ -z "$MAVEN_OPTS" ] && [ -d "$SG_TC/../m2repo" ]; then',
    '  MAVEN_OPTS="-Dmaven.repo.local=$SG_TC/../m2repo"',
    'fi',
    'if [ -n "$SG_TC" ] && [ -z "$MAVEN_ARGS" ] && [ -f "$SG_TC/../mirrors/settings.xml" ]; then',
    '  MAVEN_ARGS="-s $SG_TC/../mirrors/settings.xml"',
    'fi',
    'if [ -n "$SG_TC" ]; then',
    '  for candidate in "$SG_TC"/apache-maven-*/bin/mvn; do',
    '    if [ -x "$candidate" ]; then',
    '      exec "$candidate" "$@"',
    '    fi',
    '  done',
    'fi',
    'if command -v mvn >/dev/null 2>&1; then',
    '  exec mvn "$@"',
    'fi',
    'echo "Maven not found. Run /sg-env install (SpecGate) or install Maven 3.9.x and add it to PATH." >&2',
    'exit 1',
    '',
  ].join('\n');
}
