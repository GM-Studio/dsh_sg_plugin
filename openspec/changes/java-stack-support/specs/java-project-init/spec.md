# Java 新项目初始化

## ADDED Requirements

### Requirement: 默认组合一键初始化 (REQ-001)

系统应支持在空目录执行 `/sg-init`，默认以 JDK8 + Maven + Spring Boot 2.7.x 生成可运行的 Spring Boot 后端项目。

#### Scenario: 默认组合生成可运行项目 (AC-001)

- **WHEN** 用户在空目录执行 `/sg-init` 并接受默认技术栈
- **THEN** 生成 `mvnw` / `mvnw.cmd`、`pom.xml`、Spring Boot 启动类、`/health`、JUnit 5 测试与 `.specgate/config.yaml`
- **AND** 在项目根目录执行 `./mvnw -B -ntp test` 退出码为 0

#### Scenario: 默认组合生成首个 change (AC-002)

- **WHEN** 用户确认 H0 并完成初始化
- **THEN** `openspec/changes/add-version/` 包含 `proposal.md`、`design.md`、`tasks.md` 与 `specs/`
- **AND** 状态停在 `H1_PENDING`，等待 M1 校验

### Requirement: 交互式技术栈选择与兼容过滤 (REQ-002)

系统应在初始化时单轮收集 JDK、构建工具、Spring Boot、模块、groupId 与包名，并只展示合法组合。

#### Scenario: 展示合法组合 (AC-003)

- **WHEN** 用户进入 Java 技术栈澄清
- **THEN** JDK 选项为 8/11/17/21，构建工具为 Maven/Gradle Groovy/Gradle Kotlin，Boot 为 2.7.x/3.x/4.x
- **AND** 选择 JDK8 或 JDK11 时，Boot 3.x/4.x 不可选

#### Scenario: 拒绝非法组合 (AC-004)

- **WHEN** 用户通过配置或脚本提交 JDK8 + Boot3
- **THEN** 初始化返回 `JAVA_STACK_INVALID`
- **AND** 输出合法组合列表与失败原因

### Requirement: 非默认组合可初始化 (REQ-003)

系统应支持除默认组合外的合法技术栈矩阵，并生成对应 Wrapper、构建文件与套件配置。

#### Scenario: JDK17 + Boot3 + Maven (AC-005)

- **WHEN** 用户选择 JDK17、Maven、Spring Boot 3.x
- **THEN** 生成 Maven Wrapper、`pom.xml` 与 Boot3 兼容配置
- **AND** `./mvnw -B -ntp test` 退出码为 0

#### Scenario: JDK21 + Boot4 + Gradle (AC-006)

- **WHEN** 用户选择 JDK21、Gradle（Groovy 或 Kotlin）、Spring Boot 4.x
- **THEN** 生成 Gradle Wrapper、`build.gradle(.kts)` 与 Boot4 兼容配置
- **AND** `./gradlew check` 退出码为 0

### Requirement: 初始化幂等且不覆盖已有文件 (REQ-004)

初始化重复执行时不得覆盖用户已有文件、配置或业务代码。

#### Scenario: 重复初始化 (AC-007)

- **WHEN** 用户在已完成初始化的目录再次执行 `/sg-init`
- **THEN** 返回幂等跳过信息
- **AND** 不重复写 `.specgate/config.yaml`，不重复创建 change

#### Scenario: 已存在文件不覆盖 (AC-008)

- **WHEN** 目标目录已有 `pom.xml`、`build.gradle` 或 `src/`
- **THEN** 初始化只补缺失文件
- **AND** 输出被跳过的文件清单
