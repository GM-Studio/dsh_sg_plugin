# SpecGate Core MVP v2 · 30 条 RQ 需求映射矩阵

- 对应任务：**CORE2-0002 建立 30 条 RQ 到模块与测试的映射**
- 依据：v1.0 `1.0-frozen`（RQ-001…RQ-024）+ Delta v1.1 `v1.1-delta-frozen`（RQ-025…RQ-030 + 13 条追加 AC）
- 计划：`docs/plans/2026-10-25-...-mvp-plan-v2.zh.md`（`v2.0-approved`）
- 采集方式：静态代码审计 + 真实命令证据（见 CORE2-0001 基线报告）
- 生成时间：2026-10-25

> 判定口径：**「代码存在」不等于「需求通过」**。本矩阵只记录实现痕迹与测试痕迹，Pass 与否由 M1–M6 的真实断言决定。

---

## 1. 状态分布总览

| 实现状态            | 数量 | RQ                                                     |
| ------------------- | ---- | ------------------------------------------------------ |
| 有测试证据          | 18   | RQ-001…007、009…011、013、015、016、017、019、020、024 |
| 部分实现 / 部分证据 | 6    | RQ-008、012、014、018、021、022、023                   |
| 未实现（新增条）    | 6    | RQ-025…RQ-030                                          |

> 说明：上表「有测试证据」指该 RQ 的关键 AC 在既有测试文件中有可见断言；Delta v1.1 §2 已认定其中 7 条需追加或强化（见各行的「缺口」列）。

---

## 2. 逐条映射

### 2.1 RQ-001…RQ-010（需求与计划阶段）

| RQ     | 要点                       | 主里程碑 | 源文件                                                                             | 测试文件                                                                                 | 状态     | 缺口                                                                                                                                    |
| ------ | -------------------------- | -------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| RQ-001 | 项目绑定与只读预检         | M2       | `src/codex/server.js`、`src/codex/core/project-path.js`、`src/codex/change-add.js` | `test/codex-change-add-flow.test.js`、`test/codex-artifact-store.test.js`                | 有证据   | 无                                                                                                                                      |
| RQ-002 | 现有项目基线               | M0       | `src/codex/baseline.js`、`src/codex/baseline-job.js`                               | `test/codex-baseline.test.js`、`test/codex-baseline-job.test.js`                         | 有证据   | 无                                                                                                                                      |
| RQ-003 | 单活动 Change              | M1       | `src/codex/state-machine.js`、`src/codex/change-add.js`                            | `test/codex-state-kernel.test.js`（ACTIVE_CHANGE）、`test/codex-change-add-flow.test.js` | 有证据   | 无                                                                                                                                      |
| RQ-004 | 原生需求澄清               | M2       | `src/codex/host-input.js`、`src/codex/change-add.js`                               | `test/codex-change-add-flow.test.js`（三轮五问）                                         | 有证据   | AC-004-03 建议追加显式断言（CORE2-0204）                                                                                                |
| RQ-005 | 需求规格与 AC              | M2       | `src/codex/change-add.js`、`src/codex/change-policy.js`                            | `test/codex-change-add-flow.test.js`、`test/codex-change-policy.test.js`                 | 有证据   | AC-005-02 重复 ID 断言建议补齐（CORE2-0204）                                                                                            |
| RQ-006 | 反向复述与批判分析         | M2       | `src/codex/change-add.js`                                                          | `test/codex-change-add-flow.test.js`                                                     | 有证据   | AC-006-01 断言建议补齐（CORE2-0204）                                                                                                    |
| RQ-007 | H1 可信需求批准            | M1       | `src/codex/approvals.js`、`src/codex/host-input.js`                                | `test/codex-approval-authority.test.js`、`test/codex-approval-state.test.js`             | 有证据   | AC-007-03 重复消费断言建议补齐（CORE2-0204）                                                                                            |
| RQ-008 | 计划、文件白名单、依赖边界 | M2       | `src/codex/plan.js`、`src/codex/development.js`                                    | `test/codex-plan-core.test.js`、`test/codex-development-flow.test.js`                    | **部分** | **无 `allowedFiles`/`forbiddenFiles` 字段**（AC-008-06）；**无依赖批准门**（AC-008-07）；边界硬编码 frontend/backend（CORE2-0201/0202） |
| RQ-009 | 独立测试设计与冻结         | M2       | `src/codex/plan.js`（逐文件 hash）                                                 | `test/codex-plan-core.test.js`（篡改失配、previousHash 链）                              | 有证据   | **冻结后可整体替换**（RQ-029 / CORE2-0203）                                                                                             |
| RQ-010 | 红色基线                   | M2       | `src/codex/development.js`                                                         | `test/codex-development-flow.test.js`（red baseline requires real failing command）      | 有证据   | 无                                                                                                                                      |

### 2.2 RQ-011…RQ-024（实现、质量、交付）

| RQ     | 要点                          | 主里程碑 | 源文件                                                                                          | 测试文件                                                                                                       | 状态       | 缺口                                                                                                                                                             |
| ------ | ----------------------------- | -------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RQ-011 | 隔离实现与提交证据            | M3       | `src/codex/development.js`（worktree、单写入者、diff 校验）                                     | `test/codex-development-flow.test.js`                                                                          | 有证据     | 无                                                                                                                                                               |
| RQ-012 | 有界修复与失败上下文          | M3       | `src/codex/development.js`、`src/codex/checkpoints.js`                                          | `test/codex-format-rework.test.js`、`test/codex-development-flow.test.js`                                      | **部分**   | **findings 不进 Implementer 输入**（AC-012-05）；**轮次上界 off-by-one + 双上界**（AC-012-06）（CORE2-0301/0302）                                                |
| RQ-013 | 确定性质量门                  | M3       | `src/codex/quality.js`                                                                          | `test/codex-quality-gate.test.js`                                                                              | 有证据     | skip 判失败、改生产文件检测、runtime 证据均已实现                                                                                                                |
| RQ-014 | 格式化后全量回归              | M4       | `src/codex/format.js`（**未调用质量门**）                                                       | `test/codex-format-rework.test.js`（仅断言 phase/changedFiles）                                                | **未实现** | **格式化后不重跑质量门**（AC-014-05）（CORE2-0401）；src 与 test 双缺                                                                                            |
| RQ-015 | 固定提交独立 Review           | M4       | `src/codex/review.js`、`src/codex/workflow-tools.js`、`src/codex/server.js`                     | `test/codex-review-release.test.js`                                                                            | **部分**   | **`reviewRoleProvider` 默认入口未装配**（AC-015-06）；**报告可由 `args.report` 注入**（AC-015-07）（CORE2-0403）                                                 |
| RQ-016 | H3 人工交付验收               | M4       | `src/codex/review.js`、`src/codex/approvals.js`                                                 | `test/codex-review-release.test.js`、`test/codex-approval-authority.test.js`                                   | 有证据     | 无                                                                                                                                                               |
| RQ-017 | DeliveryRecord 与交付包       | M4       | `src/codex/release.js`、`src/codex/delivery.js`                                                 | `test/codex-delivery-record.test.js`、`test/codex-delivery-v3.test.js`                                         | **部分**   | **客户包 `knownIssues` 写死空数组**（AC-017-06）（CORE2-0404）                                                                                                   |
| RQ-018 | 证据链和新鲜度                | M1+M4    | `src/codex/events.js`、`src/codex/storage.js`、`src/codex/review.js`                            | `test/codex-state-kernel.test.js`、`test/codex-review-release.test.js`                                         | **部分**   | 跨 commit 证据可混成新指纹（AC-018-06）（CORE2-0402）；事件链端到端未单测                                                                                        |
| RQ-019 | 状态查询 / 暂停 / 恢复 / 取消 | M5       | `src/codex/state-machine.js`、`src/codex/checkpoints.js`、`src/codex/project-status.js`         | `test/codex-state-kernel.test.js`（pause/cancel/PUSH_FAILED）                                                  | **部分**   | `resumePhase` 只写不读；工具层契约未逐条断言                                                                                                                     |
| RQ-020 | 本地安全边界                  | M5       | `src/codex/core/artifact-store.js`、`src/codex/core/project-path.js`、`src/codex/host-input.js` | `test/codex-artifact-store.test.js`、`test/codex-host-input.test.js`、`test/codex-change-policy.test.js`       | 有证据     | Windows 8.3/UNC/设备路径未归一化（Delta §5.3 不纳入）                                                                                                            |
| RQ-021 | 最小产品面与默认启动          | M5       | `src/codex/workflow-tools.js`、`package.json`                                                   | `test/codex-plugin-protocol.test.js`、`test/codex-plugin-package.test.js`、`test/codex-tools-workflow.test.js` | **部分**   | **默认面含 `sg_work_item_*`**（AC-021-05，smoke 已实证）；**包内含 mysql2**（AC-021-06，pack 已实证）；**静态加载 control**（AC-021-07）（CORE2-0501/0502/0503） |
| RQ-022 | 技术栈与验收范围              | M3+M6    | `src/codex/quality.js`、`src/codex/core/java/`                                                  | `test/codex-golden-matrix.test.js`、`test/codex-quality-gate.test.js`                                          | **部分**   | 命令来源为 provider 而非 profile（AC-022-04）（CORE2-0303）；矩阵测试存在但非真实网络验证                                                                        |
| RQ-023 | 现有仓库迁移边界              | M0+M5    | 全仓（`src/codex/control/`、`core/control/`、`management/`、`channels/`）                       | 无专测                                                                                                         | **部分**   | 混合测试集导致核心无法独立全绿（AC-023-03）（CORE2-0504）                                                                                                        |
| RQ-024 | 核心发行质量                  | M0+M6    | 全仓                                                                                            | —                                                                                                              | **不成立** | **`npm test` fail=6**（CORE2-0001 已取证）；format:check 失败；**新发现端口 flake**（CORE2-0604）                                                                |

### 2.3 RQ-025…RQ-030（Delta v1.1 新增条）

| RQ     | 要点               | 主里程碑 | 目标源文件                                                        | 目标测试文件                                 | 当前状态                                                        | 对应任务   |
| ------ | ------------------ | -------- | ----------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- | ---------- |
| RQ-025 | 单一权威状态源     | M1       | `src/codex/core/state.js`（改只读）、`src/codex/state-machine.js` | `test/codex-state-kernel.test.js`（追加）    | **未实现**：存在第二套可写内核（12 值 phase，无 CAS/锁/事件链） | CORE2-0102 |
| RQ-026 | 审批期间写入可用性 | M1       | `src/codex/state-machine.js`、`src/codex/approvals.js`            | `test/codex-approval-state.test.js`（追加）  | **未实现**：写锁跨越原生审批（K-01）                            | CORE2-0103 |
| RQ-027 | 事务回滚一致性     | M1       | `src/codex/state-machine.js`、`src/codex/events.js`               | `test/codex-state-kernel.test.js`（追加）    | **未实现**：回滚只 version--，事件已 fsync（K-02）              | CORE2-0104 |
| RQ-028 | 事件链外部单调锚点 | M1       | `src/codex/events.js`、`src/codex/storage.js`                     | `test/codex-core-anchor.test.js`（**新建**） | **未实现**：无外部信任锚（K-03）                                | CORE2-0105 |
| RQ-029 | 冻结测试不可替换   | M2       | `src/codex/plan.js`、`src/codex/plan-tools.js`                    | `test/codex-plan-core.test.js`（追加）       | **可实现绕过**：TESTING 阶段凭 reason 整体替换                  | CORE2-0203 |
| RQ-030 | 状态对外/内部分离  | M1       | `src/codex/state-machine.js`                                      | `test/codex-state-kernel.test.js`（追加）    | **未实现**：16 主 + 6 侧，与 10+3 无映射表                      | CORE2-0101 |

---

## 3. 13 条追加 AC 的验证方式

来自 Delta v1.1 §3.1，追加到 8 个既有 RQ。

| AC        | 归属 RQ | 验证方式                                                                | 归入任务   |
| --------- | ------- | ----------------------------------------------------------------------- | ---------- |
| AC-008-06 | RQ-008  | 自动化：缺 `allowedFiles` 拒绝冻结；diff 越界阻断                       | CORE2-0201 |
| AC-008-07 | RQ-008  | 自动化：依赖清单变更无 AC 映射即阻断                                    | CORE2-0202 |
| AC-012-05 | RQ-012  | 自动化：断言角色输入载荷含 findings 且条数 > 0                          | CORE2-0301 |
| AC-012-06 | RQ-012  | 自动化：第 3 次失败进 BLOCKED；断言全仓单一上界常量                     | CORE2-0302 |
| AC-014-05 | RQ-014  | 自动化：格式化后质量门被调用且证据绑定新 commit                         | CORE2-0401 |
| AC-015-06 | RQ-015  | 自动化：未装配时返回 PROVIDER_UNAVAILABLE 且状态报 unavailable          | CORE2-0403 |
| AC-015-07 | RQ-015  | 自动化：非 native 模式下拒绝调用方注入 report                           | CORE2-0403 |
| AC-017-06 | RQ-017  | 自动化：客户摘要 knownIssues 与 DeliveryRecord 逐项一致                 | CORE2-0404 |
| AC-018-06 | RQ-018  | 自动化：跨 commit 证据在 Review 与 H3 均被拒                            | CORE2-0402 |
| AC-021-05 | RQ-021  | 自动化：默认工具名集合与期望清单**完全相等**                            | CORE2-0501 |
| AC-021-06 | RQ-021  | 自动化：pack 清单与 dependencies 不含 mysql2                            | CORE2-0503 |
| AC-021-07 | RQ-021  | 自动化：静态 import 图不含 control/management/channels/mysql-repository | CORE2-0502 |
| AC-022-04 | RQ-022  | 自动化：拒绝模型传入的任意命令字符串；证据带来源                        | CORE2-0303 |

---

## 4. 18 条新 AC 的验证方式

来自 Delta v1.1 §3.2，RQ-025…RQ-030 各 3 条，全部为**自动化负向 + 正向**断言。

| RQ     | AC              | 验证方式                                                                                  |
| ------ | --------------- | ----------------------------------------------------------------------------------------- |
| RQ-025 | AC-025-01/02/03 | 存在性断言：全仓无第二条可写状态路径；直写旧文件被 fail-closed 拒绝；两处读取不得矛盾     |
| RQ-026 | AC-026-01/02/03 | 并发断言：审批挂起期间读取 < 1s 返回；写入返回 APPROVAL_IN_PROGRESS；超时后无残留锁       |
| RQ-027 | AC-027-01/02/03 | 注入故障：回滚后链仍可校验；无重复 sequence；快照失败可见                                 |
| RQ-028 | AC-028-01/02/03 | 回退场景：事件+快照同时回退被检出；锚点缺失 fail-closed；锚点单调推进                     |
| RQ-029 | AC-029-01/02/03 | 阶段门：TESTING 阶段替换被拒；必须回退检查点+重跑红色基线；旧 hash/原因/审批/新 hash 并存 |
| RQ-030 | AC-030-01/02/03 | 映射覆盖：22 个内部状态全部有唯一对外映射；篡改映射即失败                                 |

---

## 5. 里程碑覆盖核对

| 里程碑 | 覆盖 RQ                                                        | 任务数 |
| ------ | -------------------------------------------------------------- | ------ |
| M0     | RQ-002、RQ-023、RQ-024                                         | 4      |
| M1     | RQ-003、RQ-007、RQ-018、RQ-025、RQ-026、RQ-027、RQ-028、RQ-030 | 5      |
| M2     | RQ-001…RQ-010、RQ-029                                          | 4      |
| M3     | RQ-011、RQ-012、RQ-013、RQ-022                                 | 3      |
| M4     | RQ-014…RQ-018                                                  | 4      |
| M5     | RQ-019、RQ-020、RQ-021、RQ-023                                 | 4      |
| M6     | RQ-022、RQ-024                                                 | 5      |

**核对结果：30 条 RQ 全部至少映射一个里程碑，无遗漏、无重复编号。**

---

## 6. 已知差距索引（复用 Delta §2）

| GAP                           | 归入任务                | 里程碑 |
| ----------------------------- | ----------------------- | ------ |
| GAP-01 状态词表不一致         | CORE2-0101              | M1     |
| GAP-02 双状态内核             | CORE2-0102              | M1     |
| GAP-03 格式化后不重跑质量门   | CORE2-0401              | M4     |
| GAP-04 证据跨 commit 复用     | CORE2-0402              | M4     |
| GAP-05 Review provider 未装配 | CORE2-0403              | M4     |
| GAP-06 报告可注入             | CORE2-0403              | M4     |
| GAP-07 plan 无 allowedFiles   | CORE2-0201              | M2     |
| GAP-08 角色边界硬编码         | CORE2-0201              | M2     |
| GAP-09 无依赖批准门           | CORE2-0202              | M2     |
| GAP-10 findings 不进输入      | CORE2-0301              | M3     |
| GAP-11 轮次上界 off-by-one    | CORE2-0302              | M3     |
| GAP-12 冻结测试可整体替换     | CORE2-0203              | M2     |
| GAP-13 客户摘要过滤已知问题   | CORE2-0404              | M4     |
| GAP-14 默认面含 WorkItem      | CORE2-0501              | M5     |
| GAP-15 包内强制 mysql2        | CORE2-0503              | M5     |
| GAP-16 静态加载控制面         | CORE2-0502              | M5     |
| GAP-17 命令来源非 profile     | CORE2-0303              | M3     |
| GAP-18 resumePhase 只写不读   | CORE2-0103 / CORE2-0104 | M1     |

---

## 7. 结论

1. 30 条 RQ 全部有：主里程碑、源文件映射、测试文件映射（或明确「待新建」）、实现状态、缺口与归属任务。
2. **18 条有测试证据 / 6 条部分 / 6 条未实现**，与 Delta v1.1 §2 的 18 条 GAP 完全对齐，无新增或遗漏。
3. 13 条追加 AC 与 18 条新 AC 全部给出验证方式，无「待定」项。
4. 本矩阵**不宣称任何 RQ 已通过**；通过与否由各里程碑的真实断言决定。
