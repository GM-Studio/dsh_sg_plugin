# java-core 设计

> 状态：G4 待复审  
> 上游：`proposal.md`、`docs/design/java-support-review.md`  
> 拆分：Gradle/JDK21/Boot4/monorepo/全矩阵由 `java-extension` 承担。  
> 规模说明：本 change 已按垂直切片拆分；specgate 将 G6.5 Brief 设为可选门控，本 change 未单独生成 Brief，任务与测试计划已覆盖其核心信息。

---

## 1. 范围

- JDK 8/11/17，Maven，Spring Boot 2.7.x / 3.x。
- Maven 单模块与多模块测试。
- Surefire/Failsafe XML、JaCoCo、P0/P1/P2 阈值。
- G7.5/G8/G9 质量门禁。
- 既有 Maven 仓库零构建文件侵入接入。
- Maven CI（JDK 8/11/17）。
- 测试计划与 AC 映射。

---

## 2. 设计原则

1. **增量优先**：不重构 Node/Python runner；新增 `maven` 分支与共享解析器。
2. **先绿后改**：实施前基线测试必须全绿（当前 189/189）。
3. **测试先行**：`tests/cases.md` 与 `tests/mapping.json` 先于实现。
4. **只读接入**：既有仓库默认不改 `pom.xml`。
5. **版本锁定**：JDK/Boot/Maven/质量工具版本由 T-001 PoC 锁定。
6. **失败可诊断**：稳定错误码 + 命令 + 退出码 + 日志尾部 + 报告路径。

---

## 3. 配置模型

```yaml
workflowVersion: 3
schemaVersion: 3
stack: java

java:
  jdk: 8
  buildTool: maven
  bootVersion: "2.7.18"
  groupId: com.example
  artifactId: demo
  packageName: com.example.demo
  modules: ["web", "validation", "actuator", "test"]

quality:
  profile: strict

coverage:
  blocking: true
  lines: 80
  branches: 70
  p0p1: 100
  p2: 90
  baseline: null          # 既有仓库：已接受的历史基线，null 表示无

suites:
  - id: backend
    kind: maven
    cwd: "."
    jdk: "8"
    buildTool: maven
    goals: ["-B", "-ntp", "verify"]
    reportGlob: "target/{surefire,failsafe}-reports/TEST-*.xml"
    jacocoGlob: "target/site/jacoco/jacoco.xml"
    timeoutMinutes: 30
```

字段全部可选；旧配置无需迁移。

---

## 4. 检测与 JDK

新增 `src/v3/java-detect.js`、`src/v3/env/java.js`、`src/v3/env/maven.js`。

JDK 优先级：

1. suite `jdk`；
2. `.java-version`；
3. `.sdkmanrc`；
4. `JAVA_HOME`；
5. `java -version`；
6. SDKMAN 候选；
7. 失败 `JDK_NOT_FOUND`。

校验 `javac` 主版本；不一致 `JDK_VERSION_MISMATCH`。

兼容过滤：

- JDK8/11 → 只允许 Boot2.7；
- JDK17 → Boot2.7/3.x；
- JDK21、Boot4、Gradle → `java-extension`；
- JDK13 → 不在选择项，仅允许手工绝对路径。

---

## 5. Maven suite

```text
./mvnw -B -ntp -Dstyle.color=never <goals...>
```

- 默认 goals：`-B -ntp verify`。
- 多模块：根聚合或 `-pl`/`-am`。
- 超时：默认 30 分钟；超时 `BUILD_TIMEOUT`。
- 报告：Surefire/Failsafe XML、JaCoCo XML。
- 解析：泛化 `parseJunitXml`，支持 `runner`、`fileResolver`、多文件聚合、去重。
- 失败：定位模块、suite、退出码、日志尾部、报告路径。
- AC 标签：测试名或 `@DisplayName` 中的 `[AC-xxx]`；无标签时报告 `AC_TAG_MISSING`。

---

## 6. 覆盖率与优先级

新增 `src/v3/coverage/jacoco.js`：

- 解析行/分支/类/方法；
- 多模块按 covered/missed 累加；
- 阈值：行 ≥80%、分支 ≥70%、P0/P1 AC 100%、P2 ≥90%。

优先级来源：

```json
{
  "requirements": [
    { "ac": "AC-001", "priority": "P0", "suite": "backend" }
  ]
}
```

- `priority` 缺省按 P1；
- 既有仓库可设置 `coverage.baseline`，未达标但不超过 baseline 时只告警；
- `coverage.blocking: false` 时全部只告警。

---

## 7. 质量门禁

| 门禁 | 检查 | 阻断 |
|---|---|---|
| G7.5 | Spotless apply + Checkstyle | 是 |
| G8 | Maven test + JaCoCo + P0/P1/P2 | 是 |
| G9 | PMD + SpotBugs + Reviewer | P0/P1 |

profile：

- `strict`：全部；
- `light`：Spotless + Checkstyle + JaCoCo。

analysis JVM：

- 优先 JDK17 运行现代工具；
- 无 JDK17 时回退 JDK8 兼容版本；
- 版本由 T-001 锁定。

---

## 8. 既有 Maven 仓库

- 只读检测，生成 `.specgate/config.yaml`、`env.json`、`env-report.md`、`docs/java-onboarding.md`。
- 不改 `pom.xml`。
- 质量工具降级：
  - Spotless 缺失 → `google-java-format` CLI；
  - Checkstyle/PMD/SpotBugs 缺失 → 外部 CLI；
  - JaCoCo 缺失 → 读取已有报告；否则 `coverage: unavailable`；
  - 默认 `coverage.blocking: false`，并输出补丁建议。
- 幂等：重复接入不覆盖已有配置。

---

## 9. Wrapper

- 新项目模板内置 Maven Wrapper 脚本与 wrapper jar/properties，初始化不依赖本机 Maven。
- 校验 wrapper 来源与 SHA-256，写入版本清单。
- 既有仓库有 wrapper 用 wrapper；无 wrapper 有系统 Maven 用系统；都没有 → `BUILD_TOOL_NOT_FOUND`。

---

## 10. CI

生成 Maven CI：

```yaml
strategy:
  matrix:
    jdk: [8, 11, 17]
steps:
  - uses: actions/setup-java@v4
    with:
      distribution: temurin
      java-version: ${{ matrix.jdk }}
  - run: ./mvnw -B -ntp verify
```

缓存 `~/.m2/repository`；权限最小化；命令只来自白名单 `goals`。

---

## 11. 错误模型

| 错误码 | 场景 |
|---|---|
| `JAVA_STACK_INVALID` | 非法 JDK/Boot 组合 |
| `JDK_NOT_FOUND` | 找不到 JDK |
| `JDK_VERSION_MISMATCH` | 主版本不符 |
| `BUILD_TOOL_NOT_FOUND` | 无 Wrapper/系统 Maven |
| `BUILD_TIMEOUT` | 超时 |
| `BUILD_FAILED` | 非零退出 |
| `TEST_REPORT_MISSING` | 无 JUnit XML |
| `TEST_REPORT_PARSE_FAILED` | XML 解析失败 |
| `AC_TAG_MISSING` | 用例无 AC 标签 |
| `COVERAGE_MISSING` | 无 JaCoCo XML |
| `COVERAGE_BELOW_THRESHOLD` | 低于阈值 |
| `STATIC_ANALYSIS_FAILED` | Checkstyle/PMD/SpotBugs 失败 |
| `QUALITY_TOOL_MISSING` | 工具缺失 |

---

## 12. 测试策略

- 先创建 `tests/cases.md` 与 `tests/mapping.json`，覆盖全部 AC。
- 单元测试：检测、JDK、Maven 命令、JUnit/JaCoCo 解析、阈值、错误码。
- 集成测试：fake `mvnw` + 固定 XML。
- 真实 Maven 集成测试可选。
- 回归：Node/Python/Vue/React 全量测试通过（不硬编码数量）。

---

## 13. 任务与波次

| 波次 | 任务 |
|---|---|
| W1 | T-001 PoC |
| W2 | T-002 检测/env、T-003 配置 |
| W3 | T-004 Maven 单模块、T-005 Maven 多模块 |
| W4 | T-006 覆盖率、T-007 Maven scaffold、T-010 质量基础 |
| W5 | T-008 初始化交互、T-009 既有仓库、T-011 外部 CLI |
| W6 | T-012 CI/文档/回归 |

---

## 14. 风险

- JDK8 工具链老化；需 analysis JVM。
- 外部 CLI 规则与插件不完全等价。
- 既有仓库覆盖率 baseline 需要人工确认。
- Wrapper jar 许可与校验。
- Maven 插件执行即代码执行，安全边界依赖可信仓库。
