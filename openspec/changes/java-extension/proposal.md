# Java 扩展支持（java-extension）

## 问题

`java-core` 覆盖 JDK 8/11/17、Maven、Boot 2.7/3.x、质量门禁与既有 Maven 仓库接入。剩余能力尚未覆盖：

- JDK 21 与 Spring Boot 4.x；
- Gradle Groovy DSL 与 Kotlin DSL；
- Java 后端 + Vue/React 前端 monorepo；
- 全 JDK/构建工具/OS CI 矩阵；
- macOS/Linux/Windows 的完整跨平台验收。

## 目标

1. 支持 JDK21 + Boot4 的 Maven 项目。
2. 支持 Gradle Groovy/Kotlin 的初始化、接入、测试与覆盖率。
3. 支持 Java 后端 + Vue/React 前端 monorepo 与变更级套件选择。
4. 生成全 JDK/构建工具矩阵 CI，并覆盖 Windows/macOS 冒烟。
5. 保持 `java-core` 与既有 Node/Python 行为不变。

## 非目标

- 重复交付 Maven/JDK8-17/Boot2.7-3.x 核心能力。
- Testcontainers、JUnit 4、Spring Security/Cache/Batch/Cloud。
- 内网私服/离线构建、自动下载 JDK。
- 非 GitHub CI、GraalVM Native Image。

## 影响面

- `src/v3/init.js`：`java-monorepo` stack、Gradle scaffold、Vue/React 前端。
- `src/v3/change.js`：`gradle` suite kind 与字段。
- `src/v3/plan.js`、`suites.js`：Gradle 执行、报告聚合。
- `src/v3/env/gradle.js`：Gradle Wrapper/版本。
- CI 生成器：全矩阵、Windows/macOS。
- `tests/`、`assets/`、`docs/`。

## 验收标准

- JDK21 + Boot4 + Maven 初始化并测试通过。
- Gradle Groovy/Kotlin 初始化、测试、覆盖率通过。
- Java + Vue/React monorepo 可按变更选择套件并通过 CI。
- Ubuntu 全矩阵 + Windows/macOS 冒烟通过。
- 版本锁定、命令白名单、最小权限生效。
- 文档与回归齐全。

## 风险

- Boot4 与 Gradle 8.14+/9.x 的生态兼容性。
- Gradle Wrapper jar 体积与许可。
- monorepo 变更选择可能误判根构建文件。
- macOS runner 成本较高，默认手动触发。

## 参考

- Spring Boot 4.0 System Requirements：<https://docs.spring.io/spring-boot/4.0/system-requirements.html>
- Spring Boot 2.7 Gradle Plugin Reference：<https://docs.spring.io/spring-boot/docs/2.7.7/gradle-plugin/reference/htmlsingle/>
- [需求基线](../../../docs/design/java-support-review.md)
