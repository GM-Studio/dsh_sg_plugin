# Maven 多模块特性交付

## ADDED Requirements

### Requirement: 多模块 suite 解析与执行 (REQ-012)

系统应支持 Maven 单模块与多模块仓库，能够按根聚合或指定模块执行测试。

#### Scenario: 根聚合执行 (AC-023)

- **WHEN** 仓库根 `pom.xml` 包含 `<modules>`
- **THEN** root suite 使用 `./mvnw -B -ntp verify` 执行全部模块
- **AND** 运行记录包含模块列表

#### Scenario: 指定模块执行 (AC-024)

- **WHEN** suite 配置 `cwd` 为某个模块，或使用 `-pl` 指定模块
- **THEN** 只执行目标模块及其依赖
- **AND** 命令中保留 `-pl` / `-am` 参数

### Requirement: 多模块报告聚合 (REQ-013)

系统应发现并聚合各模块的 Surefire、Failsafe 与 JaCoCo 报告，映射到变更 AC。

#### Scenario: Surefire 与 Failsafe 报告 (AC-025)

- **WHEN** 多模块执行完成
- **THEN** 解析每个模块的 `target/surefire-reports/TEST-*.xml` 与 `target/failsafe-reports/TEST-*.xml`
- **AND** 以 `classname + name` 去重，用例 id 不冲突

#### Scenario: JaCoCo 聚合 (AC-026)

- **WHEN** 各模块生成 `target/site/jacoco/jacoco.xml`
- **THEN** 按 covered/missed 累加行与分支覆盖率
- **AND** 聚合结果用于 G8 阈值判定

### Requirement: 失败定位 (REQ-014)

多模块执行失败时，系统应定位到具体模块与报告，而不是只返回整体退出码。

#### Scenario: 失败模块定位 (AC-027)

- **WHEN** 某个模块测试失败
- **THEN** 返回失败模块名、suite id、退出码
- **AND** 输出该模块的失败用例与日志尾部

#### Scenario: 报告缺失定位 (AC-028)

- **WHEN** 某个模块没有生成 JUnit XML
- **THEN** 返回 `TEST_REPORT_MISSING`
- **AND** 输出期望 glob、模块路径与实际目录
