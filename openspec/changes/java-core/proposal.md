# Java 核心支持（java-core）

## 问题

SpecGate 当前只把 Node、Python、Vue、React 和 Node monorepo 作为一等技术栈。Java/Maven 后端只能通过 `command` 套件接入，缺少：

- JDK 8/11/17 识别、校验与切换；
- Maven Wrapper 解析；
- Surefire/Failsafe XML 与 JaCoCo 覆盖率解析；
- Spotless / Checkstyle / PMD / SpotBugs 质量门禁；
- Spring Boot 2.7.x / 3.x 兼容矩阵；
- 既有 Maven 仓库零侵入接入；
- Maven CI。

## 目标

1. 新增 `java` 技术栈，默认 JDK8 + Maven + Spring Boot 2.7.x；支持 JDK 8/11/17 与 Boot 2.7/3.x。
2. 支持 Maven 单模块与多模块测试，解析 Surefire/Failsafe XML。
3. 支持 JaCoCo 覆盖率与 P0/P1/P2 阈值。
4. 接入 G7.5/G8/G9：Spotless + Checkstyle + PMD + SpotBugs + JaCoCo。
5. 既有 Maven 仓库零构建文件侵入接入；外部 CLI + coverage baseline。
6. 生成 Maven CI（JDK 8/11/17）。
7. 补齐测试计划与 AC 映射。
8. 保持 Node/Python/Vue/React 行为不变。

## 非目标（由 java-extension 承担）

- Gradle Groovy/Kotlin。
- JDK 21 与 Spring Boot 4.x。
- Java 后端 + Vue/React 前端 monorepo。
- 全 JDK/构建工具/OS 矩阵。
- Testcontainers、JUnit 4。
- Spring Security / Cache / Batch / Cloud。
- 内网私服/离线构建、自动下载 JDK。

## 影响面

- `src/v3/init.js`：`java` stack、Maven scaffold、交互字段、兼容过滤。
- `src/v3/change.js`：`maven` suite kind、Java suite 字段。
- `src/v3/plan.js`、`suites.js`：Maven 执行、报告聚合、超时。
- `src/v3/env/*`：`java.js`、`maven.js`。
- `src/v3/quality.js`、`toolchain.js`、`formatter.js`：Java 质量工具与外部 CLI。
- `src/v3/coverage/jacoco.js`：覆盖率解析与阈值。
- `tests/`、`assets/`、`docs/`：fixture、模板、文档。

## 验收标准

- 默认 JDK8 + Maven + Boot2.7 初始化，`./mvnw test` 通过。
- JDK8/11/17 与 Boot2.7/3.x 合法组合可初始化；非法组合被拒绝。
- Maven 单模块/多模块执行，Surefire/Failsafe 报告映射 AC。
- G7.5/G8/G9 可阻断；P0/P1 100%、P2 ≥90%、行 ≥80%、分支 ≥70%。
- 既有 Maven 仓库接入不修改 `pom.xml`；外部 CLI + baseline 生效。
- Maven CI 通过；文档、测试计划、回归齐全。

## 风险

- JDK8 工具链老化，需要 analysis JVM 或旧版本回退。
- 外部 CLI 与插件规则不完全等价。
- Wrapper 模板需要校验来源与许可。
- Maven 插件执行即代码执行，安全边界依赖可信仓库。

## 参考

- [需求基线](../../../docs/design/java-support-review.md)
- Spring Boot 4.0（extension）：<https://docs.spring.io/spring-boot/4.0/system-requirements.html>
- Spring Boot 2.7 Gradle（extension）：<https://docs.spring.io/spring-boot/docs/2.7.7/gradle-plugin/reference/htmlsingle/>
