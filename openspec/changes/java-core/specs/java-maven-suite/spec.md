# Maven 测试套件与报告

## ADDED Requirements

### Requirement: Maven 单模块测试 (REQ-005)

系统应执行 Maven Wrapper 测试并解析 Surefire XML，将用例映射到 AC。

#### Scenario: 单模块测试与 XML (AC-011)

- **WHEN** 项目为单模块 Maven
- **THEN** 执行 `./mvnw -B -ntp verify`
- **AND** 解析 `target/surefire-reports/TEST-*.xml`

#### Scenario: AC 标签映射 (AC-012)

- **WHEN** 测试名或 `@DisplayName` 包含 `[AC-001]`
- **THEN** 用例映射到 AC-001
- **AND** `test-report.md` 包含用例统计

#### Scenario: 报告缺失 (AC-013)

- **WHEN** Maven 未生成 JUnit XML
- **THEN** 返回 `TEST_REPORT_MISSING`
- **AND** 输出期望 glob 与实际目录

### Requirement: Maven 多模块测试 (REQ-006)

系统应支持根聚合与指定模块执行，并聚合多模块报告。

#### Scenario: 根聚合 (AC-014)

- **WHEN** 根 `pom.xml` 包含 `<modules>`
- **THEN** 根 suite 执行全部模块
- **AND** 运行记录包含模块列表

#### Scenario: 指定模块 (AC-015)

- **WHEN** suite 配置 `-pl`/`-am` 或 `cwd` 为子模块
- **THEN** 只执行目标模块及依赖
- **AND** 命令保留模块参数

#### Scenario: 多模块报告聚合 (AC-016)

- **WHEN** 多个模块生成 Surefire/Failsafe XML
- **THEN** 按 `classname + name` 去重聚合
- **AND** 用例 id 不冲突

### Requirement: 失败诊断 (REQ-007)

Maven 执行失败时应输出稳定错误码、模块、命令、退出码与日志尾部。

#### Scenario: 构建超时 (AC-017)

- **WHEN** 构建超过 `timeoutMinutes`
- **THEN** 返回 `BUILD_TIMEOUT`
- **AND** 输出命令、超时分钟与日志尾部

#### Scenario: XML 解析失败 (AC-018)

- **WHEN** JUnit XML 损坏
- **THEN** 返回 `TEST_REPORT_PARSE_FAILED`
- **AND** 输出文件路径与解析错误

#### Scenario: AC 标签缺失 (AC-019)

- **WHEN** 用例没有 `[AC-xxx]` 标签
- **THEN** 返回 `AC_TAG_MISSING`
- **AND** 不把该用例计入 AC 通过
