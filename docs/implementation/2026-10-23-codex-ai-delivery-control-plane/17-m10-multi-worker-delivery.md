# M10 多 Worker 正式能力阶段交付

- 日期：2026-10-24（Asia/Shanghai）
- 实施分支：`sg-codex`
- 起始提交：`42d83e2`（complete M9 deployment assurance）
- 制品标识：`WORKTREE-2026-10-24-M10`
- 状态：**实现与受控验收完成；真实多机网络分区和外部规模试点 NOT_RUN，人工阶段接受待确认**

## 1. 交付范围

| 任务                    | 交付结果                                                                                        | 验证                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- |
| M10-T01 Worker 能力声明 | 项目白名单、工具链、标签、并发、区域、优先级和技能状态可持久化，并拒绝 shell/回调/路径/密钥字段 | 网关集成与能力负向测试                 |
| M10-T02 调度与优先级    | 项目/能力/区域硬约束，业务优先级、截止时间、风险、队列年龄和项目公平性排序                      | 调度器优先级与公平轮换测试             |
| M10-T03 租约抢占        | 同一 WorkItem 单租约，过期接管递增 fencing token，旧 token 续租/完成被拒绝                      | 双 Worker 与过期接管测试               |
| M10-T04 断线补偿        | 断线 Worker 停止领取；重连按游标回放，事件按 `eventId`/`dedupeKey` 去重，Decision 游标独立      | 重连、重复事件与冲突测试               |
| M10-T05 多 Worker 安全  | 独立令牌、项目白名单、撤销级联、越权和调度拒绝均写审计                                          | 跨项目、撤销和 callback/shell 负向测试 |
| M10-T06 压力与故障测试  | 100 Worker/1000 WorkItem 有界压力、租约超时、断线和重连受控故障覆盖                             | 本地压力与故障注入测试                 |

主要实现：

- `src/codex/core/control/worker/worker-scheduler.js`
- `src/codex/core/control/worker/worker-gateway.js`
- `src/codex/core/control/worker/worker-contract.js`
- `src/codex/control/worker-runtime.js`
- `src/codex/control/service.js`

## 2. 调度语义

1. 项目白名单、toolchain、label 和严格 region 是硬约束，不满足时 Worker 直接空闲。
2. 业务优先级先于项目公平性；同级候选再按截止时间、风险、队列年龄和最近分配时间排序。
3. 同一项目沿用控制面单活租约约束；Worker 负载受 `maxConcurrency` 限制。
4. 租约过期后新 Worker 可接管，fencing token 单调递增；旧 Worker 的 heartbeat、
   waiting 和 finish 请求 fail closed。
5. 调度决策返回候选、替代 Worker 和可读原因，便于审计和排障。
6. 调度器只接受服务端声明的 Worker/lease/WorkItem 数据，不接受客户端项目或回调地址。

## 3. 验证

| 命令                                         | 结果                             | 退出码 |
| -------------------------------------------- | -------------------------------- | ------ |
| M10 scheduler + gateway integration 聚焦套件 | 13 项，13 通过，0 失败，0 跳过   | 0      |
| `npm test`                                   | 737 项，737 通过，0 失败，0 跳过 | 0      |
| `npm run lint`                               | 通过                             | 0      |
| `npm run format:check`                       | 通过                             | 0      |
| `npm run pack:check -- --cache .npm-cache`   | 通过，569 files                  | 0      |
| `git diff --check`                           | 无空白错误                       | 0      |

5 个 MySQL 集成测试已使用项目内隔离实例真实执行，React 缺失模板与入口条件也改为
确定性断言；当前全仓测试不再通过条件跳过隐藏未执行项。
默认用户级 npm 缓存首次执行时返回 `EPERM`，随后使用工作区内 `.npm-cache`
重跑同一 dry-run 打包检查并真实通过。

## 4. 未执行与阶段结论

- 在真实两台或更多主机上运行 Worker 并注入公网网络分区；
- 控制面在持租约期间崩溃、重启和跨机接管；
- MySQL 持久化 Worker 注册表上的外部规模调度与长稳测试；
- 超过 100 Worker/1000 WorkItem 的容量目标验证；
- 用户对 M10 多 Worker 范围和阶段证据的人工接受。

本地调度器、网关集成和全仓回归证明受控实现满足 M10 退出条件，但不能替代真实多机
试点。M10 的实现状态为完成，真实多机试点保持 `NOT_RUN`；该边界与 M9 的
`PARTIAL` 发布结论一致。
