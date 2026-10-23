# 人在回路 · 部署与架构部分（§5.6–§9 + 附录）

> 本文是 [hitl-async-remote-decision-research-v2.zh.md](./hitl-async-remote-decision-research-v2.zh.md) 的**部署与架构分册**（因单文件长度上限拆分）。
> 主体部分（§0–§5.5）见上文链接。

---

## 5.6 无域名 + 本机自建服务器的落地方案

### 5.6.1 结论：无域名不构成阻塞

| 通道                         | 需要域名?           | 原因                                             | 结论        |
| ---------------------------- | ------------------- | ------------------------------------------------ | ----------- |
| **钉钉 Stream**              | ❌                  | 出站 WebSocket，官方明确「无需服务器、IP、域名」 | ✅ 首选     |
| 钉钉/飞书自定义机器人        | ❌                  | 仅 POST 到对方 webhook                           | ✅          |
| **企业微集群机器人（出站）** | ❌                  | webhook 单向 POST                                | ✅          |
| 企业微信**入站回调**         | ⚠️ 需备案且主体一致 | 官方社区确认「域名主体校验未通过」               | ❌ 本就不做 |

**结论：所选方案在无域名前提下 100% 可行。**

### 5.6.2 网络要求

| 情形                    | 需公网 IP? | 说明                                            |
| ----------------------- | ---------- | ----------------------------------------------- |
| **A. 仅出网（NAT 后）** | ❌         | 钉钉 Stream 与 webhook 均出站，**可行且最安全** |
| B. 有公网 IP 直连       | ✅         | 无域名无法签可信证书，**不推荐**                |

推荐 A：管理台绑定 `127.0.0.1`，不暴露公网端口。

### 5.6.3 手机看管理台的免域名选项

| 方案                    | 需域名?               | 自动 HTTPS | 地址稳定    | 适用     |
| ----------------------- | --------------------- | ---------- | ----------- | -------- |
| **Tailscale Funnel**    | ❌（自动 `*.ts.net`） | ✅         | ⚠️          | **推荐** |
| Cloudflare Quick Tunnel | ❌（临时）            | ✅         | ❌ 重启即变 | 仅演示   |
| 同 Wi-Fi 内网           | ❌                    | ❌         | ✅          | 只能在家 |

已核验：Funnel「without port forwarding, DNS records, or a public IP... automatically provisions a TLS certificate」；Quick Tunnel「do not need a Cloudflare account or domain」，官方标注仅用于测试。

### 5.6.4 本机运维要求

| #   | 要求                                | 理由                            |
| --- | ----------------------------------- | ------------------------------- |
| O1  | 禁止休眠                            | 断连、通知逾期                  |
| O2  | 开机自启                            | 无人登录也能拉起                |
| O3  | `SPECGATE_CONTROL_HOME` 固定盘+备份 | 状态丢失=审批记录丢失           |
| O4  | 单实例                              | `lock.js` 是本地锁              |
| O5  | 重启后 reconcile                    | 识别 `SUSPECT/OFFLINE` 并重通知 |
| O6  | 家宽 IP 变化不影响                  | 出站连接自愈                    |

---

## 5.7 购买云服务器后的变化与 WebUI 上云

### 5.7.1 结论

| 问题             | 结论                                                         |
| ---------------- | ------------------------------------------------------------ |
| WebUI 能否上云？ | ✅ **能**，无需改管理台主体代码，靠现有配置即可              |
| 仍需域名？       | ❌ 不需要                                                    |
| 方案变多少？     | 核心链路 R1/R8/R4 不变；变化在 **R9 部署**与 **R2 远端访问** |
| 新增最大风险？   | **云端 Codex 凭证**（无头环境 OAuth 回调不通）               |

### 5.7.2 管理台已内置上云所需配置（代码已存在）

| 能力                     | 位置                | 上云取值                                   |
| ------------------------ | ------------------- | ------------------------------------------ |
| 监听地址可配             | `server.js:191`     | 反代场景**保持回环**                       |
| 端口可配                 | `server.js:192`     | `SPECGATE_MANAGEMENT_PORT`（默认 43120）   |
| **安全 Cookie 自动判定** | `daemon.js:148`     | `managementPublicUrl.startsWith('https:')` |
| 反代 HTTPS 识别          | `server.js:409-412` | `trustProxyHttps`                          |
| 公开 URL 可配            | `config.js:93-99`   | `SPECGATE_MANAGEMENT_PUBLIC_URL`           |
| 会话持久化               | `daemon.js:141`     | `web-sessions.json`                        |
| Cookie 加固              | `server.js:417`     | `HttpOnly; SameSite=Strict`                |

> **WebUI 上云是「配置+部署」，不是「重写」。**

### 5.7.3 需补的两个缺口

| #      | 缺口                         | 说明                                                 |
| ------ | ---------------------------- | ---------------------------------------------------- |
| **C1** | `trustProxyHttps` **未接线** | `daemon.js:142-150` 调用时**未传**该参数，恒为 false |
| **C2** | 配对令牌每次启动随机         | `daemon.js:140`，云主机重启后旧链接失效              |

**C1 有绕过**：直接设置 `SPECGATE_MANAGEMENT_PUBLIC_URL` 为 https，`secureCookie` 已为 true。**这是最稳妥的配置方式。**

### 5.7.4 WebUI 上云三种拓扑

| 拓扑                 | 入口                 | 需域名 | 证书     | 推荐度              |
| -------------------- | -------------------- | ------ | -------- | ------------------- |
| **U1. 仅 Tailscale** | 私网 IP:43120        | ❌     | ❌/自动  | ⭐⭐⭐⭐⭐ **推荐** |
| **U2. 反代+自签**    | `https://<IP>`       | ❌     | 自签告警 | ⭐⭐⭐              |
| **U3. 反代+Funnel**  | `https://xxx.ts.net` | ❌     | ✅ 自动  | ⭐⭐⭐⭐            |

**共同要求**：管理台始终绑内网/回环，**绝不** `0.0.0.0` 裸奔；设置 `SPECGATE_MANAGEMENT_PUBLIC_URL`；安全组最小放行；调低限流。

### 5.7.5 最大风险：云端 Codex 凭证

| 方案             | 可行性          | 风险           |
| ---------------- | --------------- | -------------- |
| 浏览器 OAuth     | ⚠️ 无头回调不通 | 需人工干预     |
| **API Key**      | ✅ 无头可用     | **泄露即失控** |
| 拷贝 `auth.json` | ✅              | 会过期         |

**硬约束**：凭证 `0600`；**必须设预算上限**（`wallClockMs/maxModelTokens/maxToolCalls`）；MFA + 密钥 SSH；定期轮换。

> `codex-execution-adapter.js:11` 已有 `FORBIDDEN_CHILD_ENV`，**建议把 API Key 一并纳入**。

### 5.7.6 变化对照

| 项           | 本机        | 云服务器            | 变化          |
| ------------ | ----------- | ------------------- | ------------- |
| R1/R8/R4     | ✅          | ✅                  | **不变**      |
| R9 部署      | 禁休眠/自启 | **systemd**         | 运维**简化**  |
| R2 WebUI     | Tailscale   | U1/U2/U3            | **升级为 P0** |
| 凭证         | 本机已登录  | **需显式配置+熔断** | **新增风险**  |
| 家宽 IP 漂移 | 需关注      | 不涉及              | 风险**消除**  |

---

## 5.8 最终架构：控制面上云 + 执行留本地（定稿）

> 决策：**控制面（管理台/通知/决策）全部上云；Codex 执行全部留本地；手机远端审批在任何地方可用。**

### 5.8.1 目标架构

```text
        手机 / IM
          │  钉钉卡片（出站长连接，无需域名）
          │  Tailscale / 反代 → WebUI
          ▼
┌──────────────────────────────────────┐
│  云服务器   SpecGate 控制面           │
│  · 管理台 WebUI                       │
│  · 通知 Outbox（飞书/钉钉/企微）       │
│  · 状态机 / AttentionRequest /Decision │
│  · 钉钉 Stream 出站收回调              │
└──────────────────────────────────────┘
          ▲                │
          │ ① 本地主动出站：拉任务 / 报心跳 / 报事件
          │                ▼
┌──────────────────────────────────────┐
│  本地执行机（工作站）                  │
│  · Codex 执行器（exec / resume）       │
│  · 代码仓库、凭证、工具链              │
│  · 门禁 → 上报并退出                   │
└──────────────────────────────────────┘
```

**核心思想**：云端**从不主动连入**本地（本地不需公网/IP/端口映射）；本地作为 **worker 主动拉取**。与钉钉 Stream 出站思路叠加后，**整条链路零入站端口**。

### 5.8.2 现有代码已是「注入式」，改动集中

| 现有设计             | 位置                                                                      | 分机化意义                            |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------- |
| **执行适配器可注入** | `supervisor.js:98` `adapter,`；`231` `adapter.run({...})`                 | 换远程适配器，**supervisor 主体不改** |
| 适配器契约窄         | `run({mode, projectRoot, sessionId, prompt, onEvent, onSession, signal})` | 天然适合跨机                          |
| 状态机/租约解耦      | `claimNext / heartbeat / finishRun`                                       | 本就是多执行者设计                    |
| **门禁即退出**       | `SPECGATE_WAITING_FOR_USER` + `exec resume`                               | **等待期执行机可离线/关机**           |
| 状态存于文件         | `runtime.js:98` `root: config.controlRoot`                                | ⚠️ 唯一硬约束，见 5.8.3               |

> **关键**：人工门禁本就是「子进程退出 + 会话恢复」，所以**执行机在等待期间完全可以离线**——分机部署比想象中简单，不需维持长期执行连接。

### 5.8.3 唯一硬约束：状态是本地文件

| 方案                      | 做法                                       | 评价                                     |
| ------------------------- | ------------------------------------------ | ---------------------------------------- |
| **W1. HTTP 拉取（推荐）** | 云端提供 worker API：领任务/心跳/上报/提交 | **低复杂度**，复用现有状态机             |
| W2. 共享存储              | 云端状态挂网络盘                           | **不推荐**：文件无锁，`lock.js` 是本地锁 |

### 5.8.4 最小 worker 协议（全部本地出站）

| 方法                         | 用途                    | 对应现有能力        |
| ---------------------------- | ----------------------- | ------------------- |
| `POST /api/worker/register`  | 注册执行机              | 新增                |
| `POST /api/worker/claim`     | 领取 WorkItem（长轮询） | `service.claimNext` |
| `POST /api/worker/heartbeat` | 续租+上报用量           | `service.heartbeat` |
| `POST /api/worker/events`    | 批量上报脱敏事件        | `onEvent`           |
| `POST /api/worker/attention` | 上报人工门禁            | `requestAttention`  |
| `POST /api/worker/finish`    | 结束 Run                | `finishRun`         |
| `GET  /api/worker/decision`  | 查询待恢复决策          | `resume`            |

**认证**：worker 独立令牌，**不得复用用户配对令牌**，绑定机器 id 与项目白名单。

### 5.8.5 新增风险与对策

| #      | 风险                 | 对策                                         |
| ------ | -------------------- | -------------------------------------------- |
| **X1** | 本地离线任务无人执行 | 云端排队，上线自动领取（**异步的正确语义**） |
| **X2** | 跨机时钟偏差         | **统一以云端时钟**判定租约                   |
| **X3** | 断线丢事件           | 本地持久化队列 + 序号去重，重连补传          |
| **X4** | 双机重复领取         | 复用原子租约 + worker 绑定机器 id            |
| **X5** | 路径映射             | 注册时建 `projectId→本地路径` 映射           |
| **X6** | 事件含敏感信息       | 上报前**必复用 `redact`**                    |
| **X7** | 凭证不出本机         | ✅ **本架构最大优势**                        |

### 5.8.6 与全云方案对比

| 维度       | 全云（§5.7） | **本节架构**                 |
| ---------- | ------------ | ---------------------------- |
| Codex 凭证 | ⚠️ 必须上云  | ✅ **留本地**                |
| 代码仓库   | ⚠️ 需上云    | ✅ **留本地**                |
| 本地离线   | 无影响       | 任务排队（可接受）           |
| 实现复杂度 | 中           | **中高**（新增 worker 协议） |
| 安全性     | 中           | **高**                       |
| 7×24 执行  | ✅           | ⚠️ 取决于本地                |

> **权衡**：多写一层 worker 协议，换「凭证与代码不出本地」。对管理私有代码库，**明显划算**。

### 5.8.7 落地增量

| ID             | 新增工作                                                               | 优先级               |
| -------------- | ---------------------------------------------------------------------- | -------------------- |
| **R10**        | **跨机 worker 协议** + **本地执行器 agent**（拉取/执行/上报/断线重传） | **P0 架构核心**      |
| **R11**        | worker 令牌与项目白名单                                                | **P0 须与 R10 同步** |
| R1/R8/R4/R2/C1 | 不变                                                                   | P0                   |
| R9             | 云部署套件（**无需凭证加固**）                                         | P0                   |

### 5.8.8 分阶段建议（降低风险）

| 阶段       | 形态                       | 产出                                   |
| ---------- | -------------------------- | -------------------------------------- |
| **阶段一** | 控制面与执行**同机**       | 验证 R1/R8/R4/R2，**不引入跨机复杂度** |
| **阶段二** | 引入 R10/R11，执行拆回本地 | 验证 worker 拉取、断线重传、跨机租约   |
| 阶段三     | 多执行机                   | 复用租约与白名单                       |

> **强烈建议分阶段**：先同机跑通闭环，**再**拆跨机。否则出问题无法区分业务逻辑还是网络。

---

## 6. 需求分析方案

### 6.1 设计原则

1. **不动安全底座**：指纹绑定、版本 CAS、幂等、step-up、审计、脱敏全保留；新通道只是新入口，汇聚到 `service.decide()`。
2. **通知 ≠ 审批**：延续飞书卡片声明，IM 内只做低/中风险裁决。
3. **分层授权**：沿用 `attentionNeedsStepUp`；H1/H3 `approve`、`cancel`、`accept_delivery` 必须 Web+TOTP。
4. **零依赖**：不引入 Mongo/Redis。
5. **零入站端口**：云端不连入本地，本地不需公网。
6. **失败可见可降级**：任一渠道失败不阻断其他。

### 6.2 需求条目

| ID      | 需求                                                                      | 验收口径                                           | 优先级      |
| ------- | ------------------------------------------------------------------------- | -------------------------------------------------- | ----------- |
| **C1**  | **上云代码前置**：接线 `trustProxyHttps`；配对令牌可固定/重置             | 反代下 Cookie 正确标记安全；重启后链接可用         | **P0**      |
| **R1**  | 多渠道通知（飞书/钉钉 P0，企微出站 P1）                                   | 任一送达即成功；部分失败不阻断                     | P0          |
| **R8**  | **钉钉 Stream 出站长连接**（Bot+卡片回调）                                | 断线重连；回调幂等；测试环境不污染生产             | P0          |
| **R4**  | IM 内远程裁决（低/中风险）+ 卡片就地更新                                  | 低危闭环；高危回退 Web+TOTP；并发幂等              | P0          |
| **R2**  | **WebUI 上云**（U1 Tailscale 优先）                                       | 公开 URL 设置后安全 Cookie 生效；不暴露裸端口      | P0          |
| **R10** | **跨机 worker 协议 + 本地执行器**                                         | 本地无公网即可工作；断线重传不重复；云端时钟判租约 | **P0 核心** |
| **R11** | worker 令牌与项目白名单                                                   | 只能领自身+白名单任务，越权被拒                    | **P0 同步** |
| **R9**  | 云部署（systemd/持久盘/单实例/reconcile/安全组）。**云端不含 Codex 凭证** | 重启自动恢复；状态不丢                             | P0          |
| R6      | SSE 实时推送替代 4s 轮询                                                  | <1s 到达；断线回退轮询                             | P1          |
| R7      | 提醒与升级（`REMINDED` 真正生效）                                         | 不重复轰炸；临期升级；过期失效通知                 | P1          |
| R5      | `request_changes` 结构化输入 schema                                       | 渲染类型化表单                                     | P1          |

### 6.3 改动点映射

| 需求 | 改动                                         | 文件                                                 |
| ---- | -------------------------------------------- | ---------------------------------------------------- |
| C1   | 透传 `trustProxyHttps`（现未传）             | `control/daemon.js` + `control/config.js`            |
| C1   | 配对令牌可固定/重置                          | `control/daemon.js` + `scripts/specgate-control.mjs` |
| R1   | 渠道注册表 + 各适配器                        | `src/codex/channels/registry.js`（新）               |
| R8   | 钉钉 Stream 客户端                           | `src/codex/channels/dingtalk-stream.js`（新）        |
| R4   | 回调路由 + source 白名单加 `dingtalk`        | `management/server.js` + `control/service.js`        |
| R10  | worker 协议路由                              | `management/worker-protocol.js`（新）                |
| R10  | **远程执行适配器**（实现现有 `adapter.run`） | `control/remote-execution-adapter.js`（新）          |
| R10  | 本地执行器 agent                             | `src/codex/worker/agent.js`（新）                    |
| R11  | worker 令牌与白名单                          | `control/service.js` + `control/config.js`           |
| R6   | SSE `GET /api/events`                        | `management/server.js`                               |
| R6   | 轮询改 SSE                                   | `management/public/app.js:721/732/794`               |
| R7   | remind tick                                  | `control/daemon.js`                                  |

### 6.4 建议实施顺序

```
P0-a  C1  上云代码前置（trustProxyHttps / 配对令牌）
P0-b  R1  多渠道出站通知（飞书 + 钉钉 + 企微）
P0-c  R8  钉钉 Stream 长连接回收调
P0-d  R4  钉钉卡片内远程裁决        ←「通知+裁决」闭环
P0-e  R2  WebUI 上云（U1 Tailscale 优先）
P0-f  R10 跨机 worker 协议 + 本地执行器  ←「执行留本地」闭环
P0-g  R11 worker 令牌与项目白名单   ← 与 R10 同步，不可延后
P1    R9 云部署 / R6 SSE / R7 提醒升级
P1    R5 结构化输入 schema
```

> **最小可用闭环**：**C1 + R1 + R8 + R4 + R2 + R10 + R11**。全链路**零入站端口、零域名、零备案**；**凭证与代码永不上云**。
>
> 但**强烈建议分两阶段**：阶段一先同机跑通 R1/R8/R4/R2，阶段二再引入 R10/R11 拆跨机。

---

## 7. 风险与红线

1. **app-server 不得用于生产**（官方 experimental，非回环默认允许未认证）。
2. **hook 不能修改输入**：`updatedInput` 等 fail closed；「修改后继续」只能走 `request_changes` + 恢复。
3. **`approval_policy="never"` 是刻意的**，不要改回 `on-request`（会让子进程重新阻塞）。
4. **高风险裁决必须 Web + TOTP**。
5. **文档指纹不可绕过**（`artifactHash`）。
6. **未验证如实记录**（AGENTS.md）。
7. **云端绝不持有 Codex 凭证** —— 本架构核心安全承诺。
8. **worker 令牌不得复用用户配对令牌**；R11 不可延后于 R10。
9. **云端不得主动连入本地** —— 任何反向连入设计需重新安全评审。
10. **事件上报前必须脱敏**，云端不存原始 diff 与绝对路径。

---

## 8. 待确认问题

1. **企业微信定位**：是否同意只做「出站通知」，入站裁决走钉钉卡片或 Web？
2. **高风险裁决形态**：是否接受「低/中风险 IM 内裁决、高风险回 Web+TOTP」？
3. **WebUI 入口**：U1 Tailscale（推荐）/ U2 反代自签 / U3 Funnel？
4. **是否需要执行中途实时审批**（G7）？若不需要，可不评估 app-server。
5. ~~云部署拓扑~~ —— **已确认**：控制面上云，执行留本地。
6. ~~云端凭证/代码是否放云~~ —— **已确认**：云端无 Codex 凭证，代码留本地。
7. **是否接受分两阶段**（先同机跑通，再拆跨机 R10/R11）？**建议分阶段**。
8. **本地执行机离线语义**：关机期间任务排队、上线后继续，是否认可？
9. **单执行机还是多执行机**？多机需在 R11 加机器绑定。

---

## 9. 参考链接

**Codex 官方文档（已核验）**：

- [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security.md) · [Config reference](https://learn.chatgpt.com/docs/config-file/config-reference.md) · [Advanced config](https://learn.chatgpt.com/docs/config-file/config-advanced.md)
- [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode.md) · [App server](https://learn.chatgpt.com/docs/app-server.md) · [Hooks](https://learn.chatgpt.com/docs/hooks.md)

**钉钉 / 企业微信**：

- [钉钉 Stream 模式](https://help.dingtalk.io/open/development/introduction-to-stream-mode.md) · [配置 Stream 推送](https://help.dingtalk.io/zh/open/dingstart/configure-stream-push)
- [钉钉机器人安全设置](https://help.dingtalk.io/open/dingstart/customize-robot-security-settings.md) · [消息格式](https://help.dingtalk.io/open/development/robot-message-types-and-data-format.md)
- [企业微信 智能机器人长连接（未核验）](https://developer.work.weixin.qq.com/document/path/101463)

**开源项目**：

- [HumanLayer](https://github.com/humanlayer/humanlayer) · [Codex 插件 README](https://raw.githubusercontent.com/humanlayer/humanlayer/main/apps/riptide-codex-plugin/README.md)
- [codex-slack-bridge](https://github.com/BHSDuncan/codex-slack-bridge) · [codex-relay](https://github.com/josephbartlett/codex-relay)
- [OpenHands](https://github.com/All-Hands-AI/OpenHands) · [goose](https://github.com/block/goose) · [Cline](https://github.com/cline/cline)
- [Apprise](https://github.com/caronc/apprise) · [ntfy](https://github.com/binwiederhier/ntfy)

**隧道 / 无域名**：

- [Tailscale Funnel](https://tailscale.com/docs/use-cases/application-testing/share-local-dev-server-with-internet.md) · [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/index.md)

**规范 / 上游 Issue**：

- [MCP elicitation 2025-11-25](https://modelcontextprotocol.org/specification/2025-11-25/client/elicitation)
- [codex#39447](https://github.com/openai/codex/issues/39447) · [codex#23465](https://github.com/openai/codex/issues/23465) · [codex#28833](https://github.com/openai/codex/issues/28833) · [codex PR#17563](https://github.com/openai/codex/pull/17563)

---

## 附：验证状态声明

- **已核验（官方文档抓取）**：Codex 审批策略与 `untrusted` 废弃、`granular.mcp_elicitations`、`codex exec resume`、app-server JSON-RPC 审批方法、WebSocket auth、`PermissionRequest` 契约及「无法修改输入」约束。
- **已核验（官方文档）**：钉钉 Stream「免公网/免签名/五零」、覆盖 Bot 与 **Card 回调**、三条集成约束（需公网出口/仅限企业内部应用/默认 50 连接）。
- **已核验（官方文档）**：Tailscale Funnel「无需端口转发/DNS/公网 IP，自动签证书」；Cloudflare Quick Tunnel「无需账号或域名」，标注仅用于测试。
- **已核验（GitHub API）**：codex#39447/#23465/#28833/PR#17563 状态与正文。
- **已核验（本仓库代码）**：执行适配器注入点 `supervisor.js:98,231`；状态根 `runtime.js:98`；`secureCookie` 自动判定 `daemon.js:148`；`trustProxyHttps` 未透传 `daemon.js:142-150`；配对令牌随机 `daemon.js:140`；管理台绑定 `server.js:191`。
- **未核验（标注）**：企业微信个人/未认证能否加群机器人（官方页为 JS 渲染）；企微智能机器人长连接是否免公网（推测与钉钉 Stream 同思路，**未证实**）；企微入站回调域名规则（仅见社区问题标题）；Codex 无头登录流程细节。
- **未核验**：GitHub Actions/GitLab 审批门禁行为；goose 审批 UI（上游 429）。
- **未执行**：本报告为调研与需求分析，**未运行任何构建、测试或验证命令**，未修改任何源码。
