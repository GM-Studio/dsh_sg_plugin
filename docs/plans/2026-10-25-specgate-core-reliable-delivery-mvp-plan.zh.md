# SpecGate Core 最小可靠交付 MVP 执行计划与里程碑

- 计划状态：**v1.0-approved；M0–M3 已验证，M4 未开始**
- 日期：2026-10-25
- 适用仓库：SpecGate Codex 插件
- 关联需求：`docs/requirements/2026-10-25-specgate-core-reliable-delivery-mvp.zh.md`
- 需求状态：`1.0-frozen`
- 需求冻结候选 SHA-256：`5FA97CD08A0A3DBB1A95DB366CBB87BD521651B29E860659266C14EB0F3F26A6`
- 冻结后需求文本规范化 LF SHA-256：`5F7F9067F960C17AE7C41BD23DDCAA0F4A2B06EF6A5BEB6930910849254E4531`
- 执行模式：计划驱动、TDD、逐步验收、不可跳门
- 本文件最初创建行为：**只制定计划，不实施**；本次实施授权与阶段证据见 §17。

---

## 1. 计划权威与边界

本计划只把冻结需求拆解为执行顺序，不改变需求内容。

发生以下任一情况时必须停止实施并重新修订计划或需求：

- 需要改变目标、范围、非目标、人工门、质量门或验收标准；
- 需要新增外部数据库、Web 服务、远程通知或云运行依赖；
- 核心实现无法在不依赖可选模块的情况下运行；
- 现有测试要求放宽断言、删除用例或把未执行记录为通过；
- 真实金丝雀项目不可用；
- 用户工作区变化与计划修改范围冲突。

计划和实现不得：

- 修改已冻结需求；
- 自动提交用户现有改动；
- 把生成计划、生成代码或生成报告当成验证通过；
- 删除历史状态、历史交付或未迁移模块；
- 在未获用户明确指示前提交或推送。

---

## 2. 总体执行策略

### 2.1 路线

采用以下路线：

```text
Route C：先冻结计划和任务
  ↓
Route D：按里程碑逐项执行
  ↓
Route E：对当前基线失败先复现再修复
  ↓
Route F：每个里程碑验收后进入下一阶段
```

不并发推进多个核心里程碑。原因是状态机、变更契约、测试冻结和证据绑定相互依赖，
同时修改会削弱失败定位能力。

### 2.2 实施原则

1. 每个行为变化先增加失败测试，并确认失败原因正确。
2. 每次只修改完成当前任务所需的最小文件。
3. 每个里程碑必须有独立验收证据。
4. 修复后运行完整质量门，不只运行失败用例。
5. 格式化后重新执行完整质量门。
6. 当前需求冻结内容不得由实现过程静默改变。
7. 可选模块先隔离，证明核心稳定后再物理删除。
8. 所有实时检查以当前工作区和当前命令输出为准，不继承历史 PASS。

### 2.3 最小目标组成

计划完成后应形成：

- 一个本地可信交付闭环；
- 两个人工门：H1、H3；
- 三个委派 AI 角色：Test Designer、Implementer、Reviewer；
- Git commit、append-only 事件链、审批记录和命令证据四类事实来源；
- `spec.md`、`plan.json`、`tests/`、`evidence/`、`delivery/` 五类逻辑产物；
- 不依赖 MySQL、Web 服务、通知渠道、控制面或远程 Worker。

---

## 3. 里程碑总览

| 里程碑 | 名称                     | 目标                                           | 退出后状态                 |
| ------ | ------------------------ | ---------------------------------------------- | -------------------------- |
| M0     | 基线、范围与证据映射     | 确认当前仓库基线、需求映射和修改边界           | 可以开始核心实现           |
| M1     | 可信状态与审批内核       | 完成精简状态机、H1/H3、审计链和 CAS            | 状态与批准不可伪造         |
| M2     | 需求、计划与测试前移     | 完成 spec、任务白名单、测试冻结和红色基线      | 可以开始实现               |
| M3     | 实现、质量与有界修复     | 完成隔离实现、真实质量门和 findings 传递       | 失败可定位、可修复、可重跑 |
| M4     | 格式化、Review 与交付    | 完成格式化后回归、Review 身份和 DeliveryRecord | 固定提交可审查、可验收     |
| M5     | 最小产品面与可选模块隔离 | 默认入口不依赖控制面和其他外围模块             | 核心可以独立运行           |
| M6     | 真实金丝雀与发布验收     | 在一个真实项目上完成完整闭环                   | MVP 可发布                 |

依赖关系：

```text
M0
 └─ M1
     └─ M2
         └─ M3
             └─ M4
                 └─ M5
                     └─ M6
```

M1-M4 可以暂不与旧可选测试完全解耦，但必须在聚焦测试中保持绿色。
M5 完成后，核心全量测试不得再依赖 MySQL 或其他外部服务。
M6 未完成前不得宣称 MVP 已交付。

---

## 4. M0：基线、范围与证据映射

### 4.1 目标

建立实施前的可信基线，确认当前仓库实际状态、冻结需求映射和可修改范围，避免把已有
失败、未执行项或可选模块行为误当成核心基线。

### 4.2 覆盖需求

- RQ-023：现有仓库迁移边界；
- RQ-024：核心发行质量。

### 4.3 前置条件

- 冻结需求可读取；
- 当前 Git 分支和用户工作区可检查；
- 已记录当前未跟踪文件，后续不得清理或提交。

### 4.4 任务

#### CORE-0001 记录实施前仓库基线

- 文件：`docs/implementation/2026-10-25-specgate-core-mvp/00-baseline-report.md`
- 操作：
  - 记录 `git status --short`、当前分支和 HEAD；
  - 记录 Node/npm/Git/Codex 版本；
  - 执行当前测试、lint、format check、pack check 和 smoke；
  - 将失败、跳过、环境缺失和历史证据分别记录。
- 验证：

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
node --version
npm --version
git --version
npm test
npm run lint
npm run format:check
$env:npm_config_cache = Join-Path $env:TEMP 'specgate-npm-cache'
npm run pack:check
npm run codex:smoke
```

- 完成条件：
  - 当前失败没有被描述为通过；
  - 未修改或提交任何用户文件；
  - 报告列出所有失败测试和环境依赖。

#### CORE-0002 建立需求到模块和测试的映射

- 文件：`docs/implementation/2026-10-25-specgate-core-mvp/01-requirements-mapping.md`
- 操作：
  - 将 RQ-001 至 RQ-024 映射到当前源文件、现有测试和计划里程碑；
  - 标记“已实现”“需增强”“需隔离”“需新增测试”；
  - 对每个 AC 明确验证方式。
- 验证：
  - 24 条 RQ 全部出现；
  - 每条 RQ 至少映射一个里程碑；
  - 没有重复或遗漏的 RQ/AC 编号。
- 完成条件：
  - 计划 M1-M6 可以基于该矩阵逐项执行；
  - 不把现有实现直接标记为需求通过。

#### CORE-0003 定义金丝雀项目入口条件

- 文件：`docs/implementation/2026-10-25-specgate-core-mvp/02-canary-entry.md`
- 操作：
  - 记录用户批准的现有 Git 项目绝对路径；
  - 记录项目 build/test/lint/format/runtime 命令；
  - 记录目标技术栈、基线 commit 和干净工作区状态；
  - 明确金丝雀需求不能用于修改 SpecGate 仓库自身。
- 验证：
  - 项目是普通业务目录；
  - `git status --porcelain` 为空；
  - 每条命令可由 argv 数组表达，不依赖模型临时拼接 shell。
- 完成条件：
  - 金丝雀项目满足验收要求；
  - 若没有真实项目，M6 保持 `BLOCKED`，测试 fixture 不能冒充真实验收。

### 4.5 M0 退出门

- 需求矩阵完整性检查通过；
- 当前基线失败和未执行项已如实记录；
- 用户未跟踪文件已登记且未被修改；
- 金丝雀入口条件已明确；
- M0 报告经过只读复核。

### 4.6 M0 失败与回滚

- 当前测试因外部依赖失败：保留失败报告，不降低断言；
- 现有工作区不干净：停止，不自动提交；
- 金丝雀不可用：后续可以完成 M1-M5，但 M6 不得通过。

---

## 5. M1：可信状态与审批内核

### 5.1 目标

完成 MVP 的权威状态机、append-only 事件链、CAS 写入门禁、H1/H3 审批和稳定
Pause/Resume/Cancel，确保模型不能通过工具参数或普通聊天伪造状态和批准。

### 5.2 覆盖需求

- RQ-003：单活动 Change；
- RQ-007：H1 可信需求批准；
- RQ-016：H3 人工交付验收；
- RQ-018：证据链和新鲜度；
- RQ-019：状态查询、暂停、恢复和取消；
- RQ-020：本地安全边界。

### 5.3 任务

#### CORE-0101 增加精简状态机失败测试

- 文件：
  - `test/codex-core-state-machine.test.js`（新增）
  - `test/codex-state-kernel.test.js`
- 先写测试：
  - 合法主状态和侧状态集合；
  - 非法迁移拒绝；
  - 单活动 Change 拒绝第二实例；
  - 旧事件只读映射不重写历史；
  - Pause/Resume/Cancel 保留 checkpoint。
- 运行：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-core-state-machine.test.js test/codex-state-kernel.test.js
```

- 完成条件：
  - 新测试先失败；
  - 失败原因是缺少 MVP 状态而不是测试环境。

#### CORE-0102 收敛 MVP 状态机

- 文件：
  - `src/codex/state-machine.js`
  - `src/codex/checkpoints.js`
- 操作：
  - 对外提供冻结需求中的主状态；
  - 保留合法的侧状态；
  - 拒绝非法迁移；
  - 读取旧状态时使用只读映射，不修改历史事件；
  - 每个迁移继续使用 `expectedVersion` CAS。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-core-state-machine.test.js test/codex-state-kernel.test.js
```

#### CORE-0103 强制单活动 Change

- 文件：
  - `src/codex/state-machine.js`
  - `src/codex/change-add.js`
  - `test/codex-change-add-flow.test.js`
- 操作：
  - 创建 Change 前检查活动实例；
  - 不排队、不覆盖；
  - 完成或取消后允许新 Change；
  - 记录拒绝事件但不改变状态版本。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-change-add-flow.test.js
```

#### CORE-0104 固化 H1/H3 审批

- 文件：
  - `src/codex/approvals.js`
  - `src/codex/change-add.js`
  - `src/codex/review.js`
  - `test/codex-approval-authority.test.js`
  - `test/codex-approval-state.test.js`
- 操作：
  - approval 继续由服务端闭包生成；
  - 绑定 gate、scope、artifactHash、actor、TTL、nonce；
  - 只允许一次消费；
  - 工具参数继续拒绝 approval、answer、actor 和 receipt；
  - artifact 改变后旧批准失效。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-approval-authority.test.js test/codex-approval-state.test.js
```

#### CORE-0105 固化事件链、新鲜度和 CAS

- 文件：
  - `src/codex/events.js`
  - `src/codex/storage.js`
  - `test/codex-state-kernel.test.js`
- 操作：
  - 检测事件修改、删除、重排和尾部截断；
  - 校验 commit/artifact hash；
  - 旧 PASS 不继承到新 commit；
  - 状态写入使用原子写与版本比较。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-state-kernel.test.js
```

#### CORE-0106 固化本地路径和敏感数据边界

- 文件：
  - `src/codex/core/project-path.js`
  - `src/codex/core/artifact-store.js`
  - `src/codex/development.js`
  - `test/codex-artifact-store.test.js`
  - `test/codex-host-input.test.js`
- 操作：
  - 拒绝插件源码、缓存、文件系统根、路径逃逸、符号链接和硬链接逃逸；
  - 需求、证据和状态写入前检查明显凭据；
  - 测试不可用时不伪造 H1/H3。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-artifact-store.test.js test/codex-host-input.test.js
```

### 5.4 M1 退出门

- 主状态和侧状态测试全部通过；
- 第二活动 Change 无法创建；
- H1/H3 伪造测试全部通过；
- 审批重放、过期和 artifact 变化均拒绝；
- 事件链篡改与旧证据复用均拒绝；
- Pause/Resume/Cancel 不丢失证据；
- 添加的聚焦测试没有 skip。

### 5.5 M1 验证命令

```powershell
node --import ./test/setup-temp.mjs --test test/codex-core-state-machine.test.js test/codex-state-kernel.test.js test/codex-approval-authority.test.js test/codex-approval-state.test.js test/codex-change-add-flow.test.js test/codex-artifact-store.test.js test/codex-host-input.test.js
```

### 5.6 M1 失败与回滚

- 旧状态无法只读映射：停止，保持旧实现可用，不重写历史；
- 审批必须依赖可选控制面：回到 H1/H3 需求边界重新设计；
- CAS 或事件链测试不稳定：停止，不允许降低断言。

---

## 6. M2：需求、计划与测试前移

### 6.1 目标

完成需求规格、原生澄清、批判分析、AC 映射、任务文件白名单、依赖批准、独立测试设计、
测试冻结和红色基线，使实现启动前已经具备可执行验收依据。

### 6.2 覆盖需求

- RQ-001：项目绑定与只读预检；
- RQ-002：现有项目基线；
- RQ-004：原生需求澄清；
- RQ-005：需求规格与 AC；
- RQ-006：反向复述与批判分析；
- RQ-008：计划、文件白名单和依赖边界；
- RQ-009：独立测试设计与测试冻结；
- RQ-010：红色基线；
- RQ-022：技术栈与验收范围。

### 6.3 任务

#### CORE-0201 增加需求规格和 AC 失败测试

- 文件：
  - `test/codex-change-policy.test.js`
  - `test/codex-change-add-flow.test.js`
- 覆盖：
  - REQ/AC 唯一；
  - 每条 REQ 至少一个 AC；
  - AC 包含可观察结果和验证方式；
  - 新提案保留历史；
  - blocking issue 阻止 H1。
- 先运行并确认失败：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-change-policy.test.js test/codex-change-add-flow.test.js
```

#### CORE-0202 固化需求澄清与批判分析

- 文件：
  - `src/codex/change-add.js`
  - `src/codex/change-tools.js`
  - `src/codex/host-input.js`
- 操作：
  - 最多三轮、每轮最多五问；
  - 只有可信原生回答可以记录；
  - 每个 REQ 必须有反向复述；
  - 批判覆盖歧义、矛盾、不可行、非功能、安全和测试盲区；
  - 文档或候选 hash 变化后旧批准失效。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-change-policy.test.js test/codex-change-add-flow.test.js test/codex-host-input.test.js
```

#### CORE-0203 增加计划文件白名单失败测试

- 文件：
  - `test/codex-plan-core.test.js`
  - `test/codex-development-flow.test.js`
- 覆盖：
  - AC 无任务映射时拒绝；
  - 任务无 `allowedFiles` 时拒绝；
  - 禁止修改 `tests/**` 和 `acceptance/**`；
  - 新依赖未批准时拒绝；
  - API/数据模型变化无 AC 时拒绝。
- 先运行并确认失败。

#### CORE-0204 扩展计划契约

- 文件：
  - `src/codex/plan.js`
  - `src/codex/plan-tools.js`
  - `src/codex/project-model.js`
- 操作：
  - `plan.json` 增加 `requirementIds`、`acIds`、`allowedFiles`、`forbiddenFiles`、`dependencies` 和 `verification`；
  - 校验路径规范化、唯一性和项目内边界；
  - 冻结计划 hash；
  - 保持旧计划只读可见，不能自动升级为已批准计划。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plan-core.test.js test/codex-project-model.test.js
```

#### CORE-0205 增加依赖批准门

- 文件：
  - `src/codex/plan.js`
  - `src/codex/development.js`
  - `src/codex/review.js`
  - `test/codex-development-flow.test.js`
  - `test/codex-review-release.test.js`
- 操作：
  - 识别 `package.json`、lockfile、`pom.xml` 和构建文件变化；
  - 任务未声明允许依赖时阻断；
  - 依赖批准绑定具体文件和 hash；
  - 禁止只靠 Review warning 代替批准。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-development-flow.test.js test/codex-review-release.test.js
```

#### CORE-0206 固化 Test Designer 和测试冻结

- 文件：
  - `src/codex/native-role-agent.js`
  - `src/codex/plan.js`
  - `assets/codex/agents/specgate_test_designer.toml`
  - `test/codex-native-role-agent.test.js`
  - `test/codex-plan-core.test.js`
- 操作：
  - Test Designer 使用独立 worktree；
  - 只允许提交测试、fixture 和 runner；
  - 每 AC 至少一个 case；
  - 冻结测试内容 hash；
  - Implementer 不可修改冻结测试。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-native-role-agent.test.js test/codex-plan-core.test.js
```

#### CORE-0207 固化真实红色基线

- 文件：
  - `src/codex/development.js`
  - `src/codex/native-test-runner.mjs`
  - `test/codex-development-flow.test.js`
- 操作：
  - 实现前执行冻结测试；
  - 退出码必须非零；
  - 每个 case 必须观察到 fail；
  - skip、未执行、超时和报告缺失均阻断；
  - 证据绑定测试 hash、命令和每个 case 状态。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-development-flow.test.js test/codex-native-runner.test.js
```

#### CORE-0208 固化项目预检与现有项目基线

- 文件：
  - `src/codex/project-status.js`
  - `src/codex/project-state.js`
  - `src/codex/baseline.js`
  - `src/codex/project-tools.js`
  - `test/codex-project-tools.test.js`
  - `test/codex-baseline.test.js`
- 操作：
  - 未绑定、目录不安全、Git 不干净和工具缺失时阻断；
  - 项目命令使用 argv 数组；
  - 失败命令如实记录；
  - 基线建立前禁止 Change。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-project-tools.test.js test/codex-baseline.test.js
```

### 6.4 M2 退出门

- 所有 REQ 可追溯到 AC；
- 所有 AC 可追溯到测试或人工验证方式；
- 计划任务的 AC、依赖和文件白名单完整；
- 新依赖无法绕过批准；
- Test Designer 只改测试；
- 测试 hash 冻结；
- 每个 case 的红色基线可复核；
- H1 前存在 blocking 问题时不能冻结。

### 6.5 M2 验证命令

```powershell
node --import ./test/setup-temp.mjs --test test/codex-change-policy.test.js test/codex-change-add-flow.test.js test/codex-host-input.test.js test/codex-plan-core.test.js test/codex-project-model.test.js test/codex-development-flow.test.js test/codex-review-release.test.js test/codex-native-role-agent.test.js test/codex-native-runner.test.js test/codex-project-tools.test.js test/codex-baseline.test.js
```

### 6.6 M2 失败与回滚

- Test Designer 无法保证只修改测试：停止，不进入实现；
- 文件白名单实现依赖模型自述：停止，改为 Git diff 机械校验；
- 红色基线无法逐 case 判定：保留 `NOT_RUN`，不得开始实现；
- 计划契约变化影响历史计划：增加只读兼容读取，不重写历史。

---

## 7. M3：隔离实现、质量门与有界修复

### 7.1 目标

完成隔离实现、提交级 diff 校验、真实质量门、有界修复和完整回归，确保失败原因能被
Implementer 使用，且自动修复不会无限循环。

### 7.2 覆盖需求

- RQ-011：隔离实现与提交证据；
- RQ-012：有界修复和失败上下文；
- RQ-013：确定性质量门。

### 7.3 任务

#### CORE-0301 增加实现范围和提交失败测试

- 文件：
  - `test/codex-development-flow.test.js`
  - `test/codex-core-development.test.js`（新增）
- 覆盖：
  - 主工作区不干净；
  - 没有新 commit；
  - worktree dirty；
  - 修改冻结测试；
  - 修改白名单外文件；
  - 修改任务未批准依赖。
- 先运行并确认失败。

#### CORE-0302 固化隔离实现和 diff 校验

- 文件：
  - `src/codex/development.js`
  - `src/codex/native-role-agent.js`
  - `assets/codex/agents/specgate_frontend.toml`
  - `assets/codex/agents/specgate_backend.toml`
- 操作：
  - 只允许一个实现 worktree；
  - 必须从冻结提交创建；
  - 必须形成新 commit；
  - 以 Git diff 校验 `allowedFiles`、`forbiddenFiles` 和测试路径；
  - 角色完成后 worktree 必须干净。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-development-flow.test.js test/codex-core-development.test.js test/codex-native-role-agent.test.js
```

#### CORE-0303 把具体 findings 传给 Implementer

- 文件：
  - `src/codex/development.js`
  - `src/codex/native-role-agent.js`
  - `test/codex-development-flow.test.js`
- 操作：
  - `prepareRepair` 和 `prepareRework` 生成的 findings 进入角色 challenge；
  - prompt 包含失败 case、命令、退出码、期望/实际、日志摘要、finding ID、文件、行号、AC 和建议；
  - findings 有长度上限和脱敏；
  - 不允许只传类目名称。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-development-flow.test.js test/codex-native-role-agent.test.js
```

#### CORE-0304 增加质量门失败测试

- 文件：
  - `test/codex-quality-gate.test.js`
  - `test/codex-core-quality.test.js`（新增）
- 覆盖：
  - 命令失败、超时、取消、未运行；
  - frozen case skip；
  - 测试命令修改生产文件；
  - Web/API 项目没有运行证据；
  - 旧 commit 的质量报告不能复用。
- 先运行并确认失败。

#### CORE-0305 固化质量门

- 文件：
  - `src/codex/quality.js`
  - `src/codex/quality-tools.js`
  - `src/codex/verify.js`
- 操作：
  - 读取项目确认的 build/test/lint/format/runtime 命令；
  - 每条命令记录开始/结束、退出码和日志；
  - 检查 skip、timeout、cancel、not-run；
  - 检查冻结测试不可变；
  - Web/API 项目至少一条真实运行证据；
  - 通过证据绑定当前实现 commit。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-quality-gate.test.js test/codex-core-quality.test.js test/codex-verification.test.js test/codex-verify-adapter.test.js
```

#### CORE-0306 实现两次修复上限和全量回归

- 文件：
  - `src/codex/development.js`
  - `src/codex/state-machine.js`
  - `src/codex/checkpoints.js`
  - `test/codex-development-flow.test.js`
  - `test/codex-state-kernel.test.js`
- 操作：
  - 连续两次自动修复仍失败后进入 `BLOCKED`；
  - 每次修复都从完整质量门重新开始；
  - 不允许只重跑失败 case；
  - 修复产生的 commit 和证据保留。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-development-flow.test.js test/codex-state-kernel.test.js
```

### 7.4 M3 退出门

- Implementer 必须产生新 commit；
- 白名单外修改无法进入质量门；
- findings 在 Agent 输入中可观察；
- 质量门只有真实通过才能继续；
- 自动修复最多两次；
- 每次修复后全量回归；
- 第三次失败进入 `BLOCKED`。

### 7.5 M3 验证命令

```powershell
node --import ./test/setup-temp.mjs --test test/codex-development-flow.test.js test/codex-core-development.test.js test/codex-native-role-agent.test.js test/codex-quality-gate.test.js test/codex-core-quality.test.js test/codex-verification.test.js test/codex-verify-adapter.test.js test/codex-state-kernel.test.js
```

### 7.6 M3 失败与回滚

- 角色 Provider 无法可靠输出 commit：停止，不进入质量门；
- findings 无法安全传递：保留失败状态，禁止自动修复；
- 运行证据不稳定：记录真实失败，不修改需求或测试降低门槛；
- 修复上限无法机械执行：禁止继续下一模型轮次。

---

## 8. M4：格式化、Review、H3 与交付

### 8.1 目标

完成格式化后的全量回归、固定提交独立 Review、H3 人工验收和不可变 DeliveryRecord，
消除格式化前后证据混用、Reviewer 身份不可证明和已知问题丢失。

### 8.2 覆盖需求

- RQ-014：格式化后全量回归；
- RQ-015：固定提交独立 Review；
- RQ-016：H3 人工交付验收；
- RQ-017：DeliveryRecord 与交付包。

### 8.3 任务

#### CORE-0401 增加格式化证据绑定失败测试

- 文件：
  - `test/codex-format-rework.test.js`
  - `test/codex-core-format.test.js`（新增）
- 覆盖：
  - Formatter 修改冻结测试；
  - Formatter 修改开发 delta 外文件；
  - 格式化产生新 commit；
  - 质量报告仍属于格式化前 commit；
  - 格式化后测试失败；
  - 格式化没有 diff。
- 先运行并确认失败。

#### CORE-0402 实现格式化提交和重新全量回归

- 文件：
  - `src/codex/format.js`
  - `src/codex/quality.js`
  - `src/codex/workflow-tools.js`
- 操作：
  - Formatter 只能修改任务白名单内的生产文件；
  - 禁止修改测试；
  - 产生独立提交；
  - 格式化后重新执行 build/test/lint/format/runtime；
  - 新质量报告必须绑定格式化后的 commit；
  - 质量报告 commit 与 Review commit 不同时拒绝。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-format-rework.test.js test/codex-core-format.test.js test/codex-quality-gate.test.js
```

#### CORE-0403 增加 Reviewer 身份和只读失败测试

- 文件：
  - `test/codex-review-release.test.js`
  - `test/codex-core-review.test.js`（新增）
- 覆盖：
  - 缺少 Reviewer 身份；
  - 缺少输入摘要；
  - 固定 commit 变化；
  - 工作区或提交被修改；
  - finding 不在 diff；
  - pass 与 blocking finding 并存。
- 先运行并确认失败。

#### CORE-0404 固化独立 Review

- 文件：
  - `src/codex/review.js`
  - `src/codex/review-tools.js`
  - `src/codex/native-role-agent.js`
  - `assets/codex/agents/specgate_reviewer.toml`
- 操作：
  - Reviewer 必须通过独立角色 provider 或可信执行记录产生报告；
  - 报告绑定 agent identity、prompt/input hash、reviewedCommit 和 qualityHash；
  - Review 前后 worktree、HEAD 和 main 状态不变；
  - 报告结构与 diff hunk 一致；
  - strict 模式 blocker 阻断 H3。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-review-release.test.js test/codex-core-review.test.js test/codex-native-role-agent.test.js
```

#### CORE-0405 固化 H3 和不可变 DeliveryRecord

- 文件：
  - `src/codex/review.js`
  - `src/codex/release.js`
  - `src/codex/delivery.js`
  - `src/codex/project-model.js`
  - `test/codex-review-release.test.js`
  - `test/codex-delivery-record.test.js`
- 操作：
  - H3 绑定 Review 和 archive preview；
  - H3 前重新核对质量 commit；
  - 交付写入不可覆盖；
  - 交付记录包含需求 hash、baseline、delivery commit、变更文件、AC、证据、风险和批准；
  - 客户摘要显示 known issues、open risks 和 unverified areas；
  - 无 `push=true` 不推送；
  - 回滚说明包含代码、数据边界和 forward-fix。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-review-release.test.js test/codex-delivery-record.test.js test/codex-project-model.test.js
```

### 8.4 M4 退出门

- 格式化前质量报告不能用于 Review；
- 格式化后所有质量门重新通过；
- Review 有真实执行身份和固定 commit；
- Reviewer 修改工作区时结果无效；
- H3 无批准时不交付；
- DeliveryRecord 不可覆盖；
- known issues、open risks 和 unverified areas 在交付摘要可见。

### 8.5 M4 验证命令

```powershell
node --import ./test/setup-temp.mjs --test test/codex-format-rework.test.js test/codex-core-format.test.js test/codex-quality-gate.test.js test/codex-review-release.test.js test/codex-core-review.test.js test/codex-native-role-agent.test.js test/codex-delivery-record.test.js test/codex-project-model.test.js
```

### 8.6 M4 失败与回滚

- 格式化后回归失败：返回 `IMPLEMENTING`，保留格式化提交和失败证据；
- Review 身份无法证明：保持 `REVIEWING`，不使用模型传入报告代替；
- H3 制品变化：重新展示新预览并要求批准；
- DeliveryRecord 写入冲突：保留原记录，不覆盖。

---

## 9. M5：最小产品面与可选模块隔离

### 9.1 目标

让默认安装、MCP 工具、Skill、测试和发行包只包含核心可靠交付能力；控制面、Web、
通知、MySQL、模板生成和环境安装作为非默认模块保留但不影响核心。

### 9.2 覆盖需求

- RQ-021：最小产品面与默认启动；
- RQ-023：现有仓库迁移边界。

### 9.3 任务

#### CORE-0501 增加默认工具面失败测试

- 文件：
  - `test/codex-tools-workflow.test.js`
  - `test/codex-plugin-protocol.test.js`
  - `test/codex-core-surface.test.js`（新增）
- 覆盖：
  - 默认工具不包含 WorkItem、Worker、Decision、TOTP 和部署；
  - 核心工具可完成状态和交付；
  - 可选模块不会自动启动；
  - 状态查询不创建控制目录。
- 先运行并确认失败。

#### CORE-0502 建立核心工具注册边界

- 文件：
  - `src/codex/workflow-tools.js`
  - `src/codex/locale.js`
  - `src/codex/skill-entries.js`
- 操作：
  - 定义唯一核心工具注册表；
  - 可选工具不得参与默认 definitions；
  - 核心 registry 不导入 `control/`、`management/` 和 `channels/`；
  - 状态查询和帮助不启动后台服务。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-tools-workflow.test.js test/codex-plugin-protocol.test.js test/codex-core-surface.test.js
```

#### CORE-0503 收敛 Skill 入口

- 文件：
  - `skills/sg-codex/SKILL.md`
  - `skills/sg-codex-project/SKILL.md`
  - `skills/sg-codex-change/SKILL.md`
  - `skills/sg-codex-status/SKILL.md`
  - `assets/codex/AGENTS.specgate.md`
- 操作：
  - 项目 Skill 只处理已有项目接入和基线；
  - Change Skill 只描述 M1-M4 主链路；
  - 删除默认工作流对控制面、Web、飞书和远程审批的依赖说明；
  - 环境 Skill 只检测和阻断，不默认安装；
  - 旧入口不再默认出现。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-onboarding.test.js test/codex-plugin-package.test.js
```

#### CORE-0504 移出非默认模块

- 文件：
  - `plugin.json`
  - `mcp.json`
  - `package.json`
  - `.codex-plugin/plugin.json`
  - `.mcp.json`
- 操作：
  - 控制面、Web、通知、MySQL、模板和环境安装从默认启动和核心发行入口移除；
  - 保留历史和可选代码，不做破坏性删除；
  - 可选模块标记为“非 MVP / 非默认 / 当前发行未验证”；
  - 核心启动不需要任何外部服务。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-plugin-package.test.js test/codex-tools-workflow.test.js
npm run codex:smoke
```

#### CORE-0505 拆分核心测试和 CI

- 文件：
  - `package.json`
  - `.github/workflows/codex.yml`
  - `test/codex-core-*.test.js`
- 操作：
  - 核心测试不需要 MySQL、Web 服务或网络凭据；
  - MySQL/Control 测试仅在可选模块工作流运行；
  - CI 运行核心全量测试、lint、format、pack 和 smoke；
  - 格式检查必须失败即阻断；
  - 不允许用 skip 掩盖环境缺失。
- 验证：

```powershell
npm test
npm run lint
npm run format:check
$env:npm_config_cache = Join-Path $env:TEMP 'specgate-npm-cache'
npm run pack:check
npm run codex:smoke
```

#### CORE-0506 固化发布产物内容

- 文件：
  - `package.json`
  - `README.md`
  - `README.en.md`
  - `docs/quickstart-codex-source.zh.md`
- 操作：
  - 核心发行说明只承诺 MVP 能力；
  - 列出两个人工门、三个委派角色、核心质量门和非目标；
  - 记录可选模块状态和独立启用方式；
  - 文档不宣称未验证的能力。
- 验证：
  - `npm pack --dry-run` 不包含必跑可选依赖；
  - 解包启动不依赖 MySQL；
  - README 中每项通过声明有当前证据。

### 9.4 M5 退出门

- 默认工具集只暴露核心能力；
- MCP 启动不需要外部服务；
- 状态查询不启动控制面；
- 核心测试 0 failed、0 skipped；
- lint、format check、pack check 和 smoke 通过；
- 可选模块仍可读取历史数据，但不参与默认流程；
- 发行文档不承诺非 MVP 能力。

### 9.5 M5 验证命令

```powershell
node --import ./test/setup-temp.mjs --test test/codex-tools-workflow.test.js test/codex-plugin-protocol.test.js test/codex-core-surface.test.js test/codex-onboarding.test.js test/codex-plugin-package.test.js
npm test
npm run lint
npm run format:check
$env:npm_config_cache = Join-Path $env:TEMP 'specgate-npm-cache'
npm run pack:check
npm run codex:smoke
git diff --check
```

### 9.6 M5 失败与回滚

- 核心模块仍导入可选模块：恢复默认注册表，暂停隔离，不删除代码；
- 核心测试仍要求 MySQL：保持 M5 未完成；
- pack 包含可选依赖：恢复上一发行清单，重新拆分；
- Skill 与工具面不一致：阻塞发布，不允许通过说明文档绕过。

---

## 10. M6：真实金丝雀与发布验收

### 10.1 目标

在一个真实现有项目上完成 H1 到 DeliveryRecord 的完整闭环，并证明当前提交自身满足
核心发行质量。

### 10.2 覆盖需求

- RQ-024：核心发行质量；
- AC-MVP-01 至 AC-MVP-10；
- RQ-001 至 RQ-023 的端到端集成验证。

### 10.3 任务

#### CORE-0601 增加完整成功链路测试

- 文件：
  - `test/codex-core-mvp-e2e.test.js`（新增）
  - `scripts/specgate-core-smoke.mjs`（新增）
- 路径：
  - 使用临时 Git fixture 验证机械流程；
  - 不使用 fixture 取代真实项目发布验收。
- 覆盖：
  - H1；
  - spec + plan；
  - test freeze；
  - red baseline；
  - implement；
  - quality；
  - repair；
  - format；
  - post-format regression；
  - review；
  - H3；
  - DeliveryRecord。
- 先写测试并确认失败。

#### CORE-0602 执行失败场景回归

- 文件：
  - `test/codex-core-mvp-e2e.test.js`
- 覆盖：
  - 测试一开始为绿；
  - 修改冻结测试；
  - 修改白名单外文件；
  - quality 失败；
  - 修复上下文缺失；
  - 格式化后回归失败；
  - 旧质量报告被用于 Review；
  - Reviewer 修改工作区；
  - H3 未批准；
  - known issues 未显示。
- 验证：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-core-mvp-e2e.test.js
```

#### CORE-0603 真实金丝雀完整交付

- 输出：
  - `docs/verification/specgate-core-mvp/canary-<commit>.json`
  - `docs/verification/specgate-core-mvp/canary-<commit>.md`
- 操作：
  - 在 M0 登记的现有项目执行一个真实需求；
  - 按 H1 → test freeze → red → implement → quality → repair → format → regression → review → H3 完成；
  - 保存需求版本、commit、命令、退出码、报告路径、审批时间和交付 hash；
  - 记录未执行项和已知风险。
- 完成条件：
  - 全部 AC-MVP-01 至 AC-MVP-10 通过；
  - 第二个开发者只看交付包可以复核；
  - 没有用 fixture 或模型摘要替代真实证据。

#### CORE-0604 核心提交最终验证

- 操作：

```powershell
npm test
npm run lint
npm run format:check
$env:npm_config_cache = Join-Path $env:TEMP 'specgate-npm-cache'
npm run pack:check
npm run codex:smoke
node scripts/specgate-core-smoke.mjs
git diff --check
```

- 完成条件：
  - 全部命令退出码为 0；
  - 核心测试没有 fail、skip、cancel；
  - artifact 和源码 hash 与验证记录一致；
  - 所有未执行项明确列出。

#### CORE-0605 文档与流水线一致性复核

- 文件：
  - `docs/requirements/2026-10-25-specgate-core-reliable-delivery-mvp.zh.md`
  - `docs/plans/2026-10-25-specgate-core-reliable-delivery-mvp-plan.zh.md`
  - `README.md`
  - `CHANGELOG.md`
- 操作：
  - 复核实现与冻结需求一致；
  - 更新实际交付状态和证据；
  - 不修改冻结需求正文；
  - 记录计划任务完成状态和偏离项。
- 完成条件：
  - 需求、计划、实现、测试和发行说明一致；
  - 未完成项明确列出；
  - 没有默认启用非 MVP 能力。

### 10.4 M6 退出门

- 真实项目闭环完成；
- AC-MVP-01 至 AC-MVP-10 全部通过；
- DeliveryRecord 可独立复核；
- 当前提交全部核心检查通过；
- 无核心测试 skip；
- 可选模块不在默认路径；
- 所有真实外部环境结果有证据；
- 用户完成最终发布确认。

---

## 11. 需求到里程碑覆盖矩阵

| RQ     | 主里程碑 | 验收来源                          |
| ------ | -------- | --------------------------------- |
| RQ-001 | M2       | M2 聚焦测试 + M6 真实项目         |
| RQ-002 | M2       | baseline 与 project tools 测试    |
| RQ-003 | M1       | change flow 测试                  |
| RQ-004 | M2       | host input 与 change flow 测试    |
| RQ-005 | M2       | change policy 测试                |
| RQ-006 | M2       | critique 和 change flow 测试      |
| RQ-007 | M1       | approval authority/state 测试     |
| RQ-008 | M2       | plan/core development 测试        |
| RQ-009 | M2       | test designer 和 plan 测试        |
| RQ-010 | M2       | native runner 和 development 测试 |
| RQ-011 | M3       | development diff 测试             |
| RQ-012 | M3       | development findings 测试         |
| RQ-013 | M3       | quality gate 测试                 |
| RQ-014 | M4       | format/core format 测试           |
| RQ-015 | M4       | review/core review 测试           |
| RQ-016 | M1 + M4  | approval 与 review-release 测试   |
| RQ-017 | M4       | delivery record 测试              |
| RQ-018 | M1 + M4  | state、quality、review 测试       |
| RQ-019 | M1       | state kernel 测试                 |
| RQ-020 | M1       | artifact store、host input 测试   |
| RQ-021 | M5       | surface、protocol、package 测试   |
| RQ-022 | M2 + M6  | quality gate 与真实金丝雀         |
| RQ-023 | M0 + M5  | 迁移与发行面测试                  |
| RQ-024 | M6       | 最终命令与打包证据                |

---

## 12. 变更影响控制

### 12.1 允许的高层文件分组

| 文件组                                                                  | 预期变更 |
| ----------------------------------------------------------------------- | -------- |
| `src/codex/state-machine.js`、`storage.js`、`events.js`、`approvals.js` | M1       |
| `src/codex/change-*.js`、`plan*.js`、`host-input.js`                    | M2       |
| `src/codex/development.js`、`quality*.js`、`native-*`                   | M2-M3    |
| `src/codex/format.js`、`review*.js`、`release.js`、`delivery.js`        | M4       |
| `src/codex/workflow-tools.js`、`skills/`、`plugin*.json`、`mcp.json`    | M5       |
| `test/codex-core-*.test.js`、`scripts/specgate-core-smoke.mjs`          | M1-M6    |
| `.github/workflows/codex.yml`                                           | M5-M6    |

### 12.2 默认不修改

- 用户现有未跟踪文件；
- 冻结需求正文；
- 历史验证 JSON；
- 历史交付记录；
- 可选控制面模块，除非 M5 只修改其注册和发行边界；
- 用户业务项目的生产代码，除非该修改属于 M6 金丝雀需求。

---

## 13. 风险登记

| 风险                           | 影响                   | 控制方式                                                 |
| ------------------------------ | ---------------------- | -------------------------------------------------------- |
| 精简状态机破坏旧状态读取       | 已有 Change 无法继续   | 增加只读迁移映射，禁止重写历史                           |
| 可选模块仍被核心导入           | 核心安装需要 MySQL/Web | 静态导入检查和核心 surface 测试                          |
| 文件白名单依赖模型自述         | 越权修改仍可通过       | 只用 Git diff 做机械校验                                 |
| 修复 findings 太长或含敏感信息 | Agent 输入失败或泄露   | 有界摘要、脱敏和 hash 引用                               |
| 格式化后回归成本高             | 流程变慢               | 只在固定提交执行一次全量门，不反复格式化                 |
| Reviewer 身份记录复杂          | Review 难以稳定运行    | 使用现有角色 provider 的 assignment hash 和 session 证据 |
| 历史 MySQL 测试拖累 CI         | 核心测试无法全绿       | M5 拆分核心测试与可选测试                                |
| 真实金丝雀不可用               | 无法证明可交付         | M6 保持 blocked，禁止 fixture 冒充                       |
| 当前用户工作区不干净           | 与实施改动冲突         | M0 登记，冲突时停止并请求处理                            |

---

## 14. 停止条件

出现以下情况必须停止当前里程碑：

- 需要修改冻结需求；
- 必须新增外部数据库、Web 服务或远程通知；
- 核心测试必须 skip 才能通过；
- 文件白名单只能依赖模型自述；
- 修复 findings 无法进入 Implementer；
- 格式化后无法重新执行全量质量门；
- Reviewer 身份无法与报告绑定；
- DeliveryRecord 会出现不可解释的覆盖；
- 真实金丝雀无法提供干净工作区或可执行命令；
- 现有用户改动与任务修改范围重叠。

停止后保留所有 commit、worktree、日志和证据，不自动清理，不自动回滚用户文件。

---

## 15. 最终交付物

MVP 全部里程碑完成后应提供：

```text
核心插件源码
核心测试
默认 MCP/Skill 入口
冻结需求
本执行计划
requirements-mapping 报告
baseline 报告
真实金丝雀验证报告
最终 DeliveryRecord
最终核心测试、lint、format、pack 和 smoke 证据
```

最终报告必须明确区分：

- 核心 MVP 已验证；
- 可选模块保留但未默认启用；
- 真实外部环境已验证；
- 真实外部环境未执行；
- 已知风险；
- 回滚方式。

---

## 16. 计划确认

本计划初始为 `v1.0-candidate`；本次用户明确选择仅执行本计划，现为 `v1.0-approved`。

用户明确确认后：

1. 将状态改为 `v1.0-approved`；
2. 记录确认时间和计划正文 SHA-256；
3. 允许从 M0 开始执行；
4. 在每一里程碑完成前不得进入下一里程碑；
5. 不因计划批准而自动获得提交、推送或发布授权。

---

## 17. 本次执行授权与阶段记录

- 时间：2026-10-25（Asia/Shanghai）；本节仅记录此次会话的授权与已验证事实。
- 授权：用户要求深入分析两份点名文件并“从 M0 开始”实施；在澄清时明确选择“只执行本次点名的 v1.0 需求和旧计划”。因此本次不执行 v2.0 / Delta v1.1；原目录的相关历史文件不改写。
- 用户要求：每一阶段测试验证通过后才交付并更新执行状态。
- 批准前本计划正文规范化 LF SHA-256：`6661bf5486c7f2ba2eb1d9aa8cb280f415e5c4b620b25e851032e5c3ec6a8cea`。
- 用户另行选择独立干净工作区，批准登记金丝雀路径 `E:\ai_workflow\pilot-java-api`；未授权修改其生产代码或替换冻结技术栈。
- 实施分支：`codex/core-reliable-delivery-mvp-v1`；工作区：`E:\ai_workflow\specgate\.runtime\core-mvp-v1-worktree`。
- 本轮开始前用户另行授权本地提交，M0/M1 已提交为 `bfeaeab`；M2/M3 新改动尚未提交，未执行 push / publish。

| 阶段  | 当前结果 | 真实依据                                                                                                                                           |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0    | 已验证   | 24 RQ / 94 AC 映射完整；737 tests / 737 pass / 0 fail / 0 skipped；lint、format check、pack check、MCP smoke 均退出码 0；原目录 868 文件哈希无变化 |
| M1    | 已验证   | 聚焦 97/97；全量 745/745，0 fail / 0 skipped；lint、format、pack、smoke 全部退出码 0，见 M1 验收报告                                               |
| M2    | 已验证   | 聚焦 111/111；全量 758/758；lint、format、pack、smoke 全部退出码 0，见 M2 报告                                                                     |
| M3    | 已验证   | 聚焦 79/79；全量 779/779，0 fail / skipped；lint、format、pack、smoke 均退出码 0，见 M3 报告                                                       |
| M4–M5 | 未开始   | 依次实施、测试和验收，不继承前阶段 PASS                                                                                                            |
| M6    | BLOCKED  | 用户指定项目为 Java 8 + Boot 2.7.18，无 Vue，不满足 AC-022-02；真实完整闭环 NOT_RUN                                                                |

M0 报告：

- [仓库基线](../implementation/2026-10-25-specgate-core-mvp/00-baseline-report.md)
- [24 RQ 与 94 AC 映射](../implementation/2026-10-25-specgate-core-mvp/01-requirements-mapping.md)
- [金丝雀入口与阻断](../implementation/2026-10-25-specgate-core-mvp/02-canary-entry.md)

M0 当前实现仍包含旧可选 MySQL 测试、默认 WorkItem 工具及 bundled mysql2。本次基线通过不代表核心隔离已实现，也不代表 MVP 已交付。两份原始冻结/历史文件在原目录保持不变。

M1 在全部最终验证通过后更新：[M1 可信状态与审批内核验收](../implementation/2026-10-25-specgate-core-mvp/03-m1-acceptance.md)。本次记录只对应当前工作树，不代表最终 DeliveryRecord 或 MVP 已完成。

M2 在全部验证通过后更新：[M2 需求、计划与测试前移验收](../implementation/2026-10-25-specgate-core-mvp/04-m2-acceptance.md)。本轮开始前按用户要求完成本地提交 bfeaeab；M2 新改动尚未提交、未推送。

M3 在全部验证通过后更新：[M3 隔离实现、确定性质量门与有界修复验收](../implementation/2026-10-25-specgate-core-mvp/05-m3-acceptance.md)。M3 新改动尚未提交；本阶段仅完成仓库实现验收，真实宿主与金丝雀完整交付仍未执行。可选 Worker 测试曾有随机端口失败，诊断、重跑和最终全绿证据均保留在报告中。
