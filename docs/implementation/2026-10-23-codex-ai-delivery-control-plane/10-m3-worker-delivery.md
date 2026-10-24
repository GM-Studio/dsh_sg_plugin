# M3 本地 Worker 与云端连接阶段交付

- 日期：2026-10-24（Asia/Shanghai）
- 实施分支：`sg-codex`
- 起始提交：`29f5c76`（recover active H1 sessions）
- 制品标识：`WORKTREE-2026-10-24-M3`
- 状态：**实现、全仓测试与真实 MySQL 8.4 验证完成；人工阶段接受待用户确认**

## 1. 交付范围

本轮完成冻结计划中的 M3，不进入 M4 的 Codex 执行恢复语义。实现采用本地主动
HTTP(S) 轮询，不使用云端向本地建立连接；Worker 令牌、项目白名单、租约、心跳、
命令 outbox、事件补传和撤销都由服务端校验。

| 任务                     | 交付结果                                                                                            | 验证                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| M3-T01 Worker 注册与令牌 | 独立 Worker 身份、`sgw_` Bearer 令牌、仅存 SHA-256 哈希、原子轮换与撤销                             | 旧令牌失效、撤销后拒绝、MySQL 竞争和重启持久化   |
| M3-T02 主动出站连接      | 固定 HTTP(S) 路由、Bearer、重连与抖动退避、请求超时、幂等停止                                       | 出站路由集合、网络错误、401/403 停止、无并发轮询 |
| M3-T03 项目白名单        | 服务端白名单；`claimNext` 接受服务端 `projectIds` 过滤，忽略客户端自报项目                          | 双项目隔离、越权 Worker、客户端伪造 projectIds   |
| M3-T04 租约与心跳        | claim、heartbeat、release；断线不完成运行；释放标记 `INTERRUPTED/BLOCKED`                           | 双 Worker 单租约、续租、释放、离线状态           |
| M3-T05 断线补偿          | 持久命令 outbox、游标、ACK、命令去重；Worker 事件幂等账本与待应用 Decision 拉取                     | 重放、冲突、ACK、MySQL 重启、项目隔离            |
| M3-T06 本地执行边界      | 仅允许 `CLAIM`、`RUN_TYPED_OPERATION`、`UPLOAD_EVIDENCE`、`APPLY_DECISION`、`RELEASE_LEASE`、`STOP` | 拒绝 shell/argv/executable/script/cwd 和回调 URL |
| M3-T07 故障测试          | 令牌泄露/撤销、双 Worker、事件冲突、断网、进程重启、任意 shell                                      | 网关、出站、HTTP E2E、真实 MySQL 并发与备份恢复  |

## 2. 架构与接口

服务端新增 Worker gateway，管理 API：

- `GET /api/workers`；
- `POST /api/workers/register`；
- `POST /api/workers/rotate`；
- `POST /api/workers/revoke`；
- `POST /api/workers/projects`；
- `POST /api/workers/commands`。

管理 API 使用现有用户会话、CSRF 和 step-up；注册、轮换、撤销和白名单变更要求
当前操作 TOTP proof。Worker API 使用独立 Bearer 令牌，不读取用户 Cookie：

- `POST /api/worker/connect`；
- `POST /api/worker/sync`；
- `POST /api/worker/claim`；
- `POST /api/worker/heartbeat`；
- `POST /api/worker/events`；
- `GET /api/worker/commands`；
- `POST /api/worker/commands/ack`；
- `POST /api/worker/release`。

远程模式下 Worker POST 仍要求可信代理、HTTPS 和正确 Host，但不要求浏览器 Origin；
Bearer 令牌不会被浏览器自动附带，因此与用户 CSRF 边界分离。

本地 `src/codex/control/outbound-worker.js` 只访问固定的相对路由，不接受服务端
下发的 callback、reconnect 或任意 URL。网络错误按有界指数退避重连；认证撤销
立即停止。`scripts/specgate-worker.mjs` 提供 M3 传输入口，但所有执行命令在 M4
typed executor 接入前都会明确返回 `WORKER_COMMAND_HANDLER_UNAVAILABLE`，不会
降级为 shell。

## 3. 持久化与安全

迁移 `004-worker-connections.sql`：

- Worker token 轮换时间、撤销时间和 heartbeat 索引；
- `worker_command`：类型、payload hash、Worker+dedupe 唯一、单调 sequence、ACK；
- `worker_event`：事件幂等账本并关联 `evidence_event`；
- `worker_audit`：追加式审计和防改触发器。

MySQL 逻辑备份/恢复表顺序已纳入 Worker 命令、事件和审计表。Worker 租约只持久化
token hash，活动 lease token 仅在当前控制进程内用于心跳校验。

服务端二次校验项目授权，不信任 Worker 自报 project IDs。Worker event 拒绝凭据、
绝对本地路径、回调地址和超限 payload；审计同样脱敏。撤销 Worker 后旧 token 的
connect、claim、heartbeat、event、command 和 release 全部失效。

## 4. 验证证据

真实 MySQL 实例边界：

- MySQL Community Server `8.4.13`，InnoDB，UTC；
- 项目内 `.runtime/mysql-m3/`，仅绑定 `127.0.0.1:34368`；
- 随机测试数据库自动创建和删除；连接配置仅保存在本地忽略目录；
- 未安装系统服务，未修改全局 MySQL 配置。

最终检查：

| 命令                           | 真实结果                                     | 退出码 |
| ------------------------------ | -------------------------------------------- | ------ |
| M3 聚焦 Worker/HTTP/MySQL 套件 | 80 项，80 通过，0 跳过                       | 0      |
| `npm test`（配置真实 MySQL）   | 636 项，635 通过，0 失败，1 跳过             | 0      |
| `npm run lint`                 | 无 ESLint finding                            | 0      |
| `npm run format:check`         | `All matched files use Prettier code style!` | 0      |
| `npm run pack:check`           | tarball 检查通过，包含 Worker 客户端和迁移   | 0      |
| `git diff --check`             | 无空白错误                                   | 0      |

命令、源码摘要和未执行项同时记录在
`docs/verification/codex-control-plane-product/m3-2026-10-24.json`。

跳过项：

- `requesting the react frontend without its template tree fails closed`；
- 原因：React 模板树已在本机存在，该条件未执行，不计为通过。

真实 MySQL 覆盖：

- 004 迁移重复执行；
- Worker token 轮换后旧凭据失败、撤销后全部访问失败；
- 项目白名单事务和跨项目隔离；
- 命令 sequence/dedupe/ACK 并发；
- Worker event 幂等、冲突和 sanitized evidence；
- heartbeat 在线/离线状态；
- 租约 token hash 与当前进程校验；
- Worker 审计脱敏及 append-only；
- Worker 行、命令、事件、审计的逻辑备份与空库恢复。

M3 端到端测试还使用真实 HTTP、用户配对会话、Worker Bearer、两个项目、三个 Worker
和出站客户端验证：白名单领取、双 Worker 单租约、心跳、释放不完成、事件重放、
命令去重/ACK、shell 拒绝和撤销后的 401。

## 5. 未执行边界

- 真实云服务器、域名、TLS 反向代理和跨公网长轮询；
- 真实网络分区、DNS 故障、代理断开和移动网络切换；
- 真实 Codex `exec --json` 与 session resume（M4）；
- 真实决策 `PENDING_APPLY` 应用和恢复闭环（M4）；
- 多 Worker 调度、抢占和公平性（M10）；
- MySQL 8.0.x 单独矩阵与生产灾备；
- 用户对当前 M3 阶段的人工接受。

## 6. 阶段结论

M3 的主动出站、身份撤销、白名单、租约心跳、断线补偿、类型化命令和故障退出条件
均有真实命令与 MySQL 证据。当前 Worker 只具备安全连接与协议能力，尚不能执行
Codex 任务；这是 M4 的明确边界。本阶段结束后停止，等待用户接受后再进入 M4。
