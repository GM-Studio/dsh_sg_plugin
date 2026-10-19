# Gradle 项目支持

## ADDED Requirements

### Requirement: Gradle Groovy/Kotlin 初始化 (REQ-103)

系统应支持 Gradle Groovy DSL 与 Kotlin DSL 的新项目初始化。

#### Scenario: Groovy DSL (AC-105)

- **WHEN** 用户选择 Gradle Groovy
- **THEN** 生成 `build.gradle`、`settings.gradle`、Wrapper
- **AND** `./gradlew check` 退出码为 0

#### Scenario: Kotlin DSL (AC-106)

- **WHEN** 用户选择 Gradle Kotlin DSL
- **THEN** 生成 `build.gradle.kts`、`settings.gradle.kts`、Wrapper
- **AND** `./gradlew check` 退出码为 0

### Requirement: Gradle suite 与报告 (REQ-104)

系统应执行 Gradle 测试，解析 JUnit XML 与 JaCoCo，支持多模块。

#### Scenario: JUnit XML (AC-107)

- **WHEN** 执行 `check` 或 `test`
- **THEN** 解析 `build/test-results/test/*.xml`
- **AND** AC 标签映射正确

#### Scenario: JaCoCo (AC-108)

- **WHEN** 启用 `jacocoTestReport`
- **THEN** 解析 `build/reports/jacoco/test/jacocoTestReport.xml`
- **AND** 用于 G8 阈值

#### Scenario: 多模块 (AC-109)

- **WHEN** 根项目包含多个 subproject
- **THEN** 支持根 `check` 与 `:module:check`
- **AND** 聚合报告

### Requirement: Gradle Wrapper 与版本 (REQ-105)

系统应优先使用 Wrapper，并按 Boot 版本锁定 Gradle 版本。

#### Scenario: 版本策略 (AC-110)

- **WHEN** Boot2.7
- **THEN** 使用 Gradle 7.6.6
- **WHEN** Boot3/4
- **THEN** 使用 Gradle 8.14.6

#### Scenario: Wrapper 缺失或损坏 (AC-111)

- **WHEN** 无 `gradlew` 且系统无 Gradle，或 wrapper jar 校验失败
- **THEN** 返回 `BUILD_TOOL_NOT_FOUND` 或 `GRADLE_WRAPPER_INVALID`
- **AND** 输出修复指引
