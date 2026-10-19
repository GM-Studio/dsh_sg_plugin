# java-stack-support 设计

> 状态：G4 待评审  
> 上游：`proposal.md`、`docs/design/java-support-review.md`  
> 约束：本设计不写实现代码；评审通过后再创建 specs 与 tasks。

---

## 1. 设计目标

在不改变 Node/Python/Vue/React 现有行为的前提下，把 Java/Spring Boot 作为一等技术栈接入 SpecGate：

- 新项目初始化：默认 JDK8 + Maven + Boot2.7，可交互选择 JDK 8/11/17/21、Maven/Gradle、Boot 2/3/4。
- 既有仓库接入：只读识别 JDK、构建工具、Boot 版本，不修改构建文件。
- 测试：Maven/Gradle 单模块与多模块，解析 Surefire/Failsafe/Gradle JUnit XML。
- 覆盖率：解析 JaCoCo XML，执行 G8 阈值。
- 质量：G7.5 Spotless + Checkstyle；G8 测试 + 覆盖率；G9 PMD + SpotBugs + Reviewer。
- monorepo：Java 后端 + Vue/React 前端统一编排。
- CI：生成 GitHub Actions JDK 矩阵。

---

## 2. 设计原则

1. **增量优先**：不重构现有 Node/Python runner；新增 `maven`/`gradle` 分支与共享解析器。
2. **适配器隔离**：JDK、构建工具、报告解析分别封装，避免把 Java 细节写进 `executor.js`。
3. **只读接入**：既有仓库默认不写 `pom.xml`/`build.gradle`；质量工具以外部命令运行。
4. **版本锁定**：JDK/Boot/Maven/Gradle/质量工具版本在模板与配置中固定，CI 验证。
5. **失败可诊断**：每个失败返回稳定错误码、命令、退出码、日志尾部、报告路径。
6. **向后兼容**：`SUITE_KINDS` 只增不改；配置字段全部可选；旧项目无需迁移。

---

## 3. 总体架构

```text
/sg-init
  ├─ detectInitMode()            识别 new / existing
  ├─ JavaDetector                构建工具、JDK、Boot、Wrapper、模块
  ├─ collectContext()            交互选择技术栈矩阵
  ├─ scaffoldFiles()             Java/Spring 脚手架 + 质量配置
  └─ configureSuites()           写入 maven/gradle/前端 suites

/sg-apply
  ├─ plan.discoverSuites()       解析 suite → argv / jdk / reportGlob / cmdHash
  ├─ suites.runOneSuite()
  │    ├─ resolveJava()          JDK 定位与版本校验
  │    ├─ resolveBuildTool()     Wrapper / 系统 Maven/Gradle
  │    ├─ runMavenSuite()        执行 + Surefire/Failsafe/JaCoCo
  │    └─ runGradleSuite()       执行 + Test/JaCoCo
  ├─ quality.runQualityStage()   format / lint / static
  └─ gate/report                 G7.5 / G8 / G9
```

---

## 4. 技术栈模型

### 4.1 stack

新增：

- `java`：纯 Java 后端单仓库。
- `java-monorepo`：Java 后端 + Vue/React 前端。

保留：`node`、`python`、`vue`、`react`、`monorepo`、`generic`。

### 4.2 配置 section

```yaml
workflowVersion: 3
schemaVersion: 3
stack: java-monorepo

java:
  jdk: 8
  buildTool: maven            # maven | gradle-groovy | gradle-kotlin
  bootVersion: "2.7.18"
  groupId: com.example
  artifactId: demo
  packageName: com.example.demo
  modules: ["web", "validation", "actuator", "test"]

quality:
  profile: strict             # strict | light

coverage:
  blocking: true
  lines: 80
  branches: 70
  p0p1: 100
  p2: 90

suites:
  - id: backend
    kind: maven
    cwd: backend
    jdk: "8"
    buildTool: maven
    goals: ["-B", "-ntp", "verify"]
    reportGlob: "target/{surefire,failsafe}-reports/TEST-*.xml"
    jacocoGlob: "target/site/jacoco/jacoco.xml"
    timeoutMinutes: 30
```

### 4.3 suite 字段

新增可选字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `kind` | string | 新增 `maven` / `gradle` |
| `jdk` | string | `8`/`11`/`17`/`21`；为空时走解析链 |
| `buildTool` | string | `maven` / `gradle-groovy` / `gradle-kotlin` |
| `goals` | string[] | Maven goals 或 Gradle tasks |
| `reportGlob` | string | JUnit XML glob，相对 `cwd` |
| `jacocoGlob` | string | JaCoCo XML glob，相对 `cwd` |
| `timeoutMinutes` | number | 默认 30 |

现有字段 `command`、`cwd`、`install`、`pytestArgs`、`python`、`node`、`packageManager` 保持不变。

### 4.4 解析兼容

`parseConfig` 支持一级 section 与 suites 扁平 map；上述字段不需要修改解析器，只要：

- 数组用 JSON 表示；
- 新字段全部可选；
- `readSuites()` 为缺失字段补默认值。

---

## 5. 检测与接入

### 5.1 detectInitMode

`src/v3/init.js` 的 markers 增加：

- `pom.xml`
- `build.gradle`
- `build.gradle.kts`
- `settings.gradle`
- `settings.gradle.kts`
- `mvnw`
- `gradlew`
- `.java-version`

扩展名识别增加 `.java`。

### 5.2 JavaDetector

新增 `src/v3/java-detect.js`（或 `src/v3/detect/java.js`），输入仓库根目录，输出：

```js
{
  ok: true,
  buildTool: 'maven' | 'gradle' | null,
  gradleDsl: 'groovy' | 'kotlin' | null,
  bootVersion: '2.7.18' | null,
  jdk: '8' | '11' | '17' | '21' | null,
  jdkSource: 'suite' | '.java-version' | 'JAVA_HOME' | 'pom' | 'gradle' | null,
  wrapper: { maven: true, gradle: false },
  modules: ['backend', 'web'],
  evidence: [{ file, field, value }]
}
```

识别规则：

- Maven：`<parent><artifactId>spring-boot-starter-parent</artifactId>` 或 `spring-boot-dependencies`；JDK 取 `maven.compiler.release` → `source` → `target` → `java.version`。
- Gradle：`org.springframework.boot` 插件版本；JDK 取 `sourceCompatibility` → `targetCompatibility` → `java.toolchain` → `.java-version`。
- Wrapper：文件存在即视为可用，版本从 `maven-wrapper.properties` / `gradle-wrapper.properties` 读取。
- 多模块：`settings.gradle` 的 `include` 或 `pom.xml` 的 `<modules>`。

### 5.3 既有仓库接入

`/sg-init` 的 existing 分支新增：

1. 运行 JavaDetector。
2. 生成 `.specgate/config.yaml`（只写缺失项）。
3. 写 `.specgate/env.json` / `env-report.md`。
4. 写 `docs/java-onboarding.md`：
   - 识别到的 JDK/Boot/构建工具；
   - 缺失的质量工具；
   - 建议的 suite 配置；
   - 如需覆盖率/Spotless，给出构建文件补丁建议。
5. 不写 `pom.xml` / `build.gradle`。

幂等：重复执行只补缺失配置，不覆盖用户已有 `suites` / `java` 段。

---

## 6. 环境解析

### 6.1 JDK

新增 `src/v3/env/java.js`。

```js
resolveJava({ root, suite, env = process.env })
  -> { ok: true, version: '17', javaHome, javac, source, env }
   | { ok: false, code: 'JDK_NOT_FOUND' | 'JDK_VERSION_MISMATCH', message, candidates }
```

解析优先级：

1. `suite.jdk`（精确版本）；
2. `.java-version`；
3. `.sdkmanrc`；
4. `JAVA_HOME`；
5. `java -version`；
6. SDKMAN 候选目录；
7. 失败。

校验：

- 读取 `javac -version`，解析主版本；
- `suite.jdk` 与主版本不一致 → `JDK_VERSION_MISMATCH`；
- 未指定版本时，记录实际版本。

环境注入：

- `JAVA_HOME`；
- `PATH` 前置 `${JAVA_HOME}/bin`；
- Windows 使用 `;`，POSIX 使用 `:`。

### 6.2 构建工具

新增 `src/v3/env/maven.js`、`src/v3/env/gradle.js`。

```js
resolveMaven({ root, suite, env })
  -> { ok: true, bin: '/abs/mvnw', argsPrefix: [], version, wrapper }
   | { ok: false, code: 'BUILD_TOOL_NOT_FOUND', message }
```

规则：

- `cwd` 有 `mvnw`/`mvnw.cmd` → 使用 Wrapper；
- 否则系统 `mvn`；
- 都没有 → `BUILD_TOOL_NOT_FOUND`，提示生成 Wrapper。
- Gradle 同理：`gradlew`/`gradlew.bat` → 系统 `gradle`。
- 版本写入 runtime，便于诊断。

---

## 7. Suite 执行

### 7.1 分支策略

不重构现有 runner。在 `runOneSuite` 中新增分支：

```js
if (suite.kind === 'pytest') { ... }
else if (suite.kind === 'maven') { run = runMavenSuite(...) }
else if (suite.kind === 'gradle') { run = runGradleSuite(...) }
else { ... 现有 Node/command 逻辑 ... }
```

共享：

- `parseJunitXml`（泛化后）；
- `validateReport`；
- `installMeta` / `persistRuntime`。

### 7.2 Maven

命令：

```text
<wrapper> -B -ntp -Dstyle.color=never <goals...>
```

默认 `goals`：`["-B", "-ntp", "verify"]`（`verify` 同时覆盖 Surefire 与 Failsafe）。

多模块：

- 根 suite：`cwd` 为根，使用 `-pl`/`-am` 或全量 `verify`。
- 模块 suite：`cwd` 为模块目录，单独执行。

报告：

```text
target/surefire-reports/TEST-*.xml
target/failsafe-reports/TEST-*.xml
target/site/jacoco/jacoco.xml
```

### 7.3 Gradle

命令：

```text
<wrapper> --no-daemon --console=plain <tasks...>
```

默认 `tasks`：`["check"]`；需要覆盖率时按模板启用 `jacocoTestReport`。

多模块：

- 根 suite：`check`；
- 模块 suite：`:module:check` 或 `cwd` 到模块。

报告：

```text
build/test-results/test/*.xml
build/reports/jacoco/test/jacocoTestReport.xml
```

### 7.4 报告解析

泛化 `parseJunitXml`：

```js
parseJunitXml(text, {
  suiteId,
  cwd,
  worktree,
  runner,          // 'pytest' | 'maven' | 'gradle'
  fileResolver,    // (classname) => relative source path
})
```

Java `fileResolver`：

- `com.example.DemoApplicationTests` →
  - `src/test/java/com/example/DemoApplicationTests.java`
  - `src/main/java/com/example/DemoApplicationTests.java`
- 内部类 `$` 去掉后缀；
- 找不到时保留候选路径，`validateReport` 报文件不存在。

多文件聚合：

- 每个 XML 解析为 cases；
- 以 `classname + name` 去重；
- case id 使用 `TC-<序号>`，多模块加模块前缀避免冲突；
- AC 标签仍从 `name` 中提取 `[AC-001]`。

### 7.5 超时与日志

- `timeoutMinutes` 默认 30，传给 `spawnSync` 的 `timeout`。
- 超时返回 `BUILD_TIMEOUT`，日志尾部 300 行。
- 运行记录写入 `runtime.java` / `runtime.buildTool` / `runtime.coverage`。

### 7.6 cmdHash

`cmdHash` 包含：

- `kind`；
- `cwd`；
- `jdk`；
- `buildTool`；
- `goals`；
- `reportGlob` / `jacocoGlob`。

确保 JDK/构建工具变化会使 H2 冻结失效。

---

## 8. 覆盖率

新增 `src/v3/coverage/jacoco.js`：

```js
parseJacocoXml(text) -> {
  lines: { covered, missed, rate },
  branches: { covered, missed, rate },
  classes: [{ name, lines, branches }]
}
```

聚合：

- 多模块按 `covered/missed` 累加，不平均百分比；
- 跨 suite 汇总后写入 `test-report.md`。

阈值：

```yaml
coverage:
  blocking: true
  lines: 80
  branches: 70
  p0p1: 100
  p2: 90
```

判定：

- `lines` / `branches` 低于阈值 → `COVERAGE_BELOW_THRESHOLD`；
- P0/P1 AC 通过率必须 100%；P2 ≥ 90%；
- `blocking: false` 时只记录，不阻断。

优先级来源：

- `mapping.requirements[].priority`（新增可选字段）；
- 缺省按 P1 处理。

覆盖率缺失：

- `blocking: true` → `COVERAGE_MISSING`；
- `blocking: false` → 警告。

---

## 9. 质量门禁

### 9.1 G7.5

- Spotless `apply`（新项目由构建插件提供）；
- Checkstyle `check`；
- 既有仓库无 Spotless：回退 `google-java-format` CLI；
- 失败输出 `format-report.md`，阻断。

### 9.2 G8

- Maven/Gradle test；
- JUnit XML 校验；
- JaCoCo 阈值；
- 失败输出 `test-report.md`，阻断。

### 9.3 G9

- PMD；
- SpotBugs；
- Agent Reviewer；
- P0/P1 blocking。

### 9.4 profile

| profile | Spotless | Checkstyle | PMD | SpotBugs | JaCoCo |
|---|:---:|:---:|:---:|:---:|:---:|
| strict（默认） | ✅ | ✅ | ✅ | ✅ | ✅ |
| light | ✅ | ✅ | ❌ | ❌ | ✅ |

### 9.5 analysis JVM

- 优先独立 JDK17 运行 Checkstyle/PMD/SpotBugs/Spotless；
- 无 JDK17 时，JDK8 项目回退旧版本工具；
- 版本表由 S1 PoC 锁定。

---

## 10. 既有仓库零侵入

工具解析顺序：

1. 项目已有构建插件（Spotless/Checkstyle/PMD/SpotBugs/JaCoCo）→ 直接复用；
2. 没有 Spotless → `google-java-format` CLI；
3. 没有 Checkstyle/PMD/SpotBugs → 外部 CLI jar；
4. 没有 JaCoCo → 读取已有报告；否则 `coverage: unavailable`。

补丁建议：

- 生成 `docs/java-onboarding-patches/` 下的 diff 片段；
- 不自动应用；
- 用户确认后可手工合入。

限制：

- 外部 CLI 与插件规则不完全等价；
- JaCoCo agent 注入可能与项目 `argLine` 冲突；
- 需要下载工具 jar 并缓存。

---

## 11. monorepo

```text
repo/
├─ backend/        Maven 或 Gradle
├─ web/            Vue 或 React
└─ .specgate/config.yaml
```

套件：

```yaml
suites:
  - id: backend
    kind: maven
    cwd: backend
  - id: web-unit
    kind: command
    cwd: web
    command: ["npm", "run", "test:unit"]
  - id: web-e2e
    kind: command
    cwd: web
    command: ["npm", "run", "test:e2e"]
```

变更选择：

- `changedFiles` 命中 `backend/**` → backend suite；
- 命中 `web/**` → web suite；
- 命中根 `pom.xml` / `build.gradle` / `settings.gradle` / `package.json` → 全部。

CI 拆分：

- `java` job：JDK 矩阵 + Maven/Gradle；
- `web` job：Node 20/22。

---

## 12. CI

生成的 GitHub Actions：

```yaml
jobs:
  java:
    strategy:
      matrix:
        jdk: [8, 11, 17, 21]
        build: [maven, gradle]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: ${{ matrix.jdk }}
      - uses: actions/cache@v4
        with:
          path: |
            ~/.m2/repository
            ~/.gradle/caches
      - run: ./mvnw -B -ntp verify   # 或 ./gradlew check
  web:
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
```

矩阵裁剪：

- Ubuntu 全矩阵；
- Windows 仅默认组合 JDK8 + Maven + Boot2.7 冒烟；
- macOS 手动触发。

---

## 13. 错误模型

| 错误码 | 触发 | 输出 |
|---|---|---|
| `JAVA_STACK_INVALID` | 非法 JDK/Boot/构建工具组合 | 合法组合列表 |
| `JDK_NOT_FOUND` | 找不到 JDK | 已检测版本 + 安装指引 |
| `JDK_VERSION_MISMATCH` | 主版本不符 | 请求版本 vs 实际版本 |
| `BUILD_TOOL_NOT_FOUND` | 无 Wrapper 且无系统工具 | 安装/生成 Wrapper 指引 |
| `BUILD_TIMEOUT` | 超时 | 命令 + 超时分钟 + 日志尾部 |
| `BUILD_FAILED` | 非零退出 | 命令 + 退出码 + 日志尾部 |
| `TEST_REPORT_MISSING` | 无 JUnit XML | 期望 glob + 实际目录 |
| `TEST_REPORT_PARSE_FAILED` | XML 解析失败 | 文件路径 + 解析错误 |
| `COVERAGE_MISSING` | 无 JaCoCo XML | 期望 glob + profile |
| `COVERAGE_BELOW_THRESHOLD` | 覆盖率不足 | 各项实际值 vs 阈值 |
| `STATIC_ANALYSIS_FAILED` | Checkstyle/PMD/SpotBugs 失败 | 规则 + 文件 + 行号 |
| `QUALITY_TOOL_MISSING` | 工具缺失 | 安装/降级建议 |

---

## 14. 向后兼容

- `SUITE_KINDS` 追加 `maven`、`gradle`，不删除旧值。
- `readSuites()` 新字段全部可选，旧配置默认值不变。
- `parseJunitXml` 增加可选参数；旧调用保持默认 `runner: 'pytest'`。
- `validateReport` 不改签名；覆盖率校验新增独立函数。
- `state.plan.suites` 新字段可选，旧 state 可加载。
- Node/Python/Vue/React/monorepo 的 suite 解析与执行路径不变。
- 回归测试必须覆盖旧 stack 的初始化与执行。

---

## 15. 测试策略

### 15.1 单元测试

- JavaDetector：Maven/Gradle/Boot/JDK/Wrapper/多模块 fixture。
- JDK resolver：版本解析、优先级、版本不匹配。
- Build tool resolver：Wrapper/系统工具/缺失。
- 命令构造：Maven/Gradle 参数、Windows 后缀。
- JUnit 解析：Surefire/Failsafe/Gradle XML、AC 标签、内部类、多模块去重。
- JaCoCo 解析：行/分支、聚合、阈值。
- 兼容矩阵：非法组合拒绝。

### 15.2 集成测试

- fake `mvnw` / `gradlew` 脚本输出固定 XML；
- 无真实 JDK 也能跑；
- 真实 Java 集成测试作为可选 job。

### 15.3 回归

- Node/Python/Vue/React/monorepo 初始化与 suite 执行快照不变。
- 现有 177 项测试全部通过。

---

## 16. 风险与备选方案

| 风险 | 备选 |
|---|---|
| 重构 `runOneSuite` 影响 Node/Python | 只加分支，不迁移旧逻辑 |
| JDK8 工具链老化 | 独立 JDK17 analysis JVM；或锁旧版本 |
| 无构建文件无法覆盖 JaCoCo | 读取已有报告；输出补丁；标记 unavailable |
| Wrapper 生成依赖工具 | 有工具则生成；否则写脚本 + 安装指引 |
| Boot4 生态兼容 | S1 PoC 锁定；不通过则降级为 Boot3 支持 |
| 矩阵耗时 | Ubuntu 全矩阵 + Windows 冒烟 |
| 外部 CLI 规则漂移 | 固定工具版本；规则集随模板版本化 |

---

## 17. 实施切片映射

| 切片 | 主要交付 | 依赖 |
|---|---|---|
| S1 | JavaDetector + env/java + 环境报告 | 无 |
| S2 | Maven suite + JUnit + JaCoCo | S1 |
| S3 | Gradle suite + 多模块 | S1 |
| S4 | Java scaffold + 初始化交互 + 首个 change | S1 |
| S5 | G7.5/G8/G9 质量工具链 | S2/S3 |
| S6 | Java + Vue/React monorepo | S2/S3 |
| S7 | CI 矩阵 + 文档 + 回归 | S2-S6 |

---

## 18. 待 PoC 锁定项

1. Spotless 6.x/7.x 与 JDK8/JDK17 的兼容版本。
2. google-java-format 1.7 与 1.22+ 的输出差异。
3. Checkstyle 9.3/10.x、PMD 6.55/7.x、SpotBugs 4.7.3/4.8+ 的 JDK 运行时要求。
4. Gradle 7.6.x（Boot2.7）与 8.14+（Boot3/4）的 Wrapper 行为。
5. Boot 3.5.x / 4.0.x 当前补丁版本与 Maven/Gradle 插件兼容性。
6. 外部 CLI 在 Windows 下的路径与编码行为。

以上 PoC 在 S1 完成并回写本设计。
