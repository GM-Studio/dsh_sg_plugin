# SpecGate Core 最小可靠交付 MVP · 执行计划与里程碑（v2.0）

- 计划状态：**v2.0-approved（已批准，2026-10-25）**
- 日期：2026-10-25
- 适用仓库：SpecGate Codex 插件（当前版本 `0.3.4`，分支 `sg-codex`）
- 执行模式：计划驱动、测试先行、逐里程碑验收、不可跳门

## 关联文档

| 文档                                                                                | 版本                | 状态               | 本计划如何使用                                                                        |
| ----------------------------------------------------------------------------------- | ------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| `docs/requirements/2026-10-25-specgate-core-reliable-delivery-mvp.zh.md`            | `1.0-frozen`        | 已冻结             | **需求主体**：RQ-001…RQ-024 全部条款                                                  |
| `docs/requirements/2026-10-25-specgate-core-reliable-delivery-mvp.delta-v1.1.zh.md` | `v1.1-delta-frozen` | 已冻结             | **增量**：8 组共 13 条追加 AC + RQ-025…RQ-030（18 条新 AC）+ §4 状态映射 + §7 NOT_RUN |
| `docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan.zh.md`              | `v1.0-candidate`    | **已被本计划取代** | 不再执行；见 §1.4                                                                     |

## 冻结锚点

- v1.0 需求冻结候选 SHA-256：`5FA97CD08A0A3DBB1A95DB366CBB87BD521651B29E860659266C14EB0F3F26A6`
- Delta v1.1 冻结锚定 SHA-256：`9F88C906D238522B1C05B144E1C0F2E59A54B2324E4BC49890484E600227CE9B`
- 本计划创建行为：**只制定计划，不实施**。不修改源码、测试、配置、插件清单或 Skill。

---

## 1. 计划权威与边界

### 1.1 权威来源

本计划只把 v1.0 + Delta v1.1 的**合并需求基线**拆解为可执行顺序，不新增需求、不放宽需求、不改写需求语义。

发生以下任一情况时必须停止实施，并回到需求层重新审批，而不是就地修改计划：

- 需要改变目标、范围、非目标、人工门、质量门或验收标准；
- 需要新增外部数据库、Web 服务、远程通知或云运行依赖；
- 某项需求的验收标准在现有架构下不可达成；
- 现有测试需要通过放宽断言、删除用例或标记 skip 才能变绿；
- 真实金丝雀项目不可用；
- 用户工作区变化与本计划修改范围冲突。

### 1.2 计划禁止事项

- 修改已冻结的两份需求文档；
- 自动提交用户现有改动；
- 把生成计划、生成代码或生成报告当作验证通过；
- 删除历史状态、历史交付或未迁移模块；
- 在未获用户明确指示前提交或推送；
- 用快照更新掩盖审计损坏。

### 1.3 合并需求基线

本计划覆盖 **30 条 RQ**，来源如下：

| 来源            | RQ 范围                                    | 数量     | 说明                      |
| --------------- | ------------------------------------------ | -------- | ------------------------- |
| v1.0 原文       | RQ-001…RQ-024                              | 24       | 全部保留，语义不变        |
| Delta v1.1 §3.2 | RQ-025…RQ-030                              | 6        | 新增条                    |
| Delta v1.1 §3.1 | RQ-008/012/014/015/017/018/021/022 追加 AC | 13 条 AC | 追加到既有 RQ，不新增编号 |

合计：**30 条 RQ**；v1.0 原 AC 全部有效 + **13 条追加 AC**（分布于 8 个既有 RQ）+ **18 条新 AC**（RQ-025…RQ-030 各 3 条），即 31 条新增/追加 AC。

> **已登记的原稿笔误**：冻结的 Delta v1.1 §附录第 1 项写「§3.1 的 7 组追加 AC」，且列举中遗漏 `AC-018-06`。经逐条核验，正文 §3.1 实际为 **8 组 13 条**（含 AC-018-06）。正文为权威来源，附录该计数为笔误。本计划采用正确计数。因 Delta v1.1 已冻结，**不在本次修改该文件**；如需更正附录，须按 §16 变更规则形成新版本并重新审批。

### 1.4 旧计划（v1.0-candidate）的处置

旧计划从未执行，且其 M0 产物缺失：

| 旧计划要求                       | 位置                                | 实际状态                                  | 本计划处置                                      |
| -------------------------------- | ----------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| CORE-0001 基线报告               | 旧 plan:133                         | `docs/implementation/2026-10-25-*` 不存在 | 由 CORE2-0001 重新执行                          |
| CORE-0002 需求映射               | 旧 plan:163                         | 缺失                                      | 由 CORE2-0002 重新执行（扩展到 30 条 RQ）       |
| CORE-0003 金丝雀入口             | 旧 plan:178                         | 缺失                                      | 由 CORE2-0003 重新执行                          |
| 7 个 `test/codex-core-*.test.js` | 旧 plan:229/568/617/710/743/839/994 | 一个都未落地                              | 本计划改用**既有测试文件追加断言**；理由见 §1.5 |

**判定**：旧计划 `v1.0-candidate` 标记为**已取代**，不执行、不删除（保留为历史记录）。

### 1.5 测试文件策略（与旧计划的关键差异）

旧计划要求新建 7 个 `test/codex-core-*.test.js`，实际一个都没落地。本计划改为**在既有测试文件内追加断言**，原因：

1. 既有 100 个测试文件已覆盖 18/24 条 RQ（有可见断言），新建平行文件会造成同一行为的双份断言，增加维护成本而不增加覆盖率；
2. 真正缺测试的是**具体条款**，不是**文件**；
3. AGENTS.md 要求运行聚焦回归 `node --import ./test/setup-temp.mjs --test <files>`，追加到既有文件可直接复用其 fixture。

仅在既有文件确实无对应职责时才新建文件。本计划中仅 `test/codex-core-anchor.test.js` 属此类，因锚点是全新能力。

---

## 2. 总体执行策略

### 2.1 路线

```text
Route C：先冻结计划与任务边界
  ↓
Route D：按里程碑串行执行，不并发推进
  ↓
Route E：对当前失败先复现再修复
  ↓
Route F：每个里程碑验收通过后才进入下一阶段
```

不并发推进多个核心里程碑。状态机、白名单契约、测试冻结与证据绑定相互依赖，同时修改会削弱失败定位能力。

### 2.2 实施原则

1. 每个行为变化**先写失败测试**，确认失败原因正确（不是环境错误）。
2. 每次只修改完成当前任务所需的最小文件集。
3. 每个里程碑必须有独立、可复查的验收证据。
4. 修复后运行**完整质量门**，不只运行失败用例。
5. 格式化后重新执行完整质量门。
6. 当前两份冻结需求不得由实现过程静默改变。
7. 可选模块先隔离（非默认 + 不进包），证明核心稳定后再评估物理删除；**本期不删除**（遵守 D19）。
8. 所有实时检查以当前工作区和当前命令输出为准，不继承历史 PASS。

### 2.3 目标组成

计划完成后应形成：

- 一个本地可信交付闭环；
- 两个人工门：H1、H3；
- 三类委派 AI 角色：Test Designer、Implementer、Reviewer（Formatter 为确定性工具，非 AI 角色）；
- **单一**权威状态源（事件链内核），带外部单调锚点；
- 四类事实来源：Git commit、append-only 事件链、真实命令证据、可信人工审批；
- 五类逻辑产物：`spec.md`、`plan.json`、`tests/`、`evidence/`、`delivery/`；
- 公开工具面不含可选模块入口，核心发行包不含仅服务可选模块的依赖。

---

## 3. 里程碑总览

| 里程碑 | 名称                      | 目标                                                         | 覆盖 RQ                                | 退出后状态                       |
| ------ | ------------------------- | ------------------------------------------------------------ | -------------------------------------- | -------------------------------- |
| M0     | 基线取证与需求基线        | 补齐 NOT_RUN 证据，建立 30 条 RQ 映射                        | RQ-023, RQ-024                         | 实施有可信起点                   |
| M1     | 状态内核收敛              | 单一状态源、审批不阻塞、回滚一致、外部锚点、状态映射         | RQ-025, RQ-026, RQ-027, RQ-028, RQ-030 | 状态与审计不可自锁、不可静默回退 |
| M2     | 需求、计划与测试前移      | 白名单契约、依赖批准门、冻结测试不可替换                     | RQ-001…RQ-010, RQ-029                  | 可以开始实现且无法偷换测试       |
| M3     | 实现、质量与有界修复      | findings 可达、轮次上界唯一、命令可追溯                      | RQ-011, RQ-012, RQ-013, RQ-022         | 失败可定位、可修复、可重跑       |
| M4     | 格式化、Review、H3 与交付 | 格式化后真实回归、证据绑定 commit、Review 装配、客户摘要诚实 | RQ-014…RQ-018                          | 固定提交可审查、可验收           |
| M5     | 产品面与发行隔离          | 工具面/加载图/发行包可机械断言                               | RQ-019, RQ-020, RQ-021, RQ-023         | 核心可独立运行                   |
| M6     | 真实金丝雀与发布验收      | 真实项目完成完整闭环                                         | RQ-022, RQ-024                         | MVP 可发布                       |

依赖链：

```text
M0
 └─ M1
     └─ M2
         └─ M3
             └─ M4
                 └─ M5
                     └─ M6
```

约束：

- M1-M4 期间允许旧可选测试暂时保留，但**聚焦测试必须全绿**；
- M5 完成后，核心全量测试不得再依赖 MySQL 或任何外部服务；
- M6 未完成前不得宣称 MVP 已交付；
- 任一里程碑未通过退出门，不得进入下一里程碑。

---

## 4. M0：基线取证与需求基线

### 4.1 目标

补齐冻结需求 §7.2 的 NOT_RUN 证据，建立覆盖 30 条 RQ 的实现映射，确认金丝雀入口，使后续实施有可信起点。

### 4.2 覆盖需求

- RQ-023：现有仓库迁移边界；
- RQ-024：核心发行质量；
- Delta §7.2：NR-01 至 NR-08 回填。

### 4.3 前置条件

- 两份冻结需求可读取；
- 当前 Git 分支与用户工作区可检查；
- 已登记当前未跟踪文件，后续不得清理或提交。

### 4.4 任务

#### CORE2-0001 回填 NOT_RUN 命令证据

- 产物：`docs/implementation/specgate-core-mvp-v2/00-baseline-evidence.md`
- 覆盖：NR-01 至 NR-06（NR-07 需真实项目，归 M6；NR-08 视 MySQL 可用性）
- 操作：
  - 记录 `git status --short`、`git branch --show-current`、`git rev-parse HEAD`；
  - 记录 `node --version`、`npm --version`、`git --version`；
  - 逐条执行并**原样粘贴**命令名、退出码、关键输出尾部；
  - 失败与跳过项单独列出，不得合并进「通过」。
- 验证命令：

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
node --version
npm --version
git --version
npm run lint
npm run format:check
npm run codex:smoke
$env:npm_config_cache = Join-Path $env:TEMP 'specgate-npm-cache'
npm run pack:check
npm test
```

- 完成条件：
  - NR-01 至 NR-06 每条都有真实退出码，无一留空；
  - 失败项如实记录为失败，未描述为通过；
  - 未修改或提交任何用户文件。
- 失败与回滚：若 `npm test` 因外部 MySQL 失败，保留失败报告并标注受影响的测试文件，**不得**降低断言或加 skip。

#### CORE2-0002 建立 30 条 RQ 到模块与测试的映射

- 产物：`docs/implementation/specgate-core-mvp-v2/01-requirements-mapping.md`
- 操作：
  - 将 RQ-001…RQ-030 每一条映射到：现有源文件、现有测试文件、本计划里程碑、当前状态（已实现 / 部分实现 / 未实现）；
  - 对 13 条追加 AC 与 18 条新 AC 逐条标注验证方式（自动化测试 / 人工验收 / 需新建测试）；
  - 标注每条已知差距（复用 Delta §2 GAP-01…GAP-18）。
- 验证：30 条 RQ 全部出现；无重复或遗漏编号；每条至少映射一个里程碑与一个验收来源。
- 完成条件：M1-M6 可基于该矩阵逐项执行；不把「现有代码存在」标记为「需求通过」。

#### CORE2-0003 定义金丝雀项目入口条件

- 产物：`docs/implementation/specgate-core-mvp-v2/02-canary-entry.md`
- 操作：
  - 记录用户批准的现有 Git 项目绝对路径；
  - 记录项目 build / test / lint / format / runtime 命令；
  - 记录技术栈、基线 commit、干净工作区状态；
  - 明确金丝雀需求不能用于修改 SpecGate 仓库自身。
- 验证：项目是普通业务目录（非插件源码、非缓存）；`git status --porcelain` 为空；每条命令可用 argv 数组表达。
- 完成条件：若没有真实项目，M6 保持 `BLOCKED`，**测试 fixture 不能冒充真实验收**。

#### CORE2-0004 旧计划失效声明

- 产物：`docs/implementation/specgate-core-mvp-v2/03-superseded-plan.md`
- 操作：记录旧计划 `v1.0-candidate` 的状态、未执行的 M0 产物、未落地的 7 个测试文件，以及本计划取代它的理由与差异（§1.4、§1.5）。
- 完成条件：不删除旧计划文件；声明可独立阅读，不依赖本计划上下文。

### 4.5 M0 退出门

- NR-01 至 NR-06 全部有真实证据，无一 NOT_RUN；
- 30 条 RQ 映射完整，无遗漏；
- 用户未跟踪文件已登记且未被修改；
- 金丝雀入口条件已明确，或明确标记 M6 将被阻断；
- 旧计划失效声明已落盘。

### 4.6 M0 失败与回滚

- 命令因外部依赖失败：保留失败报告，不降低断言，M0 标为部分完成并列出受阻断的后续里程碑；
- 工作区不干净：停止，不自动提交，请用户处理；
- 金丝雀不可用：M1-M5 可继续，M6 不得通过。

---

## 5. M1：状态内核收敛

### 5.1 目标

消除双状态源，修复审批期间写锁独占，修复事务回滚导致的事件链自锁，建立外部单调锚点，并把对外状态契约固化到受测映射表。

### 5.2 覆盖需求

- RQ-025：单一权威状态源（AC-025-01/02/03）
- RQ-026：人工门审批期间的写入可用性（AC-026-01/02/03）
- RQ-027：事务性审计回滚的一致性（AC-027-01/02/03）
- RQ-028：事件链外部单调锚点（AC-028-01/02/03）
- RQ-030：状态机对外承诺与内部实现分离（AC-030-01/02/03）
- RQ-018：证据链和新鲜度（原 AC 全部，作为回归保护）

### 5.3 任务

#### CORE2-0101 建立状态映射表与测试

- 对应：RQ-030 / AC-030-01/02/03
- 文件：
  - `src/codex/state-machine.js`（导出对外映射常量）
  - `test/codex-state-kernel.test.js`（追加断言）
- 先写测试：
  - 遍历 `PHASES` 全部取值，断言每个都有且仅有一个对外映射；
  - 断言对外主状态集合恰为 10 个、侧状态恰为 3 个；
  - 断言 `ARCHIVED_NOT_PUSHED` → `DELIVERED`、`PUSH_FAILED`/`ROLLBACKING` → `BLOCKED`；
  - 新增一个伪造内部状态，断言未映射即测试失败。
- 实现：新增 `PUBLIC_PHASE_MAP`（冻结对象）与 `publicPhaseOf(phase)`。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-state-kernel.test.js
```

- 完成条件：新测试先失败（缺映射），实现后通过；映射覆盖 22 个内部状态，无遗漏。

#### CORE2-0102 收敛为单一权威状态源

- 对应：RQ-025 / AC-025-01/02/03；GAP-02
- 文件：
  - `src/codex/core/state.js`（移除可写路径，改为只读兼容视图）
  - `src/codex/state-machine.js`（唯一写入口）
  - `test/codex-state-kernel.test.js`（追加断言）
- 先写测试：
  - 断言 `core/state.js` 不再导出任何可写函数（写函数导出计数为 0）；
  - 尝试直写旧状态文件后读取，断言主内核检出不一致并拒绝继续（fail-closed）；
  - 断言同一 Change 只存在一份权威状态文件。
- 实现：`core/state.js` 只保留读 + 迁移映射；写操作统一走事件链内核；旧文件缺失时按事件链重建只读视图（不写回）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-state-kernel.test.js test/codex-change-tools.test.js
```

- 完成条件：存在性断言通过；无第二写路径；旧状态可只读迁移且历史事件不被重写。
- 失败与回滚：若旧状态无法只读映射，停止，保持旧实现可用，**不重写历史事件**。

#### CORE2-0103 审批期间释放写锁

- 对应：RQ-026 / AC-026-01/02/03；缺陷 K-01
- 文件：
  - `src/codex/state-machine.js`（把授权调用移出写锁临界区）
  - `src/codex/approvals.js`（超时/取消后清理）
  - `test/codex-approval-state.test.js`（追加断言）
- 先写测试：
  - 模拟审批挂起 10 秒，期间发起状态读取，断言在 1 秒内返回；
  - 期间发起写入，断言返回可区分的 `APPROVAL_IN_PROGRESS`（不是 `STORE_BUSY`）；
  - 审批超时后，断言无残留锁、状态库可正常写入。
- 实现：授权在锁外完成；锁内只做「校验版本 + 落盘」；引入审批进行中的标记位。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-approval-state.test.js test/codex-approval-authority.test.js test/codex-state-kernel.test.js
```

- 完成条件：三条断言全绿；审批失败路径仍 fail-closed。

#### CORE2-0104 修复事务审计回滚一致性

- 对应：RQ-027 / AC-027-01/02/03；缺陷 K-02
- 文件：
  - `src/codex/state-machine.js`（回滚逻辑）
  - `src/codex/events.js`（序列连续性校验容错）
  - `test/codex-state-kernel.test.js`（追加断言）
- 先写测试：
  - 注入「事件已追加、随后事务失败」，断言回滚后事件链仍可校验通过；
  - 断言不存在同一 `sequence` 的两条记录；
  - 断言快照写失败时显式暴露状态（非静默）。
- 实现：回滚必须补偿已追加事件（追加显式回滚记录并推进 sequence），而不是只做版本减法。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-state-kernel.test.js
```

- 完成条件：回滚后链可校验；无重复 sequence；快照失败可见。
- 失败与回滚：如无法在不破坏既有事件格式的前提下补偿，停止并输出设计选项，不擅自变更事件格式。

#### CORE2-0105 建立外部单调锚点

- 对应：RQ-028 / AC-028-01/02/03；缺陷 K-03
- 文件：
  - `src/codex/events.js`（锚点读写）
  - `src/codex/storage.js`（启动时校验）
  - `test/codex-core-anchor.test.js`（**新建**，本计划唯一新建测试文件）
- 先写测试：
  - 正常推进后，锚点版本单调递增；
  - 回退事件与快照到较早版本，断言读取被拒绝并输出明确失败码；
  - 锚点缺失或不可读，断言 fail-closed 并明确报告。
- 实现：锚点落在项目 Git 树之外（用户级路径），记录 `{changeId, version, headHash, updatedAt}`；读取时比对。
- 范围界定（Delta 假设 A1）：只要求检出本地回退，**不**防御可重建整链与锚点的本机攻击者。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-core-anchor.test.js test/codex-state-kernel.test.js
```

- 完成条件：回退被检出；锚点缺失 fail-closed；正常路径无回归。

### 5.4 M1 退出门

- 状态映射表覆盖全部内部状态，无未映射项；
- 全仓不存在第二条可写状态路径（存在性断言通过）；
- 审批挂起期间读取正常、写入返回可区分结果、超时无残留锁；
- 事务回滚后事件链仍可校验，无重复 sequence；
- 事件+快照同时回退被检出，锚点缺失时 fail-closed；
- RQ-018 原 AC 全部仍通过（无回归）；
- 新增测试无 skip。

### 5.5 M1 验证命令

```powershell
node --import ./test/setup-temp.mjs --test test/codex-state-kernel.test.js test/codex-approval-authority.test.js test/codex-approval-state.test.js test/codex-change-add-flow.test.js test/codex-change-tools.test.js test/codex-core-anchor.test.js test/codex-artifact-store.test.js test/codex-host-input.test.js
```

### 5.6 M1 失败与回滚

- 旧状态无法只读映射：停止，保持旧实现可用，不重写历史；
- 审批改造需引入新外部依赖：停止，回到 RQ-026 边界重新设计；
- 锚点必须落进项目 Git 树：停止，改为重新界定 RQ-028 范围并重新审批；
- 事件格式需破坏性变更：停止，输出设计选项等审批。

---

## 6. M2：需求、计划与测试前移

### 6.1 目标

补齐 plan contract 的文件白名单与依赖批准门，封堵冻结测试被整体替换的通道，回归确认澄清与批判分析链路仍满足 RQ-004/005/006。

### 6.2 覆盖需求

- RQ-001…RQ-007（原 AC 全部，回归保护）
- RQ-008（原 AC + AC-008-06 白名单契约 + AC-008-07 依赖批准门）
- RQ-009（原 AC 全部）
- RQ-010（原 AC 全部）
- RQ-029（AC-029-01/02/03 冻结测试不可替换）

### 6.3 任务

#### CORE2-0201 扩展 plan contract 文件白名单

- 对应：RQ-008 / AC-008-06；GAP-07、GAP-08
- 文件：
  - `src/codex/plan.js`（task 结构加 `allowedFiles` / `forbiddenFiles`）
  - `src/codex/development.js`（角色边界改读 plan，移除硬编码前缀）
  - `test/codex-plan-core.test.js`（追加断言）
- 先写测试：
  - 任务缺 `allowedFiles` → 冻结计划被拒，码 `PLAN_CONTRACT_INVALID`；
  - `allowedFiles` 为空数组 → 拒绝；
  - 实现 diff 超出 `allowedFiles` → 阻断并列出违规文件；
  - 命中 `forbiddenFiles` → 阻断（即使也在 `allowedFiles` 内，forbidden 优先）。
- 实现：`allowedFiles` 为 glob 列表；校验基于 `git diff --name-only` 机械比对；移除 `development.js:297-307` 的硬编码前缀。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plan-core.test.js test/codex-development-flow.test.js
```

- 完成条件：四条断言全绿；既有 frontend/backend 计划的冻结仍可用（向后兼容或明确拒绝并给出迁移说明）。
- 失败与回滚：若无法兼容既有计划格式，停止并输出迁移方案，不做静默降级。

#### CORE2-0202 实现依赖新增批准门

- 对应：RQ-008 / AC-008-07；GAP-09
- 文件：
  - `src/codex/development.js`（新增依赖清单检测）
  - `test/codex-development-flow.test.js`（追加断言）
- 先写测试：
  - diff 修改 `pom.xml` 但没有映射 AC → 阻断，输出待批准依赖清单；
  - 有映射 AC → 放行；
  - 修改 `package-lock.json` 但无 `package.json` 变更 → 同样按依赖变更处理。
- 实现：识别依赖清单文件集合，与 task 的 `acIds` 比对。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-development-flow.test.js
```

- 完成条件：三条断言全绿；不误伤非依赖清单的普通 JSON 改动。

#### CORE2-0203 封堵冻结测试整体替换

- 对应：RQ-029 / AC-029-01/02/03；GAP-12
- 文件：
  - `src/codex/plan.js`（收紧 `replaceTests` 允许状态与前置条件）
  - `src/codex/plan-tools.js`（入口参数）
  - `test/codex-plan-core.test.js`（追加断言）
- 先写测试：
  - 在 `TESTING` 阶段调用替换 → 被拒；
  - 在 `TEST_CASES_FROZEN` 阶段、红色基线未通过时替换 → 被拒；
  - 合法替换路径：必须回退到基线前检查点、重新冻结、重跑红色基线；
  - 合法替换后，断言旧 hash、原因、审批来源与新 hash 同时存在。
- 实现：替换仅允许在 `TEST_CASES_FROZEN` 且强制重建红色基线；替换需审批记录而非仅 reason 字符串。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plan-core.test.js
```

- 完成条件：四条断言全绿；无绕过路径。

#### CORE2-0204 回归确认澄清与批判链路

- 对应：RQ-004 / RQ-005 / RQ-006 / RQ-007 原 AC
- 文件：`test/codex-change-add-flow.test.js`、`test/codex-change-policy.test.js`（**只追加断言，不修改既有断言**）
- 操作：
  - 补断言：澄清最多三轮、每轮最多五问（AC-004-03）；
  - 补断言：REQ/AC 重复 ID 拒绝（AC-005-02）；
  - 补断言：任一 REQ 无反向复述时提交批判分析被拒（AC-006-01）；
  - 补断言：同一审批重复消费被拒（AC-007-03）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-change-add-flow.test.js test/codex-change-policy.test.js
```

- 完成条件：新增断言通过，且既有断言一条未改。

### 6.4 M2 退出门

- plan contract 含 `allowedFiles` 与 `forbiddenFiles`，缺任一拒绝冻结；
- diff 越界与命中 forbidden 均被阻断；
- 依赖变更无 AC 映射时阻断；
- 冻结测试无法在实现/验证阶段被整体替换；
- RQ-004/005/006/007 的补充断言全绿，既有断言一条未改；
- 新增测试无 skip。

### 6.5 M2 验证命令

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plan-core.test.js test/codex-development-flow.test.js test/codex-change-add-flow.test.js test/codex-change-policy.test.js test/codex-change-tools.test.js
```

### 6.6 M2 失败与回滚

- 白名单无法在后端/前端分角色计划中表达：停止，输出契约扩展方案等审批；
- 依赖批准门误伤范围过大：先收敛清单到明确的依赖文件集合，不放宽为「全部放行」；
- 替换通道必须保留给测试设计阶段：确认只收紧了冻结后的通道，未影响设计阶段正常提交。

---

## 7. M3：实现、质量与有界修复

### 7.1 目标

让失败 findings 真正进入 Implementer 输入，统一修复轮次上界，并让质量门命令可追溯到仓库内定义。

### 7.2 覆盖需求

- RQ-011（原 AC 全部）
- RQ-012（原 AC + AC-012-05 findings 传递 + AC-012-06 轮次上界）
- RQ-013（原 AC 全部）
- RQ-022（AC-022-04 命令来源可追溯）

### 7.3 任务

#### CORE2-0301 让 findings 进入 Implementer 输入

- 对应：RQ-012 / AC-012-05；GAP-10
- 文件：
  - `src/codex/development.js`（构建修复输入）
  - `src/codex/native-role-agent.js`（prompt 组装）
  - `test/codex-format-rework.test.js`（追加断言）
- 先写测试：
  - 质量门失败后启动修复，断言传入角色的载荷含 findings 数组且条数 > 0；
  - 断言 findings 含文件、行号（如有）、期望值、实际值、命令、退出码；
  - 断言 Review blocker 触发 rework 时，载荷含 finding ID。
- 实现：把已落库 findings 注入 challenge 与 native prompt；沿用有界摘要与脱敏。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-format-rework.test.js test/codex-development-flow.test.js
```

- 完成条件：三条断言全绿；findings 长度受控，不含敏感信息。

#### CORE2-0302 统一自动修复轮次上界

- 对应：RQ-012 / AC-012-06；GAP-11
- 文件：
  - `src/codex/checkpoints.js`（上界语义）
  - `src/codex/development.js`（移除独立内循环上界）
  - `test/codex-development-flow.test.js`（追加断言）
- 先写测试：
  - 第 1 次失败 → 允许修复；
  - 第 2 次失败 → 允许修复；
  - 第 3 次失败 → `BLOCKED`；
  - 断言全仓只存在一个轮次上界常量。
- 实现：修正 `failures <= 2` 的 off-by-one；删除 `retry < 4` 内循环或改为复用同一计数器。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-development-flow.test.js test/codex-state-kernel.test.js
```

- 完成条件：四条断言全绿；`BLOCKED` 后不再自动重试。

#### CORE2-0303 质量门命令可追溯

- 对应：RQ-022 / AC-022-04；GAP-17
- 文件：
  - `src/codex/quality.js`（命令来源标注与校验）
  - `test/codex-quality-gate.test.js`（追加断言）
- 先写测试：
  - 模型在工具参数中传入任意命令字符串 → 被拒；
  - 命令来自项目 profile 或确定性 provider → 记录命令定义来源（文件 + 标识）；
  - 断言证据中每条命令都带可追溯来源，无来源即判失败。
- 实现：命令构造只接受已注册来源；证据记录 `source: {kind, ref}`。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-quality-gate.test.js
```

- 完成条件：三条断言全绿；既有 provider 路径无需改造即可通过（语义满足）。

### 7.4 M3 退出门

- 质量门失败的 findings 真实出现在 Implementer 输入载荷中；
- 自动修复上界严格为 2 次，第 3 次失败进入 `BLOCKED`，且全仓只有一个上界常量；
- 质量门拒绝模型临时拼接的命令，每条命令带可追溯来源；
- RQ-011 / RQ-013 原 AC 全部仍通过；
- 新增测试无 skip。

### 7.5 M3 验证命令

```powershell
node --import ./test/setup-temp.mjs --test test/codex-development-flow.test.js test/codex-quality-gate.test.js test/codex-format-rework.test.js test/codex-state-kernel.test.js
```

### 7.6 M3 失败与回滚

- findings 无法进入 native prompt（结构限制）：停止，先设计摘要格式再实施；
- 轮次上界与既有 checkpoint 语义冲突：停止，输出语义对照表等审批；
- 命令来源校验导致既有 provider 全部失败：回退到「允许 provider + 记录来源」的较弱形式，但必须保留「拒绝模型拼接」的负向断言。

---

## 8. M4：格式化、Review、H3 与交付

### 8.1 目标

让格式化后回归真实发生并把证据绑定到新 commit，让 Review 执行者装配与报告来源可信，让客户摘要不再过滤已知问题。

### 8.2 覆盖需求

- RQ-014（原 AC + AC-014-05）
- RQ-015（原 AC + AC-015-06/07）
- RQ-016（原 AC 全部）
- RQ-017（原 AC + AC-017-06）
- RQ-018（原 AC + AC-018-06）

### 8.3 任务

#### CORE2-0401 格式化后强制全量回归

- 对应：RQ-014 / AC-014-05；GAP-03、GAP-04
- 文件：
  - `src/codex/format.js`（提交后触发质量门）
  - `src/codex/quality.js`（支持针对指定 commit 重跑）
  - `test/codex-format-rework.test.js`（追加断言）
- 先写测试：
  - Formatter 产生新 commit 后，断言质量门被调用且证据绑定新 commit；
  - 若未重跑，断言迁移到 `REVIEWING` 被拒；
  - 断言质量报告 commit ≠ 当前 commit 时拒绝进入 Review。
- 实现：`format.run()` 提交后调用质量门；失败则返回修复或 `BLOCKED`，不得迁移。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-format-rework.test.js test/codex-quality-gate.test.js
```

- 完成条件：三条断言全绿；格式化无实际改动时仍记录当前 commit 并确认绑定（AC-014-04）。

#### CORE2-0402 证据与 commit 严格绑定

- 对应：RQ-018 / AC-018-06；GAP-04
- 文件：
  - `src/codex/review.js`（不再复用旧 quality hash）
  - `test/codex-review-release.test.js`（追加断言）
- 先写测试：
  - 用格式化前 commit 的 quality 证据请求 Review → 拒绝；
  - 断言不存在「新 diff + 旧 quality hash」混成新指纹的路径；
  - 断言 H3 同样拒绝跨 commit 证据。
- 实现：Review 与 H3 只接受与当前固定 commit 完全一致的证据。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-review-release.test.js
```

- 完成条件：三条断言全绿；无绕过路径。

#### CORE2-0403 Review 执行者装配与报告来源可信

- 对应：RQ-015 / AC-015-06/07；GAP-05、GAP-06
- 文件：
  - `src/codex/workflow-tools.js`（装配与状态上报）
  - `src/codex/server.js`（传入 provider）
  - `src/codex/review.js`（报告来源判定与 evidence 校验）
  - `test/codex-review-release.test.js`（追加断言）
- 先写测试：
  - 未装配 provider 且未启用 native 路径 → `review.run` 返回 `REVIEW_PROVIDER_UNAVAILABLE`，状态报 `unavailable`；
  - 调用方提交 `report` 但服务端不在 native 模式 → 拒绝；
  - native 模式下报告 evidence 不得只靠「是 diff 子串」通过，需结构校验。
- 实现：装配 provider；状态与实际能力一致；报告来源标记为服务端派生。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-review-release.test.js test/codex-plugin-protocol.test.js
```

- 完成条件：三条断言全绿；`sg_state` 的 review 状态与实际可执行性一致。

#### CORE2-0404 客户摘要不得过滤已知问题

- 对应：RQ-017 / AC-017-06；GAP-13
- 文件：
  - `src/codex/release.js`（客户包 knownIssues 取自记录）
  - `test/codex-delivery-record.test.js`（追加断言）
- 先写测试：
  - DeliveryRecord 有 knownIssues → 客户摘要逐项一致；
  - 记录非空而摘要为空 → 测试失败；
  - 断言代码中不存在写死的空数组默认值。
- 实现：客户包直接引用 DeliveryRecord 的 knownIssues / openRisks / unverified 字段。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-delivery-record.test.js
```

- 完成条件：三条断言全绿；rollback 说明齐全（AC-017-05）。

### 8.4 M4 退出门

- 格式化后质量门真实重跑，证据绑定新 commit，未重跑则无法进入 Review；
- Review 与 H3 拒绝跨 commit 证据；
- Review 不可用时状态如实报 `unavailable`，调用方注入报告被拒；
- 客户摘要与 DeliveryRecord 的已知问题逐项一致；
- RQ-016 原 AC 全部仍通过；新增测试无 skip。

### 8.5 M4 验证命令

```powershell
node --import ./test/setup-temp.mjs --test test/codex-format-rework.test.js test/codex-review-release.test.js test/codex-delivery-record.test.js test/codex-delivery-v3.test.js test/codex-quality-gate.test.js test/codex-plugin-protocol.test.js
```

### 8.6 M4 失败与回滚

- 格式化后全量回归导致流程成本过高：接受该成本（NFR-P-02），不得以「流程变慢」跳过；
- provider 装配需要宿主侧能力协商：若宿主不提供，保持 fail-closed 并在状态中明确标注，不得伪造可用；
- 报告来源校验导致既有 native 流程全断：先收敛到「标记来源 + 拒绝外部注入」，保留可用路径。

---

## 9. M5：产品面与发行隔离

### 9.1 目标

让公开工具清单、静态加载图与发行包依赖三项都可被机械断言，并把可选模块隔离为非默认能力（不删除）。

### 9.2 覆盖需求

- RQ-019（原 AC 全部）
- RQ-020（原 AC 全部）
- RQ-021（原 AC + AC-021-05/06/07）
- RQ-023（原 AC 全部）

### 9.3 任务

#### CORE2-0501 公开工具清单可断言

- 对应：RQ-021 / AC-021-05；GAP-14
- 文件：
  - `src/codex/workflow-tools.js`（条件注册）
  - `test/codex-plugin-protocol.test.js`（追加完整清单断言）
- 先写测试：
  - 断言默认工具名集合与受测期望清单**完全相等**（不是子集判定）；
  - 断言清单不含 `sg_work_item_*` 等可选入口；
  - 断言显式开启可选模式后，清单按预期变化。
- 实现：`CONTROL_TOOLS` 改为条件注册（如环境变量开关）。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plugin-protocol.test.js test/codex-tools-workflow.test.js
```

- 完成条件：完整清单断言通过；可选模块默认不出现；显式开启仍可用（D19 隔离不删除）。

#### CORE2-0502 静态加载图可断言

- 对应：RQ-021 / AC-021-07；GAP-16；NFR-M-02
- 文件：
  - `src/codex/workflow-tools.js`（control 三件套改动态 import）
  - `src/codex/core/environment.js`（安装器改按需加载）
  - `test/codex-plugin-package.test.js`（追加静态 import 断言）
- 先写测试：
  - 扫描 `src/codex` 下核心模块的静态 import 图，断言不含 control / management / channels / mysql-repository；
  - 断言启动路径不加载 MySQL 模块。
- 实现：静态 import 改惰性 `await import()`，沿用仓库内既有惰性加载先例。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plugin-package.test.js test/codex-plugin-protocol.test.js
```

- 完成条件：静态图断言通过；启动仍可用；可选模式按需加载。

#### CORE2-0503 发行包依赖隔离

- 对应：RQ-021 / AC-021-06；GAP-15；NFR-M-03
- 文件：
  - `package.json`（`mysql2` 移出 `dependencies`/`bundledDependencies`）
  - `src/codex/core/control/persistence/mysql-repository.js`（动态加载）
  - `test/codex-plugin-package.test.js`（追加包依赖断言）
- 先写测试：
  - 断言 `dependencies` 与 `bundledDependencies` 不含 `mysql2`；
  - 断言 `npm pack` 清单不含仅服务可选模块的文件；
  - 断言核心测试不因缺少 `mysql2` 而失败。
- 实现：`mysql2` 改 `optionalDependencies`；MySQL 相关模块改为动态 import 并给出明确缺失提示。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plugin-package.test.js
$env:npm_config_cache = Join-Path $env:TEMP 'specgate-npm-cache'
npm run pack:check
```

- 完成条件：包依赖断言通过；核心测试不依赖 `mysql2`；MySQL 可选路径在依赖存在时仍可用。

#### CORE2-0504 拆分核心测试与可选测试

- 对应：RQ-023 / AC-023-03；RQ-024 / AC-024-01
- 文件：
  - `package.json`（测试脚本分流）
  - `.github/workflows/codex.yml`（核心流水线不含 MySQL）
- 操作：
  - 核心测试集只包含不依赖外部服务的文件；
  - MySQL 相关测试单独命令，缺配置时明确报错而非静默跳过；
  - CI 主流水线只跑核心集。
- 验证：

```powershell
npm test
```

- 完成条件：核心测试无需 MySQL；MySQL 套件独立可跑；CI 配置与实际命令一致。

### 9.4 M5 退出门

- 公开工具清单为完整比对断言，且不含可选入口；
- 静态加载图不含 control / management / channels / mysql-repository；
- 发行包依赖不含 `mysql2`，核心测试不需它；
- 可选模块仍物理存在且可显式启用（D19）；
- 核心全量测试 0 failed、0 skipped，无外部服务依赖。

### 9.5 M5 验证命令

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plugin-protocol.test.js test/codex-plugin-package.test.js test/codex-tools-workflow.test.js
npm test
npm run lint
npm run format:check
$env:npm_config_cache = Join-Path $env:TEMP 'specgate-npm-cache'
npm run pack:check
```

### 9.6 M5 失败与回滚

- 惰性加载破坏既有调用约定：保留静态 import 但加启动守卫，需重新界定 AC-021-07 并重新审批；
- `mysql2` 移出后可选路径不可用：确认是动态加载缺失提示问题，不是删除能力；
- 核心测试与可选测试无法干净切分：先按文件维度切分，暂不追求目录级重构。

---

## 10. M6：真实金丝雀与发布验收

### 10.1 目标

在一个真实业务项目上跑通完整闭环，并把 Delta §8 的 AC-MVP-11 至 AC-MVP-16 逐条验证。

### 10.2 覆盖需求

- RQ-022（AC-022-02 金丝雀栈）
- RQ-024（AC-024-01/02/03/04）
- Delta §8：AC-MVP-11 至 AC-MVP-16

### 10.3 任务

#### CORE2-0601 补齐 AC-MVP-11 至 AC-MVP-16 场景测试

- 文件（在既有测试追加断言）：
  - AC-MVP-11 → `test/codex-format-rework.test.js`
  - AC-MVP-12 → `test/codex-state-kernel.test.js`
  - AC-MVP-13 → `test/codex-approval-state.test.js`
  - AC-MVP-14 → `test/codex-core-anchor.test.js`
  - AC-MVP-15 → `test/codex-plan-core.test.js`
  - AC-MVP-16 → `test/codex-plugin-protocol.test.js` + `test/codex-plugin-package.test.js`
- 完成条件：六条场景各有至少一个断言，且能指出对应测试名。

#### CORE2-0602 失败场景回归

- 操作：逐条复现 Delta §5.1 与 v1.0 §4.3 列出的阻断场景，确认每条都真实阻断且留下证据。
- 覆盖：脏工作区、无 AC、测试全绿、改冻结测试、越界文件、未批准依赖、质量门失败、格式化后失败、Review blocker、证据 commit 不匹配、连续两次修复失败。
- 完成条件：每条有可指出的测试，无一靠人工描述。

#### CORE2-0603 真实金丝雀完整交付

- 前置：CORE2-0003 的金丝雀入口条件满足。
- 操作：
  - 在真实项目上完成 H1 → 测试设计 → 冻结 → 红色基线 → 实现 → 质量门 → 格式化 → 全量回归 → Review → H3 → DeliveryRecord；
  - 记录每阶段真实命令、退出码、commit。
- 完成条件：AC-MVP-01 与 AC-MVP-11 至 AC-MVP-16 全部在真实项目上通过；交付记录绑定唯一 commit。
- 失败与回滚：项目不可用或不干净时 M6 保持 `BLOCKED`，**fixture 不得冒充**。

#### CORE2-0604 核心提交最终验证

- 验证命令：

```powershell
npm test
npm run lint
npm run format:check
$env:npm_config_cache = Join-Path $env:TEMP 'specgate-npm-cache'
npm run pack:check
npm run codex:smoke
```

- 完成条件：全部退出码 0；核心测试 0 failed、0 skipped；打包后从非插件目录启动可完成 handshake。

#### CORE2-0605 文档与流水线一致性复核

- 操作：核对 README、quickstart、install-config、environment 文档与实际工具面、命令、包内容一致；核对 CI 与实际命令一致。
- 完成条件：文档中不存在已不存在的工具名或命令；CI 与本地命令一致。

### 10.4 M6 退出门

- AC-MVP-01 与 AC-MVP-11 至 AC-MVP-16 全部通过；
- 核心测试 0 failed、0 skipped；
- lint、format check、pack check、smoke 全部退出码 0；
- 真实金丝雀交付记录已生成并绑定唯一 commit；
- 全部未执行的真实环境检查明确记录为 NOT_RUN。

---

## 11. 需求到里程碑覆盖矩阵

| RQ         | 需求要点                | 主里程碑 | 验收来源                          | 当前实现状态   |
| ---------- | ----------------------- | -------- | --------------------------------- | -------------- |
| RQ-001     | 项目绑定与只读预检      | M2       | change-add-flow 测试              | 有证据         |
| RQ-002     | 现有项目基线            | M0       | baseline 测试 + CORE2-0001        | 有证据         |
| RQ-003     | 单活动 Change           | M1       | state-kernel 测试                 | 有证据         |
| RQ-004     | 原生需求澄清            | M2       | change-add-flow 补充断言          | 有证据         |
| RQ-005     | 需求规格与 AC           | M2       | change-policy 补充断言            | 有证据         |
| RQ-006     | 反向复述与批判分析      | M2       | change-add-flow 补充断言          | 有证据         |
| RQ-007     | H1 可信需求批准         | M1       | approval-authority 测试           | 有证据         |
| RQ-008     | 计划与文件白名单        | M2       | **AC-008-06/07 新增**             | **契约缺失**   |
| RQ-009     | 独立测试设计与冻结      | M2       | plan-core 测试                    | 有证据         |
| RQ-010     | 红色基线                | M2       | development-flow 测试             | 有证据         |
| RQ-011     | 隔离实现与提交证据      | M3       | development-flow 测试             | 有证据         |
| RQ-012     | 有界修复与失败上下文    | M3       | **AC-012-05/06 新增**             | **实现缺失**   |
| RQ-013     | 确定性质量门            | M3       | quality-gate 测试                 | 有证据         |
| RQ-014     | 格式化后全量回归        | M4       | **AC-014-05 新增**                | **实现缺失**   |
| RQ-015     | 固定提交独立 Review     | M4       | **AC-015-06/07 新增**             | **装配缺口**   |
| RQ-016     | H3 人工交付验收         | M4       | review-release 测试               | 有证据         |
| RQ-017     | DeliveryRecord 与交付包 | M4       | **AC-017-06 新增**                | **实现缺失**   |
| RQ-018     | 证据链和新鲜度          | M1+M4    | **AC-018-06 新增** + state-kernel | 部分           |
| RQ-019     | 状态查询/暂停/恢复/取消 | M5       | state-kernel + tools-workflow     | 部分           |
| RQ-020     | 本地安全边界            | M5       | artifact-store + host-input       | 有证据         |
| RQ-021     | 最小产品面与默认启动    | M5       | **AC-021-05/06/07 新增**          | **默认面越界** |
| RQ-022     | 技术栈与验收范围        | M3+M6    | **AC-022-04 新增** + 金丝雀       | 部分           |
| RQ-023     | 现有仓库迁移边界        | M0+M5    | CORE2-0004 + 测试分流             | 部分           |
| RQ-024     | 核心发行质量            | M0+M6    | CORE2-0001 + CORE2-0604           | 有证据         |
| **RQ-025** | 单一权威状态源          | M1       | **新** state-kernel 存在性断言    | **未实现**     |
| **RQ-026** | 审批期间写入可用性      | M1       | **新** approval-state 断言        | **缺陷 K-01**  |
| **RQ-027** | 事务回滚一致性          | M1       | **新** state-kernel 断言          | **缺陷 K-02**  |
| **RQ-028** | 事件链外部单调锚点      | M1       | **新** codex-core-anchor 测试     | **缺陷 K-03**  |
| **RQ-029** | 冻结测试不可替换        | M2       | **新** plan-core 断言             | **可实现绕过** |
| **RQ-030** | 状态对外/内部分离       | M1       | **新** state-kernel 映射断言      | **词表不一致** |

---

## 12. 变更影响控制

### 12.1 允许修改的文件分组

| 文件组                                                                                    | 里程碑 | 变更性质                       |
| ----------------------------------------------------------------------------------------- | ------ | ------------------------------ |
| `src/codex/state-machine.js`、`storage.js`、`events.js`、`approvals.js`、`checkpoints.js` | M1     | 内核收敛                       |
| `src/codex/core/state.js`                                                                 | M1     | 移除可写路径（只读兼容）       |
| `src/codex/plan.js`、`plan-tools.js`                                                      | M2     | 契约扩展                       |
| `src/codex/development.js`                                                                | M2-M3  | 白名单、依赖门、findings、轮次 |
| `src/codex/quality.js`                                                                    | M3-M4  | 命令来源、指定 commit 重跑     |
| `src/codex/format.js`                                                                     | M4     | 提交后触发质量门               |
| `src/codex/review.js`                                                                     | M4     | 证据绑定、报告来源             |
| `src/codex/release.js`                                                                    | M4     | 客户摘要诚实                   |
| `src/codex/workflow-tools.js`、`server.js`                                                | M4-M5  | 装配与条件注册                 |
| `src/codex/native-role-agent.js`                                                          | M3     | findings 注入                  |
| `src/codex/core/environment.js`                                                           | M5     | 按需加载                       |
| `src/codex/core/control/persistence/mysql-repository.js`                                  | M5     | 动态加载                       |
| `package.json`、`.github/workflows/codex.yml`                                             | M5     | 依赖与流水线                   |
| `test/*.test.js`                                                                          | M1-M6  | 追加断言（不改既有断言）       |
| `test/codex-core-anchor.test.js`                                                          | M1     | **新建**（唯一新建测试文件）   |
| `docs/implementation/specgate-core-mvp-v2/*.md`                                           | M0     | 基线产物                       |

### 12.2 默认不修改

- 用户现有未跟踪文件；
- 两份已冻结需求文档正文；
- 旧计划 `v1.0-candidate`（保留为历史）；
- 历史验证 JSON 与历史交付记录；
- `src/codex/control/`、`core/control/`、`management/`、`channels/` 的内部实现（仅改注册与加载方式）；
- `assets/java-vue/template*`（模板生成不在 MVP 核心）；
- 用户业务项目的生产代码，除非属于 M6 金丝雀需求。

### 12.3 不可静默改变的约束

- 两份冻结需求的任何条款；
- Delta §4 状态映射表（新增内部状态必须同步更新映射与其测试）；
- Delta §7.2 NOT_RUN 清单（只能被真实证据回填，不能被删除）。

---

## 13. 风险登记

| 风险                                         | 影响                 | 控制方式                                         |
| -------------------------------------------- | -------------------- | ------------------------------------------------ |
| 移除可写路径导致旧数据无法读取               | 既有 Change 无法继续 | 只读映射 + 不重写历史；CORE2-0102 设专项回滚条件 |
| 审批移出写锁后出现竞态                       | 状态双写             | 锁内仍做版本比对；CORE2-0103 必须有并发断言      |
| 回滚补偿改变事件格式                         | 历史链不兼容         | 先输出设计选项再实施；禁止静默改格式             |
| 白名单契约与既有 frontend/backend 计划不兼容 | 既有计划冻结失败     | 提供迁移说明；不静默降级为无白名单               |
| findings 注入使 prompt 过长                  | Agent 输入失败       | 有界摘要 + hash 引用                             |
| 格式化后全量回归成本高                       | 流程变慢             | 明确接受（NFR-P-02），只在固定提交跑一次         |
| 惰性加载破坏调用约定                         | 核心启动失败         | 保留启动守卫作为回退方案，需重新审批 AC-021-07   |
| `mysql2` 移出后可选路径不可用                | 控制面功能退化       | 动态加载 + 明确缺失提示；不删除代码              |
| 核心/可选测试切分不彻底                      | CI 仍需 MySQL        | 按文件维度切分优先，不追求目录重构               |
| 真实金丝雀不可用                             | 无法证明可交付       | M6 保持 BLOCKED，禁止 fixture 冒充               |
| 当前工作区不干净                             | 与实施改动冲突       | M0 登记，冲突时停止并请用户处理                  |

---

## 14. 停止条件

出现以下情况必须停止当前里程碑，不擅自绕过：

- 需要修改两份冻结需求；
- 必须新增外部数据库、Web 服务或远程通知作为核心依赖；
- 核心测试必须 skip 才能通过；
- 文件白名单只能依赖模型自述；
- findings 无法进入 Implementer；
- 格式化后无法重新执行全量质量门；
- Reviewer 身份或来源无法与报告绑定；
- DeliveryRecord 出现不可解释的覆盖；
- 真实金丝雀无法提供干净工作区或可执行命令；
- 现有用户改动与任务修改范围重叠；
- 事件格式需要破坏性变更。

停止后保留所有 commit、worktree、日志与证据，不自动清理，不自动回滚用户文件。

---

## 15. 最终交付物

全部里程碑完成后应提供：

```text
核心插件源码（单一状态源 + 白名单契约 + 真实格式化回归 + 可信 Review）
核心测试（含 RQ-025…RQ-030 的负向断言）
默认 MCP / Skill 入口（可选模块非默认）
两份冻结需求（v1.0 + Delta v1.1）
本执行计划 v2.0
requirements-mapping 报告（30 条 RQ）
baseline evidence 报告（NR-01…NR-08 回填结果）
真实金丝雀验证报告
最终 DeliveryRecord
最终核心测试 / lint / format / pack / smoke 证据
```

最终报告必须明确区分：

- 核心 MVP 已验证；
- 可选模块保留但未默认启用；
- 真实外部环境已验证；
- 真实外部环境未执行（NOT_RUN）；
- 已知风险；
- 回滚方式。

---

## 16. 里程碑与任务总表

| 里程碑 | 任务                          | 覆盖条款           | 关键验证          |
| ------ | ----------------------------- | ------------------ | ----------------- |
| M0     | CORE2-0001 回填 NOT_RUN       | NR-01…NR-06        | 真实退出码        |
| M0     | CORE2-0002 建立 30 条 RQ 映射 | RQ-001…RQ-030      | 无遗漏编号        |
| M0     | CORE2-0003 金丝雀入口         | RQ-022 / M6 前置   | 干净工作区        |
| M0     | CORE2-0004 旧计划失效声明     | RQ-023             | 声明可独立阅读    |
| M1     | CORE2-0101 状态映射表         | RQ-030             | 22 状态全覆盖     |
| M1     | CORE2-0102 单一状态源         | RQ-025             | 存在性断言        |
| M1     | CORE2-0103 审批释放写锁       | RQ-026             | 并发断言          |
| M1     | CORE2-0104 回滚一致性         | RQ-027             | 链仍可校验        |
| M1     | CORE2-0105 外部锚点           | RQ-028             | 回退被检出        |
| M2     | CORE2-0201 白名单契约         | RQ-008 AC-06       | 缺失即拒          |
| M2     | CORE2-0202 依赖批准门         | RQ-008 AC-07       | 无 AC 即阻断      |
| M2     | CORE2-0203 封堵测试替换       | RQ-029             | 无法绕过          |
| M2     | CORE2-0204 澄清链路回归       | RQ-004/005/006/007 | 追加断言          |
| M3     | CORE2-0301 findings 可达      | RQ-012 AC-05       | 载荷含 findings   |
| M3     | CORE2-0302 轮次上界唯一       | RQ-012 AC-06       | 第 3 次即 BLOCKED |
| M3     | CORE2-0303 命令可追溯         | RQ-022 AC-04       | 拒绝模型拼接      |
| M4     | CORE2-0401 格式化后回归       | RQ-014 AC-05       | 证据绑新 commit   |
| M4     | CORE2-0402 证据绑定 commit    | RQ-018 AC-06       | 跨 commit 即拒    |
| M4     | CORE2-0403 Review 装配        | RQ-015 AC-06/07    | 状态如实          |
| M4     | CORE2-0404 客户摘要诚实       | RQ-017 AC-06       | 逐项一致          |
| M5     | CORE2-0501 工具清单断言       | RQ-021 AC-05       | 完整清单比对      |
| M5     | CORE2-0502 加载图断言         | RQ-021 AC-07       | 无静态依赖        |
| M5     | CORE2-0503 发行包依赖隔离     | RQ-021 AC-06       | 无 mysql2         |
| M5     | CORE2-0504 测试分流           | RQ-023 AC-03       | 核心无需 MySQL    |
| M6     | CORE2-0601 AC-MVP-11…16       | Delta §8           | 六条各有断言      |
| M6     | CORE2-0602 失败场景回归       | v1.0 §4.3          | 每条可指测试      |
| M6     | CORE2-0603 真实金丝雀         | AC-MVP-01          | 真实项目          |
| M6     | CORE2-0604 核心最终验证       | RQ-024             | 全 0 退出码       |
| M6     | CORE2-0605 文档一致性         | RQ-024             | 无失效命令        |

合计：**7 个里程碑、29 个任务**。

---

## 17. 计划确认

### 17.1 批准记录

- 计划状态：**已批准**（`v2.0-approved`），2026-10-25。
- 审批方式：用户在本次任务中直接指示「我改为 v2.0-approved」，属对全部 7 个里程碑与 29 个任务的整体批准。
- 审批时间：2026-10-25 14:21（Asia/Shanghai，UTC+8）；记录时机器时钟 UTC 2026-10-25T06:21:55Z。
- 批准前候选版本：`v2.0-candidate`。
- **批准锚定 SHA-256（批准前正文，规范化 LF）**：`428F96052A06C9F940CF1E022B4267E0E3C347F11A33C2ECD40F2B46CB84640D`
  - 该哈希覆盖「批准记录写入之前」的完整正文 50,639 字节；原文无 CRLF，规范化前后哈希相同。
  - 批准后的文件因追加本节记录而哈希变化，属预期；**上述哈希是本次批准的准确锚点**，复核方式为移除本节记录后重算。
- **格式重排记录（D-01B，2026-10-25 追加）**
  - 触发原因：`npm run format:check` 对本计划报 Markdown 表格对齐问题。
  - 授权来源：用户在 M0 验收时裁定 **D-01 = B**。
  - 变更性质：**仅表格列宽空白填充与分隔行横线长度**。规范化比对（折叠连续空白 + 折叠连续横线）证明重排前后文本逐字节一致（规范化后均为 30,971 字符）。
  - **计划语义：无任何变化。** 里程碑、任务、条款、文件边界、完成条件均未改动。
  - 重排前文件 LF SHA-256：`26188B3B4968143228EF89B62189F1B55604E5A5F29E98AF9CB7B22AEAFFA8B7`
  - **重排后文件 LF SHA-256（当前有效锚点）**：`CDEA24F4A5BC98770399D3B7AA9FA9C334BFD37634ADE578A33CF0836487B6B8`
  - 原批准锚点 `428F9605…640D` **仍然有效**：它锚定批准时刻的正文语义，本次重排不改变该语义。
- 批准的冻结前置：本计划依据的两份需求均已冻结 —— v1.0 `5F7F9067F960C17AE7C41BD23DDCAA0F4A2B06EF6A5BEB6930910849254E4531`；Delta v1.1 `9F88C906D238522B1C05B144E1C0F2E59A54B2324E4BC49890484E600227CE9B`。
- 批准范围：§1 计划权威与边界、§2 执行策略、§3 里程碑总览、§4–§10 七个里程碑全部任务、§11 覆盖矩阵、§12 变更影响控制、§13 风险、§14 停止条件、§15 交付物、§16 任务总表。

### 17.2 批准即时效力

1. 状态已改为 `v2.0-approved`；允许从 **M0** 开始执行。
2. 每一里程碑完成并通过退出门前，不得进入下一里程碑。
3. **本批准不自动获得提交、推送或发布授权**（§1.2）。任何 git commit / push / npm publish 仍需用户逐次明确指示。
4. **计划批准不等于需求已验证**：Delta §7.2 的 NR-01 至 NR-08 仍为 `NOT_RUN`，须由真实命令回填。
5. 本批准不授权修改两份已冻结需求文档正文。

### 17.3 变更控制

本计划批准后，以下变更必须形成 `v2.1` 并重新审批，不得就地修改：

- 新增、删除或重排里程碑；
- 改变任一任务的覆盖条款、文件边界或完成条件；
- 调整 §11 覆盖矩阵中任一 RQ 的主里程碑归属；
- 放宽 §14 停止条件或 §12.3 不可静默改变的约束。

允许不重新审批的改动（仅限文字层）：

- 修正错别字、标点与排版；
- 补充指向既有条款的交叉引用；
- 在既有任务下追加**更严格**的断言，且不减少任何既有断言。

上述文字层改动必须在提交说明中标注「非语义变更」。

## 18. 实际执行记录（批准正文之外的验收附录）

本节仅追加命令验证后的执行事实，不改变批准的范围、任务或退出门。

| 阶段  | 状态                                                                          | 证据                                                           |
| ----- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| M1    | 已验收：聚焦 102、全量 704，0 fail/skip/cancel，lint/format/pack/smoke 退出 0 | `docs/implementation/specgate-core-mvp-v2/05-m1-acceptance.md` |
| M2    | 已验收：聚焦 75、全量 708，0 fail/skip/cancel，lint/format/pack/smoke 退出 0  | `docs/implementation/specgate-core-mvp-v2/06-m2-acceptance.md` |
| M3    | 已验收：聚焦 41、全量 711，0 fail/skip/cancel，lint/format/pack/smoke 退出 0  | `docs/implementation/specgate-core-mvp-v2/07-m3-acceptance.md` |
| M4    | 已验收：聚焦 57、全量 719，0 fail/skip/cancel，lint/format/pack 退出 0        | `docs/implementation/specgate-core-mvp-v2/08-m4-acceptance.md` |
| M5 | 已验收：聚焦 49、全量 723，0 fail/skip/cancel；lint/format/pack/smoke 退出 0 | `docs/implementation/specgate-core-mvp-v2/09-m5-acceptance.md` |
| M6 | 尚未验收；真实 GitHub 金丝雀基线核验进行中 | 不得以仓库 fixture 替代真实闭环 |
