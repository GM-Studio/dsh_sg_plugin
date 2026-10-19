# Java 后端 + 前端 monorepo 交付

## ADDED Requirements

### Requirement: monorepo 初始化与目录约定 (REQ-018)

系统应支持 Java 后端 + Vue/React 前端的 monorepo 初始化，并生成统一配置。

#### Scenario: Vue 前端 (AC-036)

- **WHEN** 用户选择 Java 后端 + Vue 前端
- **THEN** 生成 `backend/` Java 项目与 `web/` Vue 项目
- **AND** 根 `.specgate/config.yaml` 同时包含 Java 与前端 suite

#### Scenario: React 前端 (AC-037)

- **WHEN** 用户选择 Java 后端 + React 前端
- **THEN** 生成 `backend/` Java 项目与 `web/` React 项目
- **AND** 根配置文件与 CI 同时覆盖两套技术栈

### Requirement: 变更级套件选择 (REQ-019)

系统应根据本次变更文件选择需要执行的 suite，避免无关的前端/后端构建。

#### Scenario: 仅后端变更 (AC-038)

- **WHEN** 本次变更只涉及 `backend/**`
- **THEN** 只执行 Java suite
- **AND** 不执行前端 unit/e2e

#### Scenario: 仅前端变更 (AC-039)

- **WHEN** 本次变更只涉及 `web/**`
- **THEN** 只执行前端 suite
- **AND** 不执行 Java 构建

#### Scenario: 根构建文件变更 (AC-040)

- **WHEN** 本次变更涉及根 `pom.xml`、`build.gradle(.kts)` 或 `package.json`
- **THEN** 执行 Java 与前端全部 suite
- **AND** 报告标明触发原因

### Requirement: monorepo CI 拆分 (REQ-020)

生成的 CI 应把 Java 与前端拆成独立 job，任一失败不影响另一 job 的日志可读性。

#### Scenario: Java job (AC-041)

- **WHEN** CI 在 monorepo 中运行
- **THEN** Java job 使用 `setup-java` 与 JDK 矩阵
- **AND** 缓存 Maven/Gradle 依赖

#### Scenario: 前端 job (AC-042)

- **WHEN** CI 在 monorepo 中运行
- **THEN** 前端 job 使用 `setup-node` 与 Node 20/22
- **AND** 执行前端 unit/e2e
