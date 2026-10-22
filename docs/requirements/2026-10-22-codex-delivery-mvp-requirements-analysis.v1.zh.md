# Codex 商业交付统一 MVP 需求分析

- 状态：历史版本，已由 2.0 需求取代
- 日期：2026-10-22
- 适用宿主：Codex
- 实现基线：`9ec23444ed230e7499ca444c5e06c5d8e0e8f7bb`
- 计划分支：`codex/multi-change-workflow`
- 目标分支：`sg-codex`
- 目标版本：`4.3.2`
- 产品定位：一人全栈商业项目的 AI 交付控制层

## 1. 文档地位

本文档综合以下历史输入：

- `docs/requirements/2026-10-21-codex-multi-change-workflow.zh.md`
- `docs/plans/2026-10-21-codex-multi-change-workflow-plan.zh.md`

前两份文档继续保留用于追溯，但其中关于 `delete`、`refactor` 和单
`changeType` 的实施口径不再适用于当前 MVP。当前需求、范围和实施顺序以本文档为准。

## 2. 产品目标

### 2.1 核心目标

为一至两人的小型开发团队和独立全栈开发者，提供一套稳定、可靠、可验证、可交付、可恢复的 AI 软件开发工作流。

最终用户价值：

1. 从业务需求快速形成可确认的范围、验收标准和工作拆分。
2. AI 自动执行需求、测试、开发、集成、检查和交付准备。
3. 只在关键节点请求人工确认、审批、修改、验证、反馈、取消或退回。
4. 出现失败时只重跑受影响工作项，不推倒整个交付。
5. 每次交付都有真实命令证据、变更清单、风险、发布说明和回滚说明。
6. 客户反馈回来后可以基于上一交付增量执行，而不是重新理解整个项目。

### 2.2 成功定义

统一 MVP 完成后，应满足：

```text
业务需求
  -> 需求分析
  -> 工作项分解
  -> 一次 H1 确认
  -> 安全并行执行 feature/modify/fix
  -> 真实测试和质量检查
  -> 风险例外确认
  -> 一次 H3 最终验收
  -> 本地交付与完整证据包
```

用户不需要管理每个 Agent 的细节，也不需要手工串联
`sg_change -> plan -> test -> development -> quality -> review -> release`。

## 3. 产品定位与差异化

### 3.1 不重复实现宿主已有能力

Codex 等代码 Agent 负责理解代码、修改文件、使用工具和运行命令。SpecGate 不与其竞争代码生成、代码补全或通用多 Agent 能力。

SpecGate 负责宿主编码能力之上的交付控制：

- 需求协议与验收标准
- 交付包和工作项分解
- 依赖图、并行安全与文件归属
- 角色边界和隔离 worktree
- AC、测试、代码、命令证据的固定映射
- 人工门禁和风险升级
- 失败恢复、退回和回滚
- 商业交付物和项目历史

### 3.2 核心差异化

1. **一个需求执行多个安全并行的工作流**
   - 同一交付可以同时包含 feature、modify 和 fix。
   - 仅允许无共享文件或契约冲突的工作项并行。

2. **证据驱动，而不是 Agent 自述驱动**
   - 所有通过状态必须由真实命令、报告、commit 和哈希证明。

3. **风险自适应**
   - 小 Bug 走快车道。
   - API、数据、安全和权限变更走严格车道。

4. **失败可恢复**
   - 失败工作项独立重跑。
   - 用户反馈可以回到需求、计划或实现检查点。

5. **以商业交付结果为终点**
   - 输出不仅是代码，还包括验收证据、变更说明、已知问题、发布和回滚说明。

### 3.3 非竞争力方向

以下内容不作为本 MVP 的主要卖点：

- 更大的提示词库
- Agent 数量更多
- 更复杂的工作流图展示
- 与宿主重复的代码编辑能力
- 企业级项目组合管理
- 通用云部署平台

## 4. 用户和交互边界

### 4.1 目标用户

- 一人完成前后端开发的独立开发者
- 一人负责需求、实现、测试和交付的承接方
- 服务中小型商业项目、二次开发、内部系统和 MVP 的小团队

### 4.2 人工关键节点

MVP 只设三个核心人工节点：

1. **H1 需求确认**
   - 业务目标和非目标
   - 工作项拆分
   - 前后端影响
   - AC 和风险
   - 计划采用的并行方式

2. **风险例外确认**
   - 破坏性 API
   - 数据库或数据语义变化
   - 鉴权、权限、安全或支付逻辑
   - 无法自动安全解决的冲突
   - 超出原确认范围的需求追加

3. **H3 最终验收**
   - 真实测试证据
   - 变更文件和 commit
   - 已知问题
   - 交付包和回滚说明

以下操作也允许用户随时发起：

- 暂停
- 继续
- 取消
- 退回需求
- 退回计划
- 对指定工作项提交反馈
- 仅重跑失败工作项
- 回滚未交付的代码变更

## 5. MVP 范围

### 5.1 纳入范围

统一 MVP 同时包含原 MVP1 和 MVP2 的核心价值：

- `feature`：新增功能
- `modify`：修改现有功能
- `fix`：修复 Bug
- 一个交付需求拆成多个工作项
- 工作项按依赖串行或安全并行
- 前后端按实际受影响范围派发
- H1、风险例外和 H3
- 测试设计、冻结、真实执行和质量检查
- 格式化、Review、归档和本地合并
- 失败工作项恢复
- 用户反馈和退回
- 交付包、变更说明、已知问题和回滚说明
- 基础安全、依赖和敏感信息检查
- 交付指标
- 基于上一交付的增量再交付

### 5.2 暂不纳入范围

- 功能删除 `delete`
- 代码重构 `refactor`
- 自动执行生产部署
- 自动执行生产数据库回滚
- 多客户 SaaS 管理门户
- 多仓库微服务统一编排
- 移动端、小程序和桌面端专用 Agent
- 通用企业治理、合规和成本中心
- 新的软件栈生成能力；继续沿用现有 Java/Vue 基线

## 6. 核心模型

### 6.1 Delivery

一次用户提交的业务需求形成一个 Delivery：

```json
{
  "id": "delivery-...",
  "title": "客户订单导出与筛选调整",
  "request": "客户原始需求",
  "status": "ANALYZING",
  "acceptance": ["AC-001", "AC-002"],
  "workItems": ["WI-001", "WI-002", "WI-003"],
  "risk": "yellow",
  "baselineCommit": "9ec2344",
  "previousDelivery": null
}
```

Delivery 是 H1 和 H3 的审批单元。用户不为每个内部工作项分别审批，除非触发风险例外。

### 6.2 WorkItem

工作项是最小的实现和验证单元：

```json
{
  "id": "WI-001",
  "type": "feature",
  "title": "新增订单导出",
  "sides": ["frontend", "backend"],
  "acIds": ["AC-001"],
  "dependencies": ["contract-freeze"],
  "tests": [],
  "files": [],
  "risk": "yellow",
  "status": "PLANNED"
}
```

约束：

- type 只能是 `feature`、`modify`、`fix`。
- sides 至少包含 `frontend` 或 `backend`。
- 一个工作项可以跨前端和后端，但每个端仍由独立 Agent 执行。
- 工作项必须有 AC、测试映射、文件范围和验证证据。

### 6.3 工作项依赖图

```text
需求确认
  -> 共享契约冻结
  -> 测试冻结
  -> [可并行工作项]
  -> 集成屏障
  -> 真实验证
  -> 最终交付
```

并行必须同时满足：

1. 文件所有权不重叠。
2. 不修改同一个共享契约。
3. 不依赖尚未完成的数据库迁移。
4. 测试资产可独立映射和执行。
5. 不存在前后端字段或响应结构依赖。

不满足时转为串行，不能为了并行而冒险。

### 6.4 文件锁和契约屏障

调度器必须维护逻辑文件锁：

- 同一文件同一时间只能由一个工作项修改。
- API 契约由唯一 owner 修改，其他工作项等待契约冻结。
- 数据模型和迁移必须在依赖它们的实现前冻结。
- 测试设计在实现前冻结，产品 Agent 不得直接修改。

## 7. 变更类型

### 7.1 Feature

输入：

- 新增功能描述
- 目标用户
- 业务价值
- 验收标准
- 前后端影响
- 非功能要求

执行 Agent：

- `specgate_frontend`
- `specgate_backend`

### 7.2 Modify

输入：

- 现有功能
- 目标变化
- 明确不变的行为
- 兼容性要求
- 数据/API/文档影响

执行 Agent：

- `specgate_frontend`
- `specgate_backend`

### 7.3 Fix

输入：

- Bug 描述
- 期望行为
- 实际行为

可选：

- 复现步骤
- 错误日志
- 环境
- 严重级别
- 受影响模块

执行 Agent：

- `specgate_frontend_fixer`
- `specgate_backend_fixer`

Fix 必须先生成能稳定复现问题的失败回归测试，再修复并使测试通过。

## 8. 工作流

### 8.1 完整流程

```text
用户请求
  -> sg_change
  -> AI 需求分析
  -> Delivery/WorkItem 拆分建议
  -> 需求澄清和 Critique
  -> H1
  -> 共享 Contract/Test 冻结
  -> WorkItem DAG 调度
  -> 前后端 Agent
  -> 工作项级 commit
  -> Integration
  -> Tester
  -> Formatter
  -> Reviewer
  -> H3
  -> 归档和本地合并
  -> 交付包
```

### 8.2 快速反馈循环

每个工作项完成后提供简要状态：

- 实际完成了什么
- 修改了哪些文件
- 哪些测试通过
- 哪些风险仍存在
- 是否影响其他工作项

如果工作项失败：

1. 保留 commit、日志和报告。
2. 只把失败工作项返回对应 Agent。
3. 已完成且无依赖变化的工作项不重跑。
4. 如果需求或契约变化导致已有工作项失效，才扩大重跑范围。

### 8.3 退回

用户可以在关键节点提出：

- 退回 H1：修改范围或 AC，重新生成工作项和计划。
- 退回计划：调整依赖、并行策略或文件归属。
- 退回实现：指定工作项和具体反馈，只进入对应修复 round。
- 退回验收：保留当前证据，创建新的修复/修改工作项。

任何退回都必须记录原因，并使受影响的冻结资产失效。

### 8.4 回滚

MVP 支持：

- 回滚未合并的功能分支和 worktree。
- 回滚失败工作项 commit。
- 通过反向 patch 恢复已集成但未交付的代码。
- 生成数据库备份、迁移和回滚说明。

不自动操作生产数据库。

## 9. 风险分级

### 9.1 Green：快速车道

条件：

- 单端修改
- 无 API/数据/安全语义变化
- 已有测试覆盖或可快速补回归测试
- 改动文件边界明确

流程：

```text
Bug 描述 -> 复现 -> 回归测试 -> 修复 -> 真实验证 -> 格式化 -> 快速 Review -> H3
```

仍必须有真实证据，不跳过 H3。

### 9.2 Yellow：标准车道

条件：

- 常规 feature 或 modify
- 有前后端协作
- 有新增接口、页面或业务规则
- 兼容但不影响存量数据

流程使用完整 H1、测试设计、Review 和 H3。

### 9.3 Red：严格车道

条件：

- 破坏性 API
- 数据库字段或语义变化
- 鉴权、权限、安全、支付或关键账务
- 并发、事务或数据一致性高风险
- 大范围跨模块变更

要求：

- 独立风险确认
- 数据备份和迁移/回滚说明
- 更严格的 Review
- H1 和 H3 明确展示风险

## 10. 人工审批与状态

### 10.1 状态流

```text
REQ_INTAKE
  -> REQ_CLARIFYING
  -> REQ_CRITIQUE
  -> H1_PENDING
  -> REQ_FROZEN
  -> PLANNING
  -> TEST_DESIGN
  -> TEST_CASES_FROZEN
  -> DEVELOPING
  -> INTEGRATING
  -> TESTING
  -> FORMATTING
  -> REVIEWING
  -> H3_PENDING
  -> ARCHIVING
  -> ARCHIVED
```

辅助状态：

- PAUSED
- CANCELLED
- BLOCKED
- ROLLBACKING
- ARCHIVED_NOT_PUSHED

### 10.2 审批原则

- H1 审批整个 Delivery 范围和工作项拆分。
- H3 审批最终集成结果和交付包。
- Red 风险在 H1 和 H3 中必须突出显示。
- 审批由可信原生用户交互产生，不能由 Agent、工具参数或环境变量伪造。
- 用户取消时不自动删除 worktree、分支和证据。

## 11. 数据流与持久化

```text
用户输入
  -> Delivery 状态
  -> 需求修订快照
  -> H1 审批记录
  -> 工作项 DAG 与冻结 Plan
  -> 冻结测试和 Contract
  -> 工作项 Agent commit
  -> 集成报告
  -> 质量/格式/Review 证据
  -> H3 审批记录
  -> 归档和本地合并
  -> 交付清单
```

| 数据          | 位置                                            | 约束                          |
| ------------- | ----------------------------------------------- | ----------------------------- |
| 当前 Delivery | `.specgate/codex/state.json`                    | 服务端 CAS 写入               |
| 审计事件      | `.specgate/codex/events.jsonl`                  | 追加式、哈希链                |
| 需求修订      | `.specgate/codex/deliveries/<id>/requirements/` | 保留来源和版本                |
| WorkItem DAG  | `.specgate/codex/deliveries/<id>/plan/`         | 内容哈希绑定需求              |
| 冻结测试      | `.specgate/codex/deliveries/<id>/tests/`        | v1 不可覆盖                   |
| 实现分支      | `.specgate/codex/worktrees/`                    | 按 Delivery/WorkItem/角色隔离 |
| 质量与 Review | `.specgate/codex/deliveries/<id>/`              | 绑定固定 commit               |
| 归档          | `.specgate/codex/archive/<id>/`                 | 不自动删除失败证据            |
| 交付包        | `.specgate/codex/deliveries/<id>/delivery/`     | 验收后生成                    |

## 12. 商业交付包

每个通过 H3 的 Delivery 必须生成：

1. 本次交付范围。
2. 完成的 WorkItem 列表。
3. AC 到测试和运行的映射。
4. 真实命令与结果。
5. 变更文件和 commit。
6. API、数据库和配置变化。
7. 已知问题和剩余风险。
8. 部署/升级步骤。
9. 数据备份和回滚说明。
10. 中英文变更说明。

交付包是后续客户反馈和再交付的基线。

## 13. 增量再交付

客户验收后产生新反馈时：

```text
上一交付基线
  -> 新反馈分析
  -> 只创建受影响的 feature/modify/fix 工作项
  -> 复用历史 AC、测试和项目契约
  -> 执行增量交付
  -> 新增量验收包
```

约束：

- 新 Delivery 必须引用上一交付。
- 未受影响的历史测试必须继续回归。
- 不允许因为增量修复而丢失历史验收证据。
- 新风险需要重新审批。

## 14. 非功能要求

### NFR-001 安全

- 用户输入、日志和 Bug 描述必须脱敏。
- 项目路径、worktree 和归档路径必须做边界检查。
- 不允许由 Agent 提交审批、冻结哈希或用户身份。
- 基础依赖漏洞、密钥和敏感信息检查必须纳入交付证据。

### NFR-002 可审计

- 每个状态转换必须写入事件链。
- 需求、Plan、测试、实现、质量和交付必须可追溯到同一 Delivery 和 commit。
- 未执行、跳过、超时、取消和失败必须显式记录。

### NFR-003 可恢复

- 失败工作项不得阻塞无依赖工作项的完成证据。
- 恢复后必须重新验证受影响的集成和门禁。
- 不得自动清理失败 worktree、分支或报告。

### NFR-004 一致性

- Delivery、WorkItem、Plan、测试、Agent、Review 和交付包必须引用同一 ID。
- 状态写入使用版本 CAS。
- 并行调度不得产生同一文件的并发 owner。

### NFR-005 性能与成本

- 相同失败不应无限重试。
- 已完成工作项不得因无关失败重复执行。
- 记录每阶段耗时、Agent 轮次和失败次数。
- 对大范围测试按风险和工作项影响选择定向回归，最终仍执行必要全量检查。

### NFR-006 向后兼容

- `sg_change_add` 保留为 feature 兼容别名。
- 既有 initialization、test freeze、quality、format、Review 和 archive 证据语义不能削弱。

### NFR-007 一人团队体验

- 默认给出建议决策，不要求用户理解内部 Agent 细节。
- 每次人工交互只展示业务范围、风险、需要决策的差异和证据摘要。
- 同一问题不得反复询问。

## 15. 验收场景

### AC-001 复杂混合需求

- GIVEN 客户需求同时包含新增导出和修改筛选
- WHEN 需求分析完成并进入 H1
- THEN 形成两个工作项，明确类型、前后端、依赖和并行策略

### AC-002 安全并行

- GIVEN 两个工作项无共享文件和契约依赖
- WHEN 测试冻结完成
- THEN 两个工作项并行执行并分别产生 commit

### AC-003 冲突串行

- GIVEN 两个工作项需要修改同一契约
- WHEN 生成计划
- THEN 系统插入串行屏障，不允许并发修改

### AC-004 单端 Bug

- GIVEN Bug 只影响前端
- WHEN 需求确认并冻结回归测试
- THEN 只派发 `specgate_frontend_fixer`
- AND 回归测试由红转绿

### AC-005 双端 Bug

- GIVEN Bug 同时影响前后端
- WHEN H1 和测试冻结完成
- THEN 两个 fixer Agent 并行执行并统一集成

### AC-006 功能修改

- GIVEN 用户要求改变现有行为
- WHEN `sg_change` 识别为 modify
- THEN 复用现有前后端 Agent，更新测试、兼容性和随动文档

### AC-007 部分失败

- GIVEN 一个工作项通过，另一个失败
- WHEN Tester 报告失败
- THEN 只重跑失败工作项和受影响集成，不重跑无关工作项

### AC-008 中途反馈

- GIVEN 执行中用户要求调整验收行为
- WHEN 判断影响需求或契约
- THEN 退回 H1 或计划，使旧测试和旧计划失效

### AC-009 红风险

- GIVEN 修改破坏性 API 或数据库语义
- WHEN H1 和 H3
- THEN 必须显示风险、迁移、备份和回滚说明

### AC-010 最终交付

- GIVEN 所有工作项、集成、测试、格式和 Review 完成
- WHEN H3 通过
- THEN 归档并生成交付包
- AND 只在目标分支本地合并，不自动 push

### AC-011 增量再交付

- GIVEN 客户基于上一交付提出反馈
- WHEN 创建新 Delivery
- THEN 引用上一交付基线，只分析受影响范围，同时执行历史回归

### AC-012 旧入口兼容

- GIVEN 现有调用方仍使用 `sg_change_add`
- WHEN 升级到新版本
- THEN 调用等价于 feature 工作流

## 16. 实施阶段

统一 MVP 作为一个产品版本交付，内部按三个里程碑验证。

### P0：基线、分支与规格

新增 OpenSpec 工件：

- `openspec/changes/codex-delivery-mvp/proposal.md`
- `openspec/changes/codex-delivery-mvp/design.md`
- `openspec/changes/codex-delivery-mvp/tasks.md`
- `openspec/changes/codex-delivery-mvp/specs/delivery-workflow/spec.md`

基线命令：

```powershell
git status --short --branch
git rev-parse HEAD
npm test
npm run lint
npm run format:check
```

### 里程碑 A：Delivery/WorkItem 执行内核

主要改动：

- 新增 `src/codex/change-policy.js`
- 修改 `src/codex/change-add.js`
- 修改 `src/codex/change-tools.js`
- 修改 `src/codex/workflow-tools.js`
- 修改 `src/codex/state-machine.js`
- 修改 `src/codex/plan.js`
- 修改 `src/codex/plan-tools.js`
- 修改 `src/codex/development.js`

必须完成：

1. `sg_change` 统一入口。
2. `sg_change_add` 兼容。
3. Delivery 和 WorkItem 数据模型。
4. feature/modify/fix 输入校验。
5. H1 冻结 Delivery 和 DAG。
6. 单端、双端和混合工作项。
7. 文件锁、依赖屏障和并行调度。
8. red/green baseline 策略。

定向测试：

- `test/codex-multi-change-workflow.test.js`
- `test/codex-multi-change-plan.test.js`
- `test/codex-change-add-flow.test.js`
- `test/codex-plan-core.test.js`
- `test/codex-development-flow.test.js`
- `test/codex-tools-workflow.test.js`

```powershell
node --import ./test/setup-temp.mjs --test test/codex-multi-change-workflow.test.js test/codex-multi-change-plan.test.js test/codex-change-add-flow.test.js test/codex-plan-core.test.js test/codex-development-flow.test.js test/codex-tools-workflow.test.js
```

### 里程碑 B：商业交付保障

主要改动：

- `src/codex/development.js`
- `src/codex/quality.js`
- `src/codex/review.js`
- `src/codex/release.js`
- `src/codex/release-tools.js`
- `src/codex/protocol.js`
- `assets/codex/agents/specgate_frontend_fixer.toml`
- `assets/codex/agents/specgate_backend_fixer.toml`

必须完成：

1. Fixer Agent 路由。
2. 风险分级和快车道。
3. 工作项级恢复和部分重跑。
4. Review 检查范围、兼容性和文档随动。
5. 目标分支可配置，默认本地合并、不 push。
6. 交付包和回滚说明。
7. 基础安全和依赖检查。

定向测试：

- `test/codex-multi-change-routing.test.js`
- `test/codex-native-runner.test.js`
- `test/codex-quality-gate.test.js`
- `test/codex-review-release.test.js`
- `test/codex-format-rework.test.js`

```powershell
node --import ./test/setup-temp.mjs --test test/codex-multi-change-routing.test.js test/codex-native-runner.test.js test/codex-quality-gate.test.js test/codex-review-release.test.js test/codex-format-rework.test.js
```

### 里程碑 C：反馈与增量再交付

主要改动：

- `src/codex/change-add.js`
- `src/codex/review.js`
- `src/codex/release.js`
- `skills/sg-codex/SKILL.md`
- `assets/codex/AGENTS.specgate.md`

必须完成：

1. 用户反馈绑定 WorkItem。
2. 退回 H1、计划或实现的受控状态转换。
3. 失败工作项独立重跑。
4. 基于上一 Delivery 创建增量交付。
5. 交付历史和指标。

定向测试：

- `test/codex-multi-change-workflow.test.js`
- `test/codex-approval-state.test.js`
- `test/codex-state-kernel.test.js`
- `test/codex-review-release.test.js`

```powershell
node --import ./test/setup-temp.mjs --test test/codex-multi-change-workflow.test.js test/codex-approval-state.test.js test/codex-state-kernel.test.js test/codex-review-release.test.js
```

### P4：Agent 安装、Skill 和文档

新增/修改：

- `assets/codex/agents/specgate_frontend_fixer.toml`
- `assets/codex/agents/specgate_backend_fixer.toml`
- `assets/codex/AGENTS.specgate.md`
- `skills/sg-codex/SKILL.md`
- `README.md`
- `README.en.md`
- `CHANGELOG.md`
- `CHANGELOG.zh.md`

安装器测试必须验证 8 个 Agent：

- test designer
- frontend
- backend
- frontend fixer
- backend fixer
- tester
- formatter
- reviewer

### P5：版本和发布

修改：

- `package.json`
- `package-lock.json`
- `.codex-plugin/plugin.json`
- `plugin.json`

版本统一为 `4.3.2`。

### P6：全量验证

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
node scripts/codex-plugin-smoke.mjs
node scripts/verify-codex-matrix.mjs
git diff --check
```

### P7：最终提交与本地合并

1. 功能分支内按里程碑验证。
2. 最终 squash 为一次完整功能提交。
3. 本地合并到 `sg-codex`。
4. 不 push、不发布。

## 17. 交付指标

MVP 至少记录：

1. 需求确认到首次可验证版本的时间。
2. WorkItem 首次通过率。
3. 平均返工轮次。
4. 人工介入次数和耗时。
5. 并行任务占比。
6. 失败工作项恢复时间。
7. 验收后发现的问题数量。
8. 每次交付的命令证据完整率。

这些指标用于后续优化快车道和 Agent 调度，不用于制造虚假的“自动化率”。

## 18. 决策记录

已确定：

1. 只支持 Codex。
2. MVP 支持 feature、modify、fix。
3. 删除和重构暂缓。
4. 一个需求可以拆成多个工作项。
5. 前后端可以并行，但受文件锁和契约屏障约束。
6. Bug 和修改复用对应前后端 Agent；Bug 使用专用 fixer。
7. 所有工作项复用测试、格式化、Review、H3、归档和本地合并。
8. 人工只确认需求、风险例外和最终验收。
9. 默认本地合并，不自动 push。
10. 基于上一交付支持增量再交付。
11. 统一 MVP 合并原 MVP1 和 MVP2 的核心价值。

## 19. 最终完成定义

1. 复杂混合需求可以拆成多个 feature/modify/fix 工作项。
2. 工作项依赖和安全并行由服务端判定。
3. H1 审批整个 Delivery。
4. 工作项可独立失败、恢复和重跑。
5. Bug 有真实红转绿证据。
6. 用户可暂停、取消、退回需求和提交工作项反馈。
7. 最终提供真实测试证据和商业交付包。
8. 交付完成后可以基于反馈增量再交付。
9. 不自动执行生产部署和数据库回滚。
10. 不影响 Codex 现有初始化、质量和审批安全边界。
11. 目标版本为 `4.3.2`。
12. 最终形成一个功能提交并本地合并到 `sg-codex`。
