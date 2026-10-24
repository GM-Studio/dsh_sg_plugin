# 验收映射与证据台账

- 更新日期：2026-10-24（历史证据日期保持原样）
- 当前实施分支：`sg-codex`；历史基线分支：`feat_web`
- 需求基线：`docs/requirements/2026-10-23-codex-ai-delivery-control-plane-product.zh.md`
- 需求字节哈希：`16875BBF80B6960A205763E1C7C0192626D0520E275FA4DCE91F277EE99CBBC6`
- 计划基线：`docs/plans/2026-10-23-codex-ai-delivery-control-plane-product-plan.zh.md`
- 计划字节哈希：`CE64DC087A6F4CA1EB63292E7FBC779836D75CA8F84C4DA5883CD07F8520272A`
- 状态：**M0-M7 实现与真实 MySQL 验证已具备证据；M2-M7 人工接受待确认，再交付与云部署仍为 NOT_RUN / PARTIAL**

本文件只记录验收口径、证据位置和真实状态。设计完成、代码生成、测试文件存在，均不能替代真实执行证据。状态取值限定为：

- `NOT_RUN`：尚未执行；
- `PARTIAL`：只有部分证据，或仅有受控等价验证；
- `PASS`：有可复核的自动化或人工证据；
- `FAIL`：执行失败且尚未修复；
- `SKIPPED`：经明确决定跳过，并记录原因。

## 1. 证据规则

- 自动化证据必须记录测试文件、测试名、命令、退出码和提交或工作树标识；
- 人工证据必须记录操作人、时间、环境、步骤和可复核输出；
- 未提交的工作树只能使用 `WORKTREE-<日期>-<序号>` 作为临时制品标识；
- 真实 MySQL、真实云部署、真实飞书/钉钉投递、真实 TOTP 必须分别取证；
- 冻结验收测试不得由实现者为了让结果通过而修改；
- 未执行、跳过、取消、超时和失败必须显式保留，不得折叠成“通过”。

## 2. AC01-AC16 映射

| AC   | 验收口径         | 自动化或人工步骤                                                                                                | 证据类型                         | 当前状态 | 证据 / 原因                                                                                                     |
| ---- | ---------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| AC01 | 远程通知闭环     | 创建 WorkItem，触发 H1/H3 Attention；验证飞书与钉钉各一条通知、执行进程退出、租约释放、链接定位正确 Attention   | 集成测试 + 真实渠道记录          | PARTIAL  | M3-M5 已证明租约释放、双渠道独立投递和 Attention 链接；真实飞书/钉钉渠道与手机跳转待 M9                         |
| AC02 | 链接转发安全     | 将消息链接交给无会话客户端；验证不能建立管理会话、不能读取、不能批准，只返回登录或失效提示                      | 自动化负向测试 + 人工浏览器验证  | PARTIAL  | M2 已证明短期 Attention nonce、单次兑换、无会话拒绝和无法建立会话；真实手机浏览器人工验证仍未执行               |
| AC03 | 高风险 step-up   | 分别提交无当前操作 TOTP 的 H1/H3、cancel、accept_delivery；验证拒绝并审计                                       | 自动化负向测试                   | PARTIAL  | M2 已证明动作/资源绑定 proof、TOTP 重放拒绝和认证审计；真实独立 Authenticator 设备与人工操作仍未执行            |
| AC04 | 旧制品失效       | 冻结 artifactHash 后替换制品；尝试应用旧 Decision；验证 STALE、新 Attention、必须重新决策                       | 自动化测试 + 端到端测试          | PARTIAL  | M1 真实 MySQL 覆盖旧 revision / artifactHash 拒绝且无部分写入；STALE 账本流转与真实 Worker 应用前复验仍待 M3-M6 |
| AC05 | 决策幂等         | 同一幂等键并发/重复提交；验证一个 Decision、一次恢复、一次结果通知                                              | 并发自动化测试                   | PARTIAL  | M1+M4 已证明 Decision 唯一、单消费者 PENDING_APPLY/APPLIED 和一次原 session 恢复；结果通知仍待 M5               |
| AC06 | Worker 断线      | Worker 离线时记录 Decision；验证 PENDING_APPLY；恢复后拉取、校验、应用或明确拒绝告警                            | 断网/重启端到端测试              | PARTIAL  | M3+M4 已证明主动出站、租约释放不完成、PENDING_APPLY、恢复后应用和失败告警；真实跨公网断网演练待 M9              |
| AC07 | 渠道故障隔离     | 模拟飞书失败、钉钉成功；验证独立投递、重试上限、失败记录、Attention 生命周期不受影响、无重复轰炸                | 故障注入测试                     | PARTIAL  | M5 已通过独立 Outbox、单渠道故障、全渠道故障、重试上限和去重测试；真实渠道故障注入待 M9                         |
| AC08 | Attention 过期   | 使用可控时钟推进提醒、临期、过期；验证 EXPIRED、链接失效、不自动批准、不自动续跑                                | 时间推进自动化测试               | PARTIAL  | M5 已覆盖确定性提醒、单次升级、独立过期和不自动续跑；真实浏览器深链失效人工验证待 M9                            |
| AC09 | 决策到再交付闭环 | 批准 -> Worker 应用 -> 原 session resume -> 再验证 -> 结果通知 -> 时间线回放                                    | 端到端测试 + 运行证据            | PARTIAL  | M4 受控 E2E 已闭合批准、Worker 应用和原 session resume；再验证、结果通知、时间线回放仍待 M5/M6/M8               |
| AC10 | 数据边界         | 注入源码、密钥、绝对路径、客户名；检查云端持久化、通知、时间线、日志                                            | 自动化脱敏测试 + 代码审查        | PARTIAL  | M1/M5/M6 已覆盖通知双脱敏、时间线 fail closed、审计脱敏和备份；日志全链路与真实云持久化待 M9                    |
| AC11 | 多项目隔离       | 创建多个项目、独立通知策略和 Worker 白名单；验证排序、决策不串项目、Worker 越权被拒                             | 集成测试 + 越权负向测试          | PARTIAL  | M3/M7 已证明 Worker 白名单、收件箱排序、项目过滤和角色裁剪；按项目独立通知策略仍待后续                          |
| AC12 | 多 Worker 预留   | 验证 Worker 注册表、独立令牌、白名单、租约、心跳；第二 Worker 越权领取失败                                      | 自动化并发与越权测试             | PASS     | M3 网关、真实 MySQL、HTTP E2E 已验证独立令牌/撤销/白名单/租约/心跳，第二 Worker 无法越权领取；正式调度仍属 M10  |
| AC13 | 未验证如实记录   | 人为跳过、取消、超时测试；验证交付记录显式列出未执行项，冻结测试不可被 AI 改写                                  | 测试 + 验收脚本                  | PARTIAL  | 本台账与 M1 设计明确列出 NOT_RUN；交付记录强制字段和冻结测试机制未实现                                          |
| AC14 | 保留期与审计     | 配置 7 天/30 天/1 年；执行删除并检查审计；篡改审计链；验证显式失败或告警                                        | 自动化测试 + 真实 MySQL 运维演练 | PARTIAL  | M1 真实 MySQL 覆盖并发链、篡改/尾删拒绝、删除回滚、保留期及加密恢复；审计到期归档和生产运维仍未执行             |
| AC15 | 部署安全         | 远程模式缺少 HTTPS、可信代理、Host/Origin 或安全 Cookie 时拒绝启动；伪造 Host/Origin 被拒；默认本地模式保持兼容 | 自动化安全测试 + 代理实测        | PARTIAL  | 自动化门禁与请求级校验已通过；真实反向代理 HTTPS 端到端仍为 `NOT_RUN`                                           |
| AC16 | 快速再交付       | 修复后重新验证；新交付绑定新 hash；旧决策失效；历史交付保留；引用原交付与受影响 AC                              | 端到端测试 + 交付记录检查        | PARTIAL  | 现有 artifact 绑定与部分交付语义存在；增量再交付闭环未验证                                                      |

| `docs/implementation/2026-10-23-codex-ai-delivery-control-plane/07-m1-persistence-design.md` | M1 历史契约与风险 | 历史记录 | 2026-10-24 后续证据见 08-m1-mysql-delivery.md |
| `src/codex/core/control/persistence/migrations/001-initial.sql` | MySQL 8.0+ 基线 schema | PARTIAL | 001 和 002 已在隔离 MySQL 8.4.13 执行；不代表全部产品 AC 通过 |
| `test/codex-control-persistence-*.test.js` | M1 受控契约回归 | PARTIAL | 历史 36/36；2026-10-24 聚焦 52/52 含真实 MySQL 与离线包，见阶段报告 |

## 3. 当前可引用的证据

| 证据                                                                                         | 内容                                                        | 状态     | 说明                                                                                         |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `docs/implementation/2026-10-23-codex-ai-delivery-control-plane/00-freeze-reconciliation.md` | 冻结正文当前字节哈希与历史哈希差异                          | PASS     | 只证明字节摘要；不证明历史差异性质                                                           |
| `docs/implementation/2026-10-23-codex-ai-delivery-control-plane/01-baseline-report.md`       | 环境、命令和基线缺陷                                        | PASS     | 只记录实际执行结果                                                                           |
| `docs/implementation/2026-10-23-codex-ai-delivery-control-plane/02-data-boundary.md`         | 数据分类与驻留规则                                          | 设计完成 | 不代表 AC10 通过                                                                             |
| `docs/implementation/2026-10-23-codex-ai-delivery-control-plane/03-threat-model.md`          | 威胁与控制映射                                              | 设计完成 | 不代表安全验证通过                                                                           |
| `docs/implementation/2026-10-23-codex-ai-delivery-control-plane/04-deployment-boundary.md`   | 部署拓扑与网络边界                                          | 设计完成 | 不代表 AC15 通过                                                                             |
| `test/codex-management-security.test.js`                                                     | pairing、CSRF、step-up 负向、限流、静态路径、Secure Cookie  | 既有基线 | 未覆盖远程模式启动门禁与 Host/Origin                                                         |
| `test/codex-control-daemon.test.js`                                                          | 本地 daemon、通知 outbox、租约释放等部分路径                | 既有基线 | 不覆盖真实云端或主动出站 Worker                                                              |
| `test/codex-control-config.test.js`                                                          | 本地配置与多项目模式                                        | 既有基线 | 不覆盖远程部署配置                                                                           |
| `test/codex-management-remote-mode.test.js`                                                  | 远程启动门禁、可信代理、HTTPS、Host/Origin、Secure Cookie   | PASS     | 2026-10-23 聚焦测试 40/40 通过；工作树 `WORKTREE-2026-10-23-01`；未覆盖真实代理              |
| `test/codex-control-daemon.test.js`                                                          | 远程 daemon 配置不完整拒绝启动、完整配置启动后拒绝伪造 Host | PASS     | 与远程模式测试同批执行；仅证明受控本机等价环境                                               |
| `npm test`                                                                                   | 全量测试回归                                                | PASS     | 527 tests / 526 pass / 0 fail / 1 skipped；退出码 `0`；跳过项为 React 模板树已存在的条件用例 |
| `09-m2-auth-delivery.md`                                                                     | M2 账号、TOTP、设备、会话、nonce 和 step-up                 | PASS     | 真实 MySQL；聚焦 86/86；全仓 595/594/0/1，见 M2 报告与 JSON                                  |
| `10-m3-worker-delivery.md`                                                                   | M3 Worker 注册、出站、白名单、租约、补偿和命令边界          | PASS     | 真实 MySQL；M3 聚焦 80/80；全仓 636/635/0/1，见 M3 报告与 JSON                               |
| `docs/verification/codex-control-plane-product/m3-2026-10-24.json`                           | M3 命令、源码摘要和未执行项                                 | PASS     | 绑定 M3 源码文件哈希；不替代真实云网络和 M4 恢复闭环                                         |
| `11-m4-codex-recovery-delivery.md`                                                           | M4 远程执行、举手、Decision 应用与原 session resume         | PASS     | M4 聚焦 68/68/0/0；全仓 662/661/0/1，见 M4 报告与 JSON                                       |
| `docs/verification/codex-control-plane-product/m4-2026-10-24.json`                           | M4 命令、源码摘要和未执行项                                 | PASS     | 绑定 M4 源码文件哈希；不替代真实 Codex 模型执行和云上试点                                    |
| `12-m5-notifications-delivery.md`                                                            | M5 双渠道、扇出和 Attention 生命周期                        | PASS     | M5 聚焦 63/63；真实渠道投放待 M9，见 M5 报告与 JSON                                          |
| `13-m6-timeline-delivery.md`                                                                 | M6 证据时间线与审计查询                                     | PASS     | M6 聚焦 21/21；真实云审计导出待 M9，见 M6 报告与 JSON                                        |
| `14-m7-inbox-sse-delivery.md`                                                                | M7 例外收件箱、权限裁剪与 SSE                               | PASS     | M7 聚焦 18/18；真实浏览器/公网 SSE 待 M9，见 M7 报告与 JSON                                  |
| `docs/verification/codex-control-plane-product/m5-2026-10-24.json` … `m7-2026-10-24.json`    | M5-M7 命令、源码摘要和未执行项                              | PASS     | 分别绑定阶段源码哈希；不替代真实渠道、浏览器和云部署                                         |
| `npm run lint`                                                                               | 全仓 lint                                                   | FAIL     | 仅既有 `src/codex/change-add.js` 3 个未使用符号错误；本轮未修改该文件                        |
| `npm run format:check`                                                                       | 全仓格式检查                                                | FAIL     | 仅既有 `src/codex/change-add.js`；本轮改动文件的精确 Prettier 检查另行记录                   |
| `npm pack --dry-run --cache .npm-cache`                                                      | 打包内容检查                                                | PASS     | package 628.5 kB、total files 308、退出码 `0`；默认 npm 缓存路径存在 EPERM                   |

## 4. M0 退出判定

M0 只有在以下条件同时满足时才能退出：

- [x] 冻结正文与当前字节哈希已对账；
- [x] 数据边界、威胁模型、部署边界文档已形成；
- [x] 验收映射覆盖 AC01-AC16；
- [x] 回滚与停用方案已形成；
- [x] AC15 远程启动门禁的自动化测试通过；
- [x] Host/Origin 请求级校验的自动化测试通过；
- [x] 本地默认模式回归测试通过；
- [x] 基线 lint 和 format 失败已明确记录为不阻塞 M0 的既有问题；本轮未修改 `src/codex/change-add.js`；
- [x] 以上结果已写回本台账并绑定工作树证据 `WORKTREE-2026-10-23-01`。

### 4.1 AC15 执行证据

- 命令：`node --import ./test/setup-temp.mjs --test test/codex-management-remote-mode.test.js test/codex-control-config.test.js test/codex-management-security.test.js test/codex-control-daemon.test.js`
- 结果：`tests 40`、`pass 40`、`fail 0`、退出码 `0`
- 覆盖：远程配置缺失拒绝启动；非 HTTPS、伪造 Host、缺失/伪造 Origin 拒绝；非可信代理拒绝；可信 HTTPS 代理请求通过；Secure Cookie；默认本地模式回归
- 未覆盖：真实 Nginx/Caddy 等 TLS 终止代理、真实公网域名、浏览器端到端
- 工作树标识：`WORKTREE-2026-10-23-01`

### 4.2 全量回归与质量门禁证据

- 全量测试命令：`npm test`
- 全量测试结果：`tests 527`、`pass 526`、`fail 0`、`cancelled 0`、`skipped 1`、`todo 0`，退出码 `0`
- 跳过项：`requesting the react frontend without its template tree fails closed`，原因 `# react template tree is already on disk`；该项未执行，不能计为通过
- lint 命令：`npm run lint`
- lint 结果：`FAIL`；仅 `src/codex/change-add.js` 的 3 个既有未使用符号错误（`createHash`、`validQuestion`、`validAnswer`），本轮未修改该文件
- 全仓格式命令：`npm run format:check`
- 全仓格式结果：`FAIL`；仅既有 `src/codex/change-add.js` 被报告
- 打包命令：`npm pack --dry-run --cache .npm-cache`
- 打包结果：`PASS`；package size `628.5 kB`、total files `308`、退出码 `0`
- 工作树标识：`WORKTREE-2026-10-23-01`

### 4.3 本轮改动文件的格式检查

- 命令：`npx prettier --check "docs/implementation/2026-10-23-codex-ai-delivery-control-plane/*.md" src/codex/control/config.js src/codex/control/daemon.js src/codex/management/server.js test/codex-control-config.test.js test/codex-control-daemon.test.js test/codex-management-remote-mode.test.js`
- 结果：`PASS`；`All matched files use Prettier code style!`，退出码 `0`。
- 说明：该检查不覆盖、也不能掩盖全仓 `src/codex/change-add.js` 的既有失败。

### 4.4 M1 受控持久化证据

- 命令：`node --import ./test/setup-temp.mjs --test test/codex-control-persistence-migrations.test.js test/codex-control-persistence-state-machine.test.js test/codex-control-persistence-schema.test.js test/codex-control-persistence-repository.test.js test/codex-control-persistence-audit-retention.test.js`
- 结果：`tests 36`、`pass 36`、`fail 0`、`cancelled 0`、`skipped 0`、退出码 `0`
- 覆盖：Project 版本契约、WorkItem CAS、Decision 幂等与旧制品拒绝、Evidence/Notification 去重、Audit 链、保留期 fail closed、迁移校验和与失败诊断
- 性质：受控内存等价验证，不代表真实 MySQL、InnoDB 并发或生产迁移通过
- 未执行：真实 MySQL 8.0、备份恢复、真实 Worker、飞书/钉钉、云端部署、真实 TOTP
- 工作树标识：`WORKTREE-2026-10-23-02`

### 4.5 M1 真实 MySQL 后续证据（2026-10-24）

- 制品标识：`WORKTREE-2026-10-24-M1`，起始提交 `06482cf8601292860cc647667ac5b93313a8ef99`；最终提交包含报告与代码。
- 环境：Windows、Node 24.14.0、npm 11.9.0、真实 MySQL Community 8.4.13。
- 聚焦测试 52/52、失败 0、跳过 0、退出码 0；包括两池并发 CAS/幂等/审计、SQL 故障回滚和加密备份恢复。
- 完整命令、全仓检查及剩余边界见 [M1 MySQL 交付报告](08-m1-mysql-delivery.md)。
- 此记录更新当前证据，不覆盖上面的历史失败和 NOT_RUN；完整产品 AC 仍按对应剩余路径保留 PARTIAL。

### 4.6 M2 认证与深链证据（2026-10-24）

- 制品标识：`WORKTREE-2026-10-24-M2`。
- 聚焦测试 86/86，通过真实 MySQL 的 TOTP 防重放、设备撤销级联、会话/CSRF、
  一次性 step-up proof、Attention nonce、认证审计和逻辑恢复。
- 全仓测试 595 项，594 通过、0 失败、1 跳过；详细命令和未执行项见
  [M2 交付报告](09-m2-auth-delivery.md)。
- 真实手机认证器、真实公网 HTTPS 和人工浏览器转发测试仍未执行。

### 4.7 M3 Worker 连接证据（2026-10-24）

- 制品标识：`WORKTREE-2026-10-24-M3`。
- M3 聚焦测试 80/80；真实 MySQL 覆盖 token 轮换/撤销、白名单事务、命令/事件
  去重、heartbeat/offline、租约哈希、审计和备份恢复。
- 真实 HTTP E2E 使用三个 Worker 验证项目白名单、双 Worker 单租约、释放不完成、
  命令 ACK、事件重放、任意 shell 拒绝和撤销后认证失败。
- 全仓测试 636 项，635 通过、0 失败、1 跳过；真实网络分区、云代理和 M4
  Codex 恢复仍未执行，见 [M3 交付报告](10-m3-worker-delivery.md)。

### 4.8 M4 Codex 恢复闭环证据（2026-10-24）

- 制品标识：`WORKTREE-2026-10-24-M4`。
- M4 聚焦测试 68 项，68 通过、0 失败、0 跳过；全仓 662 项，661 通过、
  0 失败、1 跳过。
- 受控 HTTP E2E 已验证 waiting → 释放 lease → approve → claim resume →
  Decision APPLIED；cancel 不调用 Codex。
- 缺少原 session、adapter resume 失败和 heartbeat 失败均显式阻塞，不创建替代
  session。
- 真实 Codex 模型执行、公网代理和 M9 试点仍未执行，见
  [M4 交付报告](11-m4-codex-recovery-delivery.md)。

### 4.9 M5 通知与生命周期证据（2026-10-24）

- 制品标识：`WORKTREE-2026-10-24-M5`。
- M5 聚焦测试 63 项，63 通过、0 失败、0 跳过。
- Feishu/DingTalk 使用独立 channel、Outbox、重试和回执；单渠道失败不阻塞另一渠道。
- 可控时钟验证提醒、单次升级、独立过期和重复 tick 幂等。
- 真实 Webhook 和移动端链接仍未执行，见
  [M5 交付报告](12-m5-notifications-delivery.md)。

### 4.10 M6 时间线与审计证据（2026-10-24）

- 制品标识：`WORKTREE-2026-10-24-M6`。
- M6 聚焦测试 21 项，21 通过、0 失败、0 跳过。
- 14 类离散事件、artifact/版本区分、脱敏 fail closed、审计链查询/导出和
  WorkItem 时间线 UI 已验证。
- 真实云审计导出和人工回放仍未执行，见
  [M6 交付报告](13-m6-timeline-delivery.md)。

### 4.11 M7 例外收件箱与 SSE 证据（2026-10-24）

- 制品标识：`WORKTREE-2026-10-24-M7`。
- M7 聚焦测试 18 项，18 通过、0 失败、0 跳过。
- 已验证风险/临期排序、项目过滤、通知失败/过期可见、角色裁剪、SSE 回放/背压和
  15 秒轮询回退。
- 真实浏览器 EventSource、公网代理和移动断网仍未执行，见
  [M7 交付报告](14-m7-inbox-sse-delivery.md)。

## 5. 维护规则

- 每次执行验收后更新对应行，不得只更新总结；
- 证据失效时回退状态，不得保留过期 PASS；
- 真实环境未执行时保持 `NOT_RUN` 或 `PARTIAL`；
- 冻结需求或计划变更时，先建立新版本并重新审批，再更新本映射。
