# SNA-0105 重基线记录与旧约束处置声明（M1）

日期：2026-10-26
本文记录 M1 把四条硬约束重基线化的完整过程。每条必须给齐四要素：**旧 → 新 → 生效条件 → 回滚**。

需求 §8 明确要求：「旧有『所有冻结 case 必须全红』和『开发并发必须为 1』等约束与 D03/D06 存在明确差异，实施前需要正式重基线化，**不能通过临时绕过校验实现**。」本文即该重基线的正式记录。

---

## 1. 并发上限：从「必须等于 1」到「1..4 的硬上界」

| 要素     | 内容                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧       | `src/codex/plan.js:162` 判 `graph.maxParallelDevelopment !== 1` → `PLAN_GRAPH_INVALID`；生成处 `:403` 写死字面量 `1`                        |
| 新       | 要求正整数且 `<= MAX_PARALLEL_DEVELOPMENT`（4）；越界返回专门码 `PLAN_PARALLEL_LIMIT_EXCEEDED`，非整数或小于 1 返回 `PLAN_PARALLEL_INVALID` |
| 生效条件 | 计划文档显式声明该值；未声明时默认 `DEFAULT_PARALLEL_DEVELOPMENT = 1`（与旧行为完全一致）                                                   |
| 回滚     | 删除两个导出常量并恢复 `!== 1` 判断即可；不涉及数据迁移                                                                                     |

**为什么不截断**：截断会把用户批准的 5 静默变成 4，等于篡改批准的资源预算。超界必须拒绝并要求重新审批（对应 AC-28）。

**反例门禁**：`test/codex-plan-core.test.js` 新增断言要求 `5` 被拒且码为 `PLAN_PARALLEL_LIMIT_EXCEEDED`，同时保留 `1` 合法。另有一条源码扫描断言禁止 `plan.js` 再出现 `maxParallelDevelopment: 1` 或 `!== 1`。

---

## 2. 全红基线：从全局硬约束到版本化验证档案

| 要素     | 内容                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧       | `src/codex/development.js:469-503` 对所有 Change 无差别要求「每个冻结 case 在实现前真实失败」，否则 `RED_REPORT_INVALID`                                                                                            |
| 新       | 新增 `src/codex/core/validation-profile.js`：档案含 `profileVersion`、`profileId`、`requiresAllFrozenCasesRed` 与按场景的 `redBaseline`/`regression`。旧状态无档案字段时解析为 `legacy`（语义与旧行为**完全等价**） |
| 生效条件 | 状态显式记录 `validationProfile`；未记录时一律 legacy                                                                                                                                                               |
| 回滚     | 删除 `validation-profile.js` 并移除状态字段引用；旧状态本就无该字段，天然兼容                                                                                                                                       |

**关键范围约束**：M1 **只定义档案与校验，不接线到执行路径**。`development.js` / `quality.js` 未引用该模块——这一条本身有测试断言（`test/codex-validation-profile.test.js` 的「M1 does not wire the profile into the execution path」）。接线在 M5 / SNA-0502，届时才真正改变行为。

因此：

- AC-19、AC-20 在 M1 结束时**仍为 `NOT_IMPLEMENTED`**，本文件不声称它们已通过；
- 现有 Change 的冻结基线校验行为零变化。

---

## 3. 变更类型词表：从三处各自维护到单一来源

| 要素     | 内容                                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧       | `src/codex/change-policy.js:3` 为 `feature/modify/fix`；`src/codex/core/state.js:22` 与 `src/codex/core/change.js:398` 为 `feature/modify/fix/remove`。同一概念两套词表 |
| 新       | 新增 `src/codex/core/change-types.js` 为唯一来源（`CHANGE_TYPES`、`isChangeType`、`CHANGE_TYPE_HINT`）；三处改为引用它                                                  |
| 生效条件 | 无条件生效；`remove` 现在在 change-policy 层合法（此前被拒）                                                                                                            |
| 回滚     | 恢复三处内联数组即可                                                                                                                                                    |

**语义影响（必须显式承认）**：`remove` 此前会被 `change-policy.validateChangeInput` 拒绝（`CHANGE_TYPE_INVALID`），现在被接受。这是**收敛到既有 state/change 语义**，而不是新增能力——`remove` 早在 `core/state.js` 与 `core/change.js` 中就是合法值。

**未做的事**：`refactor` **没有**加入词表。它由 M5 / SNA-0501 引入，M1 有测试断言 `isChangeType('refactor') === false`，防止提前放行。

**反例门禁**：三条源码扫描断言禁止三处再出现内联词表数组。

---

## 4. ProjectProfile schema：从 stack 硬钉到能力/模块描述

| 要素     | 内容                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 旧       | `src/codex/project-model.js:128` 判 `value.stack !== 'java-vue'` → `PROJECT_PROFILE_INVALID`；Java/Vue 专属字段（`javaPreset`/`frontendFramework`/`backendPackage`/`frontendLocales`）在顶层 |
| 新       | 新增 `src/codex/core/profile-migration.js`：v3 以 `capabilities` + `modules` 表达能力，`stack` 降级为可选描述性标签；提供纯函数 `migrateProfileV2ToV3` 与 `normalizeProfile`                 |
| 生效条件 | v2 档案继续由 `validateProjectProfile` 校验并通过（**只读兼容**）；v3 仅在显式使用 `validateProjectProfileV3` 时生效                                                                         |
| 回滚     | 删除 `profile-migration.js`；`project-model.js` 未改动，v2 路径完全不受影响                                                                                                                  |

**迁移器性质**：纯函数——同输入恒等输出、不读盘、不写盘、不生成时间戳（`createdAt`/`updatedAt` 原样保留）。有测试断言 `os.tmpdir()` 条目数在迁移前后不变。

**反例门禁**：v3 拒绝引用不存在模块的 capability（返回 `dangling`）、拒绝缺失 `capabilities`/`modules`、拒绝未知字段与重复 id、拒绝非 v2 输入。

**M1 不改检测产出**：`project-detect.js` / `project-adopt.js` 未引用迁移模块（有测试断言）。v3 的实际产出在 M2 / SNA-0201..0202。

---

## 5. 旧计划与既有冻结资产的处置

### 5.1 docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan-v2.zh.md（v2.0-approved）

| 项           | 处置                                                                                |
| ------------ | ----------------------------------------------------------------------------------- |
| 文件本身     | **不删除、不改写**。该计划在其自身范围内仍然有效                                    |
| 覆盖关系     | 本计划（SNA）在其之上演进；v2 中「并发必须为 1」的表述与 SNA-0102 冲突，以 SNA 为准 |
| 历史执行记录 | 其执行附录作为历史证据保留，不重写                                                  |

### 5.2 既有冻结资产（.specgate/ 下的计划/契约/测试冻结件）

| 资产                                          | 处置                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| 已冻结的计划图（`maxParallelDevelopment: 1`） | **不需要迁移**：默认值仍为 1，旧图继续通过校验                               |
| 已冻结的测试资产                              | **不动**：M1 未改 `plan.js` 的冻结逻辑，也未改 `development.js` 的红基线判定 |
| 既有 Change 的验证档案                        | 无档案字段 → 解析为 legacy，行为与今天完全一致                               |
| ProjectProfile v2                             | 继续通过 `validateProjectProfile`，无需迁移                                  |

**结论：M1 不要求任何既有资产迁移。** 这是把「重基线」做成「增加可配置维度 + 保留旧默认」而不是「改语义」的直接结果。

---

## 6. 本次改动清单

### 新增文件

| 文件                                    | 用途                                              |
| --------------------------------------- | ------------------------------------------------- |
| `src/codex/core/validation-profile.js`  | 版本化验证策略档案（SNA-0101）                    |
| `src/codex/core/change-types.js`        | 变更类型词表唯一来源（SNA-0103）                  |
| `src/codex/core/profile-migration.js`   | ProjectProfile v3 与 v2→v3 纯函数迁移（SNA-0104） |
| `test/codex-validation-profile.test.js` | 16 条断言                                         |
| `test/codex-profile-migration.test.js`  | 11 条断言                                         |

### 修改文件

| 文件                               | 改动                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/codex/plan.js`                | 导出 `MAX_PARALLEL_DEVELOPMENT`/`DEFAULT_PARALLEL_DEVELOPMENT`；并发校验改为上界判断；生成处改用常量 |
| `src/codex/change-policy.js`       | 引用统一词表；错误信息含合法类型列表                                                                 |
| `src/codex/core/state.js`          | 引用并再导出统一词表                                                                                 |
| `src/codex/core/change.js`         | 引用统一词表与提示串                                                                                 |
| `test/codex-plan-core.test.js`     | **改 1 条既有断言**（3 → 5，理由见下）；新增 2 条断言                                                |
| `test/codex-change-policy.test.js` | 新增 3 条断言（既有断言未改）                                                                        |

### 断言变更（旧 → 新 → 理由）

| 文件:行                       | 旧断言                                        | 新断言                                                       | 理由                                                                             |
| ----------------------------- | --------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `codex-plan-core.test.js:194` | `maxParallelDevelopment = 3` → `ok === false` | `= 5` → `ok === false` 且码为 `PLAN_PARALLEL_LIMIT_EXCEEDED` | D08 上界为 4，3 合法。原断言把「只允许 1」固化进测试，属需求 §8 要求清除的旧约束 |

**其余 12 个受影响测试文件的断言一条未改。**

---

## 7. 未做的事（防止范围蔓延）

| 项                                           | 为什么不做                                  | 归属                |
| -------------------------------------------- | ------------------------------------------- | ------------------- |
| 把验证档案接到 `development.js`/`quality.js` | M1 只做结构，接线会立即改变既有 Change 行为 | M5 / SNA-0502       |
| 引入 `refactor` 类型                         | 需要同时定义其验证策略                      | M5 / SNA-0501       |
| 改 `project-detect.js` 产出 v3               | 检测重构与 M1 无关                          | M2 / SNA-0201..0202 |
| 放宽 `init.js` 的祖先 `.git` 探测            | 既有行为，超出 M0–M2 范围                   | 观察项 OBS-01       |
| 删除或改写旧计划                             | NFR-07 与需求 §8 要求保留历史               | —                   |
