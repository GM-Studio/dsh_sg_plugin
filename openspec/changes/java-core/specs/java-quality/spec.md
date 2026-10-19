# Java 质量门禁

## ADDED Requirements

### Requirement: G7.5 格式化与 Checkstyle (REQ-008)

Java 变更在测试前应执行 Spotless 格式化与 Checkstyle 检查。

#### Scenario: 格式化与 Checkstyle 通过 (AC-020)

- **WHEN** 源码存在可格式化差异但无 Checkstyle 违规
- **THEN** Spotless 自动 apply 并提交
- **AND** Checkstyle 退出码为 0，进入 G8

#### Scenario: Checkstyle 违规阻断 (AC-021)

- **WHEN** Checkstyle 发现违规
- **THEN** 返回 `STATIC_ANALYSIS_FAILED`
- **AND** 输出规则、文件、行号与 `format-report.md`

#### Scenario: Spotless 缺失回退 (AC-022)

- **WHEN** 项目没有 Spotless 插件
- **THEN** 使用 `google-java-format` CLI
- **AND** 报告中记录回退原因与版本

### Requirement: G8 测试、覆盖率与优先级 (REQ-009)

G8 应执行 Maven 测试，解析 JUnit XML 与 JaCoCo XML，并按阈值判定。

#### Scenario: 覆盖率通过 (AC-023)

- **WHEN** 行覆盖率 ≥80%、分支覆盖率 ≥70%
- **THEN** G8 通过
- **AND** `test-report.md` 写入覆盖率明细

#### Scenario: 覆盖率不足阻断 (AC-024)

- **WHEN** 行覆盖率 <80% 或分支覆盖率 <70%
- **THEN** 返回 `COVERAGE_BELOW_THRESHOLD`
- **AND** 输出实际值、阈值与缺口

#### Scenario: P0/P1/P2 通过率 (AC-025)

- **WHEN** P0/P1 AC 通过率 <100% 或 P2 <90%
- **THEN** 返回 `COVERAGE_BELOW_THRESHOLD`
- **AND** 输出各优先级通过率

#### Scenario: 覆盖率缺失 (AC-026)

- **WHEN** 没有 JaCoCo XML 且 `coverage.blocking: true`
- **THEN** 返回 `COVERAGE_MISSING`
- **AND** 输出期望 glob 与 profile

### Requirement: G9 静态分析与独立审查 (REQ-010)

G9 应执行 PMD、SpotBugs 与独立 Reviewer，并按 P0/P1 blocking 判定。

#### Scenario: 静态问题阻断 (AC-027)

- **WHEN** PMD 或 SpotBugs 报告 P0/P1 问题
- **THEN** 返回 `STATIC_ANALYSIS_FAILED`
- **AND** 不允许归档

#### Scenario: light profile (AC-028)

- **WHEN** 配置 `quality.profile: light`
- **THEN** 跳过 PMD 与 SpotBugs
- **AND** 保留 Spotless、Checkstyle、JaCoCo

### Requirement: analysis JVM 与覆盖率 baseline (REQ-011)

系统应优先使用 JDK17 运行分析工具，并允许既有仓库设置覆盖率 baseline。

#### Scenario: analysis JVM 回退 (AC-029)

- **WHEN** JDK8 项目没有 JDK17 分析 JVM
- **THEN** 使用 JDK8 兼容旧版本工具
- **AND** 报告记录实际版本与回退原因

#### Scenario: baseline 生效 (AC-030)

- **WHEN** 既有仓库设置 `coverage.baseline` 且未超过 baseline
- **THEN** 只告警，不阻断
- **AND** 记录 baseline 值与实际值
