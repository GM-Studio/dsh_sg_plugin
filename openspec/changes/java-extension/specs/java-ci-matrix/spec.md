# Java 全矩阵 CI 与跨平台

## ADDED Requirements

### Requirement: 全 JDK/构建工具矩阵 (REQ-109)

系统应生成覆盖 JDK 与构建工具的 CI 矩阵。

#### Scenario: Ubuntu 全矩阵 (AC-119)

- **WHEN** 生成扩展 CI
- **THEN** Ubuntu 覆盖 JDK 8/11/17/21 与 Maven/Gradle
- **AND** 每个组合执行 Wrapper 测试

#### Scenario: Windows 组合 (AC-120)

- **WHEN** 生成扩展 CI
- **THEN** Windows 跑默认组合 + 一个 Gradle 组合
- **AND** 使用 `mvnw.cmd` / `gradlew.bat`

#### Scenario: 缓存 (AC-121)

- **WHEN** CI 运行
- **THEN** 缓存 `~/.m2/repository` 与 `~/.gradle/caches`
- **AND** 缓存键包含 JDK 与构建工具版本

### Requirement: 跨平台 (REQ-110)

系统应在 Windows/Linux/macOS 上正确处理路径、编码与 Wrapper。

#### Scenario: macOS (AC-122)

- **WHEN** macOS job 运行
- **THEN** 使用 `./mvnw` / `./gradlew`
- **AND** 默认手动或 nightly 触发

#### Scenario: 路径与编码 (AC-123)

- **WHEN** 报告路径包含空格或中文
- **THEN** 路径规范化并使用 UTF-8
- **AND** 不因编码导致解析失败

### Requirement: 安全与可复现 (REQ-111)

构建命令必须来自白名单，CI 权限最小化，版本可复现。

#### Scenario: 命令白名单 (AC-124)

- **WHEN** 执行 Maven/Gradle suite
- **THEN** 只使用 `goals`/`tasks` 白名单
- **AND** 不拼接任务文本或自由输入
- **AND** CI 权限仅为读取仓库与缓存

#### Scenario: 版本可复现 (AC-125)

- **WHEN** 换机执行
- **THEN** JDK/Boot/Maven/Gradle Wrapper/质量工具版本一致
- **AND** Wrapper jar 校验 SHA-256

### Requirement: 文档与回归 (REQ-112)

扩展变更必须补齐文档并保证 core 与既有技术栈无回归。

#### Scenario: 文档与回归 (AC-126)

- **WHEN** 扩展完成
- **THEN** README / README.zh.md / CHANGELOG 包含扩展说明
- **AND** `java-core` 与 Node/Python 全量测试通过
