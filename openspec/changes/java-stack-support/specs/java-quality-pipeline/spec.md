# Java 代码质量门禁

## ADDED Requirements

### Requirement: G7.5 格式化与 Checkstyle (REQ-005)

Java 变更在进入测试前，应自动执行 Spotless 格式化与 Checkstyle 检查；通过后提交格式化结果，失败则阻断。

#### Scenario: 格式化与 Checkstyle 通过 (AC-009)

- **WHEN** 任务的 Java 源码存在可格式化差异但无 Checkstyle 违规
- **THEN** G7.5 执行 Spotless `apply` 并提交格式化结果
- **AND** Checkstyle 退出码为 0，流程进入 G8

#### Scenario: Checkstyle 违规阻断 (AC-010)

- **WHEN** Checkstyle 发现违规
- **THEN** G7.5 返回 `STATIC_ANALYSIS_FAILED`
- **AND** 输出规则、文件、行号与 `format-report.md` 路径
- **AND** 不进入 G8

### Requirement: G8 测试与 JaCoCo 阈值 (REQ-006)

Java 变更应执行 Maven/Gradle 测试，解析 JUnit XML 与 JaCoCo XML，并按 G8 阈值判定。

#### Scenario: 测试与覆盖率通过 (AC-011)

- **WHEN** 变更关联的 AC 全部通过，且行覆盖率 ≥80%、分支覆盖率 ≥70%
- **THEN** G8 返回通过
- **AND** `test-report.md` 写入用例统计、行/分支覆盖率与报告路径

#### Scenario: 覆盖率不足阻断 (AC-012)

- **WHEN** 行覆盖率 <80% 或分支覆盖率 <70%
- **THEN** G8 返回 `COVERAGE_BELOW_THRESHOLD`
- **AND** 输出实际值、阈值与缺口
- **AND** 不进入 G9

### Requirement: G9 静态分析与独立审查 (REQ-007)

Java 变更在归档前应执行 PMD、SpotBugs 与独立 Agent Reviewer，并按 P0/P1 blocking 规则判定。

#### Scenario: 静态问题阻断 (AC-013)

- **WHEN** PMD 或 SpotBugs 报告 P0/P1 问题
- **THEN** G9 返回 `STATIC_ANALYSIS_FAILED`
- **AND** 输出规则、文件、行号
- **AND** 不允许归档

#### Scenario: strict 与 light profile (AC-014)

- **WHEN** 项目配置 `quality.profile: strict`
- **THEN** G7.5/G8/G9 执行 Spotless、Checkstyle、PMD、SpotBugs、JaCoCo

- **WHEN** 项目配置 `quality.profile: light`
- **THEN** 跳过 PMD 与 SpotBugs，保留 Spotless、Checkstyle、JaCoCo

### Requirement: 质量工具缺失与 JVM 回退可诊断 (REQ-008)

质量工具或分析 JVM 不可用时，系统应给出明确错误码与可执行建议，不得静默跳过。

#### Scenario: 质量工具缺失 (AC-015)

- **WHEN** Spotless/Checkstyle/PMD/SpotBugs 任一缺失且无法回退
- **THEN** 返回 `QUALITY_TOOL_MISSING`
- **AND** 输出缺失工具、期望版本、安装或降级建议

#### Scenario: analysis JVM 回退 (AC-016)

- **WHEN** JDK8 项目没有可用的 JDK17 analysis JVM
- **THEN** 使用 JDK8 兼容的旧版本工具
- **AND** 在报告中记录实际工具版本与回退原因
