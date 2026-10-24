# M2 云端认证、设备与会话阶段交付

- 日期：2026-10-24（Asia/Shanghai）
- 实施分支：`sg-codex`
- 起始提交：`3ce4406`（M1 MySQL persistence and recovery）
- 制品标识：`WORKTREE-2026-10-24-M2`
- 状态：**实现、全仓测试与真实 MySQL 8.4 验证完成；人工阶段接受待用户确认**

## 1. 交付范围

本轮只完成冻结计划中的 M2，不进入 M3 Worker 协议或 M4 Codex 恢复闭环。
本地模式继续支持一次性配对；远程模式强制使用账号密码、TOTP 和设备会话，
未配置 MySQL、认证加密密钥和设备确认码时拒绝启动。

| 任务                  | 交付结果                                                            | 验证                                         |
| --------------------- | ------------------------------------------------------------------- | -------------------------------------------- |
| M2-T01 账号密码认证   | scrypt 强哈希、随机盐、恒定时间校验、登录/TOTP 原子限流、失败审计   | 密码格式、错误记录、限流竞争和审计脱敏测试   |
| M2-T02 强制 TOTP      | 一次性注册种子、AES-256-GCM 加密落盘、单调计数器防重放              | 注册、验证、并发单赢家、重放拒绝             |
| M2-T03 设备注册与撤销 | `userId + deviceId + sessionId` 绑定；设备撤销级联会话失效          | 会话绑定、越权设备、级联撤销测试             |
| M2-T04 会话安全       | 会话/CSRF 仅存哈希、Secure/HttpOnly/SameSite、CSRF 校验、登出撤销   | Cookie 标志、CSRF 缺失、重启后会话和撤销测试 |
| M2-T05 Attention 深链 | 短期 nonce 只定位 Attention；兑换需要既有会话；nonce 不建立会话     | 单次、过期、无会话拒绝、链接转发负向测试     |
| M2-T06 新设备确认     | 新设备额外确认码；确认失败与新设备登记均审计                        | 正确/错误确认码、设备归属测试                |
| M2-T07 认证负向测试   | 撞库、限流、TOTP 重放、proof 重放、跨动作/资源、旧会话和 nonce 转发 | 聚焦服务、HTTP、MySQL 并发与 UI 契约测试     |

## 2. 安全与数据设计

新增认证核心位于 `src/codex/core/control/auth/`：

- `password.js`：有界 scrypt 参数、随机盐、编码格式校验和恒定时间比较；
- `secret-box.js`：AES-256-GCM，显式 32 字节密钥和 AAD 绑定；
- `auth-service.js`：登录、TOTP、设备、会话、CSRF、step-up proof 和 nonce；
- `memory-auth-store.js` / `mysql-auth-store.js`：同一异步仓储契约的内存与 MySQL 实现；
- `policy.js`：集中定义 pause、resume、retry、request_changes、approve、cancel、
  accept_delivery 和 device.revoke 的最低授权。

高风险操作先创建绑定 `session + action + resourceId` 的挑战，再兑换一次性 proof。
proof 消费、TOTP 计数器、设备撤销和 nonce 兑换均在事务/原子更新中只有一个赢家。
认证审计只记录事件、结果、关联 ID 和脱敏详情，不保存密码、TOTP、token、CSRF、
proof、nonce 或确认码原文。

MySQL 迁移 `003-auth-hardening.sql` 在保留 M1 表的前提下增加：

- 大小写敏感用户名唯一约束、TOTP 注册状态与最后使用计数器；
- `auth_challenge`、`attention_nonce`、`auth_rate_limit`、`auth_audit`；
- 认证审计 append-only 触发器。

M1 逻辑备份/恢复表清单已扩展到认证表；真实 MySQL 恢复已验证用户、设备、会话、
挑战、限流和审计数据数量一致。

## 3. 运行与配置

远程管理面必须提供：

- `SPECGATE_MYSQL_CONFIG`：绝对路径 MySQL JSON 配置；
- `SPECGATE_AUTH_ENCRYPTION_KEY`：64 位十六进制或 43 字符 base64url 的 256 位密钥；
- `SPECGATE_AUTH_DEVICE_CONFIRMATION_CODE` 或对应 SHA-256 哈希；
- `SPECGATE_AUTH_USERNAME` / `SPECGATE_AUTH_PASSWORD` 仅用于本地 `auth-init`。

`npm run codex:control -- auth-init` 创建 owner 并只显示一次 TOTP 注册 URI/种子。
远程模式不返回配对链接；账号登录成功后才签发会话 Cookie 和可读 CSRF Cookie。
消息链接使用 `#attention=<id>&nonce=<nonce>`，nonce 不进入 Cookie、localStorage
或会话建立接口。

## 4. 验证证据

真实 MySQL 实例边界：

- MySQL Community Server `8.4.13`，InnoDB，UTC；
- 项目内 `.runtime/mysql-m2/`，仅绑定 `127.0.0.1:34367`；
- 随机测试数据库自动创建和删除；连接配置仅保存在本地忽略目录；
- 未安装系统服务，未修改全局 MySQL 配置。

最终全仓检查：

| 命令                           | 真实结果                                     | 退出码 |
| ------------------------------ | -------------------------------------------- | ------ |
| M2 聚焦认证/HTTP/UI/MySQL 套件 | 86 项，86 通过；含 9 个真实 MySQL 场景       | 0      |
| `npm test`（配置真实 MySQL）   | 595 项，594 通过，0 失败，1 跳过             | 0      |
| `npm run lint`                 | 无 ESLint finding                            | 0      |
| `npm run format:check`         | `All matched files use Prettier code style!` | 0      |
| `npm run pack:check`           | tarball 检查通过，包含认证源码与迁移         | 0      |
| `git diff --check`             | 无空白错误                                   | 0      |

命令、源码摘要和未执行项同时记录在
`docs/verification/codex-control-plane-product/m2-2026-10-24.json`。

跳过项仍为：

- `requesting the react frontend without its template tree fails closed`；
- 原因是本机存在 React 模板树，因此该条件没有执行，不计为通过。

真实 MySQL 认证套件覆盖：

- 003 迁移重复执行与 M1 向后兼容；
- TOTP 计数器跨连接池竞争只有一个成功；
- 登录限流并发严格只允许配置数量；
- challenge/proof 两阶段消费单赢家；
- 设备撤销会话级联；
- 真实 HTTP 账号登录、CSRF、TOTP step-up 和受控 mutation；
- 认证审计脱敏与 append-only；
- 认证状态逻辑备份与空库恢复。

## 5. 未执行与后续边界

以下仍为 `NOT_RUN`，不因本轮测试通过而改变：

- 真实云服务器、域名证书、反向代理和手机浏览器试点；
- 真实飞书/钉钉消息中的 Attention nonce 端到端投递；
- 生产身份提供方、密钥托管、恢复码和账号生命周期管理；
- 跨平台 MySQL 8.0.x 单独矩阵与生产灾备演练；
- M3 本地主动出站 Worker、M4 原 Codex session resume、M5 通知生命周期；
- 用户对本阶段交付的人工接受。

## 6. 阶段结论

M2 的认证、设备、会话、深链和负向安全退出条件已由真实命令与 MySQL 集成证据覆盖。
本轮代码自查、全仓测试和机械门禁通过；未运行的云部署与真实渠道项保持显式未验证。
本阶段结束后停止，等待用户接受后再进入 M3。
