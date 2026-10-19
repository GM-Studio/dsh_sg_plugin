# java-extension 设计

> 状态：G4 待复审  
> 前置：`java-core` 已完成并归档  
> 上游：`proposal.md`、`docs/design/java-support-review.md`

---

## 1. 范围

- JDK21 + Spring Boot 4.x（Maven）。
- Gradle Groovy/Kotlin。
- Java 后端 + Vue/React monorepo。
- 全 JDK/构建工具矩阵 CI。
- Windows/macOS 跨平台验收。
- 安全与可复现。

---

## 2. JDK21 与 Boot4

兼容矩阵：

| JDK | Boot4 | Maven | Gradle |
|---|---|---|---|
| 17 | ✅ | 3.6.3+ | 8.14+/9.x |
| 21 | ✅ | 3.6.3+ | 8.14+/9.x |
| 8/11 | ❌ | — | — |

规则：

- JDK21 + Boot4 允许；
- JDK21 + Boot2.7 拒绝，除非显式 `allowUnsupported: true`；
- JDK8/11 + Boot4 拒绝；
- Boot4 默认 Maven 3.9.x、Gradle 8.14.6。

---

## 3. Gradle

### 3.1 初始化

- Groovy：`build.gradle`、`settings.gradle`。
- Kotlin：`build.gradle.kts`、`settings.gradle.kts`。
- 模板内置 Gradle Wrapper（脚本 + jar/properties），校验 SHA-256。
- Boot2.7 项目使用 Gradle 7.6.6；Boot3/4 使用 8.14.6；Gradle 7.6 不能在 JDK21 上运行。

### 3.2 suite

```yaml
suites:
  - id: backend
    kind: gradle
    cwd: "."
    jdk: "21"
    buildTool: gradle-kotlin
    goals: ["check"]
    reportGlob: "build/test-results/test/*.xml"
    jacocoGlob: "build/reports/jacoco/test/jacocoTestReport.xml"
    timeoutMinutes: 30
```

命令：

```text
./gradlew --no-daemon --console=plain <tasks...>
```

- 多模块：根 `check` 或 `:module:check`。
- 报告：JUnit XML、JaCoCo XML。
- Wrapper 缺失 → `BUILD_TOOL_NOT_FOUND`。

---

## 4. monorepo

```text
repo/
├─ backend/        Maven 或 Gradle
├─ web/            Vue 或 React
└─ .specgate/config.yaml
```

套件：

- `backend`（maven/gradle）
- `web-unit`（command）
- `web-e2e`（command）

变更选择：

- `backend/**` → backend；
- `web/**` → web；
- 根 `pom.xml`/`build.gradle`/`settings.gradle`/`package.json` → 全部。

CI：

- Java job：JDK 矩阵 + 构建工具；
- Web job：Node 20/22；
- 两个 job 日志独立。

---

## 5. 全矩阵 CI

```yaml
strategy:
  matrix:
    jdk: [8, 11, 17, 21]
    build: [maven, gradle]
```

- Ubuntu：全矩阵；
- Windows：默认组合 + 一个 Gradle 组合；
- macOS：手动触发或 nightly；
- 缓存：`~/.m2/repository`、`~/.gradle/caches`；
- 权限最小化；命令来自 `goals`/`tasks` 白名单。

---

## 6. 跨平台

- Windows：`mvnw.cmd`、`gradlew.bat`、`;` PATH、CRLF 容忍。
- macOS/Linux：`./mvnw`、`./gradlew`、`:` PATH。
- 路径统一 `/`；报告路径写入前做规范化。
- 外部 CLI 编码统一 UTF-8。

---

## 7. 安全与可复现

- 命令只来自白名单字段；
- 不拼接任务文本；
- CI `permissions: contents: read`；
- 版本锁定并写入报告；
- Wrapper jar 校验 SHA-256；
- 不自动执行未知 Gradle 插件（仅 `check`/`test`）。

---

## 8. 错误模型

复用 `java-core` 错误码，新增：

| 错误码 | 场景 |
|---|---|
| `GRADLE_WRAPPER_INVALID` | wrapper jar/属性校验失败 |
| `MONOREPO_SUITE_AMBIGUOUS` | 变更同时命中多个 suite 且无法判定 |
| `UNSUPPORTED_MATRIX` | JDK21+Boot2.7 等未授权组合 |

---

## 9. 测试策略

- Gradle Groovy/Kotlin fixture；
- 多模块 JUnit/JaCoCo fixture；
- monorepo 变更选择矩阵；
- CI YAML 结构断言；
- 真实 Gradle 集成测试可选；
- 回归：`java-core` 与既有技术栈全量通过。

---

## 10. 任务与波次

| 波次 | 任务 |
|---|---|
| W1 | T-101 JDK21/Boot4 |
| W2 | T-102 Gradle scaffold |
| W3 | T-103 Gradle suite、T-104 monorepo init |
| W4 | T-105 monorepo suites/CI、T-106 全矩阵/跨平台/安全/文档 |

---

## 11. 风险

- Boot4 与 Gradle 9.x 的插件兼容性需 PoC。
- macOS runner 成本高。
- monorepo 根文件变更可能触发全量构建。
- Gradle Wrapper jar 许可与体积。
