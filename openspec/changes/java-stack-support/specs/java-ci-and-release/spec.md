# Java CI 矩阵与发布前质量

## ADDED Requirements

### Requirement: JDK 与构建工具矩阵 CI (REQ-021)

系统应为 Java 项目生成 GitHub Actions CI，覆盖 JDK 与构建工具矩阵，并复用依赖缓存。

#### Scenario: Ubuntu 全矩阵 (AC-043)

- **WHEN** Java 项目生成 CI
- **THEN** Ubuntu job 覆盖 JDK 8/11/17/21 与 Maven/Gradle
- **AND** 每个组合执行 Wrapper 测试

#### Scenario: Windows 冒烟 (AC-044)

- **WHEN** Java 项目生成 CI
- **THEN** Windows job 只跑默认组合 JDK8 + Maven + Boot2.7
- **AND** 使用 `mvnw.cmd` 执行

#### Scenario: 依赖缓存 (AC-045)

- **WHEN** CI 运行
- **THEN** 缓存 `~/.m2/repository` 与 `~/.gradle/caches`
- **AND** 缓存键包含 JDK 与构建工具版本

### Requirement: 发布前质量检查 (REQ-022)

Java 相关变更在发布前必须通过 lint、测试与打包检查；真实 Java 集成测试可作为可选 job。

#### Scenario: 发布前检查 (AC-046)

- **WHEN** 执行发布流程
- **THEN** `npm run lint`、`npm test`、`npm run pack:check` 全部通过
- **AND** Java 模板与示例通过结构校验

#### Scenario: 可选 Java 集成测试 (AC-047)

- **WHEN** CI 环境提供 JDK
- **THEN** 运行真实 Java 集成测试
- **AND** 无 JDK 时跳过并记录原因，不伪装通过

### Requirement: 文档与回归 (REQ-023)

本次变更必须补齐双语文档，并保证既有技术栈无回归。

#### Scenario: 文档 (AC-048)

- **WHEN** 变更完成
- **THEN** README / README.zh.md / CHANGELOG 包含 Java 支持说明
- **AND** `docs/design/java-support-review.md` 与实现文档一致

#### Scenario: Node/Python 回归 (AC-049)

- **WHEN** 执行全量测试
- **THEN** 现有 Node/Python/Vue/React/monorepo 初始化与 suite 测试全部通过
- **AND** 现有 177 项测试无失败

### Requirement: 安全与可复现 (REQ-024)

构建命令必须由配置生成，不拼接任务文本；CI 使用最小权限；版本与 Wrapper 必须可复现。

#### Scenario: 命令生成安全 (AC-050)

- **WHEN** 执行 Maven/Gradle suite
- **THEN** 命令参数来自白名单字段 `goals` / `tasks`
- **AND** 不把任务文本或用户自由输入拼进 shell 命令
- **AND** CI 权限仅包含 checkout 与缓存所需的最小权限

#### Scenario: 版本可复现 (AC-051)

- **WHEN** 同一配置在另一台机器执行
- **THEN** JDK、Boot、Maven/Gradle Wrapper、质量工具版本一致
- **AND** 报告记录实际版本与来源
