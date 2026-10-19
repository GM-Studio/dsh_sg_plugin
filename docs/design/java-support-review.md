# Java 技术栈支持审查文稿

- 状态：已确认（2026-10-19）
- 目标仓库：`GM-Studio/dsh_sg_plugin`（SpecGate）
- 范围：Java / Spring Boot 技术栈的初始化、接入、测试、格式化与审查
- 输入：用户 2026-10-19 需求 + 15 项澄清回答 + 本稿确认
- 约束：本稿确认前未修改仓库；确认后仅落盘本文档，不进入实现

> 确认方式说明：用户回复“确认”，视为接受本稿及下列推荐项。若任一闭合项与预期不符，请在进入实现前指出，可回退修订。

---

## 1. 背景与目标

SpecGate 当前已支持 Node、Python、Vue、React、Node monorepo 与 generic 技术栈，套件类型为 `node-test`、`pytest`、`command`，质量阶段为 `format`、`lint`、`typecheck`。Java 后端目前只能通过 `command` 套件以自定义命令的方式勉强接入，缺少：

- JDK 版本识别与切换；
- Maven / Gradle Wrapper 解析；
- Surefire / Failsafe / Gradle Test 报告解析；
- JaCoCo 覆盖率；
- Spotless / Checkstyle / PMD / SpotBugs 质量门禁；
- Java 新项目脚手架与 Spring Boot 兼容矩阵；
- Java 后端 + Vue/React 前端 monorepo 编排。

本次目标是把 Java 作为一等公民技术栈接入 SpecGate，使新项目初始化和既有仓库接入都能获得可执行、可诊断、可阻断的质量门禁。

---

## 2. 范围

### 2.1 本次范围

- 新项目初始化：JDK 8/11/17/21，Maven/Gradle（Groovy & Kotlin DSL），Spring Boot 2.x/3.x/4.x。
- 既有 Java 仓库接入：识别构建工具、JDK、Boot 版本，生成 SpecGate 配置与环境报告。
- Maven/Gradle 单模块与多模块测试套件。
- Java 后端 + Vue/React 前端 monorepo。
- G7.5 格式化/Lint、G8 测试/覆盖率、G9 静态审查。
- GitHub Actions CI。

### 2.2 不在本次范围

- JDK 13 的完整矩阵与 CI（仅允许手工指定绝对路径）。
- 自动下载 JDK。
- 内网 Nexus/Artifactory、完全离线构建。
- Testcontainers、JUnit 4。
- Spring Security / Cache / Batch / Cloud。
- 非 GitHub CI、GraalVM Native Image、Kotlin/其他 JVM 语言。

---

## 3. 已确认决策

| 维度 | 决策 |
|---|---|
| 接入范围 | 新项目初始化 + 既有 Java 仓库接入 |
| 仓库形态 | Java 后端 + Vue/React 前端 monorepo |
| 构建工具 | Maven + Gradle（Groovy & Kotlin DSL），默认生成 Wrapper |
| JDK 集合 | 8 / 11 / 17 / 21 四个 LTS；13 不单独支持 |
| JDK 来源 | 检测本机（JAVA_HOME、SDKMAN、asdf、`.java-version`、`toolchains.xml`），缺失给安装指引，不自动下载 |
| Boot 兼容 | 强制兼容矩阵，交互只展示合法组合 |
| Spring 模块 | Web + Validation + Actuator + Test；Spring Data JPA 可选 |
| 初始化交互 | 单轮多问题：JDK / 构建工具 / Boot / 模块 / groupId / 包名 |
| 测试 | JUnit 5 + Mockito + AssertJ + Spring Boot Test；JaCoCo 沿用 G8 阈值 |
| 格式化 | Spotless + google-java-format，G7.5 自动 apply |
| 静态审查 | strict 默认：Spotless + Checkstyle + PMD + SpotBugs + JaCoCo；light 可选：Spotless + Checkstyle + JaCoCo |
| 既有仓库 | 不修改 `pom.xml` / `build.gradle`；外部命令检查，给补丁建议 |
| 多模块/CI | 多模块 + 根聚合 + 每模块 suite；生成 GitHub Actions JDK 矩阵 |
| 非功能 | 跨平台、构建缓存/超时、可诊断/幂等、安全边界 |
| 文稿形式 | 确认后落盘 `docs/design/java-support-review.md` |

### 3.1 审查稿推荐项闭合

以下 8 项在确认时按推荐项闭合；如与预期不符，实施前可回退修订。

| # | 问题 | 闭合决策 |
|---|---|---|
| Q1 | 静态审查完整集与轻量集同时被选中 | 默认 `strict`；`light` 作为可配置 profile |
| Q2 | Data JPA 是否默认 | 默认最小集 Web + Validation + Actuator + Test；JPA 可选，默认不勾选 |
| Q3 | 精确版本 | Boot 2.7.18 / 3.5.x / 4.0.x；Maven 3.9.x；Gradle 7.6.x（Boot2.7）与 8.14+（Boot3/4） |
| Q4 | JDK8 项目的分析 JVM | 优先用独立 JDK17 运行静态分析；不可用时回退 JDK8 兼容旧版本工具 |
| Q5 | 既有仓库降级 | 接受格式化/覆盖率降级，并输出可应用的构建文件补丁建议 |
| Q6 | 内网/离线 | V1 不做；仅保留 `settings.xml` / `init.gradle` 扩展点 |
| Q7 | Spring 全家桶边界 | Security / Cache / Batch / Cloud 不进入 V1 |
| Q8 | monorepo 前端 | Vue 与 React 都支持；初始化默认 Vue，可切换 React 或无前端 |

---

## 4. 功能需求

### FR-01 技术栈与版本识别

- Maven：`pom.xml`、`mvnw` / `mvnw.cmd`、`.mvn/wrapper/`。
- Gradle：`build.gradle`、`build.gradle.kts`、`settings.gradle(.kts)`、`gradlew` / `gradlew.bat`、`gradle/wrapper/`。
- Spring Boot：`spring-boot-starter-parent`、`spring-boot-dependencies`、`org.springframework.boot` Gradle 插件。
- JDK：`.java-version`、`.sdkmanrc`、`maven.compiler.release/source/target`、`java.version`、Gradle `sourceCompatibility` / `targetCompatibility` / `toolchain`、`JAVA_HOME`、`java -version`。
- monorepo：`backend/`（Maven/Gradle）+ `web/`（Vue/React）。

识别结果写入 `.specgate/env.json` 与 `env-report.md`，包含：

- 构建工具与版本；
- JDK 请求版本、实际版本、来源；
- Spring Boot 版本；
- Wrapper 是否存在；
- 已有质量插件（Spotless/Checkstyle/PMD/SpotBugs/JaCoCo）；
- 缺失项与建议命令。

### FR-02 新项目初始化

新增 stack：`java`、`java-monorepo`。

初始化单轮问题：

1. JDK：8 / 11 / 17 / 21（默认 8）。
2. 构建工具：Maven / Gradle Groovy / Gradle Kotlin DSL（默认 Maven）。
3. Spring Boot：2.7.x / 3.x / 4.x（默认 2.7.x）。
4. 模块：Web、Validation、Actuator、Test、Data JPA（默认前四项）。
5. groupId / artifactId / packageName。
6. monorepo 前端：Vue / React / 无（默认 Vue）。

兼容性过滤：不合法组合不可选或直接拒绝，例如：

- JDK8 + Boot3/4；
- JDK11 + Boot3/4；
- JDK21 + Boot2.7（不作为默认，需显式验证）；
- JDK13 不进入选择项。

生成内容：

- Wrapper（`mvnw` / `mvnw.cmd` 或 `gradlew` / `gradlew.bat`）。
- `pom.xml` 或 `build.gradle(.kts)`。
- Spring Boot 启动类、`/health`、`application.yml`。
- JUnit 5 测试（至少 health 集成测试）。
- Spotless / Checkstyle / PMD / SpotBugs / JaCoCo 配置。
- `.specgate/config.yaml` 套件。
- GitHub Actions CI。
- 首个 `add-version` change（停在 H1）。

### FR-03 Maven / Gradle 测试套件

新增 suite kind：`maven`、`gradle`。

建议配置字段：

```yaml
suites:
  - id: backend
    kind: maven
    cwd: backend
    jdk: "8"
    goals: ["-B", "-ntp", "verify"]
    reportGlob: "target/surefire-reports/TEST-*.xml"
    timeoutMinutes: 30
```

要求：

- 命令：`./mvnw -B -ntp <goals>`、`./gradlew <tasks>`；Windows 自动切换 `mvnw.cmd` / `gradlew.bat`。
- 多模块：根聚合 suite + 每模块 suite；支持 `-pl` 与 `:module:test`。
- 报告：Surefire、Failsafe、Gradle `build/test-results/test/*.xml`。
- 覆盖率：`target/site/jacoco/jacoco.xml`、`build/reports/jacoco/test/jacocoTestReport.xml`。
- 运行记录包含命令、退出码、耗时、日志尾部、报告路径。
- 超时可配置，默认 30 分钟。

### FR-04 质量门禁

| 门禁 | Java 检查 | 阻断 |
|---|---|---|
| G7.5 格式化 | Spotless `apply` + Checkstyle | 失败阻断 |
| G8 测试/覆盖率 | Maven/Gradle test + JaCoCo 阈值 | 失败阻断 |
| G9 静态审查 | PMD + SpotBugs + Agent Reviewer | P0/P1 blocking |

质量 profile：

- `strict`（默认）：Spotless + Checkstyle + PMD + SpotBugs + JaCoCo。
- `light`：Spotless + Checkstyle + JaCoCo。

配置示例：

```yaml
quality:
  profile: strict
```

### FR-05 覆盖率

- 解析 JaCoCo XML：行、分支、类、方法。
- 沿用 G8 阈值：P0/P1 100%、P2 ≥90%、行 ≥80%、分支 ≥70%。
- 多模块按 suite 聚合，报告写入 `test-report.md`。
- 覆盖率缺失时：
  - `strict`：阻断并标记 `COVERAGE_MISSING`；
  - `light`：记录警告，不阻断。

### FR-06 环境解析

新增 `env/java.js`、`env/maven.js`、`env/gradle.js`。

JDK 解析优先级：

1. suite 的 `jdk` 配置；
2. `.java-version`；
3. `.sdkmanrc`；
4. `JAVA_HOME`；
5. `java -version`；
6. SDKMAN 候选目录；
7. 失败并给出安装指引。

校验 `javac` 主版本与请求一致；不一致报 `JDK_VERSION_MISMATCH`。构建工具缺失时报 `BUILD_TOOL_NOT_FOUND`，优先建议使用 Wrapper。

### FR-07 既有仓库接入

- 只读扫描，不修改 `pom.xml` / `build.gradle`。
- 生成 `.specgate/config.yaml`、`.specgate/env.json`、`env-report.md`、`docs/java-onboarding.md`。
- 质量工具策略：
  - 项目已有 Spotless/Checkstyle/PMD/SpotBugs/JaCoCo：直接复用。
  - 没有 Spotless：回退 `google-java-format` CLI。
  - 没有 Checkstyle/PMD/SpotBugs：使用外部 CLI jar。
  - 没有 JaCoCo：优先读取已有报告；无法注入 agent 时标记 `coverage: unavailable`，并输出构建文件补丁建议。
- 缺少 Wrapper：有系统 `mvn` / `gradle` 则使用；否则明确失败并给安装指引。
- 接入过程幂等：重复执行不覆盖已有文件，不重复写配置。

### FR-08 Java + Vue/React monorepo

- 根 `.specgate/config.yaml` 同时定义 Java 后端 suite 与前端 unit/e2e suite。
- 目录约定：`backend/`、`web/`；允许用户自定义 `cwd`。
- 按变更文件选择套件：
  - 后端源码/构建文件变更 → Java suite；
  - 前端源码/配置变更 → Node suite；
  - 根构建文件/共享配置变更 → 全部 suite。
- CI 拆成 Java matrix job + Node job。

### FR-09 CI

- 使用 `actions/setup-java@v4`，默认 `temurin`。
- 缓存 `~/.m2/repository`、`~/.gradle/caches`。
- 矩阵策略：
  - Ubuntu 全矩阵：JDK 8/11/17/21 × Maven/Gradle；
  - Windows 冒烟：默认组合 JDK8 + Maven + Boot2.7；
  - macOS 暂不纳入默认矩阵，保留手动触发。
- monorepo 前端使用 Node 20/22。

### FR-10 文档与测试

- 更新 README / README.en.md / CHANGELOG。
- 新增 `docs/design/java-support-review.md`（本稿）与实现后的 `docs/design/java-support.md`。
- 插件自身单元测试不依赖真实 JDK：使用 fake `mvnw` / `gradlew` 与固定 XML fixture。
- 真实 Java 集成测试作为可选 CI job；无 JDK 时跳过。

---

## 5. 非功能需求

| 编号 | 要求 |
|---|---|
| NFR-01 | Windows / Linux / macOS 跨平台；路径、换行、编码、`mvnw.cmd` / `gradlew.bat` 兼容 |
| NFR-02 | 构建缓存复用；单次构建/测试超时可配置，默认 30 分钟 |
| NFR-03 | 失败可诊断：错误码 + 命令 + 退出码 + 日志尾部 + 报告路径 |
| NFR-04 | 操作幂等：重复初始化/扫描不覆盖已有文件、不重复写配置 |
| NFR-05 | 安全边界：只执行显式配置的 goals/tasks；不把任务文本拼进命令行；CI 令牌最小权限 |
| NFR-06 | 向后兼容：Node/Python/Vue/React/monorepo 行为不变；配置字段只增不改 |
| NFR-07 | 可测试性：无 Java 环境也能跑插件单测；集成测试可跳过 |
| NFR-08 | 可复现：插件版本、JDK、Maven/Gradle Wrapper 版本全部锁定 |

> 未选择内网 Maven 私服/离线构建：V1 按可访问 Maven Central 设计，仅保留 `settings.xml` / `init.gradle` 扩展接口，不承诺离线场景。

---

## 6. 兼容矩阵

| JDK | Boot 2.7.x | Boot 3.x | Boot 4.x | Maven | Gradle |
|---|:---:|:---:|:---:|---|---|
| 8 | ✅ 默认 | ❌ | ❌ | 3.6.3–3.9.x | 7.6.6 |
| 11 | ✅ | ❌ | ❌ | 3.6.3–3.9.x | 7.6.6 |
| 17 | ✅ | ✅ | ✅ | 3.6.3–3.9.x | 7.6.6（Boot2.7）/ 8.14.6（Boot3/4） |
| 21 | ⚠️ 需显式验证 | ✅ | ✅ | 3.6.3–3.9.x | 8.14.6 |
| 13 | ❌ | ❌ | ❌ | — | — |

说明：

- Spring Boot 4.0 官方要求 Java 17+，Maven 3.6.3+，Gradle 8.14+/9.x。
- Spring Boot 2.7 Gradle 插件官方支持 Gradle 6.8/6.9/7.x/8.x；本项目默认锁 7.6.6，Boot3/4 默认 8.14.6。
- Gradle 7.6.6 不能在 JDK21 上运行；JDK21 必须使用 Gradle 8.5+（本项目锁 8.14.6）。
- JDK 13 非 LTS 且 EOL；仅允许手工指定绝对路径，不进入选择项和 CI 矩阵。
- JDK 21 + Boot 2.7 不作为默认组合；如需使用，必须通过显式验证开关。

### 6.1 质量工具版本策略

| 工具 | JDK8 运行 | JDK17/21 运行 | 备注 |
|---|---|---|---|
| Spotless | 2.32.0 | 3.10.4 | 2.33.0 起最低 JRE 11；3.x 要求 Java 17 |
| google-java-format | 1.7 | 1.28.0（JDK17）/ 1.36.1（JDK21） | 1.8+ 需要 Java 11+ |
| Checkstyle | 9.3 | 12.3.1（JDK17）/ 14.3.0（JDK21） | Checkstyle 10+ 需要 Java 11+ |
| PMD | 7.28.0（失败回退 6.55.0） | 7.28.0 | PMD 7 需要 Java 11+ |
| SpotBugs | 4.7.3 | 4.10.5 | SpotBugs 4.8+ 需要 Java 11+ |
| JaCoCo | 0.8.15 | 0.8.15 | 解析 Java 8 字节码 |

策略：

1. 优先使用独立 JDK17 作为 analysis JVM，运行现代 Checkstyle/PMD/SpotBugs/Spotless。
2. 无 JDK17 时，JDK8 项目回退到表中旧版本工具。
3. 所有版本在实现阶段通过 PoC 锁定，并写入模板与文档。

---

## 7. 初始化交互与默认值

```text
/sg-init
  → 项目背景
  → 技术栈：java / java-monorepo
  → JDK：8 / 11 / 17 / 21（默认 8）
  → 构建工具：Maven / Gradle Groovy / Gradle Kotlin（默认 Maven）
  → Spring Boot：2.7.x / 3.x / 4.x（默认 2.7.x）
  → 模块：Web / Validation / Actuator / Test / Data JPA
  → groupId / artifactId / packageName
  → monorepo 前端：Vue / React / 无
  → H0 确认
```

默认组合：

- JDK 8
- Maven 3.9.x
- Spring Boot 2.7.18
- Web + Validation + Actuator + Test
- H2（仅当勾选 JPA）
- Vue（仅 java-monorepo）

---

## 8. 配置模型

```yaml
workflowVersion: 3
schemaVersion: 3
stack: java-monorepo

java:
  jdk: 8
  buildTool: maven          # maven | gradle-groovy | gradle-kotlin
  bootVersion: "2.7.18"
  groupId: com.example
  artifactId: demo
  packageName: com.example.demo
  modules: ["web", "validation", "actuator", "test"]

quality:
  profile: strict           # strict | light

suites:
  - id: backend
    kind: maven
    cwd: backend
    jdk: "8"
    goals: ["-B", "-ntp", "verify"]
    reportGlob: "target/surefire-reports/TEST-*.xml"
  - id: web-unit
    kind: command
    cwd: web
    command: ["npm", "run", "test:unit"]
```

兼容现有极简 YAML 解析器：

- `java:` 为一级 section；
- `suites:` 为扁平 map 列表；
- 数组使用 JSON 表示；
- 新增字段均为可选，旧配置无需迁移。

---

## 9. 现有架构影响

| 模块 | 现状 | 需要改动 |
|---|---|---|
| `src/v3/init.js` | stack: node/python/vue/react/monorepo/generic | 新增 `java`、`java-monorepo`、Java scaffold、交互字段、兼容过滤 |
| `src/v3/change.js` | `SUITE_KINDS = node-test/pytest/command` | 新增 `maven`、`gradle`；suite 字段扩展 |
| `src/v3/plan.js` | 解析 command / pytest | 解析 Wrapper、JDK、goals，生成 cmdHash |
| `src/v3/suites.js` | Node/Python 执行与 JUnit XML | Maven/Gradle 执行、Surefire/Gradle 报告、JaCoCo |
| `src/v3/env/*` | node.js / python.js / install.js | 新增 `java.js`、`maven.js`、`gradle.js` |
| `src/v3/env-scan.js` | Node/Python 工具扫描 | Java workspace、JDK/构建工具/Boot 检测 |
| `src/v3/quality.js` | format/lint/typecheck | 新增 Java 工具探测与 `static` 阶段 |
| `src/v3/toolchain.js` | Node/Python 工具链安装 | Java 工具链计划（不自动下载 JDK） |
| `src/v3/formatter.js` | G7.5 formatter | Spotless apply / GJF CLI 回退 |
| `src/v3/gate-summary.js` | 展示 suite 信息 | 展示 JDK/构建工具/Boot/覆盖率 |
| `tests/` | Node/Python 测试 | 新增 Java fixtures、fake wrapper、真实集成测试 |

---

## 10. 质量门禁映射

```text
开发
  → G7.5：Spotless apply + Checkstyle
  → G8：Maven/Gradle test + JaCoCo 阈值
  → G9：PMD + SpotBugs + Agent Reviewer
  → 归档
```

- G7.5 失败：不进入测试，输出 `format-report.md`。
- G8 失败：不进入审查，输出 `test-report.md` 与覆盖率明细。
- G9 失败：P0/P1 阻断；P2 记录待办。

---

## 11. 既有仓库接入的限制

“不修改构建文件”带来三个明确限制：

1. Spotless 是构建插件，没有构建文件集成时只能用 `google-java-format` CLI，规则与 Spotless 不完全等价。
2. JaCoCo 需要 agent 注入，无构建文件集成时覆盖率可能不可用；只能读取已有报告或输出补丁。
3. Checkstyle/PMD/SpotBugs 可用外部 CLI，但需要下载并缓存工具 jar，规则集需要单独维护。

因此既有仓库的接入承诺是：环境识别 + 套件执行 + 可用的外部检查 + 明确的降级提示 + 补丁建议，而不是零侵入获得与新建项目完全一致的质量门禁。

---

## 12. 错误模型

| 错误码 | 场景 | 处理 |
|---|---|---|
| `JAVA_STACK_INVALID` | 非法技术栈组合 | 初始化阶段拒绝，列出合法组合 |
| `JDK_NOT_FOUND` | 找不到请求的 JDK | 输出安装指引与已检测版本 |
| `JDK_VERSION_MISMATCH` | JDK 主版本不符 | 拒绝执行，提示切换 `JAVA_HOME` |
| `BUILD_TOOL_NOT_FOUND` | Maven/Gradle/Wrapper 缺失 | 提示安装或生成 Wrapper |
| `BUILD_FAILED` | 构建/测试命令非零退出 | 输出命令、退出码、日志尾部 |
| `TEST_REPORT_MISSING` | 未生成 JUnit XML | 输出期望路径与实际目录 |
| `TEST_REPORT_PARSE_FAILED` | XML 解析失败 | 保留原始报告路径 |
| `COVERAGE_MISSING` | 未生成 JaCoCo XML | 按 profile 降级或阻断 |
| `COVERAGE_BELOW_THRESHOLD` | 覆盖率不达标 | 输出各阈值差距 |
| `STATIC_ANALYSIS_FAILED` | Checkstyle/PMD/SpotBugs 失败 | 输出规则、文件、行号 |
| `QUALITY_TOOL_MISSING` | 工具 jar/插件缺失 | 输出安装或降级建议 |

---

## 13. 验收标准

| 编号 | 验收条件 |
|---|---|
| AC-01 | 默认初始化 JDK8 + Maven + Boot2.7，`./mvnw test` 通过，`/health` 可访问 |
| AC-02 | 交互只展示合法组合；JDK8+Boot3 等非法组合被拒绝 |
| AC-03 | Maven 单模块与多模块均可执行，Surefire/Failsafe 报告正确映射 AC |
| AC-04 | Gradle Groovy 与 Kotlin DSL 均可执行，测试报告正确映射 |
| AC-05 | 既有仓库可识别 JDK/Boot/构建工具，不修改构建文件，生成配置与报告 |
| AC-06 | G7.5/G8/G9 接入 Spotless/Checkstyle/PMD/SpotBugs/JaCoCo，失败可阻断 |
| AC-07 | JaCoCo 阈值按 G8 规则执行，报告包含行/分支/类/方法 |
| AC-08 | Java + Vue/React monorepo 可按变更选择套件，CI 拆分正确 |
| AC-09 | Windows/Linux/macOS 均能执行 Wrapper 命令 |
| AC-10 | 错误码、日志、报告路径完整；重复执行幂等 |
| AC-11 | 文档、示例、单测、集成测试齐全；Node/Python 无回归 |

---

## 14. 实施切片

| 切片 | 端到端价值 |
|---|---|
| S1 | Java 仓库识别 + 环境报告 + JDK/构建工具解析（只读） |
| S2 | Maven 单模块/多模块 suite + Surefire + JaCoCo |
| S3 | Gradle Groovy/Kotlin suite + 多模块 + 报告 |
| S4 | Java 新项目脚手架 + 初始化交互 + 首个 change |
| S5 | G7.5/G8/G9 Java 质量工具链 |
| S6 | Java + Vue/React monorepo 编排 |
| S7 | CI 矩阵 + 文档 + 回归与兼容测试 |

每个切片都应满足：可独立编译、可独立测试、可独立演示、失败可诊断。

---

## 15. 风险与限制

1. 版本矩阵复杂：JDK × Boot × Maven/Gradle × 质量工具，必须锁定并 CI 验证。
2. JDK8 工具链老化：Checkstyle 10/PMD 7/SpotBugs 4.8 要求 Java 11+，需旧版本或独立 analysis JVM。
3. 既有仓库零侵入的代价：Spotless/JaCoCo 无法完全等价接入，必须接受降级与补丁建议。
4. Wrapper 由模板内置并校验 SHA-256；既有仓库缺失时仍需系统工具或补丁。
5. 构建脚本执行即代码执行：Maven/Gradle 插件可执行任意代码；“不执行不可信构建脚本”只能通过只接入可信仓库、固定 goals、最小权限实现。
6. Boot 4.x 生态较新：第三方插件、Gradle 版本、静态分析工具兼容性需要 PoC。
7. monorepo 变更选择：根构建文件变更可能需要全量构建，耗时较长。

---

## 16. 参考

- Spring Boot 4.0 System Requirements：<https://docs.spring.io/spring-boot/4.0/system-requirements.html>
- Spring Boot 2.7 Gradle Plugin Reference：<https://docs.spring.io/spring-boot/docs/2.7.7/gradle-plugin/reference/htmlsingle/>

---

## 17. 实施拆分与下一步

G7 批判性审核后，实施拆分为两个 change：

- `java-core`：JDK 8/11/17、Maven、Boot 2.7/3.x、质量门禁、既有 Maven 仓库、Maven CI、测试计划。
- `java-extension`：JDK21、Boot4、Gradle、Java + Vue/React monorepo、全矩阵 CI、跨平台与安全。

当前状态：

- 基线已修复：189/189 测试通过（commit `e87246e`）。
- 两个 change 均已补齐 `tests/cases.md` 与 `tests/mapping.json`，AC 覆盖率 100%。
- 原 `java-stack-support` change 包已删除；本文件保留为需求基线。
- 下一步：分别完成 G7 复审，再进入实施。
