# M7 验收记录：影响范围验证、证据与审批边界

日期：2026-10-26
里程碑：M7（覆盖 FR-09、FR-10：AC-30–AC-36；NFR-05、NFR-09）
状态：**已通过**

## 1. 执行门（真实退出码）

| 命令                   | 退出码 | 结果                                                      |
| ---------------------- | ------ | --------------------------------------------------------- |
| `npm test`             | 0      | tests 1126 / pass 1126 / fail 0 / cancelled 0 / skipped 0 |
| `npm run lint`         | 0      | 通过                                                      |
| `npm run format:check` | 0      | 通过                                                      |
| `npm run pack:check`   | 0      | 通过                                                      |
| `npm run codex:smoke`  | 0      | 通过                                                      |

测试数由 M6 的 1083 增至 1126（+43 条）。

## 2. AC 逐条验收

### AC-30 常规变更不无条件附加完整业务金丝雀，但必须展示验证选择及其依据 —— 通过

- `selectVerification`：`business-canary` 仅在关键版本或内核变化时附加。
- 常规变更下被跳过的检查进入 `skipped` 并附 `reason`。
- `rationale` 至少含内核判定说明与「受影响模块」一行。
- 空 `uncovered` 必须给出 `coverageJustification`，不能默认「无影响」。

### AC-31 关键版本或内核变化缺真实闭环证据不得宣称通过 —— 通过

- `KERNEL_PATHS` 声明工作流内核文件（状态机、审批、状态、验证档案、类型词表、开发、质量、计划、结果分类）。
- `isKernelChange` 返回命中文件清单与依据句，而非仅布尔值。
- 命中或 `criticalVersion: true` → `requiresFullClosure: true`。
- Windows 路径分隔符被归一化后比对。

### AC-32 已成立的工具链自检、历史保留等约束不被错误要求先变成业务失败 —— 通过

- `validateAcceptanceNature` 区分三种性质：`business-goal` / `regression-guard` / `runtime-constraint`。
- **核心反例断言**：`runtime-constraint` 且 `requiresRedBaseline: true` → `CONSTRAINT_REQUIRES_RED`。
- 业务目标仍可合法要求红基线（不得一刀切禁止）。

### AC-33 技术验证、人工验收、归档、推送和生产部署分别报告 —— 通过

- `buildLayeredReport` 五层独立；未报告的层保持 `not-run`。
- 断言：技术验证通过不蕴含 push 或 production-deployment；`derivedFromOtherLayers: false`。
- 断言：`allPassed` 需五层全 `passed`。
- 断言：`passed` 但无证据 → `PASS_WITHOUT_EVIDENCE`。

### AC-34 仅存在脚本、报告模板或生成文档，不能生成执行通过结论 —— 通过

- `assertExecutionEvidence` 拒绝四类文档型来源（`report-template`、`requirement-baseline`、`generated-document`、`script`）。
- 通过证据必须含真实命令、`exitCode === 0`、合法时间戳，缺一即 `EVIDENCE_INCOMPLETE`。

### AC-35 修改后的提交不能直接复用修改前的 PASS —— 通过

- `canReusePass`：提交不同即 `commit-changed` 且 `requiresRerun: true`。
- 格式化产生新提交 → `formatter-created-a-new-commit`，同样要求重跑。
- `classifyFormatCheck` 区分只读检查与会写动作。

### AC-36 五类审批分离 —— 通过

- `APPROVAL_KINDS` 五类：写入需求文档、批准需求、批准计划、批准安装、批准交付。
- 每种操作只认自己那一类：`authorize` 遍历全部 5×4 组合断言互不替代。
- `independenceMatrix` 产出 C(5,2) = 10 组两两独立性，逐组断言双向不可替代。
- 审批绑定 `artifactHash`：内容变化 → `APPROVAL_STALE`；已消费 → `APPROVAL_ALREADY_CONSUMED`。
- **核心断言**：持有「写入需求文档」审批时，「批准需求」仍被拒，并列出实际持有的审批。

## 3. 本次修复的真实缺陷

| 位置                  | 问题                                                                       | 修法                                                                                   |
| --------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `classifyFormatCheck` | `--write` 与 `--check` 并存时判为只读（`explicitWrite && !explicitCheck`） | 改为「出现任一写入意图即保守判为写入」——把写误判成只读会让格式化产生的新提交跳过质量门 |

## 4. 新增文件

| 文件                                    | 用途                                        | 断言数 |
| --------------------------------------- | ------------------------------------------- | ------ |
| `src/codex/core/impact.js`              | 影响分析、内核触发、AC 性质校验             | 15     |
| `src/codex/core/report-layers.js`       | 五层报告、证据判定、PASS 复用、格式检查分类 | 16     |
| `src/codex/core/approval-separation.js` | 五类审批与两两独立性                        | 12     |

## 5. 未做的事

| 项                                       | 归属                                                            |
| ---------------------------------------- | --------------------------------------------------------------- |
| 把 impact 接入真实 `quality.js` 阶段归因 | 需改动既有质量门测试的断言结构，属独立评审事项                  |
| 替换既有 `approvals.js` 的 H1/H2/H3 门禁 | 现有 H 门禁语义由状态机与 42 个审批测试锁定，替换需专门迁移计划 |
| 真实关键版本完整闭环                     | M8 / E2E-09                                                     |

## 6. 未执行项（如实记录）

| 检查                 | 状态       | 说明                                       |
| -------------------- | ---------- | ------------------------------------------ |
| 真实关键版本闭环实例 | `NOT_RUN`  | M8 / E2E-09 覆盖                           |
| `npm run test:mysql` | `NOT_RUN`  | M7 未触及 MySQL 代码                       |
| OI-06 关键版本清单   | 待用户确认 | 当前内核清单为保守默认（全部内核模块命中） |
