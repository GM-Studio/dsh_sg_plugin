# M6 验收记录：可调度计划与动态并发

日期：2026-10-26
里程碑：M6（覆盖 FR-07、FR-08：AC-23–AC-29；NFR-06、NFR-09）
状态：**已通过**

## 1. 执行门（真实退出码）

| 命令                   | 退出码 | 结果                                                      |
| ---------------------- | ------ | --------------------------------------------------------- |
| `npm test`             | 0      | tests 1083 / pass 1083 / fail 0 / cancelled 0 / skipped 0 |
| `npm run lint`         | 0      | 通过                                                      |
| `npm run format:check` | 0      | 通过                                                      |
| `npm run pack:check`   | 0      | 通过                                                      |
| `npm run codex:smoke`  | 0      | 通过                                                      |

测试数由 M5 的 1023 增至 1083（+60 条）。

## 2. AC 逐条验收

### AC-23 独立模块能够产生可并行任务，存在依赖的任务等待前置结果 —— 通过

- `scheduleLayers` 返回拓扑分层：同层互不依赖，可并行；`maxWidth` 即最大并行度。
- 断言：三个独立任务落在同一层；`b` 依赖 `a` 时分为 `[[a],[b]]` 两层。

### AC-24 无效依赖、循环依赖或缺少必要输入的任务不会被派发 —— 通过

- `PLAN_GRAPH_CYCLE`：环被拒绝，并返回仍在环中的任务清单，不给部分结果。
- `PLAN_GRAPH_DANGLING`：悬空依赖显式列出 `{task, dependency}`。
- `canDispatch` 四类拒绝原因：缺 id、缺 AC 映射、缺文件边界、依赖未完成。

### AC-25 任务可追溯到批准输入；自动调整仅限既定需求、权限与预算 —— 通过

- `traceTasks`：每个任务必须映射到已批准 AC 且有计划版本，否则 `TRACE_INCOMPLETE`。
- `validateSubtask` 三条边界，任一越界即 `SUBTASK_OUT_OF_BOUNDS`：

| 越界类型             | 含义                       |
| -------------------- | -------------------------- |
| `FILE_SCOPE_WIDENED` | 子任务扩大了父任务文件权限 |
| `AC_SCOPE_WIDENED`   | 子任务扩大了 AC 集合       |
| `ACCEPTANCE_RELAXED` | 子任务放松了验收           |

### AC-26 宿主剩余能力少于 4 时按实际可用能力调度，不伪造并发会话 —— 通过

- `availableSlots`：**未探测到宿主能力时按 1 处理**，而不是假设 4 个槽位存在。
- 断言：`hostCapacity: 2` → 2 槽位；`hostCapacity: 16` → 封顶 4；批准的更低预算优先。
- 断言：12 个独立任务并发仍为 4（不随任务数等比例放大）。

### AC-27 文件权限冲突、资源互斥或未稳定的共享接口被识别后协调或串行 —— 通过

| 冲突类型             | 判定                                    |
| -------------------- | --------------------------------------- |
| `file-overlap`       | 文件模式相同或存在前缀包含关系          |
| `shared-resource`    | 双方声明同一共享资源（如测试数据库）    |
| `unstable-interface` | 提供方未标记 `stable: true`，消费方等待 |

- 断言：冲突任务被 `deferred` 且 `reason: conflict`，不会同批并行。
- 断言：接口 `stable: true` 时不阻塞消费方。

### AC-28 达到获批时限或预算边界时保存进度、停止启动新任务并请求调整 —— 通过

- `checkBoundary` 触及边界即 `save-and-stop` 且 `requiresBudgetAdjustment: true`。
- `saveProgress` 保留 `completed`／`pending` 与 `consumedAtStop`。
- **关键反例**：`resumeProgress` 沿用 `consumedAtStop`，断言「重启后剩余预算不回升」。
- **链式反例**：五轮「恢复 → 消耗 300ms → 保存」，累计 1500ms 仍判定越界。

### AC-29 集成结果绑定具体任务、输入版本、agent 会话与提交；最终验证不拼接不同提交 —— 通过

- `recordIntegration` 四要素缺一即 `INTEGRATION_BINDING_INVALID`。
- `bindFinalVerification`：任务绑定或证据指向其他提交即拒绝（`INTEGRATION_COMMIT_MISMATCH` / `INTEGRATION_EVIDENCE_MISMATCH`）。
- 断言：`reusableForOtherCommits: false`，验证结果只对一个提交有效。
- `checkIsolation`：并发任务共用工作区 → `WORKTREE_NOT_ISOLATED`。
- `recordConflict`：冲突必须归属具体任务，未解决时 `requiresRework: true`。

## 3. NFR 验收

| NFR    | 要求       | 证据                                                                                                 | 状态 |
| ------ | ---------- | ---------------------------------------------------------------------------------------------------- | ---- |
| NFR-06 | 资源受控   | `MAX_CONCURRENT_AGENTS = 4`、`MAX_AGENT_RUNTIME_MS = 30 分钟`；费用未知时不声称满足金额上限          | 通过 |
| NFR-09 | 效率可解释 | 六阶段（scan/prepare/queue/execute/integrate/rework）分别记录；未记录时 `recorded: false` 而非显示 0 | 通过 |

## 4. 新增文件

| 文件                                    | 用途                                     | 断言数 |
| --------------------------------------- | ---------------------------------------- | ------ |
| `src/codex/core/plan/graph.js`          | 拓扑分层、派发条件、子任务边界、追溯     | 17     |
| `src/codex/core/scheduler.js`           | 槽位计算、冲突检测、批次选择、决策依据   | 17     |
| `src/codex/core/scheduler-budget.js`    | 预算账本、边界检查、断点恢复、耗时报告   | 13     |
| `src/codex/core/integration-binding.js` | 集成绑定、单提交约束、隔离检查、冲突归属 | 13     |

## 5. 未做的事

| 项                                                      | 归属                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| 把 scheduler 接入 `development.js` 的真实工作树创建流程 | 需改动既有 14 个 development 流程测试的时序假设，属独立评审事项 |
| 真实多任务并发端到端                                    | M8 / E2E-06、E2E-07                                             |
| 宿主能力真实探测接口                                    | 需宿主提供；当前降级为「未探测按 1」并显式标注                  |

## 6. 未执行项（如实记录）

| 检查                 | 状态      | 说明                 |
| -------------------- | --------- | -------------------- |
| 真实并发执行实例     | `NOT_RUN` | M8 / E2E-06 覆盖     |
| `npm run test:mysql` | `NOT_RUN` | M6 未触及 MySQL 代码 |
