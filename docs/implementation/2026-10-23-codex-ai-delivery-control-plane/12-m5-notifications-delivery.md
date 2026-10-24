# M5 通知与 Attention 生命周期阶段交付

- 日期：2026-10-24（Asia/Shanghai）
- 实施分支：`sg-codex`
- 起始提交：`221f5f5`（complete M4 Codex recovery loop）
- 制品标识：`WORKTREE-2026-10-24-M5`
- 状态：**实现与受控验收完成；真实飞书/钉钉 Webhook 投放待 M9，人工阶段接受待确认**

## 1. 交付范围

| 任务                      | 交付结果                                                                   | 验证                            |
| ------------------------- | -------------------------------------------------------------------------- | ------------------------------- |
| M5-T01 Channel Adapter    | 统一 outbound HTTPS Webhook、发送、回执和稳定错误语义                      | adapter 契约、非法入站参数拒绝  |
| M5-T02 飞书适配器         | 保留 Feishu Card、超时、脱敏和结果回执                                     | Feishu 原有回归及 fanout 集成   |
| M5-T03 钉钉适配器         | 新增 DingTalk ActionCard、超时、回执和进程级去重                           | 成功、失败、重复事件测试        |
| M5-T04 多渠道扇出         | 每渠道独立 Outbox、channel 级 claim、去重、重试和回执                      | 单渠道失败不影响另一渠道        |
| M5-T05 Attention 生命周期 | 确定性提醒、单次升级、独立过期、过期结果通知                               | 可控时钟、重复 tick、全渠道故障 |
| M5-T06 闭环通知           | reminder/escalation/decision/resolution/failed/recovered/completed/expired | 通知载荷和 nonce/token 管理入口 |
| M5-T07 渠道故障测试       | 全渠道失败、重试上限、脱敏 fail closed、无重复轰炸                         | 63 项 M5 联合聚焦测试           |

## 2. 架构

- `channels/adapter.js` 定义统一通道契约和发送前脱敏；
- `channels/dingtalk.js` 提供独立钉钉出站适配器；
- `channels/fanout.js` 为每个渠道创建独立 Outbox；
- `control/attention-lifecycle.js` 将提醒、升级和过期与渠道发送解耦；
- control service 的 notification claim 新增 channel 过滤，避免一个渠道领取并发送其他渠道记录；
- daemon 同时配置 Feishu/DingTalk，并在每次 tick 中 drain 各渠道，同时推进 Attention 生命周期。

通知只提供唤醒与认证管理入口，不包含审批能力。消息使用短期 Attention nonce
（本地模式仍使用一次性 pairing token），不包含会话 Cookie 或 Bearer 凭证。

## 3. 安全与失败语义

- 入队前脱敏，发送前再次脱敏；
- 拒绝绝对路径、凭证、源码 diff、原始日志和思维链内容；
- 单渠道异常写入该渠道独立投递记录和退避计划，不影响其他渠道；
- 渠道全部不可用时 Attention 仍按本地时钟提醒、升级和过期；
- 同一 Attention/版本/kind/渠道的组合只发送一次；
- 重试有最大次数，超过上限保留失败记录。

## 4. 验证

| 命令                                                 | 结果                           | 退出码 |
| ---------------------------------------------------- | ------------------------------ | ------ |
| M5 通知/Feishu/Outbox/daemon/service/config 聚焦套件 | 63 项，63 通过，0 失败，0 跳过 | 0      |
| ESLint（M5 涉及文件）                                | 通过                           | 0      |
| Prettier（M5 涉及文件）                              | 通过                           | 0      |
| `git diff --check`                                   | 无空白错误                     | 0      |

真实飞书、钉钉 Webhook、真实网络断开和移动端消息跳转仍未执行，留给 M9 试点。

## 5. 阶段结论

M5 的渠道适配、独立扇出、故障隔离、提醒/升级/过期和闭环通知已完成受控验收。
全仓组合验证将在 M5-M7 全部集成后执行；本阶段不把真实渠道投放标记为通过。
