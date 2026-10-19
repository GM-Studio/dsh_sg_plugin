# Java 后端 + 前端 monorepo

## ADDED Requirements

### Requirement: monorepo 初始化 (REQ-106)

系统应支持 Java 后端 + Vue/React 前端的 monorepo 初始化。

#### Scenario: Vue 前端 (AC-112)

- **WHEN** 选择 Java + Vue
- **THEN** 生成 `backend/` 与 `web/`
- **AND** 根配置同时包含 Java 与前端 suite

#### Scenario: React 前端 (AC-113)

- **WHEN** 选择 Java + React
- **THEN** 生成 `backend/` 与 `web/`
- **AND** 根配置与 CI 覆盖两套技术栈

### Requirement: 变更级套件选择 (REQ-107)

系统应按变更文件选择 suite，避免无关构建。

#### Scenario: 仅后端 (AC-114)

- **WHEN** 变更只涉及 `backend/**`
- **THEN** 只执行 Java suite

#### Scenario: 仅前端 (AC-115)

- **WHEN** 变更只涉及 `web/**`
- **THEN** 只执行前端 suite

#### Scenario: 根构建文件 (AC-116)

- **WHEN** 变更涉及根构建文件
- **THEN** 执行全部 suite
- **AND** 报告触发原因

### Requirement: monorepo CI (REQ-108)

CI 应拆分 Java 与前端 job，日志独立。

#### Scenario: Java job (AC-117)

- **WHEN** CI 运行
- **THEN** Java job 使用 `setup-java` 与缓存

#### Scenario: 前端 job (AC-118)

- **WHEN** CI 运行
- **THEN** 前端 job 使用 `setup-node` 20/22
- **AND** 执行 unit/e2e
