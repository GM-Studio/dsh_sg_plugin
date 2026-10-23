# 人在回路 · 消息通知 + 远端控制决策 调研分析（初版）

目标：把 SpecGate 工作流中"关键节点的人工门禁"做得更扎实、更好用——在 H1/H3、澄清、阻塞、失败、预算、交付验收等节点，既能**主动触达**（消息通知），又能**远程裁决**（远端控制决策），并且不削弱现有的安全模型。

本报告分四部分：现状盘点 → 关键差距 → 开源方案调研 → 可落地实现方案与路线图。所有对现有代码的判断都标注了文件与行号；所有外部方案都标注了仓库、许可证与成熟度，便于后续取舍。

> 结论先行：SpecGate 的人在回路"骨架"已经相当完整（双审批授权、控制面状态机、版本 CAS、幂等键、文档指纹绑定、TOTP step-up、Outbox 重试、Web 管理台、租约释放后自动恢复）。真正的短板集中在**四个方向**：①通知只有飞书单渠道；②消息是"只出不进"，不能在 IM 内直接裁决；③管理台只绑定 `127.0.0.1`，缺少受控的远端可达方案；④Web 端 4 秒轮询、无实时推送，且缺少提醒/升级调度。下面给出对应的落地方案。

---

## 1. 现状盘点（已有能力）

### 1.1 两套审批授权（Approval Authority）

| 授权              | 文件                                   | 机制                                                                                                                            | 适用                                    |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 原生 MCP 表单审批 | `src/codex/approvals.js`               | `elicitation/create` 请求宿主原生表单；要求可信用户身份（`SPECGATE_INTERACTIVE_APPROVAL=1`）；产出进程内不透明句柄（`WeakMap`） | 宿主支持 elicitation 时的同步会话内审批 |
| 控制面审批桥      | `src/codex/control/approval-bridge.js` | 在控制状态里创建 `AttentionRequest` 并返回 `WAITING_FOR_USER`；待 Web/飞书产生 `Decision` 后，回查 `CONSUMED` 决策转成审批句柄  | 异步 WorkItem、跨 MCP/页面/IM 继续运行  |

两者共享同一组安全不变量（`approvals.js:82-104`、`approval-bridge.js`）：

- **文档指纹绑定**：审批绑定 `gate + scope + artifactHash`，文档变化即 `APPROVAL_ARTIFACT_CHANGED` 失效（`approvals.js:147-156`）。
- **一次性句柄 + 消费审计**：句柄状态机 `active → consuming → consumed/invalidated`，消费前必须持久化审计（`approvals.js:281-319`）。
- **门禁绑定**：`authorizeGate` 只允许 `H1 → REQ_FROZEN`、`H3 → ARCHIVING`（`approvals.js:326-351`）。
- **TTL 与 nonce**：审批 10 分钟过期（`APPROVAL_TTL_MS`），256 位随机 nonce 防重放。

### 1.2 控制面状态机（`src/codex/control/service.js`）

`createControlService` 是核心，管理 `WorkItem / ExecutionRun / AttentionRequest / Decision / Notification / Lease / Project`，并提供：

- **版本 CAS**：每次变更校验 `expectedVersion === item.revision`，冲突返回 `VERSION_CONFLICT`（`service.js:194-231`、`470-576`）。
- **幂等键**：`Decision` 以 `idempotencyKey` 去重，键被复用但内容不同则 `IDEMPOTENCY_CONFLICT`（`service.js:392-420`、`1088-1112`）。
- **AttentionRequest 生命周期**：`OPEN → DELIVERED → REMINDED → DECIDED / SUPERSEDED / EXPIRED`；新版本自动作废旧版本（`service.js:293-390`）。
- **Decision 动作**：`approve / request_changes / cancel / pause / resume / retry / accept_delivery`，并按动作迁移 WorkItem 状态、写 `resume`（`service.js:470-576`、`1067-1217`）。
- **执行租约**：按 `projectId` 持有租约，进入等待用户时**释放租约**（`service.js:358-366`）；心跳续租、超时 `reconcile` 判定 `SUSPECT/OFFLINE` 并自动开 `OFFLINE` 注意力（`service.js:748-969`）。
- **预算**：`wallClockMs / maxModelTokens / maxToolCalls / maxRepairRounds` 等，超限中断并转 `BUDGET` 注意力（`service.js:69-106`、`supervisor.js:160-309`）。

### 1.3 通知与 Outbox（`src/codex/channels/`）

- **飞书通知器** `feishu.js`：`createFeishuNotifier({ webhookUrl })` 仅暴露 `send(message)`；渲染交互卡片（`renderFeishuCard`），**按钮只打开认证管理页**，卡片明确声明"消息文字和按钮回调不是审批本身"（`feishu.js:178-187`）；对密钥/本地路径做脱敏（`redact`，`feishu.js:3-12`）；仅允许 HTTPS webhook（`validateFeishuWebhook`）。
- **通知 Outbox** `outbox.js`：`createNotificationOutbox({ store, notifier })` 提供**持久化重试**（指数退避、`maxAttempts=8`、租约式 `claimPendingNotifications`、`dedupeKey` 去重）。`createAttentionNotifier` 负责拼管理端 URL（`#attention=<id>&token=<pairing>`）并区分 `attention` / `resolution` 两类消息。
- **接线**：`daemon.js:161-285` 用单一 `notifier: feishu` 驱动 Outbox，`drain({ maxBatches: 20 })` 周期性投递。

### 1.4 Web 管理台（`src/codex/management/server.js`）

- 原生 `node:http`，默认绑定 `127.0.0.1`（`server.js:191`）。
- **配对与会话**：一次性 `pairingToken`（SHA-256 存储）→ `specgate_session` Cookie（`HttpOnly; SameSite=Strict`）+ CSRF token；会话可持久化到 `web-sessions.json`，重启后 TTL 内仍可用（`server.js:215-427`）。
- **安全头与限流**：CSP、`X-Content-Type-Options`、`Referrer-Policy`、`Cache-Control: no-store`；按 IP 令牌桶限流（`server.js:50-67`、`325-339`）。
- **脱敏**：`sanitizeForWeb` 剥离 `projectRoot/webhookUrl/credentials` 等私有键并脱敏文本（`server.js:76-117`）。
- **路由**：查询 `GET /api/{health,projects,work-items,runs,attention,notifications}`；变更 `POST /api/{decisions,work-items/*,notifications/resend,deliveries/accept}`（`server.js:15-25`、`429-514`）。
- **step-up**：变更可带 `stepUpCode`，经 `services.verifyStepUp` 校验 TOTP 后把 `authLevel` 提到 `step-up`（`server.js:468-481`）。
- **前端**：`public/app.js` 每 4 秒 `setInterval(refresh, 4000)` **轮询**（`app.js:721/732/794`），无 SSE/WebSocket。

### 1.5 监督者与恢复（`src/codex/control/supervisor.js`）

`createControlSupervisor.runOnce` 领取 WorkItem → 通过 `adapter.run` 驱动子 Codex → 心跳续租 → 解析子进程输出里的 `SPECGATE_WAITING_FOR_USER:{...}` 标记（`supervisor.js:23-37`）→ 调 `requestAttention` 开注意力并**释放租约**；决策产生后 `service` 写 `resume`，监督者以 `mode:'resume'` + 原 `sessionId` 恢复会话（`supervisor.js:39-75`、`133-336`）。

### 1.6 Step-up（`src/codex/control/step-up.js`）

自实现 RFC 6238 TOTP（HMAC-SHA1、base32、`timingSafeEqual`、±1 时间窗）。`attentionNeedsStepUp(type, action)` 规定：**高风险注意力类型（H1/H3 审批）或 `cancel` / `accept_delivery` 动作**必须 step-up（`core/control/domain.js:262-264`）；`pause/resume/retry/request_changes` 只需会话级。

### 1.7 小结

现有系统在"安全的人工门禁"这件事上已经做到了工业级：**证据绑定、版本 CAS、幂等、租约、审计、step-up、脱敏**一应俱全。它更接近 Mission Control / LangGraph 这类成熟控制面的设计，而不是简单的"发个消息"。因此本报告的定位是**在不动安全底座的前提下，补齐触达与远程裁决的"最后一公里"**。

---

## 2. 关键差距（Gap）

| #   | 差距                                                                                     | 证据                                                                 | 影响                                                         |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| G1  | **通知单渠道**：只有飞书                                                                 | `daemon.js:172` `notifier: feishu`；`channels/` 仅 `feishu.js`       | 团队用 Telegram/Slack/企业微信/钉钉/邮件就收不到关键节点通知 |
| G2  | **消息只出不进**：IM 按钮只打开网页，不能在 IM 内直接裁决                                | `feishu.js:143-187`（button.url=管理页）                             | 每次决策都要跳到 Web 台，移动端/弱网体验差、决策延迟高       |
| G3  | **管理台仅本地可达**：绑定 `127.0.0.1`，无受控远端暴露                                   | `server.js:191`；无 tunnel/relay 代码                                | 人不在宿主机旁时无法"远端控制"，与需求直接冲突               |
| G4  | **无实时推送**：Web 端 4 秒轮询                                                          | `app.js:721/732/794`                                                 | 状态延迟、无谓请求；多端协同体验弱                           |
| G5  | **无提醒/升级调度**：`REMINDED` 状态存在但不会自动重发                                   | `daemon.js:197-208`（`attention.notificationId` 一旦置位即不再通知） | 用户漏看消息 → 门禁长期挂起，无人升级                        |
| G6  | **入站面 SSRF/注入加固不足**：出站脱敏完善，但缺少针对"外部回调/ webhook 入站"的统一防护 | `management/server.js` 有 CSP/限流，但无入站 CIDR 阻断/注入扫描      | 一旦开放入站决策通道（G2），攻击面扩大                       |

> G2/G3/G6 是一组：**要支持"在 IM 里远程点一下就决策"，就必须同时解决"管理台/回调如何安全可达"和"入站如何加固"**。这是本报告方案设计的核心约束。

---

## 3. 开源方案调研

按能力分层。每项标注仓库、许可证、成熟度与"对 SpecGate 的可借鉴点"。

### 3.1 通知投递层（解决 G1）

| 方案                                               | 仓库 / 许可证 / 热度                        | 形态                                       | 可借鉴点                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apprise**                                        | `caronc/apprise` · BSD-2 · ~16.4k★          | Python 库 + CLI + 可选 API 服务            | 一套 URL 语法统一 **80+ 渠道**（Telegram/Discord/Slack/ntfy/Gotify/Pushover/邮件/Matrix…）。**只出不进**（无入站）。适合"多渠道扇出"的抽象参考        |
| **ntfy**                                           | `binwiederhier/ntfy` · Apache-2.0 · ~29.8k★ | 单个 Go 二进制 + Web UI + 原生 App         | HTTP pub/sub，`curl` 即可发；**SSE/WebSocket 实时订阅**；优先级/标签/附件；**Action 按钮可触发 HTTP 请求**；主题级 ACL。自托管推送的首选              |
| **Novu**                                           | `novuhq/novu` · MIT · ~38.8k★               | 多服务（API+Worker+Web，需 MongoDB+Redis） | 完整编排：模板引擎、**digest 聚合降噪**、订阅者偏好、**provider fallback 链**、in-app React 组件。功能强但**重依赖**，与 SpecGate"本地零依赖"取向冲突 |
| **Bark / PushDeer / Server酱 / Gotify / Pushover** | 各自开源/自托管                             | 移动推送                                   | 面向个人/移动端的轻量推送渠道，可作为飞书之外的补充通道                                                                                               |

**判断**：不引入 Novu（重依赖）。**借鉴 Apprise 的"渠道适配器 + 统一 URL 配置"抽象**，把现有 `notifier.send()` 升级为可注册的多渠道路由；**把 ntfy 作为"零配置自托管推送 + 实时订阅 + 可动作按钮"的重点集成对象**；把 Novu 的 **digest 聚合**与 **fallback 链**理念吸收进现有 Outbox（降噪 + 高可用）。

### 3.2 入站远程决策层（解决 G2）

| 方案                            | 仓库 / 许可证                                     | 入站机制                                                                                                                              | 可借鉴点                                                                                                   |
| ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Telegram 审批按钮插件**       | `JairFC/openclaw-telegram-approval-buttons` · MIT | Inline Keyboard（Allow Once / Always / Deny）；`callback_data` → 决策；**决策后编辑原消息移除按钮**；过期清理；零依赖（Node `fetch`） | 最贴近 SpecGate 需求的**完整入站范式**：一次性按钮、自动 resolve、过期处理、优雅降级（按钮失败回退纯文本） |
| **Slack Block Kit**             | 同上插件含 Slack 支持                             | Block Kit 按钮 → interaction payload                                                                                                  | 与 Telegram 同一套"发送→回调→编辑消息"闭环                                                                 |
| **企业微信（WeCom）智能机器人** | 官方文档 `主动回复消息`                           | 交互事件回调携带 **`response_url`**，可主动更新卡片                                                                                   | **中文生态里少数支持入站回调**的 IM；适合国内团队；卡片可"点一下就地更新为已处理"                          |
| **钉钉 ActionCard**             | 官方文档                                          | ActionCard 按钮 + 回调                                                                                                                | 国内另一主流渠道，卡片式交互                                                                               |
| **zeroclaw HITL 提案**          | `zeroclaw-labs/zeroclaw#1865`                     | 挂起执行循环，等待 inline 按钮 `callback_query`，记录决策后恢复                                                                       | 与 SpecGate"释放租约→决策→恢复"完全同构，可作范式印证                                                      |

**判断**：入站决策**技术可行且范式成熟**。但必须分层授权（见 §5 方案二）：**低/中风险动作（pause/resume/retry/request_changes）可走"签名回调"直接裁决；高风险动作（H1/H3 approve、cancel、accept_delivery）仍强制 Web + TOTP step-up**，与 `attentionNeedsStepUp` 现有策略一致。

### 3.3 HITL 编排范式（印证现有设计 + 补强）

| 方案                             | 来源                                                      | 关键点                                                                                                                                                                        | 对 SpecGate                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **LangGraph `interrupt/resume`** | `docs.langchain.com/oss/python/langgraph/interrupts`      | `interrupt()` 暂停并**checkpoint 持久化**；`Command(resume=...)` 恢复；`response_schema` 渲染**类型化表单**；规则：**interrupt 前的副作用必须幂等**、每节点只调一次、不可乱序 | SpecGate 的"释放租约 + `resume` + 文档指纹"已是同构实现。可借鉴 **`response_schema`**：让 `request_changes`/`BUDGET` 等注意力携带**结构化输入 schema**，前端/IM 渲染类型化表单而非自由文本 |
| **OpenAI Agents SDK HITL**       | `openai.github.io/openai-agents-python/human_in_the_loop` | 工具声明"需审批"；`RunState` 序列化暂停态，决策后恢复                                                                                                                         | 印证"暂停态可序列化、跨进程恢复"的正确性                                                                                                                                                   |
| **HITL 治理指南**                | agentdraft / neuraltrust / agentic-patterns               | 把不可逆/高影响动作前置审批；**payload 证据 + 仪表盘裁决**；对受监管场景做**双重校验**                                                                                        | 支撑本报告"高风险双通道（IM 触达 + Web/TOTP 裁决）"的红线设计                                                                                                                              |

### 3.4 远端安全访问层（解决 G3）

| 方案                                 | 形态           | 特点                                                            | 适用                                          |
| ------------------------------------ | -------------- | --------------------------------------------------------------- | --------------------------------------------- |
| **Cloudflare Tunnel（cloudflared）** | 出站-only 隧道 | 无需开入站端口/公网 IP；可叠加 **Zero Trust Access** 做身份门禁 | 想让管理台被手机/异地安全访问，且已有 CF 域名 |
| **Tailscale Funnel / tailnet**       | 私有 mesh      | 基于设备身份，默认私网；Funnel 可选择性公网暴露                 | 个人/小团队，强身份、零公网面                 |
| **ngrok**                            | 临时隧道       | 即开即用、临时 URL                                              | 演示/临时远程，不建议长期承载审批             |

**判断**：SpecGate 不应自己实现隧道，而应**提供"受控集成 + 加固默认值"**：`validateManagementUrl` 已要求远端 URL 必须 HTTPS（`feishu.js:29-45`），可在此基础上**登记隧道公网 URL 作为 `managementBaseUrl`**，并强烈建议在隧道前置 Zero Trust/身份门禁。参考 happier.dev 关于 Claude Code/Codex 仪表盘手机访问的对比（信任边界、鉴权、HTTPS、运维复杂度）。

### 3.5 自托管控制面参考（解决 G6 + 印证架构）

**Mission Control**（`builderz-labs/mission-control` · MIT · ~5.2k★）：自托管 agent 控制面，**SQLite WAL、零外部依赖**、任务看板、**原子领取**（`UPDATE … WHERE status='assigned'` 防重复派发）、多框架适配器。其**安全面板**值得直接对标：

- **Secrets scanner**：正则检测 AWS key / GitHub token / JWT / DB URI；
- **Injection guard**：对 workflow/spawn/chat 输入做提示词与命令注入扫描；
- **SSRF 加固**：阻断私有网段 CIDR（`10/8`、`172.16/12`、`192.168/16`、`127/8`、`169.254/16`）+ 主机白名单；
- **限流**：按 agent / 按 IP；**供应链**：依赖更新冷却期。

**判断**：SpecGate 的租约领取已等价于"原子领取"，出站脱敏已较完善；**缺口在入站**——一旦开放 IM 回调/ webhook，应补 **SSRF 私网阻断 + 回调签名校验 + 注入扫描 + 入站限流**。

---

## 4. 设计原则（贯穿所有方案）

1. **不动安全底座**：文档指纹绑定、版本 CAS、幂等键、step-up、审计、脱敏一律保留；新通道只是"新的触达/入口"，最终仍汇聚到 `service.decide()` / `decisions.*`。
2. **通知≠审批**：延续飞书卡片现有声明。IM 内可完成的是**低/中风险裁决**；高风险裁决必须 Web + TOTP。
3. **分层授权**：按 `attentionNeedsStepUp` 把动作分两级，通道能力（`outbound` / `inbound_decision` / `step_up_capable`）声明式描述。
4. **本地零依赖优先**：默认不引入 MongoDB/Redis；新能力尽量落在现有 `node:http` + 文件存储 + Outbox 上。
5. **失败可见、可降级**：任一渠道失败不阻断其他渠道；入站按钮失败回退到"打开 Web"；未执行/未验证如实记录（呼应 AGENTS.md）。

---

## 5. 可落地实现方案

每个方案给出：**改动点（文件）→ 接口/数据结构 → 安全考量 → 验收**。按可独立交付的小步拆分。

### 方案一：多渠道通知适配器（解 G1，低风险，优先）

**改动点**

- 新增 `src/codex/channels/registry.js`：定义 `Notifier` 契约 `{ id, capabilities, send(message, ctx) }`，与现有 `feishu.js` 的 `{ send }` 兼容。
- 新增渠道：`ntfy.js`（HTTP POST + `Priority/Tags/Actions` 头）、`telegram.js`（Bot API `sendMessage`/inline keyboard）、`slack.js`（Block Kit）、`wecom.js`/`dingtalk.js`（群机器人 webhook）、`webhook.js`（通用出站，HMAC 签名）、`email.js`（可选，SMTP）。
- `createNotificationOutbox({ store, notifier })` 的 `notifier` 支持传入**路由/扇出 notifier**：按配置把同一 `AttentionRequest` 投递到多个渠道，任一成功即算送达（或按策略 all/any）。
- `daemon.js:161-177`：由单一 `feishu` 改为**按配置构建渠道列表**（配置来自控制面 config / 环境变量）。

**配置（示意，零依赖、URL 风格借鉴 Apprise）**

```jsonc
// control config: notifications.channels
[
  { "id": "feishu", "type": "feishu", "webhookUrl": "https://open.feishu.cn/..." },
  {
    "id": "ntfy",
    "type": "ntfy",
    "url": "https://ntfy.example.com/specgate-<topic>",
    "priority": "high",
  },
  {
    "id": "telegram",
    "type": "telegram",
    "botToken": "...",
    "chatId": "...",
    "capabilities": ["outbound", "inbound_decision"],
  },
  {
    "id": "wecom",
    "type": "wecom",
    "webhookUrl": "https://qyapi.weixin.qq.com/...",
    "capabilities": ["outbound", "inbound_decision"],
  },
]
```

**安全**：沿用 `redact` 脱敏；渠道密钥只存控制面配置、经 `sanitizeForWeb` 不出现在 Web 响应；出站 URL 强制 HTTPS（复用 `validateFeishuWebhook` 思路，泛化为 `validateOutboundUrl`）。

**验收**：单测覆盖每个渠道的 `send` 成功/失败/超时；Outbox 扇出在部分渠道失败时仍按策略完成；`npm test` 全绿。

### 方案二：入站远程决策（解 G2，中风险，需与方案三/六配套）

**目标**：在 Telegram/Slack/企业微信里点按钮即可完成**低/中风险**裁决；高风险仍跳 Web + TOTP。

**改动点**

- 新增 `src/codex/management/inbound.js`：接收 IM 回调（`POST /api/inbound/:channel`），做**签名校验 + 时间戳/nonce 防重放 + 入站限流**，解析出 `{ attentionId, revision, action, artifactHash, idempotencyKey, channelActor }`。
- 回调令牌：在 `createAttentionNotifier.notify` 生成消息时，附带**一次性签名回调 URL/`callback_data`**，绑定 `attentionId + revision + artifactHash + action`（HMAC，密钥存控制面）。参考 openclaw 插件的 `callback_data` 与"决策后编辑消息"。
- 授权判定：`inbound` 收到后先查 `attentionNeedsStepUp(type, action)`：
  - **不需要 step-up**（pause/resume/retry/request_changes）→ 直接调 `service.decide()` / `decisions.*`，`source` 用渠道名（注意：`directAction` 现已允许 `source ∈ {web, feishu, cli, api}`，需**扩展白名单**加入 `telegram/slack/wecom/dingtalk`，`service.js:1083`）。
  - **需要 step-up**（H1/H3 approve、cancel、accept_delivery）→ **不在 IM 内完成**，回卡片"请在管理台完成安全校验"，附 Web 深链（复用现有 `managementUrl`）。
- 决策成功后：调用渠道 `editMessage` 把卡片就地更新为"已处理"（复用 `feishu.js` 的 `resolution` 卡片范式），并触发 `notifyResolution` 让其他渠道同步失效。

**安全（关键）**

- 回调必须**签名 + 一次性 + 绑定文档指纹**；`service.decide` 已校验 `expectedWorkItemVersion`（CAS）、`attentionRevision`、`artifactHash`、`idempotencyKey`、动作白名单（`service.js:392-451`），入站只是"另一个受控入口"，最终一致性由控制面保证。
- **IM 身份 → SpecGate actor 映射**：仅允许 allowlist 内的 chat/user（参考 openclaw `allowFrom`）；映射写入 `Decision.actor.source`，保留审计。
- 高风险动作**绝不**因"IM 点了按钮"而绕过 TOTP。

**验收**：签名错误/重放/过期/指纹不符全部拒绝；低危动作在 IM 内闭环并就地更新卡片；高危动作正确回退 Web；并发点击因幂等键只生效一次。

### 方案三：受控远端访问（解 G3，中风险）

**目标**：人不在宿主机旁时，安全地访问管理台/接收入站回调。

**改动点（提供集成与加固，不自造隧道）**

- `scripts/specgate-control.mjs` 增加 `expose` 子命令：可选启动/登记 **Cloudflare Tunnel（cloudflared）** 或 **Tailscale Funnel**，把得到的公网/尾网 URL 登记为 `managementBaseUrl`（供方案一/二的通知深链与回调使用）。
- 复用 `validateManagementUrl`（远端必须 HTTPS，`feishu.js:29-45`）。
- **加固默认值**：隧道前置身份门禁（Cloudflare Zero Trust Access / Tailscale 身份）；管理台继续保持 `SameSite=Strict` Cookie + CSRF + 限流；`trustProxyHttps` 仅在显式配置下开启（`server.js:196`、`409-414`）。
- 文档：在 `docs/install-config-codex.zh.md` 增补"远端访问与信任边界"章节，明确**不建议**用临时 ngrok 承载审批。

**安全**：默认关闭远端暴露；开启时打印信任边界与鉴权要求；不放宽 CSP/CSRF。

**验收**：`expose` 能登记 URL 并让通知深链指向它；关闭后管理台回到仅本地；未配置身份门禁时给出显式告警。

### 方案四：SSE 实时推送（解 G4，低风险）

**改动点**

- `management/server.js` 增加 `GET /api/events`（`text/event-stream`）：订阅控制面状态变更。`store.mutate` 已产出类型化事件（`work_item.created`、`attention.opened`、`decision.consumed`、`notification.sent` 等，见 `service.js` 各 `type` 字段），据此推送增量。
- `public/app.js`：把 4 秒 `setInterval` 轮询改为 **SSE 订阅 + 兜底轮询**（断线重连、降级到轮询）。
- ntfy 渠道天然支持 SSE/WebSocket，可作为"移动端实时"的补充。

**安全**：`/api/events` 同样要求会话 Cookie + 限流；事件负载经 `sanitizeForWeb` 脱敏。

**验收**：状态变更 < 1s 推送到前端；断线自动重连并回退轮询；脱敏字段不外泄。

### 方案五：提醒与升级调度（解 G5，低风险）

**改动点**

- `daemon.js` 增加 **reminder tick**：扫描 `OPEN/DELIVERED` 且超过 `remindAfterMs` 未决的 `AttentionRequest`，通过 Outbox **重发提醒**（`dedupeKey` 需加入 `reminderCount`，避免与首条去重冲突，`outbox.js:36-44`），并把状态推进到 `REMINDED`（模型已支持，`service.js:314-328`）。
- **升级策略**：接近 `expiresAt`（默认 24h，`service.js:322-323`）时，升级到更高优先级渠道（如从 ntfy 升到 Telegram/短信）或通知备份审批人（借鉴 Novu digest/fallback 理念）。
- 过期后 `expireAttention` 已存在（`service.js:578-616`），补一条"已过期"解决通知（`notifyResolution` 已支持 `EXPIRED`）。

**验收**：未决注意力按间隔收到提醒且不重复轰炸；临期升级；过期正确失效并通知。

### 方案六：入站加固（解 G6，与方案二强绑定）

**改动点**

- **SSRF 私网阻断**：对所有出站/回调 URL 校验，阻断 `10/8`、`172.16/12`、`192.168/16`、`127/8`、`169.254/16` 等私网段 + 主机白名单（对标 Mission Control）。
- **回调签名 + nonce 防重放**：方案二已含；密钥轮换策略。
- **注入扫描**：对来自 IM 的自由文本（如 `request_changes.comment`）做提示词/命令注入扫描后再入库（`service.js:1045-1065` 已限长 16000，可加扫描）。
- **入站限流**：按 chat/IP 对 `/api/inbound/*` 限流（复用 `server.js:325-339` 令牌桶）。

**验收**：私网 URL 被拒；重放/伪造签名被拒；注入样本被拦截；超限触发 429。

---

## 6. 优先级与路线图

按"价值/风险/依赖"排序，建议分三批交付（不含时间估算，按依赖推进）：

| 批次                           | 方案                    | 解决 | 风险 | 依赖                         | 价值                                                             |
| ------------------------------ | ----------------------- | ---- | ---- | ---------------------------- | ---------------------------------------------------------------- |
| **P0（先做，纯增益）**         | 方案一 多渠道通知适配器 | G1   | 低   | 无                           | 高：立刻让 Telegram/Slack/企业微信/ntfy/邮件都能收到关键节点通知 |
| **P0**                         | 方案四 SSE 实时推送     | G4   | 低   | 无                           | 中高：Web 台体验质变，去掉 4s 轮询                               |
| **P0**                         | 方案五 提醒/升级调度    | G5   | 低   | 方案一（多渠道升级更有意义） | 中高：门禁不再"静默挂起"                                         |
| **P1（远端裁决，需配套加固）** | 方案六 入站加固         | G6   | 中   | 无（但必须先于方案二上线）   | 高：开放入站前的安全前置                                         |
| **P1**                         | 方案二 入站远程决策     | G2   | 中   | 方案一 + 方案六              | 高：真正实现"IM 内远程裁决"                                      |
| **P1**                         | 方案三 受控远端访问     | G3   | 中   | 方案二（回调需可达）         | 高：人不在宿主机旁也能控制                                       |

**最小可用闭环建议**：P0 三项先落地（多渠道触达 + 实时 + 提醒），即可显著"更好用"；随后 P1 三项一起构成"远端控制决策"的完整、安全闭环。

---

## 7. 安全与合规红线（务必保留）

1. **高风险裁决不得经纯 IM 按钮完成**：H1/H3 审批、`cancel`、`accept_delivery` 必须 Web + TOTP step-up（与 `attentionNeedsStepUp` 一致）。
2. **文档指纹绑定不可绕过**：任何决策都校验 `artifactHash`，文档变更即失效（`approvals.js:147-156`、`service.js:438-439`）。
3. **版本 CAS + 幂等**：并发/重放只生效一次（`service.js:392-451`）。
4. **通知不是审批**：延续飞书卡片声明，IM 文案/按钮回调本身不构成批准（`feishu.js:178-187`）。
5. **脱敏与最小暴露**：密钥/本地路径/私有键不出现在 Web 与 IM 负载（`feishu.js:3-12`、`server.js:76-117`）。
6. **默认本地、远端 opt-in**：远端暴露默认关闭，开启需身份门禁与 HTTPS（`server.js:191`、`feishu.js:29-45`）。
7. **未执行/未验证如实记录**：任何"已通过"必须有真实命令/运行时证据（AGENTS.md 仓库规则）。

---

## 8. 参考仓库与资料

| 名称                                              | 链接                                                                                                      | 许可证 / 热度        | 用途                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------- |
| Apprise                                           | https://github.com/caronc/apprise                                                                         | BSD-2 · ~16.4k★      | 多渠道统一投递抽象（只出不进）                                |
| ntfy                                              | https://github.com/binwiederhier/ntfy                                                                     | Apache-2.0 · ~29.8k★ | 自托管推送 + SSE/WebSocket + 动作按钮                         |
| Novu                                              | https://github.com/novuhq/novu                                                                            | MIT · ~38.8k★        | digest 聚合 / fallback 链 / in-app 组件（重依赖，仅借鉴理念） |
| Telegram 审批按钮插件                             | https://github.com/JairFC/openclaw-telegram-approval-buttons                                              | MIT                  | 入站决策完整范式（inline keyboard + 自动 resolve + 过期）     |
| Mission Control                                   | https://github.com/builderz-labs/mission-control                                                          | MIT · ~5.2k★         | 自托管控制面 + 安全面板（SSRF/注入/密钥/限流/原子领取）       |
| LangGraph Interrupts                              | https://docs.langchain.com/oss/python/langgraph/interrupts                                                | 文档                 | interrupt/resume + response_schema + 幂等规则                 |
| OpenAI Agents SDK HITL                            | https://openai.github.io/openai-agents-python/human_in_the_loop/                                          | 文档                 | RunState 序列化暂停/恢复                                      |
| 企业微信 主动回复消息                             | https://developer.work.weixin.qq.com/document/path/101138                                                 | 文档                 | 交互卡片回调 + `response_url`（中文生态入站）                 |
| 钉钉 ActionCard                                   | https://open.dingtalk.com/document/connector/uses-a-robot-to-send-actioncard-messages-to-a-group          | 文档                 | 卡片式交互通知                                                |
| Cloudflare Tunnel / Tailscale Funnel / ngrok 对比 | https://behind.cloud/cloudflare-tunnels-vs-tailscale-funnel-vs-ngrok-secure-exposure-tools-compared       | 文章                 | 远端安全暴露选型                                              |
| 仪表盘手机远程访问（Codex/Claude Code）           | https://guides.happier.dev/cloudflare-tunnel-vs-tailscale-funnel-vs-ngrok-for-claude-code-codex-opencode  | 文章                 | 信任边界/鉴权/HTTPS/运维复杂度                                |
| Novu vs Apprise vs ntfy 对比                      | https://www.pistack.xyz/posts/novu-vs-apprise-vs-ntfy-self-hosted-notification-infrastructure-guide-2026/ | 文章                 | 通知基础设施选型                                              |

> 说明：Gitee 侧未检索到与"agent 人在回路 + 远端裁决"直接对标的成熟开源控制面；国内生态的可复用点主要在**企业微信/钉钉的交互卡片回调**（入站决策）与自托管推送（ntfy/Gotify）。如需，可后续单独补充 Gitee 镜像/国内部署实践调研。

---

## 9. 待确认问题（供下一步细化）

1. **目标渠道优先级**：团队实际用飞书为主，还是需要 Telegram/Slack/企业微信/钉钉/邮件/ntfy 中的哪几个？（决定方案一先落哪些适配器）
2. **入站裁决范围**：是否接受"低/中风险可在 IM 内直接裁决、高风险仍走 Web+TOTP"的分层策略？还是希望**全部**裁决都回到 Web（IM 仅触达）？
3. **远端访问形态**：倾向 Cloudflare Tunnel（需 CF 域名 + Zero Trust）、Tailscale（私有 mesh、强身份）还是仅内网可达即可？
4. **依赖取向**：是否严格保持"本地零外部依赖"（不引入 MongoDB/Redis/额外常驻服务）？ntfy 作为可选自托管二进制是否可接受？
5. **多审批人/值班**：是否需要升级策略里支持"备份审批人 / 值班轮换"（借鉴 incident 管理平台）？
