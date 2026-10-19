# Java 技术栈支持批判性审核报告

## 基本信息

- 审核文档：
  - `docs/design/java-support-review.md`
  - `openspec/changes/java-core/{proposal,design,tasks}.md`
  - `openspec/changes/java-core/specs/**`
  - `openspec/changes/java-extension/{proposal,design,tasks}.md`
  - `openspec/changes/java-extension/specs/**`
  - 两个 change 的 `tests/cases.md` 与 `tests/mapping.json`
- 审核日期：2026-10-19
- 审核类型：需求 + 架构 + 可测试性审核
- 审核轮次：G7 首轮 + 修复后复审

## 审核统计

| 级别 | 数量 | 已解决 | 接受风险 |
|---|---:|---:|---:|
| 🔴 高 | 6 | 6 | 0 |
| 🟡 中 | 9 | 8 | 1 |
| 🟢 低 | 3 | 1 | 2 |

- 高优先级解决率：100%
- 中优先级解决率：89%
- 低优先级解决率：33%

## 高优先级处置

| # | 质疑 | 处置 | 证据 |
|---|---|---|---|
| H1 | 基线不绿：189 项测试 2 失败，AC 写 177 项 | ✅ 已修复 | `e87246e`；`npm test` → 189/189 pass |
| H2 | 缺少 `tests/cases.md` 与 `mapping.json` | ✅ 已补齐 | core 43 AC/43 cases；extension 26 AC/26 cases；映射 100% |
| H3 | 覆盖率缺少 P0/P1/P2 场景与任务 | ✅ 已补齐 | core AC-025、AC-030；T-006 |
| H4 | 既有仓库外部 CLI 与 baseline 未落任务 | ✅ 已补齐 | core AC-022、AC-030、AC-036；T-011 |
| H5 | 无 Maven/Gradle 时 Wrapper 生成路径未定义 | ✅ 已定义 | java-core design §9；T-007 内置 Wrapper |
| H6 | 变更范围过大 | ✅ 已拆分 | `java-core`（16 REQ/43 AC/12 任务）+ `java-extension`（12 REQ/26 AC/6 任务） |

## 中低优先级处置

| # | 问题 | 处置 |
|---|---|---|
| M1 | JDK 缺失、JDK21+Boot2.7、macOS 场景 | ✅ AC-006、AC-103、AC-122 |
| M2 | 超时、XML 解析失败 | ✅ AC-017、AC-018 |
| M3 | 模块与 JPA 默认值 | ✅ AC-009 |
| M4 | 任务依赖不一致 | ✅ T-006 依赖 T-004/T-005；T-009 依赖 T-011 |
| M5 | 硬编码 177 项测试 | ✅ AC-042 改为不硬编码 |
| M6 | 复合 WHEN/THEN 场景 | 🟡 部分解决：core AC-028 已拆分；extension AC-110 保留两组条件，实施时拆为两个测试用例 |
| M7 | 大规模变更未生成 Brief | ✅ 已在 java-core design 记录可选门控决策 |
| M8 | 缺少 AC 标签行为 | ✅ AC-019 |
| M9 | cwd 逃逸仓库 | ✅ AC-043 |
| L1 | T-003/T-009 AC 映射重叠 | 🟢 接受：仅 traceability 冗余，不影响执行 |
| L2 | CI 分支保护未写入 | 🟢 接受：属于 GitHub 仓库设置，实施文档补充 |
| L3 | macOS 默认手动触发 | 🟢 接受：成本考虑，AC-122 明确 |

## 复核验证

| 检查 | 结果 |
|---|---|
| `npm test` | 189 passed / 0 failed |
| core specs/tasks/cases/mapping | 16 REQ / 43 AC / 12 tasks / 43 cases，0 错误 |
| extension specs/tasks/cases/mapping | 12 REQ / 26 AC / 6 tasks / 26 cases，0 错误 |
| 依赖 | 无缺失、无循环 |
| AC 覆盖 | 69/69 |
| 变更包 | `java-stack-support` 已删除，拆分为 core/extension |

## 剩余风险

| # | 风险 | 等级 | 说明 |
|---|---|---|---|
| R1 | extension AC-110 仍为复合场景 | 🟡 中 | 实施时拆为两个测试用例即可 |
| R2 | 分支保护未自动化 | 🟢 低 | 需在 GitHub 设置必需检查 |
| R3 | macOS 默认手动触发 | 🟢 低 | 成本与覆盖的权衡 |
| R4 | 外部 CLI 规则与 Spotless/插件不完全等价 | 🟡 中 | 已在 design 记录降级策略 |
| R5 | Boot4/Gradle 9.x 生态兼容性 | 🟡 中 | T-101 PoC 锁定 |

## 审核结论

✅ **有条件通过**：6 个高优先级问题全部解决，中优先级 8/9 解决；剩余风险已记录，建议在实施中处理 R1，并在仓库设置中处理 R2。

进入实施前，请确认：

- 接受剩余风险 R1-R5；
- 按 `java-core` → `java-extension` 顺序实施；
- 每个 change 分别走 G8-G11。

## 审核员声明

本轮以独立审查者视角完成审核，未修改被审查的实现代码；基线修复与 artifacts 修改均由用户明确批准。

审核员：AI Critical Reviewer  
日期：2026-10-19
