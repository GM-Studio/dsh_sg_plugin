# 既有 Java 仓库零侵入接入

## ADDED Requirements

### Requirement: 识别既有 Java 仓库 (REQ-009)

系统应在既有仓库中识别 Maven/Gradle、JDK、Spring Boot、Wrapper 与模块结构，并记录证据。

#### Scenario: 识别 Maven 项目 (AC-017)

- **WHEN** 仓库包含 `pom.xml`、`spring-boot-starter-parent` 与 `maven.compiler.release`
- **THEN** 识别构建工具为 Maven、Boot 版本与 JDK 版本
- **AND** `env.json` 写入 `jdkSource` 与证据文件

#### Scenario: 识别 Gradle 项目 (AC-018)

- **WHEN** 仓库包含 `build.gradle(.kts)` 与 `org.springframework.boot` 插件
- **THEN** 识别 Gradle DSL、Boot 版本、JDK 版本与模块列表
- **AND** 识别 `gradlew` / `gradlew.bat` 是否存在

### Requirement: 零侵入生成 SpecGate 配置 (REQ-010)

接入既有仓库时不得修改 `pom.xml` 或 `build.gradle`，只生成 SpecGate 配置、环境报告与接入说明。

#### Scenario: 生成配置与报告 (AC-019)

- **WHEN** 用户在既有 Java 仓库执行接入
- **THEN** 生成 `.specgate/config.yaml`、`.specgate/env.json`、`env-report.md` 与 `docs/java-onboarding.md`
- **AND** 配置包含识别到的 Java suite

#### Scenario: 构建文件不变且幂等 (AC-020)

- **WHEN** 接入完成
- **THEN** `git diff` 不包含 `pom.xml` / `build.gradle` 的修改
- **AND** 再次执行接入不重复写配置、不覆盖已有 suite

### Requirement: 既有套件执行与降级提示 (REQ-011)

系统应能执行既有仓库的 Maven/Gradle 测试；质量工具不可用时必须明确降级，不得伪装通过。

#### Scenario: 执行既有测试套件 (AC-021)

- **WHEN** 既有仓库存在可运行的 Maven/Gradle 测试
- **THEN** 执行测试并解析 JUnit XML
- **AND** 输出用例统计与报告路径

#### Scenario: Spotless/JaCoCo 缺失降级 (AC-022)

- **WHEN** 既有仓库没有 Spotless 或 JaCoCo 插件
- **THEN** 格式化回退 `google-java-format` CLI；覆盖率标记 `coverage: unavailable`
- **AND** 生成 `docs/java-onboarding-patches/` 补丁建议
- **AND** 不把缺失能力报告为通过
