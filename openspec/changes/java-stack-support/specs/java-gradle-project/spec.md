# Gradle 项目特性交付

## ADDED Requirements

### Requirement: Gradle Groovy/Kotlin 初始化 (REQ-015)

系统应同时支持 Gradle Groovy DSL 与 Kotlin DSL 的新项目初始化与既有项目接入。

#### Scenario: Groovy DSL (AC-029)

- **WHEN** 用户选择 Gradle Groovy
- **THEN** 生成 `build.gradle`、`settings.gradle`、`gradlew` / `gradlew.bat`
- **AND** `./gradlew check` 退出码为 0

#### Scenario: Kotlin DSL (AC-030)

- **WHEN** 用户选择 Gradle Kotlin DSL
- **THEN** 生成 `build.gradle.kts`、`settings.gradle.kts`、`gradlew` / `gradlew.bat`
- **AND** `./gradlew check` 退出码为 0

### Requirement: Gradle suite 与报告 (REQ-016)

系统应执行 Gradle 测试并解析 JUnit XML 与 JaCoCo 报告，支持多模块。

#### Scenario: JUnit XML 解析 (AC-031)

- **WHEN** Gradle 执行 `check` 或 `test`
- **THEN** 解析 `build/test-results/test/*.xml`
- **AND** 将 `[AC-xxx]` 标签映射到变更 AC

#### Scenario: JaCoCo 报告 (AC-032)

- **WHEN** 项目启用 `jacocoTestReport`
- **THEN** 解析 `build/reports/jacoco/test/jacocoTestReport.xml`
- **AND** 用于 G8 覆盖率阈值判定

#### Scenario: 多模块 Gradle (AC-033)

- **WHEN** 根项目包含多个 subproject
- **THEN** 可按根 `check` 或 `:module:check` 执行
- **AND** 聚合各模块测试与覆盖率报告

### Requirement: Wrapper 与版本兼容 (REQ-017)

系统应优先使用 Gradle Wrapper，并对 Boot 2.7 与 Boot 3/4 使用不同 Gradle 版本策略。

#### Scenario: Wrapper 版本策略 (AC-034)

- **WHEN** 项目使用 Boot 2.7
- **THEN** 使用 Gradle 7.6.x Wrapper
- **WHEN** 项目使用 Boot 3.x/4.x
- **THEN** 使用 Gradle 8.14+ Wrapper

#### Scenario: Wrapper 缺失 (AC-035)

- **WHEN** 项目没有 `gradlew` / `gradlew.bat` 且系统无 Gradle
- **THEN** 返回 `BUILD_TOOL_NOT_FOUND`
- **AND** 输出生成 Wrapper 或安装 Gradle 的指引
