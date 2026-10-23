# 人在回路 · 异步通知与远端裁决 调研分析报告（v2 修订版）

- 状态：调研报告 + 初步需求分析，**未进入实现**
- 日期：2026-10-23
- 适用宿主：Codex
- 关系：本报告是 `docs/hitl-notification-remote-decision-research.zh.md`（初版）的**修订与补充**。初版聚焦「通知渠道不足」；本版补充初版未覆盖、但对需求最关键的一层：**Codex 进程本身的阻断/恢复机制**。

---

## 0. 结论先行（TL;DR）

用户的需求——「涉及人工决策的部分异步通知、远端裁决、完成后自动继续，而不是让人一直挂在 Codex 前面等」——**在 SpecGate 中已经解决了约 80%**，且解法比初版报告假设的更好。

三条核心结论：

1. **本项目已经用「进程退出 + 会话恢复」绕开了阻塞审批**。
   `src/codex/control/codex-execution-adapter.js:56` 在启动子 Codex 时强制传入 `--config approval_policy="never"`。子进程**永远不会弹出终端审批**，因此也不会挂死。到达人工门禁时，Agent 输出 `SPECGATE_WAITING_FOR_USER:{...}` 标记后**正常退出**；`supervisor.js:37-46` 解析该标记并创建 `AttentionRequest`，同时**释放执行租约**。人工决策后，`supervisor.js:143` 以 `codex exec resume <sessionId> --json` 从同一会话恢复继续执行。
   这意味着：**等待期间没有任何进程、线程或 MCP 调用被占用**——这正是异步的正确形态。

2. **用户痛点不在「审批会不会阻塞」，而在「触达与裁决的最后一公里」**：只有飞书单一出口、消息只能出不能进（按钮只打开网页）、Web 台仅绑定 `127.0.0.1`、4 秒轮询、缺少提醒升级。人不在电脑前就**无法决策**，于是 WorkItem 长期挂在 `WAITING_FOR_USER`——用户感受到的「堵死」实际来自这里。

3. **初版报告存在一个关键技术性误判，必须纠正**：它把「方案二 入站远程决策」设计为「在 IM 内直接调用 `service.decide()`」。这在 SpecGate 控制面**可行**（决策本就是落库的异步事实），但它**不能**用于「打断一个正在跑的子 Codex」。经查证，若将来需要支持**执行中途**的实时审批，Codex 提供了比 tmux/pty 注入干净得多的原生通道：`codex app-server` 的 JSON-RPC 审批请求（详见 §4）。

---

## 1. 全仓库现状扫描（代码级证据）

### 1.1 异步执行骨架（已实现，这是需求的底座）

| 能力                   | 实现位置                                     | 说明                                                                            |
| ---------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| 禁止子进程弹出终端审批 | `codex-execution-adapter.js:56`              | `--config approval_policy="never"`，配合 `--sandbox workspace-write`            |
| 人工门禁信号           | `supervisor.js:23-37` `parseWaitingMarker`   | 解析子进程 JSONL 事件中的 `SPECGATE_WAITING_FOR_USER:`                          |
| 抬升注意力             | `supervisor.js:113-131` `raiseAttention`     | 调 `service.requestAttention`，WorkItem 转 `WAITING_FOR_USER`                   |
| 会话 ID 捕获           | `extractSessionId`                           | 从 JSONL 事件抓 `session_id`/`thread_id`，心跳持久化                            |
| **从同一会话恢复**     | `supervisor.js:143`                          | `item.resume && sessionId → mode='resume'`                                      |
| 恢复命令               | `codex-execution-adapter.js:77-84`           | `codex exec resume <sessionId> --json ...`                                      |
| 控制面决策动作         | `service.js`                                 | `approve / request_changes / cancel / pause / resume / retry / accept_delivery` |
| 文档指纹绑定           | `approvals.js:147-156`、`approval-bridge.js` | 审批绑定 `gate + scope + artifactHash`，文档变更即失效                          |
| 版本 CAS + 幂等        | `service.js:392-451`                         | `expectedVersion`、`attentionRevision`、`idempotencyKey`                        |

**评价**：这套设计的成熟度高于绝大多数开源方案。它把「人工等待」降解为**一次状态迁移 + 一次会话恢复**，而不是一个挂起的进程。初版报告未点明这一点，导致方案设计的目标出现偏移。

### 1.2 两套审批授权（并存，各司其职）

| 授权              | 文件                         | 机制                                                                      | 阻塞性                           |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------- | -------------------------------- |
| 原生 MCP 表单审批 | `src/codex/approvals.js`     | `elicitation/create`，需 `SPECGATE_INTERACTIVE_APPROVAL=1` 与可信用户身份 | **同步阻塞**（会话内交互场景）   |
| 控制面审批桥      | `control/approval-bridge.js` | 查 `CONSUMED` 决策转审批句柄                                              | **不阻塞**（异步 WorkItem 场景） |

注意：`approvals.js` 的同步路径用于**交互式会话**（人在终端旁）。异步交付路径走的是 `approval-bridge.js`。两者按需选用，是正确的分层，不应在本次需求中改动。

### 1.3 触达层现状（**主要缺口所在**）

| 项        | 现状                                    | 证据                                                                               |
| --------- | --------------------------------------- | ---------------------------------------------------------------------------------- |
| 渠道数量  | **仅飞书**                              | `src/codex/channels/` 只有 `feishu.js`、`outbox.js`                                |
| 消息方向  | **只出不进**（按钮 = 打开 Web）         | `feishu.js:143-187`，卡片明确声明「按钮回调不是审批」                              |
| Web 绑定  | `127.0.0.1`                             | `management/server.js:191`                                                         |
| 实时性    | **4 秒轮询**                            | `public/app.js:721/732/794`                                                        |
| 提醒/升级 | **缺失**（`REMINDED` 状态存在但不触发） | `daemon.js` 无 remind tick                                                         |
| 决策 API  | **完整已存在**                          | `server.js:495-507`：`/api/decisions`、`pause/resume/retry/cancel/request-changes` |
| 出站脱敏  | 完善                                    | `feishu.js:3-12` `redact`                                                          |
| 入站防护  | 弱（无回调签名/防重放/SSRF）            | 一旦开放入站即成为攻击面                                                           |

**关键判断**：`/api/decisions` 等**远端裁决能力已经存在且完整**，缺的只是「让手机/IM 能安全地打到这个 API」。这是本次需求的核心杠杆点——不需要新造裁决逻辑，只需要新增受控入口。

---

## 2. 缺口清单（Gap）

| #   | 缺口                        | 影响                                            | 优先级          |
| --- | --------------------------- | ----------------------------------------------- | --------------- |
| G1  | 通知单渠道（仅飞书）        | 用其他 IM 的团队收不到关键节点                  | P0              |
| G2  | 消息只出不进，IM 内不能裁决 | 每次都要跳网页，移动端体验差、决策延迟高        | P0              |
| G3  | 管理台仅本地可达            | **人不在宿主机旁就完全无法决策** ← 用户核心痛点 | P0              |
| G4  | 无实时推送（4s 轮询）       | 状态延迟、流量浪费                              | P1              |
| G5  | 无提醒/升级调度             | 漏看消息 → 门禁静默挂起                         | P1              |
| G6  | 入站防护缺失                | 开放入站后的安全风险                            | P1（须先于 G2） |
| G7  | 无「执行中途」实时审批通道  | 长任务中若需临时授权，只能靠退出/恢复           | P2（观察）      |

---

## 3. 开源生态调研（已核验）

### 3.1 直接对标项目

| 项目                     | 链接                                                                                 | 语言       | ★(约)      | 机制                                                     | 支持 Codex                 | 能否恢复在途执行            | 成熟度                   |
| ------------------------ | ------------------------------------------------------------------------------------ | ---------- | ---------- | -------------------------------------------------------- | -------------------------- | --------------------------- | ------------------------ |
| **HumanLayer**           | [humanlayer/humanlayer](https://github.com/humanlayer/humanlayer)                    | TypeScript | ~11.7k     | Codex **插件**（MCP server + hooks）+ Web/桌面端审批卡片 | ✅ **专门提供 Codex 插件** | ✅ **是**（Codex 等待答案） | **生产级**，活跃         |
| Codex app-server（原生） | [codex-rs/app-server](https://github.com/openai/codex/tree/main/codex-rs/app-server) | Rust       | 仓库 130k+ | JSON-RPC 2.0 over WebSocket，服务端主动发审批请求        | ✅ 一方实现                | ✅ **原生支持**             | ⚠️ 官方标注 experimental |
| codex-slack-bridge       | [BHSDuncan/codex-slack-bridge](https://github.com/BHSDuncan/codex-slack-bridge)      | TypeScript | 0          | app-server 适配 + Slack Socket Mode                      | ✅                         | ✅                          | 个人项目                 |
| codex-relay              | [josephbartlett/codex-relay](https://github.com/josephbartlett/codex-relay)          | TypeScript | 1          | Slack + `codex exec --json` 两阶段                       | ✅                         | ⚠️ 重启阶段而非续跑         | 个人项目                 |
| OpenHands                | [All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)                  | TS/Python  | ~91.6k     | 自有 runtime + `confirmation_mode`                       | ❌ 非 Codex                | ✅ 会话内                   | 生产级                   |
| goose (Block)            | [block/goose](https://github.com/block/goose)                                        | Rust       | ~55.5k     | 本地 UI 权限模式                                         | ❌                         | ✅ 会话内                   | 生产级                   |
| Cline                    | [cline/cline](https://github.com/cline/cline)                                        | TypeScript | ~70.7k     | IDE 内审批                                               | ❌                         | ✅ 会话内                   | 生产级                   |
| Roo Code                 | [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code)                        | TypeScript | ~24.3k     | IDE 内审批                                               | ❌                         | ✅                          | ⚠️ 仓库已归档            |

> ★ 数为 2026-10-23 GitHub API 快照，会漂移。

### 3.2 HumanLayer 的实现范式（最值得借鉴）

依据其 [Codex 插件 README](https://raw.githubusercontent.com/humanlayer/humanlayer/main/apps/riptide-codex-plugin/README.md)（已核验）：

- **架构极简**：一个 Codex 插件 = 一个名为 `humanlayer` 的 MCP server + 调用它的 hooks + skills。**无守护进程、无启动器**，由 Codex 按会话拉起。
- **审批流**：Codex 请求命令前，Web 端卡片显示 Approve/Deny，**Codex 等待答案**；拒绝时的 comment 会回传给模型。
- **超时降级**：9 分钟后无响应（`HUMANLAYER_CODEX_APPROVAL_WAIT`）回落到终端提问。等待上限 540s，**最大 590s**（低于 hook 600s 上限）。
- **可借鉴细节**：「停止」是**拒绝正在等待的审批**实现的——因为 Codex 无法从外部中断 turn；Web 发消息走 `codex queue`；需把 artifacts 目录加进 `writable_roots`。

**启示**：SpecGate 的「退出 + 恢复」模型在**资源占用**上优于 HumanLayer 的「同步阻塞 hook」（后者要占住一个 hook 进程最长 590s）。我们的底座更优，无需更换。

### 3.3 中文生态（飞书/钉钉/企业微信）

**负面结论（已验证）**：未检索到可用的、把飞书/钉钉/企业微信审批机器人与 AI 编码 Agent（含 Codex CLI）打通的开源项目。仅有通用 IM SDK（如 [larksuite/oapi-sdk-python](https://github.com/larksuite/oapi-sdk-python)）。

**判断**：这是一片**真空地带**。SpecGate 若做成「飞书交互卡片 → 控制面 → 恢复执行」的完整闭环，具备差异化价值。代价是需要自建入站回调服务（G6 必须先行）。

---

## 4. Codex 原生能力（本版新增，已核验官方文档）

### 4.1 审批策略（`~/.codex/config.toml`）

```toml
sandbox_mode    = "workspace-write"   # read-only | workspace-write | danger-full-access
approval_policy = "on-request"        # on-request | never | { granular = {...} }
```

重要变更与细节：

- ⚠️ **`approval_policy = "untrusted"` 已废弃**，设置它会导致 Codex/ChatGPT Work **无法启动**。替代方式：`[projects."<path>"] trust_level = "untrusted"`。（[来源](https://learn.chatgpt.com/docs/agent-approvals-security.md)）
- ⚠️ **`--full-auto` 已移除**，改用 `--sandbox workspace-write`。常见博客中的 `suggest/auto-edit/full-auto` 是**旧 UI 标签，不是当前配置值**。
- **粒度审批策略**（对本次需求有用）：

```toml
approval_policy = { granular = {
  sandbox_approval    = true,
  rules               = true,
  mcp_elicitations    = true,   # ← MCP elicitation 允许浮出而非被自动拒绝
  request_permissions = false,
  skill_approval      = false
} }
```

`mcp_elicitations = true` 意味着 **Codex 原生支持 MCP elicitation 浮出**，与 `approvals.js` 的 `elicitation/create` 实现相吻合。

- `approvals_reviewer = "user" | "auto_review"`：可把审批交给自动评审子代理。

### 4.2 非交互执行与恢复

- `codex exec "<task>"`：进度到 stderr，最终消息到 stdout。
- `--json`：JSONL 事件流（`thread.started`/`turn.started`/`item.*`/`turn.completed`）。
- ⚠️ **`codex exec` 默认沙箱是 `read-only`**，需显式 `--sandbox workspace-write`。
- `codex exec resume --last` / `codex exec resume <SESSION_ID>`（[来源](https://learn.chatgpt.com/docs/non-interactive-mode.md)）。

> **重要澄清**：`codex exec resume` **不能**「救活」一个正在阻塞的进程——它是**基于已存历史启动新进程**。这对 SpecGate 不构成问题（我们的设计本就是「退出后恢复」），但它意味着：**若将来要支持执行中途实时审批，`resume` 不是答案**，需要 §4.3。

### 4.3 app-server 审批协议（执行中途实时审批的唯一正解）

（[来源](https://learn.chatgpt.com/docs/app-server.md)，已核验）

```bash
codex app-server --listen ws://127.0.0.1:4500
codex --remote ws://127.0.0.1:4500
```

协议：**JSON-RPC 2.0**（线上省略 `"jsonrpc":"2.0"` 头），每条消息一个 WebSocket 文本帧。服务端主动发起审批请求，客户端应答：

| 方法                                    | 决策取值                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `item/commandExecution/requestApproval` | `accept` / `acceptForSession` / `decline` / `cancel` / `{acceptWithExecpolicyAmendment:{...}}`                                                                           |
| `item/fileChange/requestApproval`       | `accept` / `acceptForSession` / `decline` / `cancel`                                                                                                                     |
| `item/permissions/requestApproval`      | `permissions`（仅授予子集）+ `scope: "session"\|"turn"`                                                                                                                  |
| `mcpServer/elicitation/request`         | `mode:"form"`/`"openai/form"`（`message`+`requestedSchema`）或 `mode:"url"`（`message`+`url`+`elicitationId`）；应答 `{action:"accept", content}` / `decline` / `cancel` |
| `tool/requestUserInput`                 | Accept / Decline / Cancel，含 `autoResolutionMs` 自动超时                                                                                                                |

配套通知：

- `serverRequest/resolved` —— 请求被应答**或**因 turn 结束/中断而清理时发出（客户端据此撤回卡片）。
- `item/completed` —— 带最终状态。

安全（远端必须配置）：

- `--ws-auth capability-token --ws-token-file <path>` 或 `--ws-auth signed-bearer-token --ws-shared-secret-file <path>`，客户端握手带 `Authorization: Bearer <token>`。
- 健康探针 `GET /readyz`、`GET /healthz`；带 `Origin` 头一律 403。
- 过载返回 JSON-RPC `-32001`，需指数退避重试。
- ⚠️ **官方明确标注：app-server 命令与 WebSocket 传输为 experimental，不支持生产负载**。非回环监听在 rollout 期间默认**允许未认证连接**，远端暴露前必须配好 auth。

### 4.4 生命周期 Hooks（另一条可选路径）

事件：`SessionStart` / `PreToolUse` / **`PermissionRequest`** / `PostToolUse` / `UserPromptSubmit` / `Stop` / `SubagentStop` / `PreCompact` / `PostCompact` / `Interrupt`。

`PermissionRequest` 在 Codex **即将请求审批时**触发，可返回：

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": { "behavior": "allow" }
  }
}
```

硬性约束（已核验，直接决定可行性）：

- 多 hook 并发执行，**任一 `deny` 胜出**；否则 `allow` 抑制提示；否则走正常流程。
- **`updatedInput` / `updatedPermissions` / `interrupt` 保留未实现，「fail closed today」** ⇒ **通过 hook 无法修改待执行的输入**。
- `async: true` 明确禁止用于决策：「后台 hook 不能阻塞、批准、重写或控制操作」。
- 默认超时 600s；非托管 hook 需 `/hooks` 人工信任。

### 4.5 上游已知问题（对方案选型有决定性影响）

| Issue                                                        | 状态     | 内容                                                                                         | 对 SpecGate 的意义                  |
| ------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| [codex#39447](https://github.com/openai/codex/issues/39447)  | **open** | `PermissionRequest` hook 与原生提示**串行**：hook 等待期间终端用户被锁死，无法「谁先答谁赢」 | **佐证 SpecGate 选退出/恢复是对的** |
| [codex#23465](https://github.com/openai/codex/issues/23465)  | open     | 需暴露 `approvals_reviewer` 或支持显式 `defer`                                               | 远端 UI 无法判断该由谁处理          |
| [codex#28833](https://github.com/openai/codex/issues/28833)  | open     | 需「是否真的需要人类」信号，否则被动通知误报                                                 | 与 G5 提醒降噪直接相关              |
| [codex PR#17563](https://github.com/openai/codex/pull/17563) | closed   | 引入 `PermissionRequest` hook                                                                | 该项已落地                          |

---

## 5. 技术路线对比与最终选型

| 路线                                   | 能否解阻塞 | 结构化         | 稳定性                            | 资源占用             | 结论                             |
| -------------------------------------- | ---------- | -------------- | --------------------------------- | -------------------- | -------------------------------- |
| **A. 退出 + `exec resume`（现存）**    | ✅ 彻底    | ✅             | ✅ 已用于生产                     | **等待期零占用**     | **保留为主干**                   |
| B. `PermissionRequest` hook 阻塞等远端 | ✅         | ✅             | ⚠️ 锁终端（#39447）               | 占用 hook 进程 ≤600s | 仅作**兼容模式**备选             |
| C. app-server WebSocket 审批           | ✅ 在途    | ✅ 最丰富      | ⚠️ 官方 experimental              | 常驻连接             | **未来升级方向**，现在不引入     |
| D. MCP elicitation 挂起                | ✅         | ⚠️ 扁平 schema | ✅                                | 占用 MCP 调用        | 仅用于自有工具                   |
| E. `tmux send-keys` / pty 注入         | ⚠️         | ❌             | ❌ TUI 非稳定接口，Windows 不可行 | —                    | **不采用**                       |
| F. `codex exec resume` 救活在途进程    | ❌         | —              | —                                 | —                    | **认知纠偏**：不能救活，只能重启 |

**选型结论**：**主干保持路线 A**，不引入 app-server（experimental 风险与当前收益不匹配）。本次需求的全部工作量集中在**触达与远端裁决的最后一公里**（G1-G6）。以 `ATT-1` 记录：若未来需要执行中途实时审批，再评估 C。

---

## 5.5 渠道与部署选型（2026-10-23 补充调研：钉钉 + 云服务器）

> 本节回应两个新增决策输入：**① 钉钉也要接入；② 企业微信似乎需要企业资质；③ 能否整机部署到云服务器。**

### 5.5.1 关键发现：钉钉 Stream 模式直接消解了「远端可达」难题

依据钉钉官方文档 [Server-Side Stream Mode](https://help.dingtalk.io/open/development/introduction-to-stream-mode.md)（已核验）：

```text
"Stream mode ... When you integrate using Stream mode, the DingTalk Open Platform
 communicates with your app through a WebSocket connection ... You do not need
 public network resources such as a server, IP address, or domain."

官方称之为「五零」集成体验：零公网 IP / 零加解密签名与 TLS 证书管理 /
零防火墙白名单 / 零网关部署 / 零内网穿透。
```

它覆盖的能力恰好是本需求需要的全部入站面：

> "It can listen for **Bot callbacks, event subscription callbacks, and registered Card callbacks**."

**对 SpecGate 的意义（重要，需据此调整原方案）**：

| 原方案假设                                      | 钉钉 Stream 下的实际                                | 结论                                                   |
| ----------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| R2「受控远端可达」是 R4 的前置                  | 钉钉方向**无需公网入口**，出站 WebSocket 即完成回调 | 钉钉通道可**跳过 R2**                                  |
| R3 需自建回调签名 / 时间戳 / nonce 防重放 / TLS | 由钉钉平台完成鉴权 + TLS 反向连接                   | R3 的**签名与 TLS 部分可下沉**，仅需保留幂等与业务校验 |
| 入站需暴露 `/api/inbound/:channel` 公网端点     | 改为**出站长连接客户端**主动收                      | 攻击面显著小于自建 webhook                             |

集成约束（官方原文）：① 部署环境**必须能访问公网**；② **仅限企业内部应用与第三方企业应用**；③ 单实例默认 1 条连接，默认上限 50 条。

### 5.5.2 企业微信：需要区分「个人可用」与「企业资质」

用户的判断基本正确，但需要按能力拆开看：

| 能力                                | 是否需要企业资质 | 说明                                                                                                                                                                                      |
| ----------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **只出不进**：群机器人 webhook 推送 | ⚠️ 低门槛        | 创建企业微信（可「个人」注册一个组织）+ 建内部群 + 加群机器人，即可拿到 webhook 发消息。**足以满足 R1（通知触达）**                                                                       |
| **入站回执**：群机器人交互卡片回调  | ❌ 需要企业应用  | 群机器人本身的 webhook 是单向的；要做按钮回传需走**自建应用/智能机器人**，配置回调地址（需可信域名且通常要求备案）                                                                        |
| **智能机器人长连接**                | ❌ 需企业应用    | 企微官方另有 [智能机器人长连接](https://developer.work.weixin.qq.com/document/path/101463) 形态，思路与钉钉 Stream 相同，但**文档为 JS 渲染、本次未能核验其是否免公网**，标注为**未核验** |

> ⚠️ **未核验项**：企业微信「个人/未认证组织能否添加群机器人」的官方明确表述，本次未能从官方文档取得权威引用（官方社区页面为 JS 渲染）。上面表格中「低门槛」基于多方社区实践归纳，**建议以实际注册试跑为准**。

**建议的企微定位**：首版只做 **R1 出站通道**（群机器人 webhook，复用现有 `feishu.js` 的卡片渲染与脱敏逻辑）。**入站裁决不在企微做**——裁决统一引导到 Web 管理台或钉钉卡片。这样既拿到了企微的触达覆盖，又避开了企业资质与回调备案的坑。

### 5.5.3 渠道优先级（据此修订 R1）

| 渠道                    | 出站通知            | 入站裁决                   | 资质门槛                | 结论                  |
| ----------------------- | ------------------- | -------------------------- | ----------------------- | --------------------- |
| 飞书                    | ✅ 已有             | ⚠️ 现为跳转 Web            | 低                      | **保留**              |
| **钉钉**                | ✅                  | ✅ **Stream 模式，免公网** | 低（企业内部应用）      | **P0 首选，完整闭环** |
| 企业微信                | ✅ 群机器人 webhook | ❌ 暂不做                  | 出站低 / 入站需企业资质 | **P1，仅出站**        |
| Telegram / Slack / ntfy | ✅                  | ✅                         | 低                      | P2 按需               |

**修订后的最小闭环**：**飞书 + 钉钉双通道**。钉钉承担「手机上一键裁决」，飞书保留既有能力，企业微信作为纯通知补充。

### 5.5.4 云服务器部署：可行，且与现有设计高度契合

**结论：可以整机部署到云服务器，而且这是推荐形态。** 理由与约束如下。

**契合点（基于本仓库实现）**：

| 特性                         | 证据                                 | 上云后                                     |
| ---------------------------- | ------------------------------------ | ------------------------------------------ |
| 零外部依赖（无 Mongo/Redis） | 文件态 `createFileSessionStore`      | 单机即可跑，无需托管数据库                 |
| 控制面状态机 + 租约 + 心跳   | `service.js`                         | 本身就是为「常驻守护进程」设计             |
| 守护进程循环                 | `control/daemon.js` `pollMs=2000`    | 云上 7×24 常驻，正好补上本地机器关机的空档 |
| 脱敏已完善                   | `redact`                             | 降低公网暴露风险                           |
| 安全响应头 + 限流            | `management/server.js:50-67,325-339` | 已具备公网部署基础                         |

**必须处理的差异（本地 → 云）**：

| #   | 问题                                      | 处理                                                                                       |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| D1  | **Codex 凭证**：云上需要登录态或 API Key  | 首版建议只把**控制面 + 通知**上云，执行留在本地；或云上单独配置凭证并收紧预算              |
| D2  | **代理与 TLS**：公网需 HTTPS              | 前置 Nginx/Caddy 终止 TLS；`trustProxyHttps` 仅在显式配置下开启（`server.js:196,409-414`） |
| D3  | **监听地址**：默认 `127.0.0.1`            | 反转代下仍保持回环，由反代对外；**不要**直接绑 `0.0.0.0` 裸奔                              |
| D4  | **身份校验**：公网后 pairing token 更重要 | 保持一次性 pairing + Cookie + CSRF；建议加 IP 白名单或零信任网关                           |
| D5  | **控制目录持久化**                        | `SPECGATE_CONTROL_HOME` 挂载到持久盘，避免容器重建丢状态                                   |
| D6  | **数据库/文件系统并发**                   | 单实例部署；多实例需先引入分布式锁（当前 `lock.js` 为本地锁）                              |
| D7  | **出站网络**                              | 钉钉/飞书/企微 webhook 与 Stream 均需出网，云安全组放行出站 443                            |

**两种推荐拓扑**：

```text
拓扑 A（推荐首版）：控制面上云，执行留本地
  手机/IM ──▶ 云服务器：SpecGate 控制面 + 管理台 + 通知 Outbox
                    │ (钉钉 Stream 出站长连接收回调)
                    ▼
              本地工作站：codex exec 执行 / 文件系统 / 凭证

拓扑 B（全云）：控制面 + 执行都在云上
  需额外解决：Codex 登录态/API Key、代码仓库克隆、持久盘、预算上限
```

> **建议**：先用**拓扑 A**。它能拿到全部收益（人在手机/IM 上远程裁决、7×24 常驻不漏通知），同时**不把企业代码与 Codex 凭证搬到公网**。待验证稳定后再评估拓扑 B。

**注意**：拓扑 A 需要额外的「云 ↔ 本地」控制通道（本地执行机主动出站拉取任务，仍是`codex exec` 退出/恢复模型）。这是一项**新增工作项**，见 R8。

---

---

> **文档导航**：本文件为**主体部分（§0–§5.5）**：结论、仓库现状、开源调研、Codex 原生能力、技术与渠道选型。

> **部署与架构部分（§5.6–§9 + 附录）见 [hitl-async-remote-decision-research-v2-deploy.zh.md](./hitl-async-remote-decision-research-v2-deploy.zh.md)**，涵盖：
>
> - §5.6 无域名 + 本机自建
> - §5.7 云服务器与 WebUI 上云
> - **§5.8 最终架构：控制面上云 + 执行留本地**
> - §6 需求条目 R1–R11 / C1 与实施顺序
> - §7 风险红线 · §8 待确认问题 · §9 参考链接 · 附录验证状态
