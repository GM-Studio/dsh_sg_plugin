# Java 核心 CI 与发布质量

## ADDED Requirements

### Requirement: Maven CI (REQ-015)

系统应为 Java 核心项目生成 Maven CI，覆盖 JDK 8/11/17。

#### Scenario: JDK 矩阵 (AC-037)

- **WHEN** 生成 Java 核心 CI
- **THEN** Ubuntu job 覆盖 JDK 8/11/17
- **AND** 每个组合执行 `./mvnw -B -ntp verify`

#### Scenario: 缓存与安全 (AC-038)

- **WHEN** CI 运行
- **THEN** 缓存 `~/.m2/repository`
- **AND** 权限最小化，命令只来自白名单 `goals`

#### Scenario: Windows 冒烟 (AC-039)

- **WHEN** 生成 Java 核心 CI
- **THEN** Windows job 使用 `mvnw.cmd` 跑默认组合
- **AND** 失败日志可独立查看

### Requirement: 文档、测试计划与回归 (REQ-016)

变更必须补齐测试计划、文档并保证既有技术栈无回归。

#### Scenario: 测试计划覆盖 (AC-040)

- **WHEN** 实施开始前
- **THEN** `tests/cases.md` 与 `tests/mapping.json` 覆盖全部 AC
- **AND** 每个 AC 至少一个用例与 suite

#### Scenario: 文档 (AC-041)

- **WHEN** 变更完成
- **THEN** README / README.zh.md / CHANGELOG 包含 Java 核心支持说明

#### Scenario: 全量回归 (AC-042)

- **WHEN** 执行全量测试
- **THEN** 现有 Node/Python/Vue/React 测试全部通过
- **AND** 不硬编码测试数量
