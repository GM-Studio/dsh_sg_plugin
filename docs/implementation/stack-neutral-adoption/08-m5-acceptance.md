# M5 验收记录：四类场景验证策略

日期：2026-10-26
里程碑：M5（覆盖 FR-06：AC-19、AC-20、AC-21、AC-22）
状态：**已通过**

## 1. 执行门（真实退出码）

| 命令                   | 退出码 | 结果                                                      |
| ---------------------- | ------ | --------------------------------------------------------- |
| `npm test`             | 0      | tests 1023 / pass 1023 / fail 0 / cancelled 0 / skipped 0 |
| `npm run lint`         | 0      | 通过                                                      |
| `npm run format:check` | 0      | 通过                                                      |
| `npm run pack:check`   | 0      | 通过                                                      |
| `npm run codex:smoke`  | 0      | 通过                                                      |

测试数由 M4 的 986 增至 1023（+37 条）。

## 2. AC 逐条验收

### AC-19 重构需求可以合法进入工作流，不必伪装成新增功能或故意制造全红 —— 通过

- `refactor` 加入唯一词表（`src/codex/core/change-types.js`），`state.js` 与 `change.js` 自动继承。
- 必填三字段：`internalStructure`、`preservedBehavior`、`constraints`，缺一即 `CHANGE_DETAILS_INVALID`。
- 反例断言：`refactor` 同时声明 `desiredBehavior` → 拒绝（那是 `modify` 的语义）。
- 不要求 fix 的 `expectedBehavior`/`actualBehavior`，也不要求 modify 的三字段。
- 红基线策略 `none`：`development.js` 允许全绿通过而不阻断，但仍要求可读报告（不能因为命令成功就跳过证据）。

### AC-20 新增或修复的目标用例失败、既有回归通过时，不因回归没有失败而拒绝有效基线 —— 通过

- 验证档案接线到 `development.js` 的 `prepare`：按 `state.type` 解析场景策略后传给 `redBaseline`。
- 四种 `redBaseline` 策略各有明确语义：

| 策略                   | 含义                                 | 适用场景        |
| ---------------------- | ------------------------------------ | --------------- |
| `all-frozen-cases-red` | 每个冻结用例都必须真实失败（旧行为） | legacy 档案     |
| `target-only-red`      | 至少一个目标用例真实失败，回归保持绿 | feature、modify |
| `reproduce-red`        | 复现目标故障的用例失败               | fix             |
| `none`                 | 不要求红基线                         | refactor        |

- 关键兼容性：`legacyProfile()` 对所有场景都用 `all-frozen-cases-red`，且旧状态无档案字段时解析为 legacy。既有 development 流程测试一条未改、全部通过。
- 非 legacy 策略下仍强制「冻结用例不得被跳过」。

### AC-21 超时、缺依赖、进程异常或未运行不能冒充已观察到的业务缺陷 —— 通过

- 新增 `src/codex/core/outcome-classification.js`：两个业务结论 + 四个基础设施结论。
- 分类优先级：基础设施信号优先于业务信号——「缺依赖导致的断言失败」归为 `missing-dependency`，否则实现方会去修一个不存在的缺陷。

| 输入                                                  | 结果                 | 是否业务 |
| ----------------------------------------------------- | -------------------- | -------- |
| `ETIMEDOUT` / 超时                                    | `timeout`            | 否       |
| `ENOENT` / `Cannot find module` / `command not found` | `missing-dependency` | 否       |
| `SIGKILL` / `ENOMEM` / `EACCES`                       | `process-error`      | 否       |
| 非零退出但无可读报告                                  | `process-error`      | 否       |
| `skip` / `not-run`                                    | `not-run`            | 否       |
| 真正的断言失败                                        | `business-failure`   | 是       |

- 报告级结论：出现任何基础设施问题 → `usableAsBusinessEvidence: false` 且 `usableAsRedBaseline: false`。
- 回归守卫：断言 `development.js` 仍保留 `infrastructureErrors` 与 `failureKind === infrastructure` 两条既有校验，SNA-0502 的改写没有放宽它们。

### AC-22 纯模块变更不被强制附加无关的前端、后端、HTTP 或数据模型任务 —— 通过

- 新增 `implementationRolesFor(snapshot)`：按 `moduleRoles` 派生实现角色。

| moduleRoles                             | 实现角色               |
| --------------------------------------- | ---------------------- |
| 无（向后兼容）                          | `backend` + `frontend` |
| `{service:1}`                           | `backend`              |
| `{ui:1}`                                | `frontend`             |
| `{cli:1}` / `{library:1}` / `{other:1}` | `backend`（单端）      |
| `{service:1,ui:1}`                      | `backend` + `frontend` |

- 生成器与集成依赖共用同一份角色列表，避免两处口径不一致。
- 图校验随之放宽为「至少一个实现角色 + 每条 AC 被至少一个实现 kind 覆盖」，结构性 kind 仍须逐一存在。
- 向后兼容：无 `moduleRoles` 时行为与之前完全一致，`codex-plan-core` 全部既有断言未改。

## 3. 本次改动中发现并修复的真实缺陷

窄化实现角色后图校验失败，暴露了三处原本被「前后端总是同时存在」掩盖的硬编码：

| 位置            | 问题                                                   | 修法                                              |
| --------------- | ------------------------------------------------------ | ------------------------------------------------- |
| `validateGraph` | 要求每一种 kind 都必须出现，窄化后缺 `frontend` 即非法 | 改为「结构性 kind 逐一存在 + 实现 kind 至少其一」 |
| `validateGraph` | 要求每条 AC 被所有 kind 覆盖                           | 改为「结构性 kind 全覆盖 + 实现 kind 至少其一」   |
| 集成任务依赖    | 依赖过滤写死 frontend 与 backend 两个字面量            | 改用本次计算出的 `implementationRoles`            |

## 4. 接线范围的明确边界

| 文件                       | 是否引用验证档案 | 理由                                 |
| -------------------------- | ---------------- | ------------------------------------ |
| `src/codex/development.js` | 是（M5 起）      | 红基线判定需要按场景策略             |
| `src/codex/quality.js`     | 否               | 质量门不在 SNA-0502 范围；有断言守住 |

原 M1 守卫断言（「两者都不得引用」）已按设计更新为「development 必须引用、quality 不得引用」。

## 5. 断言变更记录

| 文件                               | 旧                             | 新                                          | 理由             |
| ---------------------------------- | ------------------------------ | ------------------------------------------- | ---------------- |
| `codex-change-policy.test.js`      | 词表恰为 4 个；`refactor` 非法 | 词表 5 个；`refactor` 合法但需三字段        | SNA-0501 / AC-19 |
| `codex-validation-profile.test.js` | 断言 development 不得引用档案  | 断言 development 必须引用、quality 不得引用 | SNA-0502 接线    |

其余受影响测试文件的断言未改（`codex-development-flow` 全绿证明 legacy 行为未变）。

## 6. 新增文件

| 文件                                       | 用途                   | 断言数 |
| ------------------------------------------ | ---------------------- | ------ |
| `src/codex/core/outcome-classification.js` | 基础设施与业务故障分类 | 15     |
| `test/codex-scenario-policy.test.js`       | 场景策略矩阵           | 10     |
| `test/codex-plan-roles.test.js`            | 模块角色驱动的任务图   | 10     |

## 7. 未做的事

| 项                                                     | 归属                              |
| ------------------------------------------------------ | --------------------------------- |
| 把 outcome-classification 接入 `quality.js` 的阶段归因 | M7 / SNA-0701                     |
| 真实四类变更端到端实例                                 | M8 / E2E-05                       |
| 已冻结 Change 的档案迁移                               | 不需要：无档案字段即解析为 legacy |

## 8. 未执行项（如实记录）

| 检查                                         | 状态          | 说明                                                                                   |
| -------------------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| `npm run test:mysql`                         | `NOT_RUN`     | M5 未触及 MySQL 代码                                                                   |
| 真实仓库的四类变更实例                       | `NOT_RUN`     | M8 / E2E-05                                                                            |
| `codex-management-security.test.js` 端口占用 | 偶发 `EACCES` | 首次全量跑时该文件因 127.0.0.1 端口被外部占用失败；单独重跑 13/13 通过。非本次改动引起 |
