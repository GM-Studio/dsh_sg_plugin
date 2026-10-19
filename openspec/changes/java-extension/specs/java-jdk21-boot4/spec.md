# JDK21 与 Spring Boot 4.x

## ADDED Requirements

### Requirement: JDK21 + Boot4 Maven 初始化 (REQ-101)

系统应支持 JDK21 + Maven + Spring Boot 4.x 的新项目初始化与测试。

#### Scenario: 初始化 (AC-101)

- **WHEN** 用户选择 JDK21 + Maven + Boot4
- **THEN** 生成 Boot4 `pom.xml`、Wrapper、启动类与测试
- **AND** 状态停在 H1

#### Scenario: 测试通过 (AC-102)

- **WHEN** 执行 `./mvnw -B -ntp verify`
- **THEN** 退出码为 0
- **AND** JUnit XML 与 JaCoCo 报告生成

#### Scenario: 未授权组合 (AC-103)

- **WHEN** 用户选择 JDK21 + Boot2.7 且未显式授权
- **THEN** 返回 `UNSUPPORTED_MATRIX`
- **AND** 输出合法组合

### Requirement: Boot4 兼容配置 (REQ-102)

Boot4 项目应使用 Maven 3.6.3+ 与 Gradle 8.14+/9.x，并锁定依赖。

#### Scenario: 构建工具版本 (AC-104)

- **WHEN** 生成 Boot4 项目
- **THEN** Maven Wrapper 为 3.9.x
- **AND** Gradle Wrapper 为 8.14+
