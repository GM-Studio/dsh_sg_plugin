# 任务：java-core

<!-- 每个任务一个标题，紧跟一行 sg:task 元数据；勾选状态由编排器维护。 -->

## 建议波次

| 波次 | 任务 |
|---|---|
| W1 | T-001 |
| W2 | T-002、T-003 |
| W3 | T-004、T-005 |
| W4 | T-006、T-007、T-010、T-011 |
| W5 | T-008、T-009 |
| W6 | T-012 |

---

## T-001 版本矩阵 PoC 与工具链锁定

<!-- sg:task {"id":"T-001","title":"版本矩阵 PoC 与工具链锁定","ac":["AC-029","AC-037","AC-042"],"deps":[],"parallel":false} -->

- [ ] 验证 Spotless/GJF/Checkstyle/PMD/SpotBugs/JaCoCo 在 JDK8 与 JDK17 的兼容版本
- [ ] 验证 Maven 3.9.x、Boot 2.7.18/3.5.x 与 Wrapper 行为
- [ ] 验证 Windows 外部 CLI 路径、编码、超时
- [ ] 锁定版本并写入 `docs/design/java-version-matrix.md`
- [ ] 回写 design 的待 PoC 项

## T-002 Java 检测与环境解析 [P]

<!-- sg:task {"id":"T-002","title":"Java 检测与环境解析","ac":["AC-006","AC-031","AC-032"],"deps":["T-001"],"parallel":true} -->

- [ ] 新增 `src/v3/java-detect.js`
- [ ] 新增 `src/v3/env/java.js`、`env/maven.js`
- [ ] JDK 优先级、版本校验、`JDK_NOT_FOUND`
- [ ] Wrapper 与系统 Maven 解析
- [ ] 单测覆盖未安装 JDK、版本不匹配、Wrapper 缺失

## T-003 配置模型与 suite schema [P]

<!-- sg:task {"id":"T-003","title":"配置模型与 suite schema","ac":["AC-004","AC-005","AC-033","AC-034","AC-043"],"deps":["T-001"],"parallel":true} -->

- [ ] `SUITE_KINDS` 增加 `maven`
- [ ] `readSuites`/`validateSuites` 支持 `jdk`、`goals`、`reportGlob`、`jacocoGlob`
- [ ] `parseConfig` 支持 `java`、`quality.profile`、`coverage` 新字段
- [ ] 非法组合 `JAVA_STACK_INVALID`；`cwd` 逃逸仓库拒绝
- [ ] 单测覆盖旧配置兼容与字段缺省

## T-004 Maven 单模块与报告 [P]

<!-- sg:task {"id":"T-004","title":"Maven 单模块与报告","ac":["AC-011","AC-012","AC-013","AC-017"],"deps":["T-002","T-003"],"parallel":true} -->

- [ ] 实现 `runMavenSuite()` 与超时
- [ ] 解析 Surefire XML、AC 标签映射
- [ ] 报告缺失 `TEST_REPORT_MISSING`
- [ ] 单测覆盖通过/缺失/超时

## T-005 Maven 多模块与诊断 [P]

<!-- sg:task {"id":"T-005","title":"Maven 多模块与诊断","ac":["AC-014","AC-015","AC-016","AC-018","AC-019"],"deps":["T-002","T-003"],"parallel":true} -->

- [ ] 根聚合与 `-pl`/`-am`
- [ ] 多模块 XML 聚合与去重
- [ ] XML 解析失败、AC 标签缺失
- [ ] 失败模块定位与日志尾部
- [ ] 单测覆盖多模块/失败/解析错误

## T-006 覆盖率与优先级 [P]

<!-- sg:task {"id":"T-006","title":"覆盖率与优先级","ac":["AC-023","AC-024","AC-025","AC-026","AC-030"],"deps":["T-004","T-005"],"parallel":true} -->

- [ ] 新增 `src/v3/coverage/jacoco.js`
- [ ] 行/分支/多模块聚合
- [ ] P0/P1/P2 通过率与阈值
- [ ] 覆盖率缺失、baseline
- [ ] 单测覆盖阈值/缺失/baseline

## T-007 Maven 脚手架 [P]

<!-- sg:task {"id":"T-007","title":"Maven 脚手架","ac":["AC-001","AC-002","AC-003","AC-007","AC-008","AC-009","AC-010"],"deps":["T-003","T-004"],"parallel":true} -->

- [ ] 模板内置 Maven Wrapper（脚本 + jar/properties）
- [ ] 生成 Boot2.7/3.x `pom.xml`、启动类、`/health`、测试
- [ ] 生成首个 `add-version` change
- [ ] 幂等与不覆盖
- [ ] 集成测试：默认、JDK11、JDK17 组合

## T-008 初始化交互 [P]

<!-- sg:task {"id":"T-008","title":"初始化交互","ac":["AC-004","AC-005","AC-006","AC-007","AC-008","AC-009"],"deps":["T-007"],"parallel":true} -->

- [ ] 扩展 `CONTEXT_FIELDS`
- [ ] 单轮多问题与 H0 摘要
- [ ] 合法组合过滤
- [ ] 默认 JDK8 + Maven + Boot2.7
- [ ] 单测覆盖选项/非法组合/JDK 缺失

## T-009 既有 Maven 仓库接入 [P]

<!-- sg:task {"id":"T-009","title":"既有 Maven 仓库接入","ac":["AC-031","AC-032","AC-033","AC-034","AC-035","AC-036"],"deps":["T-002","T-004","T-005","T-006","T-011"],"parallel":true} -->

- [ ] existing 分支：检测 + 配置 + env 报告
- [ ] 生成 onboarding 文档与补丁建议
- [ ] 不修改 `pom.xml`，重复接入幂等
- [ ] 执行既有测试
- [ ] 覆盖率缺失降级与 baseline
- [ ] 单测覆盖“构建文件 diff 为空”

## T-010 G7.5/G9 质量门禁 [P]

<!-- sg:task {"id":"T-010","title":"G7.5/G9 质量门禁","ac":["AC-020","AC-021","AC-022","AC-027","AC-028"],"deps":["T-003","T-004"],"parallel":true} -->

- [ ] Spotless + Checkstyle 接入
- [ ] PMD + SpotBugs 接入
- [ ] strict/light profile
- [ ] `format-report.md` / `review-report.md`
- [ ] 单测覆盖通过/阻断/降级

## T-011 外部 CLI 与 baseline [P]

<!-- sg:task {"id":"T-011","title":"外部 CLI 与 baseline","ac":["AC-022","AC-030","AC-036"],"deps":["T-003"],"parallel":true} -->

- [ ] `google-java-format` CLI 回退
- [ ] Checkstyle/PMD/SpotBugs 外部 CLI
- [ ] 工具 jar 缓存与版本校验
- [ ] 覆盖率 baseline 读写
- [ ] 单测覆盖 CLI 缺失/回退/baseline

## T-012 CI、文档与回归

<!-- sg:task {"id":"T-012","title":"CI、文档与回归","ac":["AC-037","AC-038","AC-039","AC-040","AC-041","AC-042"],"deps":["T-001","T-006","T-008","T-009","T-010","T-011"],"parallel":false} -->

- [ ] 生成 Maven CI JDK8/11/17、缓存、最小权限、Windows 冒烟
- [ ] 更新 README / README.zh.md / CHANGELOG
- [ ] 校验 `tests/cases.md` 与 `tests/mapping.json` 覆盖全部 AC
- [ ] 全量回归，不硬编码测试数量
- [ ] 输出验收报告
