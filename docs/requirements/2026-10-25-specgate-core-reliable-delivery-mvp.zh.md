# SpecGate Core 最小可靠交付 MVP 需求

- 文档状态：**已批准 / 已冻结**（2026-10-25，用户明确审批）
- 日期：2026-10-25
- 版本：1.0-frozen
- 适用宿主：Codex
- 适用仓库：SpecGate Codex 插件
- 产品定位：**单机、单项目、本地可信执行的可靠交付内核**
- 需求来源：
  - `E:\ai_workflow\demo_java\docs\AI协同工作流-Codex可靠交付实施文稿.md`
  - 当前 SpecGate 仓库实现审计结论
- 冻结规则：本文档已经用户明确确认并冻结；实施必须严格遵守本版本。

---

## 冻结记录

- 审批方式：用户在当前任务中明确回复“确认并冻结这份需求文稿 但不实施”。
- 审批时间：2026-10-25（Asia/Shanghai）。
- 审批前候选版本：`1.0-candidate`。
- 审批前文档规范化 LF 后 SHA-256：`5FA97CD08A0A3DBB1A95DB366CBB87BD521651B29E860659266C14EB0F3F26A6`。
- 冻结范围：本需求正文、范围、非目标、人工门、质量门、验收标准、证据模型和实施边界。
- 实施指令：本次审批仅冻结需求文稿，不授权修改源码、测试、Skill、插件清单、配置或创建实现分支。
- 变更规则：任何目标、范围、非目标、人工门、质量门、验收标准或证据边界变化，都必须形成新版本并重新审批；不得静默覆盖本冻结稿。

---

## 0. 决策摘要

本版本采用以下已收敛的产品决策：

| 编号 | 决策                                                                                        |
| ---- | ------------------------------------------------------------------------------------------- |
| D01  | 第一版只做本地 Codex 会话内的可靠交付闭环，不做远程交付平台                                 |
| D02  | 一个 MCP 会话只绑定一个业务项目                                                             |
| D03  | 同一个项目同时只允许一个活动 Change                                                         |
| D04  | 第一版只接入已有 Git 项目；新建项目与管理后台模板生成移出核心产品                           |
| D05  | 状态、审批和审计使用本地文件、Git 与 append-only 事件链，不使用 MySQL                       |
| D06  | 第一版只保留 H1 需求批准和 H3 交付批准两个人工门                                            |
| D07  | 委派 AI 角色收敛为 Test Designer、Implementer、Reviewer；主 Codex 负责需求分析和编排        |
| D08  | 测试设计和测试冻结必须先于实现                                                              |
| D09  | 实现前必须运行红色基线，并观察到每个冻结用例真实失败                                        |
| D10  | 每个实现任务必须具备文件白名单；冻结测试和验收测试不可修改                                  |
| D11  | 每个 AC 至少映射一个可执行测试或人工验收证据                                                |
| D12  | Formatter 是确定性工具，不再作为独立 AI 角色                                                |
| D13  | 格式化完成后必须再次执行完整质量门，之后才能进入 Review                                     |
| D14  | Reviewer 必须针对固定提交只读审查，并留下可验证的执行身份与提交绑定                         |
| D15  | 交付记录必须绑定唯一提交、需求版本、测试证据、Review、风险和 H3 批准                        |
| D16  | 第一版不做异步 WorkItem、远程 Decision、Web 管理台、飞书、TOTP、多 Worker、多项目或生产部署 |
| D17  | 第一版不自动下载或安装 JDK、Maven、Node、Git；只检测、复用、阻断和报告缺项                  |
| D18  | 第一版只有一个验收金丝雀技术栈，其他技术栈组合不作为 MVP 发布门槛                           |
| D19  | 当前仓库已有控制面、模板和环境安装代码先隔离为非默认能力，不直接删除历史实现                |

---

## 1. 背景与问题

AI 编码的主要风险不是“不能生成代码”，而是：

- 需求没有冻结，模型按自己的理解实现；
- 验收标准不可执行，最后只依赖模型口头声明；
- 实现者修改测试、放宽断言或越出任务范围；
- 测试失败后没有明确失败证据，修复变成盲目重写；
- 格式化后没有重新测试，交付证据与实际提交不一致；
- 独立评审只存在于提示词中，没有可验证的 Reviewer 身份；
- 为了远程、异步和多人协作提前建设平台，反而削弱最小交付闭环。

当前 SpecGate 已实现需求批准、测试前移、worktree、质量门、Review、H3 和
DeliveryRecord，但同时包含大量控制面、数据库、Web、通知、多 Worker、模板生成和
环境安装能力。对当前目标而言，这些外围能力扩大了状态组合、依赖和失败面。

本需求定义一个可以优先稳定运行的最小版本：保留可靠交付的必要约束，移除不影响
单机完整闭环的产品化能力。

---

## 2. 产品目标

### 2.1 总目标

让用户在本地 Codex 中，把一个已有 Git 项目的业务需求从澄清推进到可复核交付，
并保证：

1. 人批准的需求是唯一业务依据；
2. 每条需求都有验收标准；
3. 每条 AC 都有测试或明确的人工验收方式；
4. 实现者不能修改冻结测试或超出任务范围；
5. 所有通过结论都来自真实命令和真实退出码；
6. 修复和格式化后执行全量回归；
7. 独立 Reviewer 对唯一提交完成只读审查；
8. 人完成最终验收后生成可复核交付记录；
9. 上述事实可在没有数据库、Web 服务和外部通知的情况下复核。

### 2.2 成功后的用户结果

用户只需要进入一个已有项目并描述需求，即可按以下方式完成交付：

```text
确认需求
→ 确认测试能够失败
→ 等待或处理失败修复
→ 查看固定提交的评审和证据
→ 最终验收
→ 获得包含提交、测试、风险与回滚说明的交付记录
```

用户不需要启动控制面、配置数据库、登录 Web 管理台或连接飞书。

---

## 3. 非目标

以下内容明确不属于 MVP：

- 异步 WorkItem、Supervisor、Session 自动恢复；
- Web 管理台、SSE、远程管理 API；
- 飞书、钉钉或其他远程通知；
- 账号密码、TOTP、设备绑定、step-up；
- MySQL、Redis、消息队列；
- 多 Worker、租约、fencing、跨主机调度；
- 多项目组合视图；
- 云端执行、远程 Worker、网络分区恢复；
- 新项目脚手架、完整 Java/Vue/React 管理后台模板；
- 自动下载和安装 JDK、Maven、Node、Git；
- JDK 8/17/21 与 Vue/React 全矩阵发布验证；
- 增量再交付、父交付 AC 证据复用；
- 自动部署、生产数据库迁移和自动回滚；
- 多模型路由、组织权限和多租户 SaaS；
- 业务质量 KPI 看板。

上述能力可以保留在非默认模块或后续版本中，但不得阻塞 MVP 安装、启动和验收。

---

## 4. 目标用户与核心场景

### 4.1 目标用户

- 一人开发者；
- 小型交付团队；
- 希望把 AI 编码限制在可审计流程中的技术负责人；
- 已经拥有 Git 仓库和本地开发环境，不需要插件代建工程的人。

### 4.2 主场景

用户在一个干净的现有 Git 项目中提出新增、修改或修复需求。Codex 通过原生问答完成
澄清，用户批准需求，随后 Codex 生成计划和测试、串行实现、执行质量门、修复、格式化、
回归和独立评审，最后由用户完成 H3 验收并生成本地交付记录。

### 4.3 典型失败场景

- 工具链缺失：在工作流开始前阻断；
- Git 工作区不干净：不创建 Change；
- 需求存在阻塞歧义：禁止请求 H1 批准；
- 测试没有先失败：禁止开始实现；
- 修改冻结测试：阻断并保留证据；
- 修改任务白名单外文件：阻断；
- 测试失败：给出具体 findings，最多自动修复两轮；
- 格式化后回归失败：禁止进入 Review；
- Review 有 blocker：退回实现；
- Reviewer 修改工作区：拒绝评审结果；
- H3 未批准：禁止归档和生成最终交付。

---

## 5. MVP 工作流与状态机

### 5.1 用户流程

```text
项目绑定
  ↓
只读预检与环境门禁
  ↓
需求录入
  ↓
澄清、REQ/AC 提案、反向复述和批判分析
  ↓
H1 人工批准
  ↓
计划与文件白名单冻结
  ↓
Test Designer 生成测试
  ↓
测试冻结
  ↓
红色基线
  ↓
Implementer 实现
  ↓
质量门
  ├─ 失败 → 修复，最多 2 次 → 全量回归
  └─ 通过
       ↓
确定性格式化
       ↓
全量回归
       ↓
Reviewer 只读审查固定提交
  ├─ blocker → 退回实现并重新全量回归
  └─ 通过
       ↓
H3 人工验收
       ↓
DeliveryRecord 与交付包
```

### 5.2 Change 状态

MVP 主状态固定为：

| 状态             | 含义                                   |
| ---------------- | -------------------------------------- |
| `CLARIFYING`     | 需求澄清、提案和批判分析               |
| `H1_PENDING`     | 等待 H1 人工批准                       |
| `PLANNED`        | 需求已冻结，任务、文件和验收映射已形成 |
| `TEST_DESIGNING` | Test Designer 正在设计测试             |
| `TESTS_FROZEN`   | 测试已冻结，尚未开始实现               |
| `IMPLEMENTING`   | Implementer 正在实现或修复             |
| `VERIFYING`      | 正在执行质量门、格式化或全量回归       |
| `REVIEWING`      | Reviewer 正在评审固定提交              |
| `H3_PENDING`     | 等待 H3 人工验收                       |
| `DELIVERED`      | 已生成交付记录                         |

侧状态固定为：

- `BLOCKED`
- `PAUSED`
- `CANCELLED`

不合法状态迁移必须拒绝；不兼容版本不得自动修复或覆盖。

---

## 6. 角色边界

### 6.1 主 Codex

主 Codex 可以：

- 读取项目、需求、状态和证据；
- 发起澄清与提议；
- 生成需求和批判分析；
- 生成计划与任务映射；
- 编排工具和子角色；
- 向用户解释结果。

主 Codex 不可以：

- 代替用户批准 H1/H3；
- 修改已冻结需求；
- 修改冻结测试；
- 宣称未执行命令通过；
- 跳过质量门直接归档。

### 6.2 Test Designer

- 使用独立会话；
- 只能创建测试、fixture 和测试运行器；
- 不得修改生产代码或状态文件；
- 必须将每条 AC 映射到至少一个 case；
- 必须提交真实 Git commit。

### 6.3 Implementer

- 使用与测试设计隔离的 Git worktree；
- 不得修改冻结测试；
- 只能修改任务白名单允许的文件；
- 必须提交真实 Git commit；
- 接收到失败修复或 Review rework 时，必须获得具体 finding。

### 6.4 Reviewer

- 使用独立评审会话；
- 只读，不得修改任何 tracked 文件；
- 必须绑定固定 commit、质量报告 hash 和文件差异；
- 每条 finding 必须有文件、行号、AC 和证据；
- Reviewer 执行身份和输入摘要必须进入证据。

### 6.5 Formatter

Formatter 不是 AI 角色，只运行项目定义的确定性格式化命令，并产生独立提交。

---

## 7. 功能需求与验收标准

### RQ-001 项目绑定与只读预检

系统必须在创建 Change 前确认当前 MCP 会话绑定到唯一的普通业务目录，并完成只读
预检。

验收标准：

- AC-001-01：Given 会话未绑定项目，When 用户启动 Change，Then 系统拒绝并返回绑定入口，不写入状态。
- AC-001-02：Given 项目根目录、技术栈、Git 仓库或必需工具无效，When 执行预检，Then 系统明确列出阻断项且不创建 Change。
- AC-001-03：Given Git 存在已跟踪修改或未跟踪文件，When 执行预检，Then 系统要求先清理工作区，不自动提交用户文件。

### RQ-002 现有项目基线

系统必须为已有项目记录真实项目配置和基线，不以“代码已生成”或“命令已配置”
代替基线。

验收标准：

- AC-002-01：Given 项目配置有效，When 执行基线验证，Then 每条命令记录命令、开始时间、结束时间、退出码和证据路径。
- AC-002-02：Given 基线命令失败，When 创建基线，Then 失败以已知失败或阻断状态保留，不得标记为绿色。
- AC-002-03：Given 项目基线未建立，When 请求创建 Change，Then 系统拒绝。

### RQ-003 单活动 Change

同一项目同时只能存在一个未结束的 Change。

验收标准：

- AC-003-01：Given 已存在活动 Change，When 创建第二个 Change，Then 返回 `ACTIVE_CHANGE`，不排队、不覆盖。
- AC-003-02：Given Change 已完成或取消，When 创建新 Change，Then 允许创建且使用新的唯一 ID。

### RQ-004 原生需求澄清

需求澄清必须来自可信原生用户输入，工具参数、模型推断和普通聊天文本不得伪造
用户答案。

验收标准：

- AC-004-01：Given 宿主支持 elicitation，When 发起澄清，Then 用户回答、问题和来源被持久化。
- AC-004-02：Given 原生输入不可用，When 请求澄清，Then 状态保持 `WAITING_FOR_USER`，不得继续提案或批准。
- AC-004-03：Given 澄清最多三轮、每轮最多五个问题，When 超出限制，Then 拒绝新增问题。

### RQ-005 需求规格与 AC

系统必须形成唯一、可版本化的需求规格，并为每条需求定义至少一个可观察 AC。

验收标准：

- AC-005-01：Given 需求没有 AC，When 提交提案，Then 拒绝。
- AC-005-02：Given REQ 或 AC ID 重复，When 提交提案，Then 拒绝。
- AC-005-03：Given AC 只有“功能可用”等不可观察描述，When 审核提案，Then 必须要求补充可验证结果或验证方式。
- AC-005-04：Given 新提案产生，When 保存，Then 旧提案和旧批准候选不可被静默覆盖。

需求规格至少包含：

- 目标；
- 包含范围；
- 非目标；
- REQ 列表；
- 每个 REQ 下的 AC；
- 关键失败与边界；
- 风险、假设和未决项。

### RQ-006 反向复述与批判分析

在 H1 前，模型必须覆盖所有需求进行反向复述，并检查歧义、矛盾、不可行性、安全、
性能、并发和测试盲区。

验收标准：

- AC-006-01：Given 任一 REQ 没有反向复述，When 提交批判分析，Then 拒绝。
- AC-006-02：Given 存在 blocking 未决项或 blocking finding，When 请求 H1，Then 拒绝。
- AC-006-03：Given 用户修改需求，When 再次请求 H1，Then 必须重新提案和批判分析。

### RQ-007 H1 可信需求批准

只有可信原生用户响应可以批准冻结需求。

验收标准：

- AC-007-01：Given 用户批准，When 冻结，Then 审批绑定需求 artifact hash、Change ID、用户来源和过期时间。
- AC-007-02：Given 审批前需求正文变化，When 消费审批，Then 返回 artifact changed 并拒绝冻结。
- AC-007-03：Given 同一审批被重复消费，When 再次提交，Then 拒绝。
- AC-007-04：Given 模型在工具参数中提交 approval、answer、actor 或 receipt，When 调用 H1，Then 拒绝。

### RQ-008 计划、文件白名单和依赖边界

H1 后，系统必须生成机器可读计划。每个任务必须绑定 REQ、AC、依赖和允许修改的文件。

验收标准：

- AC-008-01：Given 任一 AC 没有任务映射，When 冻结计划，Then 拒绝。
- AC-008-02：Given 任务没有 `allowedFiles`，When 冻结计划，Then 拒绝。
- AC-008-03：Given 实现 diff 超出任务白名单，When 校验提交，Then 阻断并保留违规文件列表。
- AC-008-04：Given 新增依赖但没有批准，When 校验提交，Then 阻断并请求明确批准。
- AC-008-05：Given API 或数据模型发生变化但没有关联 AC，When 冻结计划，Then 拒绝。

计划至少包含：

```json
{
  "changeId": "example",
  "requirementsHash": "sha256:...",
  "tasks": [
    {
      "id": "TASK-001",
      "requirementIds": ["REQ-001"],
      "acIds": ["AC-001-01"],
      "dependencies": [],
      "allowedFiles": ["src/example/**"],
      "forbiddenFiles": ["tests/**", "acceptance/**"],
      "verification": ["test-command-id"]
    }
  ]
}
```

### RQ-009 独立测试设计与测试冻结

Test Designer 必须在实现开始前生成真实可执行测试，并冻结内容和 hash。

验收标准：

- AC-009-01：Given 测试没有覆盖全部 AC，When 冻结测试，Then 拒绝。
- AC-009-02：Given Test Designer 没有真实提交，When 尝试完成，Then 拒绝。
- AC-009-03：Given Test Designer 修改生产代码，When 校验，Then 拒绝并保留 commit。
- AC-009-04：Given 测试已冻结，When Implementer 修改测试文件，Then 阻断。

### RQ-010 红色基线

实现开始前必须真实执行冻结测试，并观察到每个 case 失败。

验收标准：

- AC-010-01：Given 测试命令退出码为 0，When 开始实现，Then 拒绝。
- AC-010-02：Given 任一冻结 case 未失败、被跳过或未执行，When 开始实现，Then 拒绝。
- AC-010-03：Given 测试进程超时、崩溃或没有报告，When 开始实现，Then 拒绝。
- AC-010-04：Given 红色基线证据生成，When 保存，Then 证据绑定测试 hash、命令、退出码和每个 case 状态。

### RQ-011 隔离实现与提交证据

实现必须在独立 worktree 中进行，任一时刻只允许一个实现写入者。

验收标准：

- AC-011-01：Given 主工作区不干净，When 创建实现 worktree，Then 拒绝。
- AC-011-02：Given Implementer 没有新 commit，When 完成实现，Then 拒绝。
- AC-011-03：Given Implementer 修改 worktree 后未清理，When 提交结果，Then 拒绝。
- AC-011-04：Given 实现完成，When 进入质量门，Then 记录固定 commit、分支和 diff。

如 Change 需要前后端分工，可以由同一 Implementer 角色按顺序执行多个任务；不得并发
写入同一 worktree。

### RQ-012 有界修复和失败上下文

质量门或 Review 失败时，系统必须把具体失败证据传给 Implementer，并限制自动修复次数。

验收标准：

- AC-012-01：Given 测试失败，When 启动修复，Then Implementer 输入包含失败 case、命令、退出码、期望值、实际值、日志摘要和允许文件。
- AC-012-02：Given Review blocker，When 启动 rework，Then Implementer 输入包含 finding ID、文件、行号、AC、证据和建议。
- AC-012-03：Given 连续两次自动修复后仍失败，When 再次失败，Then Change 进入 `BLOCKED`，不得无限循环。
- AC-012-04：Given 任一修复完成，When 重新验证，Then 执行完整质量门，不能只运行失败用例。

### RQ-013 确定性质量门

系统必须通过真实项目命令验证实现，不得把未运行、跳过、超时或取消记录为通过。

验收标准：

- AC-013-01：Given 项目定义了 build、test、lint 和 format check，When 执行质量门，Then 每条命令均有真实日志和退出码。
- AC-013-02：Given 任一阻断命令失败、超时、取消或未运行，When 汇总结果，Then 状态为 fail/blocked/incomplete，不得进入 Review。
- AC-013-03：Given 测试包含冻结 case，When 执行，Then 所有 case 必须 pass 且不得 skip。
- AC-013-04：Given Web/API 项目，When 执行质量门，Then 至少有一条真实 integration、HTTP runtime 或等价运行证据。
- AC-013-05：Given 命令执行修改了生产文件，When 校验，Then 质量门失败。

浏览器级 E2E 可以按风险启用，但不作为 MVP 所有项目的强制依赖。

### RQ-014 格式化后全量回归

格式化工具必须产生独立提交；格式化完成后必须重新执行完整质量门。

验收标准：

- AC-014-01：Given Formatter 修改冻结测试或任务白名单外文件，When 校验，Then 拒绝格式化提交。
- AC-014-02：Given 格式化产生新 commit，When 进入 Review，Then 新 commit 必须重新通过 build、test、lint 和 format check。
- AC-014-03：Given 质量报告来自格式化前 commit，When 执行 Review，Then 拒绝使用该报告。
- AC-014-04：Given 格式化没有实际修改，When 继续流程，Then 仍记录当前固定 commit 并确认证据绑定。

### RQ-015 固定提交独立 Review

Reviewer 必须对唯一固定提交执行只读审查。

验收标准：

- AC-015-01：Given Review 前后工作区或提交变化，When 提交报告，Then 拒绝。
- AC-015-02：Given finding 文件不在 diff 或行号不在变更 hunk 内，When 校验报告，Then 拒绝。
- AC-015-03：Given 报告没有 Reviewer 执行身份、输入摘要或固定 commit，When 校验，Then 拒绝。
- AC-015-04：Given Review mode 判定为 strict，When 存在 P0/P1/P2/P3 中该模式定义的 blocker，Then 禁止 H3。
- AC-015-05：Given Review verdict=pass 但存在 blocking finding，When 保存，Then 拒绝。

### RQ-016 H3 人工交付验收

只有可信用户能够批准进入最终交付。

验收标准：

- AC-016-01：Given Review 未通过或质量证据不是当前 commit，When 请求 H3，Then 拒绝。
- AC-016-02：Given H3 展示内容变化，When 消费批准，Then 返回 artifact changed。
- AC-016-03：Given 用户未批准，When 请求交付，Then 不得归档、合并目标分支或推送。

### RQ-017 DeliveryRecord 与交付包

H3 通过后，系统必须生成不可变交付记录和人类可读交付摘要。

验收标准：

- AC-017-01：Given H3 已批准，When 生成交付，Then 记录需求 hash、baseline commit、delivery commit、变更文件、AC、测试证据、Review、风险和批准记录。
- AC-017-02：Given Delivery 已存在，When 再次写入不同内容，Then 拒绝覆盖。
- AC-017-03：Given 存在 known failures、open risks 或未验证区域，When 生成客户可见摘要，Then 必须显示这些内容，不能输出为空。
- AC-017-04：Given 用户没有要求推送，When 交付，Then 只生成本地提交和记录，不执行 remote push。
- AC-017-05：Given DeliveryRecord 已生成，When 展示回滚说明，Then 至少包含代码回滚方式、数据回滚边界和 forward-fix 建议。

### RQ-018 证据链和新鲜度

系统必须保持状态、审批、测试、Review 和交付之间的 hash 与 commit 绑定。

验收标准：

- AC-018-01：Given 任一事件被修改、删除或重排，When 读取状态，Then 检测失败并拒绝继续。
- AC-018-02：Given 状态版本落后于事件链，When 写入，Then 使用 CAS 拒绝旧版本。
- AC-018-03：Given 需求、测试、质量、Review 或 Preview artifact 发生变化，When 消费旧审批或继续下一步，Then 拒绝。
- AC-018-04：Given 测试报告所属 commit 与当前 commit 不同，When Review 或 H3，Then 拒绝。
- AC-018-05：Given 历史证据来自旧 commit，When 当前流程需要通过，Then 必须重新执行，不继承旧 PASS。

### RQ-019 状态查询、暂停、恢复和取消

用户必须能够读取当前状态，并从稳定检查点暂停、恢复或取消。

验收标准：

- AC-019-01：Given 查询状态，When 执行只读命令，Then 不创建目录、不修复、不审批、不恢复任务。
- AC-019-02：Given 合法活动状态，When 暂停，Then 保存检查点并保持 worktree、commit 和证据。
- AC-019-03：Given 暂停或阻塞状态，When 恢复，Then 从记录的稳定状态继续，不跳过审批。
- AC-019-04：Given 活动 Change，When 取消，Then 进入 `CANCELLED`，保留全部代码、分支和证据。
- AC-019-05：Given 推送失败，When 恢复流程，Then 不自动重试失败推送。

### RQ-020 本地安全边界

MVP 默认将本地操作系统用户视为可信用户，同时保持状态、路径和命令边界。

验收标准：

- AC-020-01：Given 项目路径是插件源码、缓存目录、文件系统根或符号链接逃逸路径，When 执行操作，Then 拒绝。
- AC-020-02：Given 用户输入包含明显密码、token、secret、API key 或授权头，When 记录需求或证据，Then 拒绝持久化。
- AC-020-03：Given 角色任务尝试读取或修改工作区外路径，When 校验，Then 阻断。
- AC-020-04：Given 宿主不支持可信 elicitation，When 请求 H1/H3，Then 保持待审批状态，不使用普通聊天替代。

### RQ-021 最小产品面与默认启动

MVP 安装和启动不得依赖控制面、MySQL、Web 服务或外部通知。

验收标准：

- AC-021-01：Given 干净安装，When 启动 MCP，Then 不需要数据库、端口、Web 会话或通知凭据。
- AC-021-02：Given 用户只查询状态，When 执行，Then 不自动启动控制面或其他后台服务。
- AC-021-03：Given 用户只使用核心交付流程，When 查看公开工具和 Skill，Then 不出现 WorkItem、Worker、Decision、TOTP 或远程部署入口。
- AC-021-04：Given 可选模块存在，When 构建核心发行包，Then 其运行和测试不依赖可选模块。

### RQ-022 技术栈与验收范围

核心工作流不得固化到单一语言，但 MVP 发布验收只要求一个金丝雀栈。

验收标准：

- AC-022-01：Given 项目已声明真实 build/test/lint/format/runtime 命令，When 执行工作流，Then 命令来自项目配置而非模型猜测。
- AC-022-02：Given 金丝雀项目使用 JDK 17、Spring Boot 3.5 和 Vue 3，When 执行端到端验收，Then 全部质量门通过。
- AC-022-03：Given 项目使用 React、JDK 8 或 JDK 21，When MVP 发布，Then 可以标记“支持但未验签”，不得声称已验证。

### RQ-023 现有仓库迁移边界

收缩实现时必须保留当前用户工作区和历史证据，不得直接删除未迁移模块。

验收标准：

- AC-023-01：Given 当前存在控制面、模板和环境安装代码，When 收缩为 MVP，Then 先从默认注册、发行包和必跑测试中隔离。
- AC-023-02：Given 历史状态、交付和文档，When 迁移，Then 不删除、不覆盖、不伪造迁移结果。
- AC-023-03：Given MVP 核心测试，When 运行，Then 不要求外部 MySQL、Web 服务或网络凭证。
- AC-023-04：Given 可选模块保留，When 说明其状态，Then 明确标记为“非 MVP / 非默认 / 未被当前发行验证”。

### RQ-024 核心发行质量

MVP 的当前提交必须自身通过核心质量和打包检查，不得依赖历史 PASS。

验收标准：

- AC-024-01：Given 当前核心提交，When 执行完整测试，Then 0 failed、0 skipped；不得用环境缺失作为核心测试跳过理由。
- AC-024-02：Given 当前核心提交，When 执行 lint、format check 和 pack check，Then 全部退出码为 0。
- AC-024-03：Given 打包产物，When 从非插件目录启动，Then MCP handshake、状态读取和至少一条完整本地交付 Smoke 通过。
- AC-024-04：Given 任一检查失败，When 发布，Then 不得把该提交标记为 MVP 可交付。

---

## 8. 数据与证据模型

MVP 只允许四类事实来源：

1. Git commit、branch 和 diff；
2. 本地权威状态与 append-only 事件链；
3. 真实命令日志、测试报告和退出码；
4. H1/H3 可信人工审批记录。

逻辑产物固定为：

```text
Change
├── spec.md          用户可读需求、REQ、AC、范围和风险
├── plan.json        机器可读任务、AC、依赖和文件白名单
├── tests/           Test Designer 提交并冻结的测试资产
├── evidence/        红色基线、质量门、格式化、Review 和审批证据
└── delivery/        最终交付记录和人类可读摘要
```

要求：

- `spec.md` 和 `plan.json` 不重复定义两套需求；
- `plan.json` 只引用 `spec.md` 中的 REQ/AC ID；
- 所有证据必须带 commit 或 artifact hash；
- 不允许出现第二个状态源；
- 关闭或损坏证据时必须 fail closed。

---

## 9. 质量门与阻断矩阵

| 门               | 输入                         | 通过条件                                       | 失败行为                     |
| ---------------- | ---------------------------- | ---------------------------------------------- | ---------------------------- |
| H1               | 需求规格、澄清记录、批判分析 | 所有 REQ 有 AC，无 blocking 问题，人工批准有效 | 保持 `H1_PENDING` 或返回澄清 |
| Plan Freeze      | `plan.json`                  | 所有 AC 映射任务；任务有文件白名单和依赖       | `BLOCKED`，禁止测试设计      |
| Test Freeze      | Test Designer commit         | 每 AC 映射 case；只有测试资产；提交真实        | 阻断，不开始实现             |
| Red Baseline     | 冻结测试                     | 所有 case 被观察为 fail                        | 阻断，不创建实现提交         |
| Quality Gate     | 实现 commit                  | 所有命令真实通过；无 skip、超时、改生产文件    | 修复或 `BLOCKED`             |
| Post-format Gate | 格式化后 commit              | 与 Quality Gate 相同且证据绑定新 commit        | 修复或 `BLOCKED`             |
| Review           | 固定 commit                  | 只读；无 blocker；报告和身份绑定当前 commit    | 退回实现或 `BLOCKED`         |
| H3               | 需求、质量、Review、风险     | 人工批准有效且 artifact 未变化                 | 保持 `H3_PENDING`            |
| Delivery         | 当前 commit、H3              | 记录完整；不可覆盖；已知问题可见               | 不生成交付                   |

---

## 10. 人工介入边界

MVP 只保留两个常规人工决策点：

1. **H1：需求和 AC 是否正确；**
2. **H3：当前固定提交和证据是否可交付。**

以下情况自动阻断，不要求 AI 自行“解释后继续”：

- 需求存在 blocking 歧义；
- 测试未覆盖所有 AC；
- 红色基线不失败；
- 修改冻结测试；
- 修改白名单外文件；
- 新增依赖未批准；
- 质量门失败；
- 格式化后回归失败；
- Review 存在 blocker；
- 证据 commit 不匹配；
- 连续两次修复失败。

阻断后由用户决定补充需求、允许一次显式人工处理或取消 Change；AI 不得自行降低门槛。

---

## 11. 非功能需求

### 11.1 可靠性

- 状态写入使用原子写和 CAS。
- 同一 Change 同时只有一个写入者。
- 任意阶段中断后可以从稳定检查点读取状态。
- 不自动修复损坏审计链。
- 不把“进程启动成功”等同于“命令执行通过”。

### 11.2 可恢复性

- Pause/Cancel 不删除 worktree、分支和证据。
- 命令超时必须被记录并终止相关进程。
- 部分写入文件不得成为有效证据。
- DeliveryRecord 写入不可覆盖。

### 11.3 性能

- 状态读取不运行项目构建。
- 状态查询不触发安装、初始化或控制面启动。
- 单命令超时可配置，默认不超过 30 分钟。
- 角色超时可配置，默认不超过 2 小时。

### 11.4 安全

- 所有路径必须解析并确认位于绑定项目内。
- 拒绝绝对路径逃逸、`..`、符号链接和硬链接逃逸。
- 日志和证据写入前执行密钥模式扫描。
- MCP 工具不得接受任意 shell、审批凭据或用户身份。
- 角色子进程不得继承宿主其他 MCP 和插件。

### 11.5 可维护性

- 核心模块不得导入可选控制面、Web、通知或 MySQL 模块。
- 每个核心状态迁移必须有聚焦测试。
- 每个阻断条件必须有至少一个负向测试。
- 不允许用快照更新掩盖审计损坏。

---

## 12. 成功指标

MVP 只记录三个业务指标：

| 指标             | 定义                                   | 用途                 |
| ---------------- | -------------------------------------- | -------------------- |
| 首轮 AC 通过率   | 首次质量门即通过全部 AC 的 Change 比例 | 判断需求和测试质量   |
| 平均自动修复轮次 | 每个成功 Change 进入修复轮次的平均值   | 判断反馈闭环是否有效 |
| 发布后逃逸缺陷数 | 已交付 Change 后续发现的 P0/P1 缺陷数  | 判断验收是否充分     |

这些指标由交付记录和 Change 事件派生，不需要 Web 看板或数据库。

---

## 13. 发布验收场景

MVP 至少完成一个真实项目需求，而不是只通过单元测试。

### AC-MVP-01 完整成功链路

Given 一个干净的已有 Git 项目和一个明确业务需求，
When 用户完成 H1、测试设计、红色基线、实现、质量门、格式化回归、Review 和 H3，
Then 系统生成绑定唯一 commit 的 DeliveryRecord，且全部测试、Lint、Format、Build 和运行证据通过。

### AC-MVP-02 测试先行失败

Given 冻结测试在实现前全部通过，
When 请求开始实现，
Then 系统拒绝，并保留红色基线失败报告。

### AC-MVP-03 越界修改阻断

Given 任务只允许修改 `src/example/**`，
When Implementer 修改 `tests/**` 或白名单外文件，
Then 提交被拒绝，Change 不进入质量通过状态。

### AC-MVP-04 修复上下文完整

Given 质量门发现具体失败 case，
When 启动修复，
Then Implementer 输入包含该失败 case、命令、退出码、期望/实际结果和允许文件。

### AC-MVP-05 格式化后回归

Given Formatter 产生了新的格式化 commit，
When 进入 Review，
Then build、test、lint、format 和运行证据全部针对该新 commit 重新执行并绑定。

### AC-MVP-06 旧证据拒绝

Given 质量报告属于格式化前 commit，
When 尝试用它完成 Review 或 H3，
Then 系统拒绝，并要求重新运行质量门。

### AC-MVP-07 独立 Review

Given Reviewer 没有真实执行身份、输入摘要或固定 commit，
When 提交 Review report，
Then 报告被拒绝。

### AC-MVP-08 最终人工验收

Given H3 尚未批准，
When 请求生成最终 DeliveryRecord 或推送，
Then 系统拒绝，且不合并目标分支、不推送。

### AC-MVP-09 无外部服务运行

Given 干净开发机只安装 Node、Git、Codex 和项目工具链，
When 运行核心测试和完整成功链路，
Then 不需要 MySQL、Web 服务、飞书、TOTP 或远程队列。

### AC-MVP-10 当前提交自身可发布

Given MVP 当前提交，
When 执行核心 `npm test`、lint、format check、pack check 和打包 Smoke，
Then 全部退出码为 0，且核心测试没有 skipped。

---

## 14. 版本与实施边界

### 14.1 第一版必须完成的收缩

- 默认 MCP 工具注册只包含核心能力；
- 默认 Skill 只导航项目接入和 Change 交付；
- 控制面和通知模块不参与默认启动；
- MySQL 不在核心测试依赖中；
- 新项目模板生成不在默认包中；
- Formatter 和 Tester 通过工具运行，不启动 AI 角色；
- 只要求一个金丝雀技术栈完成真实验收。

### 14.2 后续版本候选

以下能力等待 MVP 真实稳定后再评估：

- 增量再交付；
- 浏览器 E2E；
- 业务指标汇总；
- 远程通知；
- WorkItem 异步执行；
- MySQL 和 Web 管理台；
- 多项目；
- 多 Worker；
- 多技术栈矩阵；
- 新项目模板。

---

## 15. 完成定义

本 MVP 只有在以下条件全部满足时才算完成：

1. 文档已由用户明确批准并冻结；
2. 主流程状态机和两个人工门已实现；
3. 测试先行、红色基线和测试冻结已实现；
4. 任务文件白名单、依赖批准和冻结测试保护已实现；
5. 修复 findings 真正进入 Implementer；
6. 格式化后全量回归已实现；
7. Reviewer 执行身份和固定提交绑定已实现；
8. DeliveryRecord 正确包含已知问题和未验证项；
9. 一个真实项目完成 AC-MVP-01 至 AC-MVP-10；
10. 当前核心提交的测试、Lint、Format、Pack 和 Smoke 全部通过；
11. 非 MVP 模块被隔离且不参与默认启动、核心测试和发行包；
12. 所有未执行的真实环境检查明确记录为 NOT_RUN。

---

## 16. 未决事项

本版没有阻塞性未决项。

以下内容属于后续版本决策，不影响本 MVP：

- 第二个验收技术栈；
- 是否恢复增量再交付；
- 是否恢复浏览器 E2E；
- 是否需要远程通知；
- 是否重新启用控制面和 MySQL。

变更规则：

- 修改目标、范围、非目标、人工门、质量门或验收标准必须形成新版本；
- 不得通过修改实现阶段产物静默改变本需求；
- 本文档已经用户确认并冻结；
- 后续变更必须记录新的审批时间、审批来源和候选正文 SHA-256。
