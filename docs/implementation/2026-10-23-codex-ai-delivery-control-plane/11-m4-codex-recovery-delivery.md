# M4 WorkItem、Run 与 Codex 恢复闭环阶段交付

- 日期：2026-10-24（Asia/Shanghai）
- 实施分支：`sg-codex`
- 起始提交：`b3273cb`（complete M3 outbound worker connections）
- 制品标识：`WORKTREE-2026-10-24-M4`
- 状态：**实现、受控端到端和全仓验证完成；真实 Codex 宿主机试点待 M9，人工阶段接受待确认**

## 1. 交付范围

本轮完成冻结计划中的 M4。复用既有 Codex execution adapter 和本地 supervisor
语义，把远程 Worker 的 claim、等待、Decision 应用和原 session resume 串成闭环；
没有用新 session 冒充恢复，也没有把 shell 或任意命令下发给本地。

| 任务                     | 交付结果                                                                               | 验证                                             |
| ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| M4-T01 WorkItem/Run API  | 复用现有创建/查询/状态 API，远程 Worker 通过 M3 claim/heartbeat/finish 驱动 Run        | 状态转换、项目隔离、lease 与 run version         |
| M4-T02 Codex 执行适配器  | 远程 supervisor 接入 `exec --json` adapter，捕获 JSON events 与 sessionId              | adapter 参数、session 提取和远程 supervisor      |
| M4-T03 举手与租约释放    | 解析 `SPECGATE_WAITING_FOR_USER`，保存 session，创建 Attention，释放执行租约           | waiting E2E、Attention、Run WAITING、无 lease    |
| M4-T04 Decision 下发     | Worker sync 暴露尚未应用的 Decision；claim 开始 `PENDING_APPLY`；完成/失败均有显式账本 | 单消费者、幂等、APPLIED/REJECTED、失败 Attention |
| M4-T05 原 session resume | approve/request_changes/resume/retry 使用精确 sessionId；修改意见进入恢复 prompt       | 原 session、payload prompt、无替代 session       |
| M4-T06 恢复失败处理      | 缺少 session、adapter 失败、heartbeat 失败均显式失败并进入 Attention，不伪造续跑       | missing session、resume failure、blocked 状态    |
| M4-T07 端到端测试        | 远程 HTTP + 出站 Worker + fake Codex adapter 完成 waiting → approve → resume → APPLIED | 2 条 M4 E2E；M3 Worker/MySQL 回归保持通过        |

## 2. 恢复语义

Decision 在既有 `CONSUMED` 兼容状态之上新增应用账本：

```text
CONSUMED
  -> applyStatus=PENDING_APPLY
  -> applyStatus=APPLIED / status=APPLIED
  -> 或 status=REJECTED / applyStatus=REJECTED
```

- `beginDecisionApplication` 只允许一个 Worker 开始应用；
- `markDecisionApplied` 只能由开始应用的同一 Worker 完成；
- `failDecisionApplication` 记录错误并阻塞 WorkItem；
- cancel Decision 可直接完成且不会启动 Codex；
- H1/H3 原生审批桥仍可独立完成，不受 session resume 约束。

远程 Worker 只在本地 `projectId -> absolute projectRoot` 映射中解析项目目录，
云端返回的绝对路径被忽略。恢复 prompt 包含 Decision ID、动作、payload、原
sessionId 和“不要创建替代 session”的明确约束。

新增 Worker 固定接口：

- `POST /api/worker/waiting`；
- `POST /api/worker/finish`；
- `POST /api/worker/decisions/apply`；
- `POST /api/worker/decisions/complete`；
- `POST /api/worker/decisions/fail`。

全部继续使用 M3 的独立 Bearer、项目白名单、固定相对路由和 typed payload 校验。

## 3. 执行与失败路径

`src/codex/control/remote-worker-supervisor.js` 的每次 `runOnce()`：

1. connect + sync，处理 cancel；
2. claim 白名单内 WorkItem；
3. 根据持久 session 选择 start/resume；
4. 执行期间串行 heartbeat，使用最新 Run revision；
5. waiting marker → 完成 Decision 应用（如有）→ 创建 Attention 并释放 lease；
6. 成功 → 上报脱敏 execution evidence → finish COMPLETED；
7. 失败 → fail Decision 应用（如有）→ finish FAILED → 创建 FAILED Attention。

缺少原 session、adapter resume 失败或 heartbeat 失效时均不会生成新替代 session，
WorkItem 进入显式阻塞并保留可操作 Attention。

## 4. 验证证据

| 命令                                 | 真实结果                                     | 退出码 |
| ------------------------------------ | -------------------------------------------- | ------ |
| M4 Decision/Worker/HTTP/E2E 聚焦套件 | 68 项，68 通过，0 失败，0 跳过               | 0      |
| `npm test`（配置真实 MySQL）         | 662 项，661 通过，0 失败，1 跳过             | 0      |
| `npm run lint`                       | 无 ESLint finding                            | 0      |
| `npm run format:check`               | `All matched files use Prettier code style!` | 0      |
| `npm run pack:check`                 | tarball 检查通过                             | 0      |
| `git diff --check`                   | 无空白错误                                   | 0      |

命令、源码摘要和未执行项同时记录在
`docs/verification/codex-control-plane-product/m4-2026-10-24.json`。

M4 端到端测试实际覆盖：

- 远程 HTTP pairing、Worker 注册和 Bearer；
- 首次执行举手后 Run `WAITING_FOR_USER`、lease 清空、session 持久化；
- approve Decision 后同一 Worker 再次 claim，以 `resume` 模式使用完全相同 session；
- Decision 从 `PENDING_APPLY` 到 `APPLIED`，WorkItem 完成；
- cancel Decision 只完成应用，不调用 Codex；
- 修改意见进入 resume prompt；
- 缺 session、adapter resume 失败、heartbeat 失败和未知项目均 fail closed；
- M3 Worker token、白名单、命令/事件、租约和真实 MySQL 回归继续通过。

跳过项仍为 React 模板树已存在导致的条件用例，不计为通过。

## 5. 未执行边界

- 真实 Codex CLI `exec --json` 在远程 Worker 宿主机的完整模型执行；本轮使用真实
  adapter 接口和受控 fake process 验证事件/session 语义；
- 真实公网 TLS、反向代理、移动网络和云端长轮询；
- M5 飞书/钉钉闭环通知与 Attention 提醒/升级；
- M6 可回放时间线与审计查询 UI；
- M8 冻结测试、独立验证和再交付；
- M9 真实单机云部署与试点；
- 用户对当前 M4 阶段的人工接受。

## 6. 阶段结论

M4 的“Codex 举手 → 释放租约 → Decision → Worker 应用 → 原 session 恢复”已在
受控 HTTP E2E 中闭合，失败与取消路径不会伪造续跑。真实 Codex 模型执行和云上
试点保留给 M9。本阶段结束后停止，等待用户接受后再进入 M5。
