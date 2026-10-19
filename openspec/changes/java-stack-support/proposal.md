# Java 技术栈支持（java-stack-support）

## 问题

SpecGate 当前只把 Node、Python、Vue、React 和 Node monorepo 作为一等技术栈。Java 后端只能通过 `command` 套件配置自定义命令接入，缺少：

- JDK 版本识别、校验与切换；
- Maven / Gradle Wrapper 解析；
- Surefire / Failsafe / Gradle Test XML 与 JaCoCo 覆盖率解析；
- Spotless / Checkstyle / PMD / SpotBugs 质量门禁；
- Spring Boot 2.x / 3.x / 4.x 兼容矩阵；
- Java 新项目脚手架与 Java 后端 + Vue/React 前端 monorepo 编排。

结果是 Java 团队无法获得与 Node/Python 一致的初始化、测试、格式化、审查和 CI 体验。

## 目标

1. 新增 `java` 与 `java-monorepo` 技术栈，支持新项目初始化和既有 Java 仓库接入。
2. 支持 JDK 8/11/17/21，Maven 与 Gradle（Groovy & Kotlin DSL），默认生成 Wrapper。
3. 支持 Spring Boot 2.7.x / 3.x / 4.x 强制兼容矩阵；默认 JDK8 + Maven + Boot 2.7.x。
4. 新增 `maven` / `gradle` suite kind，支持单模块、多模块、Surefire/Failsafe/Gradle 报告与 JaCoCo。
5. 接入 G7.5/G8/G9：
   - G7.5：Spotless apply + Checkstyle；
   - G8：测试 + JaCoCo 阈值；
   - G9：PMD + SpotBugs + Agent Reviewer。
6. 既有仓库接入不修改 `pom.xml` / `build.gradle`；外部命令检查，输出补丁建议。
7. 生成 GitHub Actions Java JDK 矩阵 CI；monorepo 同时保留前端 Node job。
8. 保持 Node/Python/Vue/React/monorepo 行为不变，配置字段只增不改。

## 非目标

- JDK 13 的完整矩阵与 CI（仅允许手工指定绝对路径）。
- 自动下载 JDK。
- 内网 Nexus/Artifactory、完全离线构建（V1 仅保留 `settings.xml` / `init.gradle` 扩展点）。
- Testcontainers、JUnit 4。
- Spring Security / Cache / Batch / Cloud。
- 非 GitHub CI、GraalVM Native Image、Kotlin/其他 JVM 语言、Android。
- 修改既有仓库的构建文件来强制接入质量插件。

## 影响面

### 代码

- `src/v3/init.js`：新增 `java`、`java-monorepo` stack、Java scaffold、交互字段、兼容过滤。
- `src/v3/change.js`：`SUITE_KINDS` 新增 `maven`、`gradle`；suite 字段扩展。
- `src/v3/plan.js`：解析 Wrapper、JDK、goals，生成 cmdHash。
- `src/v3/suites.js`：Maven/Gradle 执行、Surefire/Gradle XML、JaCoCo。
- `src/v3/env/*`：新增 `java.js`、`maven.js`、`gradle.js`。
- `src/v3/env-scan.js`：Java workspace、JDK/构建工具/Boot 检测。
- `src/v3/quality.js`：Java 工具探测与 `static` 阶段。
- `src/v3/toolchain.js`：Java 工具链计划（不自动下载 JDK）。
- `src/v3/formatter.js`：Spotless apply / google-java-format CLI 回退。
- `src/v3/gate-summary.js`：展示 JDK/构建工具/Boot/覆盖率。
- `tests/`：Java fixtures、fake wrapper、真实集成测试。
- `assets/`：Java/Spring 模板、质量配置模板、技能与文档。

### 配置与兼容

- `.specgate/config.yaml` 新增可选 `java:` section、`quality.profile`、suite 字段。
- 旧配置无需迁移；Node/Python 行为不变。
- 文档：`docs/design/java-support-review.md` 为需求基线。

### CI 与发布

- CI 新增 Java 矩阵 job；保留现有 Node 断言。
- 发布流程仍需通过 lint/test/pack:check。

## 验收标准

- 默认初始化 JDK8 + Maven + Boot2.7，Wrapper 测试通过，`/health` 可访问。
- 交互只展示合法组合；非法组合被拒绝。
- Maven 单模块/多模块、Gradle Groovy/Kotlin 均可执行并映射 AC。
- 既有仓库可识别 JDK/Boot/构建工具，不修改构建文件，生成配置与报告。
- G7.5/G8/G9 接入 Spotless/Checkstyle/PMD/SpotBugs/JaCoCo，失败可阻断。
- Java + Vue/React monorepo 可按变更选择套件，CI 拆分正确。
- Windows/Linux/macOS 可执行 Wrapper 命令。
- 错误码、日志、报告路径完整；重复执行幂等。
- 文档、示例、单测、集成测试齐全；Node/Python 无回归。

## 风险

- 版本矩阵复杂，需在 S1 PoC 锁定 JDK/Boot/Gradle/质量工具版本。
- JDK8 工具链老化，现代 Checkstyle/PMD/SpotBugs 需要 Java 11+，需独立 analysis JVM 或旧版本回退。
- 既有仓库零侵入会导致 Spotless/JaCoCo 降级，需要用户接受补丁建议。
- Maven/Gradle 插件可执行任意代码，安全边界只能靠可信仓库 + 固定 goals + 最小权限。
- Boot 4.x 生态较新，第三方插件兼容性需 PoC。

## 参考

- 需求与兼容矩阵：[docs/design/java-support-review.md](../../../docs/design/java-support-review.md)
- Spring Boot 4.0 System Requirements：<https://docs.spring.io/spring-boot/4.0/system-requirements.html>
- Spring Boot 2.7 Gradle Plugin Reference：<https://docs.spring.io/spring-boot/docs/2.7.7/gradle-plugin/reference/htmlsingle/>
