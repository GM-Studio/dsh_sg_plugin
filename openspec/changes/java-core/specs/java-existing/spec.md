# 既有 Maven 仓库接入

## ADDED Requirements

### Requirement: 识别既有 Maven 仓库 (REQ-012)

系统应识别既有 Maven 项目的 JDK、Spring Boot、Wrapper 与模块结构。

#### Scenario: 识别 Maven/JDK/Boot (AC-031)

- **WHEN** 仓库包含 `pom.xml`、`spring-boot-starter-parent` 与 `maven.compiler.release`
- **THEN** 识别 Maven、Boot 版本与 JDK 版本
- **AND** `env.json` 写入证据文件

#### Scenario: 识别 Wrapper 与模块 (AC-032)

- **WHEN** 仓库有 `mvnw` 或 `<modules>`
- **THEN** 记录 Wrapper 与模块列表
- **AND** 为每个模块生成候选 suite

### Requirement: 零侵入生成配置 (REQ-013)

接入不得修改 `pom.xml`，只生成 SpecGate 配置与报告。

#### Scenario: 生成配置与报告 (AC-033)

- **WHEN** 用户执行既有仓库接入
- **THEN** 生成 `.specgate/config.yaml`、`env.json`、`env-report.md` 与 `docs/java-onboarding.md`
- **AND** 配置包含 Maven suite

#### Scenario: 构建文件不变且幂等 (AC-034)

- **WHEN** 接入完成
- **THEN** `git diff` 不包含 `pom.xml`
- **AND** 再次接入不重复写配置

### Requirement: 既有套件执行与降级 (REQ-014)

系统应执行既有 Maven 测试；质量能力缺失时必须明确降级。

#### Scenario: 执行既有测试 (AC-035)

- **WHEN** 仓库存在可运行的 Maven 测试
- **THEN** 执行测试并解析 JUnit XML
- **AND** 输出用例统计与报告路径

#### Scenario: 覆盖率缺失降级 (AC-036)

- **WHEN** 仓库没有 JaCoCo 插件
- **THEN** 标记 `coverage: unavailable`
- **AND** 默认 `coverage.blocking: false`
- **AND** 生成 `pom.xml` 补丁建议
