# 验收映射与证据台账

- 日期：2026-10-23
- 分支：`feat_web`
- 需求基线：`docs/requirements/2026-10-23-codex-ai-delivery-control-plane-product.zh.md`
- 需求字节哈希：`16875BBF80B6960A205763E1C7C0192626D0520E275FA4DCE91F277EE99CBBC6`
- 计划基线：`docs/plans/2026-10-23-codex-ai-delivery-control-plane-product-plan.zh.md`
- 计划字节哈希：`CE64DC087A6F4CA1EB63292E7FBC779836D75CA8F84C4DA5883CD07F8520272A`
- 状态：**M0 已完成；AC15 仍为 PARTIAL，真实代理与云端链路未验证**

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

| AC   | 验收口径         | 自动化或人工步骤                                                                                                | 证据类型                         | 当前状态 | 证据 / 原因                                                                    |
| ---- | ---------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------- | ------------------------------------------------------------------------------ |
| AC01 | 远程通知闭环     | 创建 WorkItem，触发 H1/H3 Attention；验证飞书与钉钉各一条通知、执行进程退出、租约释放、链接定位正确 Attention   | 集成测试 + 真实渠道记录          | NOT_RUN  | 现有飞书 outbox 与 daemon 测试只覆盖单渠道路径，钉钉未实现                     |
| AC02 | 链接转发安全     | 将消息链接交给无会话客户端；验证不能建立管理会话、不能读取、不能批准，只返回登录或失效提示                      | 自动化负向测试 + 人工浏览器验证  | PARTIAL  | 现有一次性 pairing token 测试可证明 token 消费，不足以证明转发后的完整授权边界 |
| AC03 | 高风险 step-up   | 分别提交无当前操作 TOTP 的 H1/H3、cancel、accept_delivery；验证拒绝并审计                                       | 自动化负向测试                   | PARTIAL  | 现有测试覆盖缺少 step-up 的拒绝；当前操作绑定、TOTP 重放和真实 TOTP 未验证     |
| AC04 | 旧制品失效       | 冻结 artifactHash 后替换制品；尝试应用旧 Decision；验证 STALE、新 Attention、必须重新决策                       | 自动化测试 + 端到端测试          | PARTIAL  | 现有服务存在 artifact hash 与冲突语义，真实 Worker 应用前复验未验证            |
| AC05 | 决策幂等         | 同一幂等键并发/重复提交；验证一个 Decision、一次恢复、一次结果通知                                              | 并发自动化测试                   | PARTIAL  | 现有测试覆盖部分重复决策语义；跨进程和真实 MySQL 唯一约束未验证                |
| AC06 | Worker 断线      | Worker 离线时记录 Decision；验证 PENDING_APPLY；恢复后拉取、校验、应用或明确拒绝告警                            | 断网/重启端到端测试              | NOT_RUN  | 当前实现为本地同进程管理面，主动出站 Worker 尚未实现                           |
| AC07 | 渠道故障隔离     | 模拟飞书失败、钉钉成功；验证独立投递、重试上限、失败记录、Attention 生命周期不受影响、无重复轰炸                | 故障注入测试                     | NOT_RUN  | 多渠道扇出与钉钉适配器尚未实现                                                 |
| AC08 | Attention 过期   | 使用可控时钟推进提醒、临期、过期；验证 EXPIRED、链接失效、不自动批准、不自动续跑                                | 时间推进自动化测试               | PARTIAL  | 现有 Attention 有过期字段和部分语义，提醒/升级/深链失效的完整链路未验证        |
| AC09 | 决策到再交付闭环 | 批准 -> Worker 应用 -> 原 session resume -> 再验证 -> 结果通知 -> 时间线回放                                    | 端到端测试 + 运行证据            | PARTIAL  | 本地决策与 outbox 有部分测试；云端 Worker 与真实 session resume 未验证         |
| AC10 | 数据边界         | 注入源码、密钥、绝对路径、客户名；检查云端持久化、通知、时间线、日志                                            | 自动化脱敏测试 + 代码审查        | PARTIAL  | 现有管理响应和通知有脱敏；云端持久化与 fail-closed 全链路未验证                |
| AC11 | 多项目隔离       | 创建多个项目、独立通知策略和 Worker 白名单；验证排序、决策不串项目、Worker 越权被拒                             | 集成测试 + 越权负向测试          | PARTIAL  | 本地聚合模式有项目注册与队列逻辑；云端多项目隔离未验证                         |
| AC12 | 多 Worker 预留   | 验证 Worker 注册表、独立令牌、白名单、租约、心跳；第二 Worker 越权领取失败                                      | 自动化并发与越权测试             | NOT_RUN  | 当前只有单 Worker 本地 supervisor，Worker 注册与令牌模型未实现                 |
| AC13 | 未验证如实记录   | 人为跳过、取消、超时测试；验证交付记录显式列出未执行项，冻结测试不可被 AI 改写                                  | 测试 + 验收脚本                  | PARTIAL  | 本台账与基线报告按事实记录；交付记录强制字段和冻结测试机制未实现               |
| AC14 | 保留期与审计     | 配置 7 天/30 天/1 年；执行删除并检查审计；篡改审计链；验证显式失败或告警                                        | 自动化测试 + 真实 MySQL 运维演练 | PARTIAL  | 当前 JSONL 事件链有哈希完整性；MySQL 保留期和删除审计未验证                    |
| AC15 | 部署安全         | 远程模式缺少 HTTPS、可信代理、Host/Origin 或安全 Cookie 时拒绝启动；伪造 Host/Origin 被拒；默认本地模式保持兼容 | 自动化安全测试 + 代理实测        | PARTIAL  | 自动化门禁与请求级校验已通过；真实反向代理 HTTPS 端到端仍为 `NOT_RUN`          |
| AC16 | 快速再交付       | 修复后重新验证；新交付绑定新 hash；旧决策失效；历史交付保留；引用原交付与受影响 AC                              | 端到端测试 + 交付记录检查        | PARTIAL  | 现有 artifact 绑定与部分交付语义存在；增量再交付闭环未验证                     |

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
| `npm test`                                                                                   | 全量测试回归                                                | PASS     | 491 tests / 490 pass / 0 fail / 1 skipped；退出码 `0`；跳过项为 React 模板树已存在的条件用例 |
| `npm run lint`                                                                               | 全仓 lint                                                   | FAIL     | 仅既有 `src/codex/change-add.js` 3 个未使用符号错误；本轮未修改该文件                        |
| `npm run format:check`                                                                       | 全仓格式检查                                                | FAIL     | 仅既有 `src/codex/change-add.js`；本轮改动文件的精确 Prettier 检查另行记录                   |
| `npm pack --dry-run --cache .npm-cache`                                                      | 打包内容检查                                                | PASS     | package 616.6 kB、total files 304、退出码 `0`；默认 npm 缓存路径存在 EPERM                   |

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
- 全量测试结果：`tests 491`、`pass 490`、`fail 0`、`cancelled 0`、`skipped 1`、`todo 0`，退出码 `0`
- 跳过项：`requesting the react frontend without its template tree fails closed`，原因 `# react template tree is already on disk`；该项未执行，不能计为通过
- lint 命令：`npm run lint`
- lint 结果：`FAIL`；仅 `src/codex/change-add.js` 的 3 个既有未使用符号错误（`createHash`、`validQuestion`、`validAnswer`），本轮未修改该文件
- 全仓格式命令：`npm run format:check`
- 全仓格式结果：`FAIL`；仅既有 `src/codex/change-add.js` 被报告
- 打包命令：`npm pack --dry-run --cache .npm-cache`
- 打包结果：`PASS`；package size `616.6 kB`、total files `304`、退出码 `0`
- 工作树标识：`WORKTREE-2026-10-23-01`

### 4.3 本轮改动文件的格式检查

- 命令：`npx prettier --check "docs/implementation/2026-10-23-codex-ai-delivery-control-plane/*.md" src/codex/control/config.js src/codex/control/daemon.js src/codex/management/server.js test/codex-control-config.test.js test/codex-control-daemon.test.js test/codex-management-remote-mode.test.js`
- 结果：`PASS`；`All matched files use Prettier code style!`，退出码 `0`。
- 说明：该检查不覆盖、也不能掩盖全仓 `src/codex/change-add.js` 的既有失败。

## 5. 维护规则

- 每次执行验收后更新对应行，不得只更新总结；
- 证据失效时回退状态，不得保留过期 PASS；
- 真实环境未执行时保持 `NOT_RUN` 或 `PARTIAL`；
- 冻结需求或计划变更时，先建立新版本并重新审批，再更新本映射。
