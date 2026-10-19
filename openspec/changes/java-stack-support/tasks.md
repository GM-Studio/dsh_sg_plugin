# 任务：java-stack-support

<!-- 每个任务一个标题，紧跟一行 sg:task 元数据；勾选状态由编排器维护。 -->
<!-- 任务按垂直切片组织；[P] 表示可并行，deps 表示前置任务。 -->

## 建议波次

| 波次 | 任务 |
|---|---|
| W1 | T-001 |
| W2 | T-002、T-003 |
| W3 | T-004、T-005 |
| W4 | T-006、T-007、T-008、T-011 |
| W5 | T-009、T-010、T-012、T-013、T-016 |
| W6 | T-014 |
| W7 | T-015 |
| W8 | T-017 |
| W9 | T-018 |

---

## T-001 版本矩阵 PoC 与工具链锁定 [P]

<!-- sg:task {"id":"T-001","title":"版本矩阵 PoC 与工具链锁定","ac":["AC-016","AC-034","AC-051"],"deps":[],"parallel":false} -->

- [ ] 验证 Spotless 6.x/7.x、google-java-format 1.7/1.22+、Checkstyle 9.3/10.x、PMD 6.55/7.x、SpotBugs 4.7.3/4.8+ 的 JDK8/JDK17 运行时兼容性
- [ ] 验证 Gradle 7.6.x（Boot2.7）与 8.14+（Boot3/4）的 Wrapper 行为
- [ ] 锁定 Boot 2.7.18 / 3.5.x / 4.0.x 与 Maven 3.9.x 的补丁版本
- [ ] 验证 Windows 下外部 CLI 的路径、编码与超时行为
- [ ] 将结论回写 `design.md` 的“待 PoC 锁定项”，并生成 `docs/design/java-version-matrix.md`

## T-002 Java 检测与环境解析 [P]

<!-- sg:task {"id":"T-002","title":"Java 检测与环境解析","ac":["AC-017","AC-018","AC-035"],"deps":["T-001"],"parallel":true} -->

- [ ] 新增 `src/v3/java-detect.js`：识别 Maven/Gradle、DSL、Boot、JDK、Wrapper、多模块
- [ ] 新增 `src/v3/env/java.js`：JDK 解析优先级、`javac` 版本校验、`JAVA_HOME`/`PATH` 注入
- [ ] 新增 `src/v3/env/maven.js`、`src/v3/env/gradle.js`：Wrapper 优先、系统工具回退
- [ ] 扩展 `src/v3/env-scan.js`：Java workspace、工具缺失、安装计划
- [ ] 单测覆盖 Maven/Gradle fixture、版本不匹配、Wrapper 缺失

## T-003 配置模型与 suite schema [P]

<!-- sg:task {"id":"T-003","title":"配置模型与 suite schema","ac":["AC-003","AC-004","AC-019","AC-020"],"deps":["T-001"],"parallel":true} -->

- [ ] `src/v3/change.js`：`SUITE_KINDS` 增加 `maven`/`gradle`
- [ ] `readSuites()` 支持 `jdk`、`buildTool`、`goals`、`reportGlob`、`jacocoGlob`
- [ ] `validateSuites()` 校验 Java suite 的 `cwd`、`jdk`、`goals`、报告 glob
- [ ] `parseConfig` 兼容 `java:`、`quality.profile`、`coverage` 新字段
- [ ] 单测覆盖旧配置兼容、非法组合、字段缺省值

## T-004 Maven suite 与报告 [P]

<!-- sg:task {"id":"T-004","title":"Maven suite 与报告","ac":["AC-021","AC-023","AC-024","AC-025","AC-027","AC-028"],"deps":["T-002","T-003"],"parallel":true} -->

- [ ] 实现 `runMavenSuite()`：Wrapper、`-B -ntp`、`verify`、超时、日志
- [ ] 支持根聚合与 `-pl` / `-am` 模块执行
- [ ] 泛化 `parseJunitXml()`：`runner`、`fileResolver`、多文件聚合、去重
- [ ] 发现 `target/surefire-reports` 与 `target/failsafe-reports`
- [ ] 失败定位到模块、suite、退出码、报告路径
- [ ] 单测覆盖单模块/多模块/报告缺失/失败用例

## T-005 Gradle suite 与报告 [P]

<!-- sg:task {"id":"T-005","title":"Gradle suite 与报告","ac":["AC-031","AC-033","AC-034","AC-035"],"deps":["T-002","T-003"],"parallel":true} -->

- [ ] 实现 `runGradleSuite()`：Wrapper、`--no-daemon --console=plain`、`check`
- [ ] 支持根 `check` 与 `:module:check`
- [ ] 解析 `build/test-results/test/*.xml`
- [ ] 处理 Gradle 7.6.x 与 8.14+ 的 Wrapper 差异
- [ ] 单测覆盖 Groovy/Kotlin、多模块、Wrapper 缺失

## T-006 JaCoCo 与覆盖率 [P]

<!-- sg:task {"id":"T-006","title":"JaCoCo 与覆盖率","ac":["AC-011","AC-012","AC-026","AC-032"],"deps":["T-004"],"parallel":true} -->

- [ ] 新增 `src/v3/coverage/jacoco.js`：解析行/分支/类/方法
- [ ] 多模块按 covered/missed 聚合，不平均百分比
- [ ] 接入 `coverage.blocking/lines/branches/p0p1/p2`
- [ ] 覆盖率缺失时按 profile 阻断或降级
- [ ] 单测覆盖聚合、阈值、缺失报告

## T-007 Maven 脚手架与首个 change [P]

<!-- sg:task {"id":"T-007","title":"Maven 脚手架与首个 change","ac":["AC-001","AC-002","AC-005","AC-007","AC-008"],"deps":["T-003","T-004"],"parallel":true} -->

- [ ] 生成 Maven Wrapper、`pom.xml`、启动类、`/health`、JUnit 5 测试
- [ ] 支持 Boot 2.7.18 与 Boot 3.5.x 的 `pom.xml`
- [ ] 写入 `.specgate/config.yaml` 的 Java suite
- [ ] 生成首个 `add-version` change（停在 H1）
- [ ] 幂等初始化，不覆盖已有文件
- [ ] 集成测试：默认组合 `./mvnw test` 通过

## T-008 Gradle 脚手架 [P]

<!-- sg:task {"id":"T-008","title":"Gradle 脚手架","ac":["AC-006","AC-029","AC-030"],"deps":["T-003","T-005"],"parallel":true} -->

- [ ] 生成 Gradle Wrapper、`build.gradle(.kts)`、启动类、`/health`、测试
- [ ] 支持 Groovy DSL 与 Kotlin DSL
- [ ] 支持 Boot 2.7/3.x/4.x 的插件版本
- [ ] 写入 `.specgate/config.yaml` 的 Gradle suite
- [ ] 集成测试：`./gradlew check` 通过

## T-009 初始化交互与兼容矩阵

<!-- sg:task {"id":"T-009","title":"初始化交互与兼容矩阵","ac":["AC-003","AC-004","AC-005","AC-006","AC-007"],"deps":["T-007","T-008"],"parallel":false} -->

- [ ] 扩展 `CONTEXT_FIELDS`：JDK/构建工具/Boot/模块/groupId/包名
- [ ] 实现单轮多问题交互与 H0 摘要
- [ ] 实现合法组合过滤与 `JAVA_STACK_INVALID`
- [ ] 默认 JDK8 + Maven + Boot2.7 + 最小模块集
- [ ] 单测覆盖合法/非法组合、默认值、幂等

## T-010 既有仓库接入

<!-- sg:task {"id":"T-010","title":"既有仓库接入","ac":["AC-017","AC-018","AC-019","AC-020","AC-021","AC-022"],"deps":["T-002","T-004","T-005","T-006"],"parallel":false} -->

- [ ] 实现 existing 分支：JavaDetector + 配置生成 + env 报告
- [ ] 生成 `docs/java-onboarding.md` 与补丁建议
- [ ] 不修改 `pom.xml` / `build.gradle`，重复执行幂等
- [ ] 执行既有套件并输出报告
- [ ] 处理 Spotless/JaCoCo 缺失降级
- [ ] 单测覆盖“构建文件 diff 为空”与重复接入

## T-011 质量工具链基础 [P]

<!-- sg:task {"id":"T-011","title":"质量工具链基础","ac":["AC-014","AC-016"],"deps":["T-001","T-003"],"parallel":true} -->

- [ ] 扩展 `quality.js`：Java format/lint/static 探测
- [ ] 实现 `quality.profile`（strict/light）
- [ ] 实现 analysis JVM 选择与回退
- [ ] 质量工具缺失返回 `QUALITY_TOOL_MISSING`
- [ ] 单测覆盖 profile、JVM 回退、工具缺失

## T-012 Spotless + Checkstyle G7.5 [P]

<!-- sg:task {"id":"T-012","title":"Spotless + Checkstyle G7.5","ac":["AC-009","AC-010","AC-015"],"deps":["T-011","T-007"],"parallel":true} -->

- [ ] 接入 Spotless `apply` 与 Checkstyle `check`
- [ ] 既有仓库回退 `google-java-format` CLI
- [ ] 输出 `format-report.md` 与违规明细
- [ ] Checkstyle 失败阻断 G8
- [ ] 单测/集成测试覆盖通过/失败/工具缺失

## T-013 PMD + SpotBugs G9 [P]

<!-- sg:task {"id":"T-013","title":"PMD + SpotBugs G9","ac":["AC-013","AC-014"],"deps":["T-011","T-007"],"parallel":true} -->

- [ ] 接入 PMD 与 SpotBugs，新增 `static` 阶段
- [ ] 解析违规文件/行号，P0/P1 blocking
- [ ] strict 执行，light 跳过
- [ ] 输出 `review-report.md`
- [ ] 单测覆盖通过/阻断/profile

## T-014 monorepo 初始化与套件 [P]

<!-- sg:task {"id":"T-014","title":"monorepo 初始化与套件","ac":["AC-036","AC-037","AC-038","AC-039","AC-040"],"deps":["T-007","T-008","T-009"],"parallel":true} -->

- [ ] 新增 `java-monorepo` stack 与目录约定
- [ ] 生成 Java 后端 + Vue/React 前端脚手架
- [ ] 根配置同时写入 Java 与前端 suite
- [ ] 按 `changedFiles` 选择 suite
- [ ] 单测覆盖 Vue/React、后端/前端/根变更

## T-015 monorepo CI

<!-- sg:task {"id":"T-015","title":"monorepo CI","ac":["AC-041","AC-042"],"deps":["T-014"],"parallel":false} -->

- [ ] 生成 Java job（setup-java + 缓存）
- [ ] 生成前端 job（setup-node + unit/e2e）
- [ ] 两个 job 日志独立、失败互不遮蔽
- [ ] 集成测试检查 workflow 结构

## T-016 Java CI 矩阵生成 [P]

<!-- sg:task {"id":"T-016","title":"Java CI 矩阵生成","ac":["AC-043","AC-044","AC-045","AC-050"],"deps":["T-007","T-008"],"parallel":true} -->

- [ ] 生成 Ubuntu JDK 8/11/17/21 × Maven/Gradle 矩阵
- [ ] 生成 Windows 默认组合冒烟
- [ ] 缓存 `~/.m2/repository` 与 `~/.gradle/caches`
- [ ] 命令只来自白名单 `goals`/`tasks`，CI 最小权限
- [ ] 单测检查 YAML 结构与矩阵组合

## T-017 发布前质量与文档

<!-- sg:task {"id":"T-017","title":"发布前质量与文档","ac":["AC-046","AC-048","AC-051"],"deps":["T-010","T-012","T-013","T-015","T-016"],"parallel":false} -->

- [ ] `npm run lint` / `npm test` / `npm run pack:check` 全部通过
- [ ] 更新 README / README.zh.md / CHANGELOG
- [ ] 固化 JDK/Boot/Maven/Gradle/质量工具版本与来源
- [ ] 校验模板与示例结构
- [ ] 文档与 `java-support-review.md` 一致

## T-018 集成回归与可选 Java 测试

<!-- sg:task {"id":"T-018","title":"集成回归与可选 Java 测试","ac":["AC-047","AC-049"],"deps":["T-017"],"parallel":false} -->

- [ ] 新增 fake `mvnw`/`gradlew` fixture 与 JUnit/JaCoCo XML fixture
- [ ] 真实 Java 集成测试作为可选 CI job，无 JDK 时跳过
- [ ] 回归 Node/Python/Vue/React/monorepo 初始化与 suite
- [ ] 全量测试通过（现有 177 项 + 新增）
- [ ] 输出验收报告
