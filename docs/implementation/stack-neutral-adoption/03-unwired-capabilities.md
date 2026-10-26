# SNA-0004 未接线能力与复用清单（M0）

日期：2026-10-26
目的：登记仓库中**已实现但未被接通**或**已接通可复用**的能力，避免 M2–M8 重复造轮子。

## 1. 核心发现：core/suites.js 零引用

文件：src/codex/core/suites.js（748 行），已实现多构建系统套件探测与执行。

| 行                 | 能力                                                        |
| ------------------ | ----------------------------------------------------------- |
| :54                | suggestSuites(root) —— 探测仓库可用测试套件                 |
| :42-143            | 已支持 node-test、pytest、maven、gradle、command 五类 suite |
| :151               | suiteIdForAc(mapping, suites, ac) —— AC → suite 映射        |
| :523               | runOneSuite(...) —— 单套件执行                              |
| :667 / :708        | runTaskSuites / runAllSuites                                |
| :200               | parseJunitXml(...) —— JUnit 结果解析                        |
| :245 / :331 / :427 | runPytestSuite / runMavenSuite / runGradleSuite             |

**验证命令与结果**（真实执行）：

```
rg -n "core/suites.js" src scripts test
```

输出为空：src/、scripts/、test/ 均无导入方。

**结论**：该模块在仓库内零引用，属「已实现未接线」。它同时支持 maven/gradle/pytest/node-test，正好覆盖 FR-01（AC-01）与 FR-06 所需的跨技术栈测试执行，是 M2/M5 的最低成本起点。

**风险提示**：零引用意味着它的行为没有测试覆盖，接入时必须先补测试（SNA-0201 第一步），不得假定其可用。

## 2. 可复用能力清单

| #    | 能力                           | 证据                                                                                                | 现状         | 首次消费里程碑 | 复用时需补的缺口                                          |
| ---- | ------------------------------ | --------------------------------------------------------------------------------------------------- | ------------ | -------------- | --------------------------------------------------------- |
| U-01 | 多构建系统套件探测与执行       | src/codex/core/suites.js:54、:42-143、:523                                                          | 已实现未接线 | M2 / SNA-0201  | 无测试覆盖；需先补 test/codex-stack-detect.test.js 再接入 |
| U-02 | 有界环境发现                   | src/codex/core/java/java-env.js:136-139（maxEntries、roots.slice(0,16)）、:380/:495（slice(0,128)） | 已接通       | M2 / SNA-0203  | 上限散落在各函数，需抽为共享常量（SNA-0303）              |
| U-03 | 安装包校验                     | src/codex/core/environment-install.js:14-31（verifyArchive）                                        | 已接通       | M3 / SNA-0305  | 无（直接复用）                                            |
| U-04 | 审批一次性消费 + 门禁授权      | src/codex/approvals.js:332（consume）、:377（authorizeGate）                                        | 已接通       | M2 / SNA-0205  | 需扩展门禁作用域以支持五类审批（SNA-0707）                |
| U-05 | 验证结果分类状态（含 not-run） | src/codex/adopted-verification.js:15-16（RESULT_STATES、FAILURE_STATES）                            | 已接通       | M2 / SNA-0206  | 需增加 infrastructure / business-failure 区分（SNA-0503） |
| U-06 | 已知失败基线索引               | src/codex/adopted-verification.js:21（knownFailureIndex）                                           | 已接通       | M2 / SNA-0206  | 需与 OI-03 准入策略对接                                   |
| U-07 | 平台矩阵诚实记录               | scripts/verify-codex-matrix.mjs:16-31（一平台一记录，其余 not-run）                                 | 已接通       | M4 / SNA-0402  | 需增加 Linux CI job                                       |

## 3. 与 suites.js 的接线计划

| 步骤 | 里程碑 | 任务     | 说明                                                                                        |
| ---- | ------ | -------- | ------------------------------------------------------------------------------------------- |
| 1    | M2     | SNA-0201 | 先为 suites.js 补最小测试（maven/gradle/pytest/node-test 各一例），确认行为后再接入         |
| 2    | M2     | SNA-0201 | project-detect.js 用 suggestSuites 填充跨技术栈的 commands.test，替换当前仅前后端的两条路径 |
| 3    | M5     | SNA-0503 | suites.js 的结果分类接入 infrastructure / business-failure 判定                             |
| 4    | M6     | SNA-0601 | suiteIdForAc 用于 AC → 套件映射，支撑按影响范围选取验证集                                   |

## 4. 明确的**不**复用项

| 能力                                                    | 原因                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| src/codex/core/java/verify-evidence.js 的固定 8 段阶段  | 与 AC-22、FR-09 冲突；M5/M7 需按能力重构，不复用其硬编码顺序 |
| src/codex/core/environment.js:38-74 的 pom/package 推断 | 与 AC-11、FR-03 冲突；M3 替换为能力推导                      |
| src/codex/plan.js:19-38 的 roleForKind 固定映射         | 与 AC-22 冲突；M5 改为可配置（默认保持等价）                 |

## 5. 自检

| 项                                                 | 结果             |
| -------------------------------------------------- | ---------------- |
| 七项能力均登记现状、复用方式、首次消费里程碑、缺口 | 是               |
| suites.js 零引用事实被记录并给出接入入口           | 是（第 1、3 节） |
| 未修改任何源码                                     | 是               |
