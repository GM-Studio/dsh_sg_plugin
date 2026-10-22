# Codex 异步交付、Web 管理台与飞书决策控制实施计划

- 状态：实施、跨环境审查与真实飞书交付接受闭环已完成；选择性提交本功能
- 日期：2026-10-22
- 计划版本：0.1
- 适用宿主：Codex
- 首版范围：一人团队、多项目监控、单项目串行 Change、飞书决策
- 需求来源：
  `docs/requirements/2026-10-22-codex-async-delivery-control-v2.zh.md`
- 需求版本：0.2
- 需求 SHA-256：
  `2A2025EF4B50FF39A70E9EE1CC015DE9542A721CB8ECD6C9235F41364A3DCDA5`
- 既有主需求：
  `docs/requirements/2026-10-22-codex-delivery-mvp-requirements-analysis.zh.md`
- 既有主需求 SHA-256：
  `81171E6A6B8A7E6CB0DA555CA409CEC87278E3A7AAF011DD5460F0916C4B79A8`
- 计划基线提交：
  `5df74a548824344a9179ef1d74dab2f8d5a9c912`
- 当前分支：`sg-codex`

本文档定义实施阶段、任务拆分、依赖、验证和退出条件。用户已批准在临时
`feat` 分支实施；当前变更仍在工作树中，提交、推送和交付继续等待用户确认。

## 实施检查点

- 2026-10-22：用户批准实施并要求在临时 `feat` 分支并行开发。
- 当前分支：`feat/async-delivery-control`。
- P0-P6 的纵向功能已落到工作树，并有 focused tests。
- P7 已完成全量自动化验证、浏览器验收、代码走查和风险记录。
- 真实飞书 webhook、桌面端卡片、TOTP Decision、自动 resume、预算触达和
  Completion 接受已做无副作用 smoke。
- 真实 schema 3 DeliveryRecord 接受和 Feishu “已处理”回执已完成隔离项目
  验证；Windows 真实 Codex 只启动项目绑定的 SpecGate MCP。
- 手机可达 HTTPS App、Feishu 卡片按钮坐标自动化和 macOS 生命周期仍未执行；
  这些项目不得标记通过。
- 用户确认前不提交、不推送、不归档、不交付。

## 1. 冻结记录

### 1.1 需求冻结

本计划按以下需求组合实施：

1. 冻结的异步交付、Web 管理台和飞书决策控制需求 v0.2。
2. 既有商业交付保证需求 2.1。
3. 仓库 `AGENTS.md` 中的 Codex-only、证据、HTTP API 和安全规则。

需求正文变化后，本计划和相关 OpenSpec 工件必须重新评估，不得静默沿用旧计划。

### 1.2 代码基线

在 `5df74a548824344a9179ef1d74dab2f8d5a9c912` 上记录：

- `npm test`：229/229 通过。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `npm pack --dry-run`：通过；使用临时 npm cache，避免本机全局 cache 权限干扰。
- `npm run codex:smoke`：stdio diagnostics 通过。
- `git status --short --branch`：工作区干净。

这些结果是本计划开始前的源码基线，不代表未来异步功能已经验证。

### 1.3 不得破坏的现有能力

- ProjectProfile 和 ProjectBaseline 的建立与校验。
- feature/modify/fix 的统一 ChangeContract。
- H1/H3 的 artifact hash 绑定和单次消费。
- 固定 commit 的 Evidence、VerificationAssessment 和独立 Review。
- DeliveryRecord、内部证据包、客户包和增量再交付。
- 追加式事件链、CAS、锁、崩溃恢复和安全 artifact store。
- 默认串行实现、显式推送和禁止 force push。

## 2. 实施目标

构建一条真正可替用户托管注意力的纵向闭环：

```text
用户创建 WorkItem
  -> 独立 supervisor 启动 Codex execution
  -> AI 自主完成分析、计划、实现、验证和修复
  -> 到达 H1/H3 或异常边界
  -> 保存检查点、释放执行租约
  -> Web 可详细监控
  -> 飞书主动触达
  -> 用户异步 Decision
  -> 服务端校验身份、版本和 artifact
  -> 自动恢复 Codex execution
  -> Outcome 和交付闭环
```

首版不追求：

- 通用 Agent Runtime。
- 任意项目并行 DAG。
- 多租户 SaaS。
- Web IDE 或远程 shell。
- 多消息渠道同时上线。
- 自动批准任何高风险门禁。

## 3. 关键设计约束

1. WorkItem 执行监督器必须独立于 MCP stdio、Web 连接和飞书连接。
2. 人工门禁必须通过停止执行并持久化状态实现，不能长时间占用 MCP/HTTP
   请求等待用户。
3. 现有 `src/codex/state-machine.js` 继续作为活动 Change 的内部阶段权威。
4. WorkItem、ExecutionRun、AttentionRequest、Decision 和 Outcome 使用独立的
   控制领域事件和投影，不复制 ChangeContract、Evidence 或 DeliveryRecord。
5. Web、飞书和 MCP 只调用同一 Decision 服务，不各自修改状态。
6. 通知采用可重试 Outbox；业务 Decision 必须幂等。
7. 飞书身份必须通过受验证应用事件或可信认证会话映射，不能信任消息内容。
8. H1/H3、推送、取消和客户验收必须使用升级认证。
9. 默认本地访问，不默认暴露公网端口；远程访问使用受认证 Relay 或安全隧道。
10. Codex execution 首选稳定的 `codex exec --json` 和 persisted session resume；
    M0 必须验证该能力，失败时才评估 app-server 替代方案。
11. 首版保持每项目单活动 Change。
12. 所有实现按测试先行和纵向切片完成。

## 4. 建议目标架构

```text
                         +----------------------+
                         | Web Management UI    |
                         | attention/control    |
                         +----------+-----------+
                                    |
                         GET queries / POST decisions
                                    |
+------------------+     +----------v-----------+     +------------------+
| Feishu Attention |<--->| Management/Decision  |<--->| Local Control    |
| channel adapter  |     | API                  |     | Store + Outbox   |
+------------------+     +----------+-----------+     +---------+--------+
                                    |                           |
                                    +-------------+-------------+
                                                  |
                                       +----------v-----------+
                                       | Execution Supervisor |
                                       | lease/heartbeat/budget|
                                       +----------+-----------+
                                                  |
                                       +----------v-----------+
                                       | Codex CLI Adapter    |
                                       | exec/resume --json   |
                                       +----------+-----------+
                                                  |
                                       +----------v-----------+
                                       | Project state/evidence|
                                       | Existing SpecGate core|
                                       +-----------------------+
```

### 4.1 控制面与交付面边界

控制面拥有：

- WorkItem。
- ExecutionRun。
- 执行租约和 heartbeat。
- AttentionRequest。
- Decision。
- Notification Outbox。
- Web 投影。

交付面继续拥有：

- ProjectProfile。
- ProjectBaseline。
- ChangeContract。
- Evidence。
- VerificationAssessment。
- H3。
- DeliveryRecord。

控制面只保存交付面对象的 ID、版本和 hash 引用，不复制其业务内容。

### 4.2 建议模块边界

新增逻辑应遵循当前仓库结构，不创建版本命名目录。

建议模块：

- `src/codex/core/control/`
  - 领域模型、事件 schema、纯状态 reducer、预算和身份上下文。
- `src/codex/control/`
  - Control Store、Decision Service、Outbox、Projection、Outcome。
- `src/codex/control/codex-execution-adapter.js`
  - Codex CLI session 启动、事件解析、resume 和进程监督。
- `src/codex/control/supervisor.mjs`
  - 独立后台 supervisor 入口。
- `src/codex/management/`
  - 管理 API、认证、SSE 和静态 Web 资产。
- `src/codex/channels/feishu/`
  - 官方能力适配、身份映射、卡片渲染和回调验证。
- `scripts/specgate-control.mjs`
  - 启动、停止、状态、doctor 和本地 Web 服务 CLI。

具体文件名在 OpenSpec design 阶段确认，但控制逻辑、渠道逻辑和交付逻辑不得混在
同一个大模块中。

## 5. 阶段总览

| 阶段 | 目标                         | 主要依赖  | 退出条件                                  |
| ---- | ---------------------------- | --------- | ----------------------------------------- |
| P0   | 契约冻结、能力探针和设计门禁 | 需求 v0.2 | OpenSpec 工件一致，技术探针有真实结果     |
| P1   | 控制领域模型和持久化         | P0        | 状态、事件、租约和预算测试通过            |
| P2   | Codex Execution Supervisor   | P1        | 关闭 MCP/页面后任务继续，决策边界释放资源 |
| P3   | Web 管理端只读监控           | P1、P2    | 首页、项目、WorkItem、Run、证据视图可用   |
| P4   | 飞书 Attention 与 Outbox     | P1、P2    | 关键节点通知、重试、合并和身份映射通过    |
| P5   | Decision、Web 管理和自动续跑 | P2-P4     | 两端 Decision 一致，Decision 后自动恢复   |
| P6   | Outcome 和交付语义闭环       | P1、P5    | H3、发布、客户接受分离，记录证据完整      |
| P7   | 故障、真实飞书和真实项目试点 | P0-P6     | 恢复、安全、试点指标和发布检查通过        |

依赖图：

```text
P0
 |
 v
P1
 |\
 | +------> P3 read-only UI
 v
P2 ------+
 |       |
 v       |
P4 ------+
 |
 v
P5
 |
 v
P6
 |
 v
P7
```

P3 的只读视图可与 P2/P4 部分并行；P3 的管理动作和 P5 一起验收。

## 6. P0：契约冻结、能力探针和设计门禁

### P0-01 记录实现前基线

- [ ] 重新读取 `AGENTS.md`、需求 v0.2、主需求 2.1 和本计划。
- [ ] 核对需求 hash、HEAD 和工作区状态。
- [ ] 运行并记录：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-state-kernel.test.js
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
git diff --check
```

- [ ] 若基线发生偏离，记录原因，不静默覆盖。
- [ ] 用户明确批准目标分支和是否创建功能分支。

建议分支名：

```text
codex/async-delivery-control
```

### P0-02 创建 OpenSpec 工件

- [ ] 新增 `openspec/changes/codex-async-delivery-control/proposal.md`。
- [ ] 新增
      `openspec/changes/codex-async-delivery-control/specs/async-delivery-control/spec.md`。
- [ ] 新增 `openspec/changes/codex-async-delivery-control/design.md`。
- [ ] 新增 `openspec/changes/codex-async-delivery-control/tasks.md`。

内容约束：

- proposal 只说明问题、范围、非目标和受影响能力。
- spec 只写可观察行为，引用需求 AC。
- design 明确控制面、交付面、存储、Supervisor、Web、飞书和 Decision 边界。
- tasks 与本文档阶段一一对应。

### P0-03 Codex execution 能力探针

探针只读取官方 CLI 帮助和临时项目，不修改产品源码。

- [ ] 验证 `codex exec --json` 可启动非交互任务并输出稳定机器事件。
- [ ] 验证可以从输出中可靠取得 session ID。
- [ ] 验证 `codex exec resume <SESSION_ID>` 可以继续同一上下文。
- [ ] 验证临时项目可以加载 SpecGate 插件和项目 `AGENTS.md`。
- [ ] 验证子进程退出码、stdout JSONL、stderr 和取消行为。
- [ ] 验证 Windows detached child 在父进程退出后仍可继续运行。
- [ ] 验证 supervisor 可以在后续选择新 ExecutionRun 而不是强制 resume。
- [ ] 记录 app-server 是否提供更稳定能力，但不得在无证据时切换实验 API。

P0 技术判断：

- 首选 `codex exec --json` + session resume。
- 如探针证明无法稳定获得 session 或无法加载插件，进入设计评审，再决定是否采用
  app-server。
- 探针生成的文件只进入临时目录，不作为交付证据。

### P0-04 飞书能力探针

- [ ] 验证测试企业应用可以发送文本和交互卡片。
- [ ] 验证回调或事件能提供经过验证的 tenant、app 和用户身份。
- [ ] 验证用户 open_id/union_id 到业务 Owner 的可信映射方式。
- [ ] 验证安全链接和升级认证流程。
- [ ] 验证消息更新、撤回、提醒和失败重试能力。
- [ ] 验证本机无公网入口时的官方长连接或 Relay 方案。
- [ ] 记录能力差异和降级策略。

禁止：

- 把测试凭据写入仓库。
- 把消息正文、昵称或用户自填字段当身份。
- 用未签名的通用 Webhook 直接修改 Decision。

### P0-05 技术决策记录

- [ ] Control Store 的权威位置和跨项目索引位置。
- [ ] 是否复用现有事件链原语，以及如何避免与 Change 状态混用。
- [ ] Codex CLI adapter 与 app-server 的选择。
- [ ] Web 使用最小静态 ES 模块还是引入前端依赖。
- [ ] 飞书官方 SDK 与本仓库依赖预算。
- [ ] H1/H3 升级认证方式。
- [ ] 安全链接、CSRF、会话和本地管理 API 认证。
- [ ] Windows/macOS/Linux supervisor 生命周期。
- [ ] DeliveryRecord schema 演进而非覆盖旧记录。

### P0-06 安全与测试策略

- [ ] 编写威胁模型：伪造、重放、跨项目绑定、旧 artifact、通知洪泛、
      凭据泄漏、离线误报和恶意 Feishu 内容。
- [ ] 定义测试替身：clock、process runner、Feishu transport、secure store、
      Codex execution adapter。
- [ ] 定义测试隔离：临时目录、独立端口、唯一项目 ID 和清理规则。
- [ ] 定义未执行检查的记录格式。

P0 退出条件：

- OpenSpec 工件一致。
- Codex 和飞书探针均有真实结果。
- 关键架构争议已解决或明确记录。
- 用户批准进入 P1。

## 7. P1：控制领域模型与持久化

### P1-01 编写领域失败测试

新增测试建议：

- `test/codex-control-model.test.js`
- `test/codex-control-store.test.js`
- `test/codex-control-projection.test.js`
- `test/codex-control-budget.test.js`

测试必须覆盖：

1. 业务里程碑、执行状态、宿主健康和注意力状态彼此独立。
2. `WAITING_FOR_USER` 不占用执行租约。
3. `OFFLINE` 不能投影为 `RUNNING`。
4. 同一 `attentionKey` 只能有一个当前 revision。
5. Revision 变化后旧 Decision 失效。
6. 重复事件不能产生重复 WorkItem 或 AttentionRequest。
7. 不同项目的相同 ID 不能互相消费。
8. Budget 只能由授权 Decision 提高。
9. 事件重放得到相同投影。
10. Control Store 审计链损坏时 fail closed。

### P1-02 实现领域模型

- [ ] 为 WorkItem、ExecutionRun、AttentionRequest、Decision、Outcome 定义严格结构。
- [ ] 所有文本、集合和 payload 设置长度上限。
- [ ] 所有 ID 使用稳定格式。
- [ ] 定义显式状态转换表，不接受任意 patch。
- [ ] 定义认证强度和 Decision 类型映射。
- [ ] 定义运行预算和时间阈值。
- [ ] 定义模型版本、schemaVersion 和只读旧版本策略。
- [ ] 领域模型只做纯校验和纯转换，不读写文件。

### P1-03 实现控制事件与 reducer

- [ ] 定义稳定领域事件，例如：

```text
work_item.created
work_item.updated
run.leases_requested
run.lease_acquired
run.heartbeat
run.waiting_for_user
run.resumed
run.interrupted
attention.opened
attention.delivered
attention.reminded
attention.superseded
decision.received
decision.consumed
decision.rejected
outcome.ready
delivery.linked
```

- [ ] 使用至少一个版本化 revision 事件处理 AttentionRequest 更新。
- [ ] reducer 不接受客户端提供的派生状态。
- [ ] 事件中包含 actor、来源、时间和前序版本。
- [ ] 所有状态变化均可从事件重放。

### P1-04 实现 Control Store

- [ ] 复用现有路径边界、原子写、锁和 hash 思路。
- [ ] 定义单用户、跨项目 WorkItem 索引。
- [ ] 项目业务证据仍留在项目内。
- [ ] 索引失效时可从项目事件重建。
- [ ] Control Store 路径不得位于用户项目源码可见业务目录。
- [ ] 写入使用 0600/0700 等最小权限。
- [ ] 读取时校验审计链和 schema。
- [ ] 同内容幂等写入，不同内容禁止覆盖。
- [ ] 模拟进程崩溃、WAL 截断和并发写。

### P1-05 实现 Projection

- [ ] 实现 Attention Inbox 投影。
- [ ] 实现项目组合投影。
- [ ] 实现 WorkItem 详情投影。
- [ ] 实现 ExecutionRun 和角色状态投影。
- [ ] 实现 Decision/Notification 历史投影。
- [ ] 实现宿主健康和预算投影。
- [ ] 缓存必须是可丢弃、可重建的。

### P1-06 实现预算模型

- [ ] 墙钟时间。
- [ ] token 或模型使用量。
- [ ] 工具/命令执行时长。
- [ ] 自动修复轮次。
- [ ] 通知和提醒次数。
- [ ] 证据包大小。
- [ ] 软阈值和硬阈值事件。
- [ ] 预算提高必须绑定人工 Decision。

### P1-07 接入现有 Change 状态

- [ ] 读取 `src/codex/state-machine.js` 的版本和 phase，不复制其转换表。
- [ ] Control Store 只保存 `changeId`、版本和 artifact hash 引用。
- [ ] H1/H3 事件由现有审批边界触发 AttentionRequest。
- [ ] Change 状态损坏时，不做乐观投影。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-control-model.test.js test/codex-control-store.test.js test/codex-control-projection.test.js test/codex-control-budget.test.js test/codex-state-kernel.test.js
```

P1 退出条件：

- 控制领域模型和事件 schema 冻结。
- 所有转换和预算有表驱动测试。
- 跨项目索引不会复制交付真相。
- 投影可在损坏缓存后重建。

## 8. P2：Codex Execution Supervisor

### P2-01 编写执行适配器测试

新增测试建议：

- `test/codex-execution-adapter.test.js`
- `test/codex-supervisor-lifecycle.test.js`
- `test/codex-supervisor-recovery.test.js`
- `test/codex-supervisor-heartbeat.test.js`
- `test/codex-supervisor-budget.test.js`

测试必须覆盖：

1. 关闭 MCP stdin 后工作继续。
2. 关闭管理 API 连接不影响工作。
3. 子进程退出码和 JSONL 事件被正确分类。
4. session ID 可持久化并用于 resume。
5. 到达人工门禁后写 `WAITING_FOR_USER` 并释放租约。
6. 决策前不启动新的 AI 消耗。
7. heartbeat 超时进入疑似失联。
8. 进程崩溃后恢复时不重复已提交副作用。
9. Windows detached child 和 Unix child 都受监督。
10. 同一项目不会同时获得两个 Change 租约。

### P2-02 定义 Execution Adapter 接口

接口至少支持：

- `start(input)`。
- `resume(input)`。
- `cancel(runId)`。
- `inspect(runId)`。
- `streamEvents(runId)` 或有界事件读取。
- `context(projectRoot)`。

测试实现同时提供：

- Fake Adapter：确定性事件和可控退出。
- Codex CLI Adapter：真实子进程。

### P2-03 实现 Codex CLI Adapter

- [ ] 以 argv 数组启动，不拼接 shell。
- [ ] 使用项目目录作为 cwd。
- [ ] 通过环境注入受控项目根。
- [ ] 解析 JSONL，只保存白名单事件。
- [ ] session ID 写入 ExecutionRun。
- [ ] 保存 stdout/stderr 的有界、脱敏尾部。
- [ ] 识别正常退出、失败、超时、取消和中断。
- [ ] 不把模型文本直接写入 passed/verified。
- [ ] resume 前重新校验状态、artifact 和 Decision。

### P2-04 实现 Supervisor CLI

建议命令：

```text
node scripts/specgate-control.mjs start
node scripts/specgate-control.mjs status
node scripts/specgate-control.mjs stop
node scripts/specgate-control.mjs doctor
```

- [ ] start 默认后台 detached。
- [ ] status 展示 PID、heartbeat、版本和控制 API 状态。
- [ ] stop 优雅停止并保留 WorkItem。
- [ ] doctor 只读检查配置、store、端口和 adapter。
- [ ] 同一控制实例有单例锁。
- [ ] PID 文件不作为唯一存活证据。

### P2-05 实现租约和 heartbeat

- [ ] 项目级租约。
- [ ] WorkItem 级执行租约。
- [ ] 租约令牌和到期时间。
- [ ] 每 15 秒 heartbeat 的默认配置。
- [ ] 45 秒疑似失联。
- [ ] 90 秒离线/中断。
- [ ] 阈值可配置并在 Web 显示。
- [ ] 时钟注入测试，不能真实等待。
- [ ] 重启时只有确定死亡或租约过期才回收。

### P2-06 实现人工门禁停止语义

- [ ] 捕获 H1/H3/补充信息/预算门禁。
- [ ] 保存稳定检查点。
- [ ] 创建 AttentionRequest。
- [ ] 更新 WorkItem 和 ExecutionRun。
- [ ] 释放项目执行租约。
- [ ] 结束当前同步工具等待。
- [ ] 保留 session 或明确创建新 Run 的规则。
- [ ] 不向 Agent 暴露“可以自动批准”的路径。

### P2-07 实现自动续跑

- [ ] 有效 Decision 产生 resume command。
- [ ] resume 使用确定性幂等键。
- [ ] 首选恢复原 session；不可用时明确新建 Run。
- [ ] resume 前重读最新 artifact hash。
- [ ] 旧 Decision 不触发 resume。
- [ ] resume 失败进入显式失败或阻塞。

### P2-08 实现恢复与中断

- [ ] supervisor 重启扫描未完成 Run。
- [ ] 校验 Control Store 审计和项目状态。
- [ ] 校验 worktree、commit、测试 manifest 和 H1/H3。
- [ ] 不重复已提交 commit、通知、Decision 或 Delivery。
- [ ] 无法判断外部副作用时进入 `INTERRUPTED`。
- [ ] 恢复和放弃均记录审计。

### P2-09 实现跨项目队列

- [ ] 项目索引。
- [ ] 每项目单活动 Change。
- [ ] WorkItem FIFO 或明确优先级。
- [ ] 队列等待原因。
- [ ] 公平性基础指标。
- [ ] 不实现并行 DAG。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-execution-adapter.test.js test/codex-supervisor-lifecycle.test.js test/codex-supervisor-recovery.test.js test/codex-supervisor-heartbeat.test.js test/codex-supervisor-budget.test.js test/codex-state-kernel.test.js
```

P2 退出条件：

- 页面、飞书和 MCP 客户端断开不终止工作。
- 人工门禁不占用执行资源。
- 真实 Codex session 可启动和恢复。
- 崩溃、离线、预算和取消均有显式状态。

## 9. P3：Web 管理端只读监控

### P3-01 定义管理 API 契约

所有查询使用 GET；所有状态变更使用 POST。

建议只读接口：

```text
GET /api/health
GET /api/projects
GET /api/work-items
GET /api/work-items/:workItemId
GET /api/runs/:runId
GET /api/attention
GET /api/decisions
GET /api/notifications
GET /api/evidence/:reference
GET /api/events/stream
```

约束：

- 业务响应 JSON。
- 错误响应 JSON。
- 不返回明文凭据。
- 原始路径按角色折叠或脱敏。
- 静态资产 GET。
- SSE 只读，不触发状态变化。

### P3-02 编写 API 和 UI 契约测试

新增测试建议：

- `test/codex-management-api.test.js`
- `test/codex-management-projection.test.js`
- `test/codex-management-security.test.js`
- `test/codex-management-ui-contract.test.js`

测试必须覆盖：

1. 未认证请求不能读取内部视图。
2. GET 不产生状态变化。
3. 查询不会唤醒或恢复执行。
4. SSE 断开不影响 supervisor。
5. 页面刷新不改变 WorkItem。
6. 响应不泄漏敏感字段。
7. 旧版本查询明确显示 revision。
8. 损坏缓存从权威事件重建。

### P3-03 实现管理服务

- [ ] 默认绑定 localhost。
- [ ] 独立于 supervisor 进程。
- [ ] 只读 Control Store 和项目投影。
- [ ] Content Security Policy。
- [ ] SameSite/secure cookie 或本地会话令牌。
- [ ] CSRF 防护。
- [ ] 请求大小和并发上限。
- [ ] 访问日志脱敏。
- [ ] 优雅关闭。

### P3-04 实现注意力首页

- [ ] 第一屏显示等待用户处理的 AttentionRequest。
- [ ] 风险、阻塞时长、项目过滤。
- [ ] 离线、中断、通知失败和预算异常。
- [ ] 最近重要结果。
- [ ] 普通日志不占首页首屏。

### P3-05 实现跨项目总览

- [ ] 项目就绪和 Baseline 状态。
- [ ] 当前活动 Change。
- [ ] WorkItem 队列。
- [ ] 执行、等待、阻塞、失败和完成统计。
- [ ] 宿主在线状态。
- [ ] 待验收交付。
- [ ] 通知健康摘要。

### P3-06 实现 WorkItem 与 ExecutionRun 详情

- [ ] 业务目标和版本。
- [ ] 用户可见主状态。
- [ ] 业务里程碑。
- [ ] 当前责任人和下一步。
- [ ] AI 角色和当前阶段。
- [ ] 关键命令、退出码、耗时和脱敏尾部。
- [ ] worktree、branch、commit 和集成关系。
- [ ] heartbeat、重试和预算。
- [ ] 检查点和恢复原因。

### P3-07 实现证据下钻

- [ ] AC 与 Outcome 映射。
- [ ] Evidence 状态和引用。
- [ ] skipped、not-run、timeout、cancelled、flaky 和 retry。
- [ ] VerificationAssessment。
- [ ] H1/H3 artifact。
- [ ] DeliveryRecord 和包 hash。

### P3-08 实现前端交互

- [ ] 响应式布局。
- [ ] 技术信息默认折叠。
- [ ] 键盘可访问。
- [ ] 无可见状态时明确空态。
- [ ] 数据刷新不重置筛选和输入。
- [ ] SSE 断线重连有显式提示。
- [ ] 不在浏览器保存敏感 token 到 localStorage。

建议首版使用最小静态 ES 模块，避免为了状态展示引入重型框架。若设计评审认为
复杂视图需要框架，必须单独记录依赖和包体积影响。

验证命令：

```powershell
node --import ./test/setup-temp.mjs --test test/codex-management-api.test.js test/codex-management-projection.test.js test/codex-management-security.test.js test/codex-management-ui-contract.test.js
```

P3 退出条件：

- 用户可以从首页定位待办和异常。
- 可以查看项目、WorkItem、Run、角色、关键命令、证据和交付链路。
- 所有查询只读，页面断开不影响执行。

## 10. P4：飞书 Attention 与 Notification Outbox

### P4-01 编写 Outbox 和通知策略测试

新增测试建议：

- `test/codex-attention-policy.test.js`
- `test/codex-notification-outbox.test.js`
- `test/codex-feishu-adapter.test.js`
- `test/codex-feishu-identity.test.js`

测试必须覆盖：

1. 普通阶段不产生通知。
2. H1/H3/阻塞/离线/预算/客户验收产生通知。
3. 发送失败不阻塞执行。
4. 重试不会重复产生 AttentionRequest。
5. 同一 `attentionKey` 合并。
6. Revision 变化使旧消息失效。
7. 飞书凭据错误时 fail closed。
8. 伪造发送者不能映射为 Owner。
9. 通知中不含绝对路径、凭据和完整日志。
10. 静音不改变状态。

### P4-02 实现 Attention Policy

- [ ] 定义通知类型和紧急度。
- [ ] 默认安静事件白名单。
- [ ] H1/H3 和异常优先级。
- [ ] 5 分钟默认合并窗口。
- [ ] 24 小时默认有效期。
- [ ] 提醒策略。
- [ ] 高优先级绕过静音。
- [ ] 每个结果记录是否需要行动。

### P4-03 实现 Outbox

- [ ] 幂等 `notificationId`。
- [ ] `pending`、`sending`、`sent`、`failed`、`cancelled` 状态。
- [ ] 指数退避和最大尝试次数。
- [ ] 渠道故障隔离。
- [ ] 发送和消息更新审计。
- [ ] 进程重启后继续未完成投递。
- [ ] 不把消息投递成功当作 Decision。

### P4-04 实现飞书 Adapter

- [ ] 凭据通过安全存储或受控环境提供。
- [ ] 直接使用官方 API/受批准 SDK。
- [ ] 请求超时、限流和错误分类。
- [ ] 文本和交互卡片。
- [ ] 发送、更新、撤回和测试通知。
- [ ] tenant/app/user 身份映射。
- [ ] 回调签名和事件验证。
- [ ] 未知事件安全忽略并审计。

### P4-05 实现卡片模板

- [ ] 项目、WorkItem 和类型。
- [ ] 当前结果。
- [ ] 为什么需要人。
- [ ] 风险和证据入口。
- [ ] 动作及后果。
- [ ] 有效期和不处理的后果。
- [ ] 安全链接。

### P4-06 实现合并、提醒和更新

- [ ] 同一 revision 的重复事件不重复发送。
- [ ] 自动事件合并。
- [ ] 到期待处理可提醒。
- [ ] Decision 完成后更新原卡片。
- [ ] Revision 失效后更新或发送简短说明。
- [ ] 飞书不可用时 Web 显示未送达。

### P4-07 接入 Web 渠道健康

- [ ] 应用、机器人和身份映射状态。
- [ ] 最近发送成功/失败。
- [ ] 重试队列。
- [ ] 测试通知。
- [ ] “通知失败不阻塞执行”的显式状态。

P4 退出条件：

- 关键状态能主动触达飞书。
- 普通阶段保持安静。
- 通知故障不阻塞执行。
- 渠道和业务对象边界清晰。

## 11. P5：Decision、Web 管理和自动续跑

### P5-01 编写 Decision 安全测试

新增测试建议：

- `test/codex-decision-service.test.js`
- `test/codex-decision-auth.test.js`
- `test/codex-decision-idempotency.test.js`
- `test/codex-decision-resume.test.js`
- `test/codex-management-actions.test.js`

测试必须覆盖：

1. 消息正文不能成为 Decision。
2. 飞书昵称或伪造 actor 被拒绝。
3. 高风险动作缺少升级认证被拒绝。
4. 旧 WorkItem 版本被 CAS 拒绝。
5. 旧 Attention revision 被拒绝。
6. artifact 变化后审批失效。
7. 重复回调只产生一次 Decision。
8. 跨项目 Decision 不能消费。
9. Web 和飞书动作进入同一服务。
10. 有效 Decision 只触发一次 resume。

### P5-02 定义 Decision API

所有变更使用 POST，ID、版本和幂等键在 JSON body：

```text
POST /api/decisions
POST /api/work-items/pause
POST /api/work-items/resume
POST /api/work-items/retry
POST /api/work-items/cancel
POST /api/work-items/request-changes
POST /api/notifications/resend
```

约束：

- 不接受任意 shell 或命令参数。
- 服务端读取当前版本和 artifact。
- 客户端版本用于 CAS，不得覆盖服务端事实。
- 业务响应 JSON。
- 错误响应 JSON。

### P5-03 实现身份和升级认证

- [ ] 本地 Owner 会话。
- [ ] 飞书受验证应用事件映射。
- [ ] Passkey/WebAuthn 或等效升级认证。
- [ ] H1/H3、推送、取消和客户验收使用升级认证。
- [ ] 认证强度写入 Decision。
- [ ] 认证过期或失败 fail closed。
- [ ] 不在消息或 URL 中放长期凭据。

### P5-04 实现 Decision Service

- [ ] 验证 actor、workItem、revision、version、artifact 和 action。
- [ ] 单一写锁/CAS。
- [ ] 幂等 key 唯一约束。
- [ ] Decision receipt。
- [ ] 消费事件和失败事件。
- [ ] H1/H3 与现有审批 artifact 绑定。
- [ ] 外部消息只作为不可信请求，不直接推进状态。

### P5-05 实现持久审批桥

当前审批 Handle 是进程内能力，不能直接跨 supervisor 重启复用。

必须新增：

- [ ] 服务端签发的持久 Decision receipt。
- [ ] receipt 绑定签名/机密材料、artifact hash、WorkItem 版本和有效期。
- [ ] 只在可信服务内消费。
- [ ] 重启后未消费 Decision 可验证，已消费不可重放。
- [ ] 失败的 WAL/审计事务不得返回可用 receipt。
- [ ] 不降低现有 H1/H3 不变量。

### P5-06 实现自动续跑桥

- [ ] Decision 消费后写入 `resume.requested`。
- [ ] supervisor 监听或轮询控制事件。
- [ ] 同一 Decision 只产生一个 resume command。
- [ ] resume 前重新读取 artifact 和版本。
- [ ] 恢复失败产生 AttentionRequest 或 BLOCKED。
- [ ] Web 和飞书显示同一续跑结果。

### P5-07 实现 Web 受控管理

- [ ] 暂停。
- [ ] 恢复。
- [ ] 取消。
- [ ] 重试。
- [ ] 要求修改。
- [ ] 重发通知。
- [ ] 处理离线或中断。
- [ ] 查看完整审计。
- [ ] 所有动作使用服务端授权和版本 CAS。

### P5-08 跨端一致性

- [ ] 一个渠道 Decision 完成后另一个渠道失效。
- [ ] Web 和飞书展示相同 revision。
- [ ] 消息平台失败不影响本地 Decision。
- [ ] 重复回调审计。
- [ ] 旧链接返回最新状态。

P5 退出条件：

- 飞书和 Web 可完成可控 Decision。
- 高风险动作绑定身份和认证强度。
- 旧动作无法执行。
- Decision 后系统自动续跑。

## 12. P6：Outcome 与交付语义闭环

### P6-01 编写 DeliveryRecord 演进测试

新增或扩展：

- `test/codex-delivery-record-v3.test.js`
- `test/codex-delivery-legacy.test.js`
- `test/codex-outcome-builder.test.js`
- `test/codex-customer-view.test.js`

测试必须覆盖：

1. 旧 schema v2 DeliveryRecord 可只读验证。
2. 新记录必须引用 verificationId、assessment hash、H3 和 contract hash。
3. 已知问题不再固定为空。
4. H3 通过不等于客户接受。
5. 客户拒绝、未查看和接受分别记录。
6. 客户视图与 DeliveryRecord 一致。
7. 重放或重复客户接受不产生重复记录。
8. 旧记录不被重写。

### P6-02 演进 DeliveryRecord

- [ ] 保留旧 schema v2 读取。
- [ ] 新记录使用明确的 schema 演进。
- [ ] 增加 VerificationAssessment 引用。
- [ ] 增加 H3 approval 和 artifact hash。
- [ ] 增加 ChangeContract hash。
- [ ] 增加 knownIssues、unverifiedAreas 和 openRisks。
- [ ] 增加内部包和客户包 hash。
- [ ] 分离发布批准、交付生成和客户接受。
- [ ] 不覆盖旧 deliveryId。

### P6-03 实现 Outcome Builder

- [ ] 从 ChangeContract 和 AC 生成结构化结果。
- [ ] 从 Evidence/VerificationAssessment 生成通过和未验证事实。
- [ ] 从 Review 和风险生成已知问题。
- [ ] 从 DeliveryRecord 生成交付事实。
- [ ] 模型只负责文字渲染。
- [ ] 摘要与事实冲突时标记冲突。

### P6-04 修正 release 语义

- [ ] H3 后进入“允许生成正式交付”，不直接显示客户已接受。
- [ ] 生成 DeliveryRecord 和包后显示“待交付/本地交付可用”。
- [ ] 记录客户发送和回执。
- [ ] 客户接受是独立 Decision。
- [ ] 推送和部署继续独立。

### P6-05 客户视图

- [ ] 业务语言。
- [ ] AC 结果。
- [ ] 已知问题和未验证范围。
- [ ] 升级、回退和联系方式。
- [ ] 内部路径、日志、凭据和 Agent 内容脱敏。
- [ ] 角色可见性由服务端验证。

P6 退出条件：

- Outcome 可追溯到 assessment 和固定 commit。
- H3、交付生成和客户接受完全分离。
- 新旧 DeliveryRecord 均可安全读取。

## 13. P7：故障、真实飞书与真实项目试点

### P7-01 纵向 E2E

- [ ] 创建多项目测试数据。
- [ ] 创建 WorkItem。
- [ ] supervisor 启动 Codex execution。
- [ ] 关闭 MCP、Web 和飞书，任务继续。
- [ ] 到达 H1，释放执行租约。
- [ ] 飞书收到通知。
- [ ] 从安全链接完成 H1。
- [ ] 系统自动 resume。
- [ ] AI 完成实现和验证。
- [ ] 到达 H3。
- [ ] 飞书和 Web 完成 H3。
- [ ] 生成新 DeliveryRecord。
- [ ] 客户接受独立记录。

### P7-02 故障演练

- [ ] supervisor 被杀。
- [ ] Codex child 被杀。
- [ ] 管理 API 重启。
- [ ] 飞书不可用。
- [ ] 通知重复回调。
- [ ] Decision 重复提交。
- [ ] artifact 在审批期间变化。
- [ ] 宿主离线。
- [ ] store 快照落后但 WAL 完整。
- [ ] 预算耗尽。
- [ ] 时钟变化。

### P7-03 真实飞书

- [ ] 使用测试企业应用发送 H1/H3。
- [ ] 验证身份映射和升级认证。
- [ ] 验证通知更新。
- [ ] 验证跨端 Decision。
- [ ] 验证凭据不进入仓库和普通日志。
- [ ] 验证无公网端口模式。

### P7-04 真实 Java/Vue 项目试点

建议至少覆盖：

- 1 个已接入存量项目。
- 1 个新生成项目。
- 1 次 feature。
- 1 次 modify。
- 1 次 fix。
- 1 次自动修复。
- 1 次 H1/H3 飞书决策。
- 1 次离线恢复。
- 1 次客户接受。

记录：

- 提交到开始执行的时间。
- 无需 AI 输出文本的 Web 可读性。
- 飞书通知到 Decision 的时间。
- 人工介入次数。
- 打开 Web 的必要性。
- 离线发现时间。
- 恢复时间。
- 失败和重试次数。
- 预算和成本。

### P7-05 自动化验证

按目标范围运行 focused tests，然后执行：

```powershell
npm test
npm run lint
npm run format:check
npm run pack:check
npm run codex:smoke
node scripts/verify-codex-matrix.mjs
git diff --check
```

如新增 Web 浏览器测试：

- 验证认证。
- 验证首页和详情。
- 验证断线不影响执行。
- 验证无任意命令入口。

### P7-06 安全复核

- [ ] Feishu 回调签名。
- [ ] 身份映射。
- [ ] CSRF。
- [ ] 会话过期。
- [ ] 安全链接一次性/短期。
- [ ] 路径穿越。
- [ ] 日志脱敏。
- [ ] 凭据存储。
- [ ] 请求大小和速率限制。
- [ ] 任意 action 白名单。

### P7-07 产品判断

- [ ] 普通 Change 内部人工注意力请求不超过 2 个。
- [ ] 常规执行不发送飞书进度。
- [ ] 至少一条完整流程通过飞书 Decision 自动完成。
- [ ] 重复 Decision 和重复副作用为 0。
- [ ] 无证据完成和客户接受为 0。
- [ ] 宿主失联 90 秒内识别。
- [ ] 用户不需要手工串联内部 Agent。

若仅增加通知和复杂度，没有降低盯守时间、决策时间或返工成本，应停止扩张
飞书和 Web 功能，先修正核心闭环。

P7 退出条件：

- 纵向流程和故障场景有真实证据。
- 自动化验证全部通过。
- 真实飞书和真实项目试点完成，或明确记录未执行项。
- 产品价值指标有结论。

## 14. 需求追踪矩阵

| 需求                       | 实现阶段   |
| -------------------------- | ---------- |
| FR-001 WorkItem 持久化     | P1         |
| FR-002 独立执行监督        | P0、P2     |
| FR-003 决策边界释放资源    | P2、P5     |
| FR-004 单项目约束          | P2         |
| FR-005 心跳和离线          | P2         |
| FR-006 恢复                | P2、P5     |
| FR-007 预算                | P1、P2     |
| FR-008 AI 自主边界         | P2、P5、P6 |
| FR-009 注意力首页          | P3         |
| FR-010 跨项目监控          | P1、P3     |
| FR-011 WorkItem 详情       | P3         |
| FR-012 执行监控            | P2、P3     |
| FR-013 证据下钻            | P3、P6     |
| FR-014 Decision 审计       | P3、P5     |
| FR-015 Web 受控管理        | P5         |
| FR-016 集成健康            | P3、P4     |
| FR-017 飞书首版            | P4         |
| FR-018 必要触达            | P4         |
| FR-019 默认安静            | P4         |
| FR-020 可行动通知          | P4         |
| FR-021 合并与提醒          | P4         |
| FR-022 原通知更新          | P4、P5     |
| FR-023 结构化 Decision     | P5         |
| FR-024 版本绑定            | P1、P5     |
| FR-025 身份可信            | P4、P5     |
| FR-026 高风险认证          | P5         |
| FR-027 幂等                | P1、P4、P5 |
| FR-028 自动续跑            | P2、P5     |
| FR-029 失效处理            | P1、P5     |
| FR-030 Outcome 来源        | P6         |
| FR-031 完成语义            | P6         |
| FR-032 DeliveryRecord 关联 | P6         |
| FR-033 客户安全            | P6         |
| FR-034 完整审计            | P1-P6      |
| FR-035 运行时诊断          | P2、P3     |
| FR-036 人工介入指标        | P1、P3、P7 |

## 15. 关键风险与处理

| 风险                          | 影响                            | 处理                              |
| ----------------------------- | ------------------------------- | --------------------------------- |
| MCP stdio 生命周期绑定执行    | 关闭会话后任务消失              | P2 独立 supervisor                |
| 审批 Handle 仅进程内有效      | 人工 Decision 后无法跨 Run 授权 | P5 持久 receipt，不降低安全       |
| WorkItem 状态复制 Change 状态 | 双真相和历史冲突                | P1 只保存 Change 引用和版本       |
| Web 查询触发恢复或写操作      | 刷新页面改变业务状态            | P3 GET 严格只读                   |
| 飞书回调被伪造                | 未授权审批或取消                | P4/P5 服务端身份、签名和版本绑定  |
| Notification 反复发送         | 新干扰替代盯守                  | P4 attentionKey、合并和指标       |
| 宿主崩溃后状态永久 RUNNING    | 假执行、假完成                  | P2 heartbeat、租约和离线测试      |
| Supervisor 重复副作用         | 重复 commit、通知、交付         | P1 幂等、P2 恢复、P7 故障演练     |
| H3 等于客户接受               | 交付语义错误                    | P6 schema 演进而非覆盖            |
| DeliveryRecord 遗漏风险       | 客户看到不真实“无问题”          | P6 Outcome builder 和完整风险引用 |
| Codex CLI JSON/session 变化   | Supervisor 不稳定               | P0 探针和 Adapter 隔离            |
| 飞书网络或应用配置不稳        | 通知失败                        | P4 Outbox 与渠道健康              |
| Web UI 膨胀成 IDE             | 范围和攻击面失控                | 固定视图、白名单动作、非目标      |
| 真实时钟测试不稳定            | 假失败/假通过                   | 注入 clock，禁止真实 sleep        |
| 旧数据无法读取                | 历史交付断裂                    | P6 v2 read-only 和迁移测试        |
| Feishu/模型凭据泄漏           | 安全事件                        | P0 威胁模型、P4/P7 安全复核       |

## 16. 执行规则

每个任务必须遵循：

1. 先写失败测试，确认失败原因与任务目标一致。
2. 实现最小变更使目标测试通过。
3. 运行 focused tests 和最近相关回归。
4. 只有测试保持通过时才做必要重构。
5. 每个阶段结束运行一次阶段测试。
6. 无法执行、跳过或失败的检查保持原状态并报告。
7. 生成文件、计划、模型摘要、初始化或打包成功不视为功能验证。
8. 不静默删除、跳过或重试失败测试。
9. 不修改用户未授权的分支、提交或远程仓库。
10. 不新增版本命名目录或旧宿主兼容入口。
11. 所有 HTTP API 查询使用 GET，所有变更使用 POST；update/delete 的 ID 在 JSON
    body 中。
12. 新增依赖前记录用途、包体积、许可、维护状态和替代方案。

## 17. 审批点

### 实施前

用户必须明确批准：

- 本计划。
- 需求 v0.2。
- 实现目标分支和分支命名。
- 是否允许创建功能分支。
- P0 技术探针范围。

### P0 技术门禁

汇报：

- 基线结果。
- Codex CLI session/resume 探针。
- 飞书身份、回调和长连接能力。
- Control Store 路径。
- Web 技术栈。
- 升级认证方式。
- 未解决风险。

用户确认后进入 P1。

### P1/P2 核心门禁

汇报：

- 控制领域事件。
- 状态转换表。
- 心跳和恢复策略。
- 人工门禁释放资源证据。

用户确认后进入 Web、飞书和 Decision 集成。

### 交付前

用户必须确认：

- 真实飞书测试账户和范围。
- 真实项目试点仓库。
- H1/H3 和客户验收的分界。
- 是否允许远程推送。
- 任何未执行、失败或残留风险。

## 18. 明确不纳入本计划

- 任意远程 shell。
- Web IDE 和远程文件管理器。
- 模型内部思维展示。
- 企业级多租户和复杂 RBAC。
- 通用 Agent 调度平台。
- 任意项目并行 DAG 和文件锁调度器。
- 首版多消息渠道。
- 首版生产部署。
- 生产数据库自动回滚。
- 自动批准 H1/H3、推送、取消或客户验收。

## 19. 最终完成定义

1. 用户关闭 Web、MCP 客户端和原 Codex 会话后，WorkItem 继续运行。
2. AI 自主完成普通分析、实现、验证、修复和准备。
3. 只有关键门禁和不可恢复异常产生人工 AttentionRequest。
4. 人工门禁释放执行资源，Decision 后自动续跑。
5. Web 可以详细监控跨项目、WorkItem、Run、角色、阶段、命令、证据和交付。
6. Web 可以执行白名单受控管理，不提供任意命令。
7. 飞书在关键状态主动通知，默认不发送普通进度。
8. Decision 绑定可信身份、认证强度、版本和目标 artifact。
9. 重复、过期和跨项目 Decision 无法执行。
10. H3、交付生成和客户接受保持分离。
11. DeliveryRecord 完整引用 Assessment、H3、风险、证据和客户包。
12. 故障、离线、恢复和通知失败有真实测试证据。
13. focused tests、全量测试、lint、格式、打包、smoke 和试点均有真实结果。
14. 试点证明注意力、决策时间、返工成本或交付风险至少一项显著改善。

在上述审批和证据完成前，不宣布异步交付能力已经完成。
