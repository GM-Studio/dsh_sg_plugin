# Java 核心项目初始化

## ADDED Requirements

### Requirement: 默认 Maven 组合初始化 (REQ-001)

系统应支持在空目录执行 `/sg-init`，默认以 JDK8 + Maven + Spring Boot 2.7.x 生成可运行的 Spring Boot 后端项目。

#### Scenario: 默认组合生成可运行项目 (AC-001)

- **WHEN** 用户接受默认技术栈
- **THEN** 生成 `mvnw` / `mvnw.cmd`、`pom.xml`、启动类、`/health`、JUnit 5 测试与 `.specgate/config.yaml`
- **AND** `./mvnw -B -ntp test` 退出码为 0

#### Scenario: 默认组合生成首个 change (AC-002)

- **WHEN** 用户确认 H0
- **THEN** 生成 `openspec/changes/add-version/` 的 proposal/design/tasks/specs
- **AND** 状态停在 `H1_PENDING`

#### Scenario: 重复初始化幂等 (AC-003)

- **WHEN** 用户再次执行 `/sg-init`
- **THEN** 返回幂等跳过信息
- **AND** 不覆盖已有 `pom.xml`、`src/` 或配置

### Requirement: 交互式选择与兼容过滤 (REQ-002)

系统应单轮收集 JDK、Boot、模块、groupId 与包名，并只展示合法组合。

#### Scenario: 展示合法选项 (AC-004)

- **WHEN** 用户进入 Java 澄清
- **THEN** JDK 为 8/11/17，Boot 为 2.7.x/3.x
- **AND** JDK8/11 时 Boot3 不可选

#### Scenario: 拒绝非法组合 (AC-005)

- **WHEN** 提交 JDK8 + Boot3
- **THEN** 返回 `JAVA_STACK_INVALID`
- **AND** 输出合法组合列表

#### Scenario: JDK 缺失可诊断 (AC-006)

- **WHEN** 请求的 JDK 未安装
- **THEN** 返回 `JDK_NOT_FOUND`
- **AND** 输出已检测版本、安装指引与可用的替代 JDK

### Requirement: 合法替代组合可初始化 (REQ-003)

系统应支持 JDK11 + Boot2.7、JDK17 + Boot3 等合法组合。

#### Scenario: JDK11 + Boot2.7 (AC-007)

- **WHEN** 用户选择 JDK11 + Maven + Boot2.7
- **THEN** 生成兼容 `pom.xml` 与 Wrapper
- **AND** `./mvnw -B -ntp test` 通过

#### Scenario: JDK17 + Boot3 (AC-008)

- **WHEN** 用户选择 JDK17 + Maven + Boot3
- **THEN** 生成 Boot3 兼容 `pom.xml`
- **AND** `./mvnw -B -ntp test` 通过

#### Scenario: 模块与 JPA 选择 (AC-009)

- **WHEN** 用户选择 Web + Validation + Actuator + Test，并勾选 Data JPA
- **THEN** 生成对应 starter 与 H2 测试配置
- **AND** 未勾选 JPA 时不生成 JPA 依赖

### Requirement: 已存在文件不覆盖 (REQ-004)

初始化不得覆盖用户已有构建文件或业务代码。

#### Scenario: 已有 pom.xml 与 src (AC-010)

- **WHEN** 目录已有 `pom.xml` 或 `src/`
- **THEN** 只补缺失文件
- **AND** 输出跳过清单
